import {spawn, type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {readFile} from "node:fs/promises";
import {setTimeout as sleep} from "node:timers/promises";

export type MarkedChild = ChildProcess & {pid: number};

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
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
        const environ = await readFile(`/proc/${child.pid}/environ`, "utf8").catch(() => "");
        if (environ.includes(`NBDEV_TEST_MARK=${mark}`)) return child as MarkedChild;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${command} 在就绪之前退出了`);
        if (Date.now() > deadline) {
            child.kill("SIGKILL");
            throw new Error(`${command} ${READY_TIMEOUT_MS} 毫秒内没有就绪`);
        }
        await sleep(5);
    }
}

/** 结束子进程并等到 `exit`：SIGKILL 之后、`exit` 之前，`/proc/<pid>/stat` 仍在（僵尸），会被判成还活着。 */
export async function stopProcess(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
}
