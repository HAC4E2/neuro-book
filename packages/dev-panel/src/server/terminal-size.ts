import {readlink} from "node:fs/promises";
import {systemErrorCode} from "../core/errors.js";
import {HerdrError, type HerdrClient} from "../herdr/client.js";

/**
 * 一格 pane 的真实终端尺寸（t12 设计审查 I1）：`pane.process_info` 的 shell pid → `/proc/<pid>/fd/0` 指向的 `/dev/pts/N` →
 * `stty -F /dev/pts/N size`（只读的 `TIOCGWINSZ`，不改终端；面板不是会话首进程，打开 tty 不会成为它的控制终端）。
 * herdr 的 `pane.layout` 是含边框的布局格子、TUI 不挂时是无头缺省值，不能用来推列数。读不到时回 null，调用方按“尺寸不确定”处理。
 */

export type TerminalSize = {cols: number; rows: number};
const PTY = /^\/dev\/pts\/\d+$/u;

export async function readPtySize(client: HerdrClient, paneId: string, sttyBin = "stty"): Promise<TerminalSize | null> {
    let shellPid: number | null;
    try {
        shellPid = (await client.processInfo(paneId))?.shellPid ?? null;
    } catch (error) {
        if (error instanceof HerdrError) return null;
        throw error;
    }
    if (shellPid === null) return null;
    let tty: string;
    try {
        tty = await readlink(`/proc/${shellPid}/fd/0`);
    } catch (error) {
        const code = systemErrorCode(error);
        if (code === "ENOENT" || code === "EACCES" || code === "ESRCH" || code === "EINVAL") return null;
        throw error;
    }
    if (!PTY.test(tty)) return null;
    const child = Bun.spawn([sttyBin, "-F", tty, "size"], {stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 1_000});
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    if (code !== 0) return null;
    const match = /^(\d+) (\d+)\s*$/u.exec(output);
    if (!match) return null;
    const rows = Number(match[1]);
    const cols = Number(match[2]);
    return rows > 0 && cols > 0 ? {cols, rows} : null;
}
