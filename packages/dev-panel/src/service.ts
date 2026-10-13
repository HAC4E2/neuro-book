#!/usr/bin/env bun
/**
 * 管理 `install-service` 装好的面板服务，开发者不用记单元名。不进 nbdev 的命令面（那是给 Agent 用的）。
 * 单元名与主工作区的定位同 `install-service`：`--target` 缺省是本脚本所在仓库的主工作区，给了 worktree 也按它的主工作区。
 * systemctl、journalctl 的输出直接到终端，退出码照传（`status` 在服务停着时非 0 是 systemctl 的语义）；
 * 本脚本自己的失败（用法、没装服务、命令起不来）按 nbdev 的错误码与退出码。
 * 用法：bun run --cwd packages/dev-panel service <status|start|stop|restart|logs> [--target <checkout>] [--follow] [--lines <n>]
 *       便捷入口 service:status、service:start、service:stop、service:restart、service:logs，参数接在后面（如 service:logs --follow）。
 */
import {spawn} from "node:child_process";
import {lstat} from "node:fs/promises";
import {constants} from "node:os";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {emit, toNbdevError, type CliIo} from "./cli/output.js";
import {NbdevError, systemErrorCode} from "./core/errors.js";
import {locateRepository} from "./core/repo.js";
import {serviceUnitName, userUnitDir} from "./install-service.js";

/** `emit` 要一个外壳名；本脚本不带 `--json`（输出是 systemctl、journalctl 的原样输出），它不出现在输出里。 */
const SCHEMA = "nbdev.service/v1";
const ACTIONS = ["status", "start", "stop", "restart", "logs"] as const;
type ServiceAction = (typeof ACTIONS)[number];
const USAGE = "用法：bun run --cwd packages/dev-panel service <status|start|stop|restart|logs> [--target <checkout>] [--follow] [--lines <n>]";
const DONE: Record<"start" | "stop" | "restart", string> = {start: "已启动", stop: "已停止", restart: "已重启"};
/** 登录会话只在一个服务实例里有效（见 docs/panel.md 的“登录”），服务一重启浏览器就要重新登录。 */
const LOGIN_HINT = "服务重启后浏览器要重新登录：运行 nbdev panel open --print，打开打印的链接";
const SPAWN_FAILURE = {systemctl: "systemctl_failed", journalctl: "journalctl_failed"} as const;
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function isAction(value: string): value is ServiceAction {
    return (ACTIONS as readonly string[]).includes(value);
}

function linesOption(value: string | undefined): string {
    if (value === undefined) return "100";
    if (!/^\d+$/u.test(value)) throw new NbdevError("usage", `--lines 要写非负整数：${value}`, {details: {lines: value}});
    return value;
}

async function exists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return false;
        throw error;
    }
}

/**
 * 子进程继承本进程的 stdin、stdout、stderr；本进程收到的结束信号转给它，`journalctl -f` 不会在本进程被结束后成为孤儿。
 * 终端里按 Ctrl+C 时两者都收到 SIGINT，本进程不先退出，等子进程退出后照传它的退出码；子进程被信号结束时按 shell 的惯例是 128 加信号值。
 */
function runInherited(command: keyof typeof SPAWN_FAILURE, args: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, [...args], {env, stdio: "inherit"});
        const forward = (signal: NodeJS.Signals) => {
            child.kill(signal);
        };
        for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);
        const detach = () => {
            for (const signal of FORWARDED_SIGNALS) process.off(signal, forward);
        };
        child.once("error", (error) => {
            detach();
            rejectPromise(new NbdevError(SPAWN_FAILURE[command], `${command} ${args.join(" ")} 起不来：${error.message}`, {details: {args}, cause: error}));
        });
        child.once("close", (code, signal) => {
            detach();
            resolvePromise(code ?? 128 + (signal ? constants.signals[signal] : 0));
        });
    });
}

/** 返回进程的退出码：systemctl、journalctl 跑起来了就是它们的退出码，否则是 nbdev 错误码对应的退出码。 */
export async function serviceCommand(argv: readonly string[], io: CliIo): Promise<number> {
    try {
        let parsed: {values: {target?: string; follow?: boolean; lines?: string}; positionals: string[]};
        try {
            parsed = parseArgs({args: [...argv], options: {target: {type: "string"}, follow: {type: "boolean"}, lines: {type: "string"}}, allowPositionals: true, strict: true});
        } catch (error) {
            if (systemErrorCode(error)?.startsWith("ERR_PARSE_ARGS_")) throw new NbdevError("usage", `${error instanceof Error ? error.message : String(error)}\n${USAGE}`, {cause: error});
            throw error;
        }
        const {values, positionals} = parsed;
        const action = positionals[0];
        if (positionals.length !== 1 || action === undefined || !isAction(action)) throw new NbdevError("usage", USAGE, {details: {positionals}});
        if (action !== "logs" && (values.follow !== undefined || values.lines !== undefined)) throw new NbdevError("usage", `--follow、--lines 只用于 logs\n${USAGE}`, {details: {action}});
        const lines = linesOption(values.lines);

        const {mainRoot} = await locateRepository(values.target ? resolve(io.cwd, values.target) : import.meta.dirname);
        const unit = serviceUnitName(mainRoot);
        const unitPath = join(userUnitDir(io.env), unit);
        if (!await exists(unitPath)) {
            throw new NbdevError("service_not_installed", `没有装面板服务（${unitPath} 不存在）：先运行 bun run --cwd packages/dev-panel install-service`, {details: {unit, unitPath, mainRoot}});
        }

        if (action === "logs") return await runInherited("journalctl", ["--user", "-u", unit, "--no-pager", "-n", lines, ...(values.follow ? ["-f"] : [])], io.env);
        if (action === "status") return await runInherited("systemctl", ["--user", "status", unit, "--no-pager"], io.env);
        const status = await runInherited("systemctl", ["--user", action, unit], io.env);
        if (status !== 0) {
            io.stderr.write(`systemctl --user ${action} ${unit} 退出码 ${status}；查看：bun run --cwd packages/dev-panel service:status、service:logs\n`);
            return status;
        }
        const human = action === "stop" ? [`${DONE[action]} ${unit}`] : [`${DONE[action]} ${unit}`, LOGIN_HINT];
        return emit({schema: SCHEMA, data: {action, unit}, warnings: [], error: null, human}, false, io);
    } catch (error) {
        return emit({schema: SCHEMA, data: null, warnings: [], error: toNbdevError(error, io), human: []}, false, io);
    }
}

if (import.meta.main) {
    process.exitCode = await serviceCommand(process.argv.slice(2), {cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr});
}
