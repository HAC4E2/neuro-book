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

/**
 * `onUnknown` 收读不到的原因（herdr 的错误码、`/proc` 的错误码、`stty` 的退出码与 stderr），由调用方决定记不记日志；
 * 页面上只显示“尺寸不确定”，原因要能在面板日志里查到（t12 实现审查 F8）。
 */
export async function readPtySize(client: HerdrClient, paneId: string, options: {stty?: string; onUnknown?: (reason: string) => void} = {}): Promise<TerminalSize | null> {
    const unknown = (reason: string) => {
        options.onUnknown?.(reason);
        return null;
    };
    let shellPid: number | null;
    try {
        shellPid = (await client.processInfo(paneId))?.shellPid ?? null;
    } catch (error) {
        if (error instanceof HerdrError) return unknown(`herdr 的 pane.process_info 失败（${error.code}）：${error.message}`);
        throw error;
    }
    if (shellPid === null) return unknown("herdr 没有给出 pane 的 shell pid");
    let tty: string;
    try {
        tty = await readlink(`/proc/${shellPid}/fd/0`);
    } catch (error) {
        const code = systemErrorCode(error);
        if (code === "ENOENT" || code === "EACCES" || code === "ESRCH" || code === "EINVAL") return unknown(`读不到 /proc/${shellPid}/fd/0（${code}）`);
        throw error;
    }
    if (!PTY.test(tty)) return unknown(`shell 的 fd 0 不是 pty：${tty}`);
    const child = Bun.spawn([options.stty ?? "stty", "-F", tty, "size"], {stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 1_000});
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) return unknown(`stty -F ${tty} size 以 ${code} 退出：${errors.trim().slice(0, 200)}`);
    const match = /^(\d+) (\d+)\s*$/u.exec(output);
    if (!match) return unknown(`stty 的输出读不懂：${output.trim().slice(0, 80)}`);
    const rows = Number(match[1]);
    const cols = Number(match[2]);
    return rows > 0 && cols > 0 ? {cols, rows} : unknown(`pty 的尺寸是 ${cols}×${rows}`);
}
