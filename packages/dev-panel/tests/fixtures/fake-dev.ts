/**
 * 假开发脚本（t14 的 L4）：由临时 `package.json` 的 `scripts.dev` 经真实的 `bun run` 起。起一个 HTTP 服务、打印就绪行、起一个孙进程 `sleep`。
 * 环境变量：
 * - `FAKE_DEV_MODE`：`normal`（收到 SIGTERM 时收掉孙进程再退出）、`leave`（不收孙进程就退出）、`ignore`（忽略 SIGTERM）、
 *   `owned`（仿 master 的 source-dev：本进程起一个不处理 SIGTERM 的监督器，监督器以 detached 另起会话起运行时；
 *   本进程收到 SIGTERM 时经监督器的 stdin 让它收掉运行时）；
 * - `FAKE_DEV_STYLE`：`listhen`（缺省，`➜ Local: <url>`，带 ANSI）、`nbook`（`[dev] page-ready <url>`，再隔 `FAKE_DEV_BACKEND_MS` 打 `[dev] backend-ready`）、`none`；
 * - `FAKE_DEV_READY_MS`：打就绪行之前等多久；`FAKE_DEV_STATUS`：HTTP 回的状态码（缺省 200）；`FAKE_DEV_EXIT_MS`：过这么久自己以 3 退出；
 * - `FAKE_DEV_ANNOUNCE_URL`：就绪行里报这个地址而不是自己的（扮“就绪地址上是别的服务”）；
 * - `FAKE_DEV_PIDS`：把各角色的 pid 追加到这个文件（`<角色> <pid>`），测试据此核对进程都不在了。
 */
import {spawn} from "node:child_process";
import {appendFileSync} from "node:fs";

const role = process.argv[2] ?? "main";
const mode = process.env.FAKE_DEV_MODE ?? "normal";
const note = (name: string, pid: number) => {
    if (process.env.FAKE_DEV_PIDS) appendFileSync(process.env.FAKE_DEV_PIDS, `${name} ${pid}\n`);
};
note(role, process.pid);

function serve(): void {
    const status = Number(process.env.FAKE_DEV_STATUS ?? "200");
    const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("fake dev", {status})});
    const url = process.env.FAKE_DEV_ANNOUNCE_URL ?? `http://127.0.0.1:${server.port}/`;
    const style = process.env.FAKE_DEV_STYLE ?? "listhen";
    setTimeout(() => {
        // 先打一行用 \r 原地改写的进度，再打就绪行：就绪识别要按 \r 切行。
        process.stdout.write("building 10%\rbuilding 90%\r");
        if (style === "listhen") process.stdout.write(`\n  \u001b[32m➜\u001b[39m Local:    \u001b[36m${url}\u001b[39m\n`);
        else if (style === "nbook") {
            process.stdout.write(`\n[dev] page-ready ${url} 状态根 /tmp/x\n`);
            setTimeout(() => process.stdout.write(`[dev] backend-ready pid=${process.pid} http://127.0.0.1:1/\n`), Number(process.env.FAKE_DEV_BACKEND_MS ?? "300"));
        }
    }, Number(process.env.FAKE_DEV_READY_MS ?? "200"));
}

function grandchild(): ReturnType<typeof spawn> {
    const child = spawn("sleep", ["600"], {stdio: "ignore"});
    note("sleep", child.pid!);
    return child;
}

if (role === "main" && mode === "owned") {
    // 仿 owned-process：监督器与本进程同组、没有 SIGTERM 处理；运行时在另一个会话里。
    const supervisor = spawn(process.execPath, [import.meta.path, "supervisor"], {stdio: ["pipe", "inherit", "inherit"], env: process.env});
    const stop = () => {
        supervisor.stdin!.write("stop\n");
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    supervisor.on("exit", () => process.exit(0));
} else if (role === "supervisor") {
    const runtime = spawn(process.execPath, [import.meta.path, "runtime"], {stdio: ["ignore", "inherit", "inherit"], env: process.env, detached: true});
    process.stdin.on("data", (chunk) => {
        if (!String(chunk).includes("stop")) return;
        try {
            process.kill(-runtime.pid!, "SIGTERM");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        setTimeout(() => {
            try {
                process.kill(-runtime.pid!, "SIGKILL");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            }
            process.exit(0);
        }, 2_000);
        runtime.on("exit", () => process.exit(0));
    });
} else {
    serve();
    const sleeper = grandchild();
    process.on("SIGTERM", () => {
        note("term", process.pid);
        if (mode === "ignore") return;
        if (mode !== "leave") sleeper.kill("SIGKILL");
        process.exit(0);
    });
    process.on("SIGINT", () => {
        sleeper.kill("SIGKILL");
        process.exit(0);
    });
    if (process.env.FAKE_DEV_EXIT_MS) setTimeout(() => process.exit(3), Number(process.env.FAKE_DEV_EXIT_MS));
}
setInterval(() => undefined, 1 << 30);
