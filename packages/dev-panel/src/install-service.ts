#!/usr/bin/env bun
/**
 * 把面板装成 systemd 用户服务 `nbdev-panel-<主工作区目录名>.service`（一个主工作区一个面板，面板锁本来就按主工作区）。
 * 不进 nbdev 的命令面（那是给 Agent 用的）。单元文件写在 `${XDG_CONFIG_HOME:-~/.config}/systemd/user/`，装完 `daemon-reload` 并 `enable --now`。
 * - `ExecStart` 用运行本脚本的 bun 的绝对路径加主工作区 `packages/dev-panel/src/cli.ts`，不经 shim（shim 可以被指到 worktree）；
 *   用户管理器的 `PATH` 不保证有 `~/.local/bin`。
 * - `Environment=NBDEV_PANEL_UNIT=<单元名>`：面板只凭这个变量判断自己是服务（`INVOCATION_ID` 在 KDE 的终端标签页里也有），据此写重启命令。
 * - 用法错误与冲突（退出码 2、3：`unsafe_host`、`port_in_use`、`panel_running`）重启也不会好，`RestartPreventExitStatus` 挡住重启风暴。
 * 用法：bun run --cwd packages/dev-panel install-service [-- --dry-run] [--port 4400] [--artifact-port 4401] [--target <checkout>] [--force] [--json]
 *       bun run --cwd packages/dev-panel install-service -- --uninstall [--target <checkout>] [--force] [--json]
 * `--target` 缺省是本脚本所在仓库的主工作区；给了 worktree 也按它的主工作区装。
 */
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {lstat, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {basename, join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {emit, toNbdevError, type CliIo} from "./cli/output.js";
import {NbdevError, systemErrorCode, type ExitCode} from "./core/errors.js";
import {locateRepository} from "./core/repo.js";
import {readRunningPanel} from "./server/panel-file.js";

export const SERVICE_MARKER = "# nbdev panel unit (installed by @notnotype/dev-panel)";

/** 单元名：主工作区目录名里 systemd 单元名不收的字符换成 `-`。 */
export function serviceUnitName(mainRoot: string): string {
    return `nbdev-panel-${basename(mainRoot).replace(/[^A-Za-z0-9_.-]/gu, "-")}.service`;
}

/** 用户单元目录 `${XDG_CONFIG_HOME:-~/.config}/systemd/user/`；`XDG_CONFIG_HOME` 不是绝对路径时按 XDG 规范忽略。 */
export function userUnitDir(env: NodeJS.ProcessEnv): string {
    const configHome = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith("/") ? env.XDG_CONFIG_HOME : join(env.HOME ?? homedir(), ".config");
    return join(configHome, "systemd", "user");
}

/** systemd 的值：`%` 是说明符要写成 `%%`；`ExecStart` 的参数含空白或引号时加双引号。 */
function unitValue(value: string): string {
    return value.replaceAll("%", "%%");
}

function execArg(value: string): string {
    const escaped = unitValue(value);
    return /[\s"'\\]/u.test(escaped) ? `"${escaped.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"` : escaped;
}

export function serviceUnit(input: {mainRoot: string; bun: string; port: number; artifactPort: number}): string {
    const unit = serviceUnitName(input.mainRoot);
    const cli = join(input.mainRoot, "packages", "dev-panel", "src", "cli.ts");
    return [
        "[Unit]",
        SERVICE_MARKER,
        `Description=nbdev 开发者项目面板（${unitValue(input.mainRoot)}）`,
        "StartLimitIntervalSec=300",
        "StartLimitBurst=5",
        "",
        "[Service]",
        "Type=simple",
        `WorkingDirectory=${unitValue(input.mainRoot)}`,
        `Environment=NBDEV_PANEL_UNIT=${unit}`,
        `ExecStart=${[input.bun, cli, "panel", "serve", "--port", String(input.port), "--artifact-port", String(input.artifactPort)].map(execArg).join(" ")}`,
        "Restart=on-failure",
        "RestartSec=5",
        "# 用法错误与冲突（unsafe_host、port_in_use、panel_running）重启也不会好，不要重启风暴。",
        "RestartPreventExitStatus=2 3",
        "KillSignal=SIGTERM",
        "# 收到 SIGTERM 先等进行中的投递结束（上限 12 秒），再收口。",
        "TimeoutStopSec=30",
        `# stdout、stderr 进 journal：journalctl --user -u ${unit}`,
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
    ].join("\n");
}

function portOption(value: string | undefined, fallback: number, name: string): number {
    if (value === undefined) return fallback;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new NbdevError("usage", `--${name} 要写 1 到 65535 的端口号：${value}`, {details: {[name]: value}});
    return port;
}

async function readIfExists(path: string): Promise<{kind: "file" | "other"; text: string | null} | null> {
    try {
        const stats = await lstat(path);
        // 符号链接不跟随去读；只有普通文件才可能是本脚本写的。
        return stats.isFile() ? {kind: "file", text: await readFile(path, "utf8")} : {kind: "other", text: null};
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
}

function systemctl(args: readonly string[]): void {
    const result = spawnSync("systemctl", ["--user", ...args], {encoding: "utf8"});
    if (result.error || result.status !== 0) {
        throw new NbdevError("systemctl_failed", `systemctl --user ${args.join(" ")} 失败：${result.error?.message ?? result.stderr.trim()}`, {details: {args, status: result.status}});
    }
}

export async function installService(argv: readonly string[], io: CliIo): Promise<ExitCode> {
    const json = argv.includes("--json");
    try {
        let values: {"dry-run"?: boolean; uninstall?: boolean; force?: boolean; port?: string; "artifact-port"?: string; target?: string};
        try {
            values = parseArgs({args: [...argv], options: {"dry-run": {type: "boolean"}, uninstall: {type: "boolean"}, force: {type: "boolean"}, port: {type: "string"}, "artifact-port": {type: "string"}, target: {type: "string"}, json: {type: "boolean"}}, strict: true}).values;
        } catch (error) {
            if (systemErrorCode(error)?.startsWith("ERR_PARSE_ARGS_")) throw new NbdevError("usage", error instanceof Error ? error.message : String(error), {cause: error});
            throw error;
        }
        const {mainRoot} = await locateRepository(values.target ? resolve(io.cwd, values.target) : import.meta.dirname);
        const unit = serviceUnitName(mainRoot);
        const unitDir = userUnitDir(io.env);
        const unitPath = join(unitDir, unit);
        const existing = await readIfExists(unitPath);
        const ours = existing?.text?.includes(SERVICE_MARKER) === true;
        const stopHint = `停止：bun run --cwd packages/dev-panel service:stop（即 systemctl --user stop ${unit}）；日志：bun run --cwd packages/dev-panel service:logs（即 journalctl --user -u ${unit}）`;

        if (values.uninstall) {
            const commands = existing ? [["disable", "--now", unit], ["daemon-reload"]] : [];
            if (existing && !ours && !values.force) throw new NbdevError("service_exists", `${unitPath} 不是本脚本写的，不删；确认删除时加 --force`, {details: {unitPath}});
            if (!values["dry-run"] && existing) {
                systemctl(commands[0]!);
                await rm(unitPath, {force: true});
                systemctl(commands[1]!);
            }
            const human = existing ? [`${values["dry-run"] ? "将删除" : "已停用并删除"} ${unitPath}`] : [`没有装过：${unitPath} 不存在`];
            return emit({schema: "nbdev.install-service/v1", data: {action: "uninstall", unit, unitPath, dryRun: values["dry-run"] === true, commands: commands.map((args) => `systemctl --user ${args.join(" ")}`)}, warnings: [], error: null, human}, json, io);
        }

        const port = portOption(values.port, 4400, "port");
        const artifactPort = portOption(values["artifact-port"], 4401, "artifact-port");
        const cliPath = join(mainRoot, "packages", "dev-panel", "src", "cli.ts");
        if (!await readIfExists(cliPath)) throw new NbdevError("shim_target_not_found", `主工作区里没有 nbdev：${cliPath}`, {details: {mainRoot, cliPath}});
        const content = serviceUnit({mainRoot, bun: process.execPath, port, artifactPort});
        const commands = [["daemon-reload"], ["enable", "--now", unit]];
        if (existing?.kind === "other") throw new NbdevError("service_exists", `${unitPath} 不是普通文件（目录或符号链接），不覆盖`, {details: {unitPath}});
        if (existing && !ours && !values.force) throw new NbdevError("service_exists", `${unitPath} 已存在且不是本脚本写的；确认覆盖时加 --force`, {details: {unitPath}});
        const running = await readRunningPanel(mainRoot);
        if (running && !values["dry-run"]) {
            throw new NbdevError("panel_running", `这个主工作区已经有面板在跑（pid ${running.pid}）：先停掉它（前台的按 Ctrl+C；服务用 systemctl --user stop ${unit}）再安装`, {details: {pid: running.pid}});
        }
        if (!values["dry-run"]) {
            await mkdir(unitDir, {recursive: true});
            const temporary = `${unitPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
            await writeFile(temporary, content, {encoding: "utf8", flag: "wx", mode: 0o644});
            try {
                await rename(temporary, unitPath);
            } catch (error) {
                await rm(temporary, {force: true});
                throw error;
            }
            for (const args of commands) systemctl(args);
        }
        const human = values["dry-run"]
            ? [`将写入 ${unitPath}：`, content, ...commands.map((args) => `将运行 systemctl --user ${args.join(" ")}`)]
            : [`已安装并启动 ${unit}（${unitPath}）`, stopHint, `打开面板：nbdev panel open（服务重启后要重新打开）`];
        return emit({schema: "nbdev.install-service/v1", data: {action: "install", unit, unitPath, dryRun: values["dry-run"] === true, content, commands: commands.map((args) => `systemctl --user ${args.join(" ")}`), mainRoot, bun: process.execPath}, warnings: [], error: null, human}, json, io);
    } catch (error) {
        return emit({schema: "nbdev.install-service/v1", data: null, warnings: [], error: toNbdevError(error, io), human: []}, json, io);
    }
}

if (import.meta.main) {
    process.exitCode = await installService(process.argv.slice(2), {cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr});
}
