import {spawn, type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {readFileSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createInterface} from "node:readline";
import {setTimeout as sleep} from "node:timers/promises";
import {processStartTicks} from "../src/core/procfs.js";
import {CLI_PATH, type CliEnvelope, type RunResult} from "./git-fixture.js";

export type MarkedChild = ChildProcess & {pid: number};

/**
 * 结束子进程所在的整个进程组：`sh -c 'sleep … & wait'` 这类子进程的后台孙进程与它同组，只结束外层会让孙进程被 PID 1 收养、
 * 留在本机（cwd 在仓库里，`status` 会列出来）。只对自成一组（detached）的子进程用。
 */
export function killGroup(pid: number): void {
    try {
        process.kill(-pid, "SIGKILL");
    } catch (error) {
        // 组里已经没有进程了。
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
}

const READY_TIMEOUT_MS = 5_000;

/**
 * 起一个环境干净的子进程，等到 `/proc/<pid>/environ` 已是它自己的环境（带上本次的标记）才返回：
 * Bun 的 `spawn` 返回时子进程多半还没 exec，`/proc` 里看到的仍是父进程的环境。
 * 缺省 `detached`：真实的 Claude 每次 Bash 调用都是独立的进程组，`status` 按进程组排除管道伙伴，测试里的“工具进程”要与测试进程分开。
 */
export async function spawnMarked(command: string, args: readonly string[], options: {cwd?: string; env?: Record<string, string>; detached?: boolean} = {}): Promise<MarkedChild> {
    const mark = randomUUID();
    const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: {PATH: process.env.PATH ?? "", ...options.env, NBDEV_TEST_MARK: mark},
        stdio: "ignore",
        detached: options.detached ?? true,
    });
    if (child.pid === undefined) throw new Error(`起不来：${command}`);
    try {
        await waitForMark(child.pid, mark, () => child.exitCode !== null || child.signalCode !== null);
    } catch (error) {
        if (options.detached ?? true) killGroup(child.pid);
        else child.kill("SIGKILL");
        throw error;
    }
    return child as MarkedChild;
}

async function waitForMark(pid: number, mark: string, exited: () => boolean): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
        const environ = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => "");
        if (environ.includes(`NBDEV_TEST_MARK=${mark}`)) return;
        if (exited()) throw new Error(`进程 ${pid} 在就绪之前退出了`);
        if (Date.now() > deadline) throw new Error(`进程 ${pid} ${READY_TIMEOUT_MS} 毫秒内没有就绪`);
        await sleep(5);
    }
}

/**
 * 结束子进程（`spawnMarked` 缺省自成一组，连同组里的后台孙进程一起结束）并等到 `exit`：
 * SIGKILL 之后、`exit` 之前，`/proc/<pid>/stat` 仍在（僵尸），会被判成还活着。
 */
export async function stopProcess(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    if (child.pid !== undefined && isGroupLeader(child.pid)) killGroup(child.pid);
    else child.kill("SIGKILL");
    await exited;
}

function isGroupLeader(pid: number): boolean {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]) === pid;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return false;
    }
}

const HOST_PATH = resolve(import.meta.dirname, "fake-claude-host.ts");

export type FakeClaude = {
    pid: number;
    startTicks: string;
    sessionId: string;
    /** 以它的子进程运行 nbdev（`CLAUDE_PID` 是它、会话 id 是它的），像会话的 Bash 工具那样。 */
    cli(args: readonly string[], cwd: string, env?: Record<string, string>): Promise<RunResult & {json: CliEnvelope | null}>;
    /** 起一个长期运行的子进程（会话派出的命令），等它就绪后返回 pid。 */
    spawn(command: string, args: readonly string[], options?: {cwd?: string; env?: Record<string, string>}): Promise<number>;
    kill(pid: number): Promise<void>;
    stop(): Promise<void>;
};

/**
 * 起一个扮成 Claude 主进程的子进程（见 `fake-claude-host.ts`）。不能用测试进程自己扮：nbdev 要求 `CLAUDE_PID` 是它的祖先，
 * 而测试进程若是从真实的 Claude 会话里跑起来的，`/proc/<pid>/environ` 里还带着那个会话的 id，会被当成嵌套调用。
 */
export async function startFakeClaude(sessionId: string): Promise<FakeClaude> {
    const host = spawn(process.execPath, [HOST_PATH], {env: {...process.env, FAKE_CLAUDE_SESSION_ID: sessionId}, stdio: ["pipe", "pipe", "inherit"]});
    const pending = new Map<number, (message: Record<string, unknown>) => void>();
    let ready: ((message: Record<string, unknown>) => void) | null = null;
    const readyMessage = new Promise<Record<string, unknown>>((resolvePromise) => {
        ready = resolvePromise;
    });
    createInterface({input: host.stdout!}).on("line", (line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.ready === true) ready?.(message);
        else pending.get(message.id as number)?.(message);
    });
    let nextId = 0;
    const request = (payload: Record<string, unknown>): Promise<Record<string, unknown>> => new Promise((resolvePromise, rejectPromise) => {
        const id = ++nextId;
        pending.set(id, (message) => {
            pending.delete(id);
            if (typeof message.error === "string") rejectPromise(new Error(message.error));
            else resolvePromise(message);
        });
        host.stdin!.write(`${JSON.stringify({id, ...payload})}\n`);
    });
    await readyMessage;
    const pid = host.pid!;
    return {
        pid,
        startTicks: (await processStartTicks(pid))!,
        sessionId,
        async cli(args, cwd, env = {}) {
            const message = await request({op: "run", command: process.execPath, args: [CLI_PATH, ...args], cwd, env, timeoutMs: 60_000});
            const result = {exitCode: message.exitCode as number, stdout: message.stdout as string, stderr: message.stderr as string};
            const json = args.includes("--json") && result.stdout.trim() !== "" ? JSON.parse(result.stdout) as CliEnvelope : null;
            return {...result, json};
        },
        async spawn(command, args, options = {}) {
            const mark = randomUUID();
            const message = await request({op: "spawn", command, args: [...args], cwd: options.cwd ?? process.cwd(), env: {...options.env, NBDEV_TEST_MARK: mark}});
            await waitForMark(message.pid as number, mark, () => false);
            return message.pid as number;
        },
        async kill(childPid) {
            await request({op: "kill", pid: childPid});
        },
        async stop() {
            if (host.exitCode !== null || host.signalCode !== null) return;
            const exited = once(host, "exit");
            host.stdin!.end();
            await exited;
        },
    };
}
