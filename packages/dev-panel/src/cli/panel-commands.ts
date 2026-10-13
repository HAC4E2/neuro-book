import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {lstat} from "node:fs/promises";
import {resolve} from "node:path";
import {NbdevError, systemErrorCode, type Warning} from "../core/errors.js";
import {locateRepository} from "../core/repo.js";
import {createHerdrClient, HERDR_PANEL_READ_METHODS, resolveHerdrSocket} from "../herdr/client.js";
import {stringValue, type CommandSpec} from "./common.js";
import type {CommandOutcome} from "./output.js";

/** 面板的两个命令（t09）。服务端模块只在 `panel serve` 里按需导入，其它命令不加载它们。合同见 docs/panel.md。 */

export const PANEL_USAGE = `  panel serve [--host 127.0.0.1] [--port 4400] [--artifact-port 4401] [--no-build | --static-dir <目录>]
  panel open [--print]`;

const PACKAGE_ROOT = resolve(import.meta.dirname, "..", "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const DIST_DIR = resolve(PACKAGE_ROOT, "dist", "web");
const LOOPBACK = ["127.0.0.1", "localhost"];

function portValue(text: string | undefined, fallback: number, name: string): number {
    if (text === undefined) return fallback;
    const port = Number(text);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new NbdevError("usage", `--${name} 要写 0 到 65535 的端口：${text}`);
    return port;
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

export const PANEL_COMMANDS: Record<string, CommandSpec> = {
    "panel serve": {
        schema: "nbdev.panel-serve/v1",
        positionals: [],
        options: {host: {type: "string"}, port: {type: "string"}, "artifact-port": {type: "string"}, "no-build": {type: "boolean"}, "static-dir": {type: "string"}},
        async run({io, values}): Promise<CommandOutcome> {
            const host = stringValue(values, "host") ?? "127.0.0.1";
            if (!LOOPBACK.includes(host)) throw new NbdevError("unsafe_host", `面板只绑回环地址（${LOOPBACK.join("、")}）：${host}；跨设备访问在 t13`, {details: {host}});
            const port = portValue(stringValue(values, "port"), 4400, "port");
            const staticOption = stringValue(values, "static-dir");
            if (staticOption !== undefined && values["no-build"] === true) throw new NbdevError("usage", "--static-dir 已经跳过构建，不与 --no-build 同用");
            // 用现成的前端产物（例如别处构建好的），不构建、不看 .build-hash。
            const distDir = staticOption === undefined ? DIST_DIR : resolve(io.cwd, staticOption);
            const artifactPort = portValue(stringValue(values, "artifact-port"), 4401, "artifact-port");
            const context = await locateRepository(io.cwd);
            const log = (message: string) => io.stderr.write(`[${new Date().toISOString()}] ${message}\n`);
            const [{acquirePanelLock, writePanelInfo, removePanelInfo}, {startPanelServer}, {ensureWebBuild, stopRunningBuild}] = await Promise.all([
                import("../server/panel-file.js"), import("../server/serve.js"), import("../server/build.js"),
            ]);
            const lock = await acquirePanelLock(context.mainRoot);
            const cleanups: Array<() => Promise<void>> = [() => lock.release()];
            const cleanup = async () => {
                for (const step of cleanups.splice(0).reverse()) {
                    try {
                        await step();
                    } catch (error) {
                        log(`收口时出错：${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            };
            let stopping: (signal: string) => void = () => undefined;
            const stopped = new Promise<string>((resolvePromise) => {
                stopping = resolvePromise;
            });
            const onSignal = (signal: NodeJS.Signals) => {
                log(`收到 ${signal}，面板退出`);
                stopRunningBuild();
                stopping(signal);
            };
            // SIGHUP：关掉面板所在的终端或 herdr pane 时也要收口（删 panel.json、放锁、结束子进程）。
            for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, onSignal);
            cleanups.push(async () => {
                for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, onSignal);
            });
            const warnings: Warning[] = [];
            try {
                const token = randomBytes(32).toString("hex");
                const herdr = createHerdrClient({socketPath: resolveHerdrSocket(io.env), allow: HERDR_PANEL_READ_METHODS});
                // 先绑定两个端口再构建：端口被占时立刻失败，不白等构建。
                const server = await startPanelServer({context, host, port, artifactPort, herdr, token, log});
                cleanups.push(() => server.stop());
                await writePanelInfo(context.mainRoot, {instanceId: server.instanceId, url: server.url, artifactUrl: server.artifactUrl, token});
                cleanups.push(() => removePanelInfo(context.mainRoot));
                log(`面板在 ${server.url}（产物来源 ${server.artifactUrl}），用 nbdev panel open 打开`);
                const build = values["no-build"] === true || staticOption !== undefined
                    ? {built: false, failed: await exists(resolve(distDir, "index.html")) ? null : `没有前端产物：${distDir}`}
                    : await Promise.race([ensureWebBuild({packageRoot: PACKAGE_ROOT, repoRoot: REPO_ROOT, distDir, log}), stopped.then(() => null)]);
                if (build === null) return {schema: "nbdev.panel-serve/v1", data: {url: server.url, artifactUrl: server.artifactUrl}, warnings, error: null, human: ["面板在启动途中退出"]};
                if (build.failed !== null && !await exists(resolve(distDir, "index.html"))) throw new NbdevError("build_failed", build.failed);
                if (build.failed !== null) warnings.push({code: "build_failed", message: `前端构建失败，用的是旧的产物：${build.failed}`, details: {}});
                await server.setStatic(distDir, build);
                if (await Promise.race([server.warm(), stopped.then(() => false)])) log("预热完成");
                await stopped;
                return {schema: "nbdev.panel-serve/v1", data: {url: server.url, artifactUrl: server.artifactUrl}, warnings, error: null, human: ["面板已退出"]};
            } finally {
                await cleanup();
            }
        },
    },
    "panel open": {
        schema: "nbdev.panel-open/v1",
        positionals: [],
        options: {print: {type: "boolean"}},
        async run({io, values}): Promise<CommandOutcome> {
            const context = await locateRepository(io.cwd);
            const [{readRunningPanel}, {createLoginTicket}] = await Promise.all([import("../server/panel-file.js"), import("../server/auth.js")]);
            const panel = await readRunningPanel(context.mainRoot);
            if (!panel) throw new NbdevError("panel_not_running", "面板没有在跑：先运行 nbdev panel serve", {details: {mainRoot: context.mainRoot}});
            const loginUrl = `${panel.url}/login?ticket=${createLoginTicket(panel.token)}`;
            const warnings: Warning[] = [];
            if (values.print !== true) {
                const opened = await new Promise<string | null>((resolvePromise) => {
                    const child = spawn("xdg-open", [loginUrl], {stdio: "ignore", detached: true});
                    child.on("error", (error) => resolvePromise(error.message));
                    child.on("spawn", () => {
                        child.unref();
                        resolvePromise(null);
                    });
                });
                if (opened !== null) warnings.push({code: "open_failed", message: `没能用 xdg-open 打开浏览器（${opened}）；手动打开下面的链接`, details: {}});
            }
            return {
                schema: "nbdev.panel-open/v1",
                data: {url: panel.url, loginUrl, pid: panel.pid},
                warnings,
                error: null,
                human: [values.print === true || warnings.length > 0 ? `登录链接（5 分钟内有效，用一次作废）：${loginUrl}` : `已在浏览器里打开面板：${panel.url}`],
            };
        },
    },
};
