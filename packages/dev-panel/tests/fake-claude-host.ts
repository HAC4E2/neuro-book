/**
 * 扮成 Claude 主进程（由 `tests/processes.ts` 的 `startFakeClaude` 起）。自己的环境里没有 `CLAUDE_*` 变量，与真实的顶层 Claude 一样；
 * 按 stdin 上一行一个 JSON 的请求起子进程，子进程的环境带上 `CLAUDE_PID=<本进程>` 与 `CLAUDE_CODE_SESSION_ID`。
 * 这样被测的 nbdev 看到的 `CLAUDE_PID` 是它的祖先，与真实会话的 Bash 工具一致。每个子进程都起在自己的进程组里（真实的每次 Bash 调用也是）。
 */
import {spawn, type ChildProcess} from "node:child_process";
import {createInterface} from "node:readline";

type Request =
    | {id: number; op: "run"; command: string; args: string[]; cwd: string; env: Record<string, string>; timeoutMs: number}
    | {id: number; op: "spawn"; command: string; args: string[]; cwd: string; env: Record<string, string>}
    | {id: number; op: "kill"; pid: number};

const sessionId = process.env.FAKE_CLAUDE_SESSION_ID ?? "";
const children = new Map<number, ChildProcess>();

/** 子进程都自成一组（detached）：连同它们的后台孙进程一起结束，不留下被 PID 1 收养的进程。 */
function killGroup(pid: number): void {
    try {
        process.kill(-pid, "SIGKILL");
    } catch (error) {
        // 组里已经没有进程了。
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
}

function reply(message: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function childEnv(extra: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) if (value !== undefined && name !== "FAKE_CLAUDE_SESSION_ID") env[name] = value;
    return {...env, CLAUDE_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: sessionId, ...extra};
}

function handle(request: Request): void {
    if (request.op === "kill") {
        const child = children.get(request.pid);
        if (!child || child.exitCode !== null || child.signalCode !== null) {
            reply({id: request.id});
            return;
        }
        child.once("exit", () => reply({id: request.id}));
        killGroup(request.pid);
        return;
    }
    const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: childEnv(request.env),
        stdio: request.op === "run" ? ["ignore", "pipe", "pipe"] : "ignore",
        detached: true,
    });
    if (child.pid === undefined) {
        reply({id: request.id, error: `起不来：${request.command}`});
        return;
    }
    children.set(child.pid, child);
    child.once("exit", () => children.delete(child.pid!));
    if (request.op === "spawn") {
        reply({id: request.id, pid: child.pid});
        return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
    });
    child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => killGroup(child.pid!), request.timeoutMs);
    child.once("close", (code) => {
        clearTimeout(timer);
        reply({id: request.id, exitCode: code ?? 1, stdout, stderr});
    });
}

const lines = createInterface({input: process.stdin});
lines.on("line", (line) => handle(JSON.parse(line) as Request));
lines.on("close", () => {
    for (const pid of children.keys()) killGroup(pid);
    process.exit(0);
});
reply({ready: true, pid: process.pid});
