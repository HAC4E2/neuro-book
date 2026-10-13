import {readdir, readFile, readlink} from "node:fs/promises";
import {systemErrorCode} from "./errors.js";

/**
 * 读 Linux 的 `/proc`。nbdev 只支持 Linux：持锁者、会话是否还在、运行的发现都靠这里。
 * 进程随时可能退出，读不到（ENOENT、ESRCH）一律当作“这个进程已不在”，其余错误照常抛出。
 */

function isGone(error: unknown): boolean {
    const code = systemErrorCode(error);
    return code === "ENOENT" || code === "ESRCH";
}

/** `/proc/<pid>/stat` 解析出的字段。`comm` 可能含空格与括号，按最后一个 `)` 切。`pgrp` 是进程组。 */
export type ProcStat = {pid: number; comm: string; ppid: number; pgrp: number; startTicks: string};

export async function readProcStat(pid: number): Promise<ProcStat | null> {
    let text: string;
    try {
        text = await readFile(`/proc/${pid}/stat`, "utf8");
    } catch (error) {
        if (isGone(error)) return null;
        throw error;
    }
    const close = text.lastIndexOf(")");
    const fields = text.slice(close + 2).split(" ");
    const startTicks = fields[19];
    const ppid = Number(fields[1]);
    const pgrp = Number(fields[2]);
    if (startTicks === undefined || !Number.isInteger(ppid) || !Number.isInteger(pgrp)) return null;
    return {pid, comm: text.slice(text.indexOf("(") + 1, close), ppid, pgrp, startTicks};
}

/** `/proc/<pid>/stat` 的第 22 项（进程启动时刻，时钟周期数）；进程不存在时为 null。 */
export async function processStartTicks(pid: number): Promise<string | null> {
    return (await readProcStat(pid))?.startTicks ?? null;
}

/** pid 在、且启动时刻与记下的一致：防 pid 被复用。 */
export async function processAlive(process: {pid: number; startTicks: string}): Promise<boolean> {
    return await processStartTicks(process.pid) === process.startTicks;
}

const MAX_ANCESTRY = 256;

/** `ancestor`（pid 加启动时刻）是否在 `descendantPid` 的父进程链上（不含它自己）；链上读不到的进程视为链已断。 */
export async function isAncestor(ancestor: {pid: number; startTicks: string}, descendantPid: number): Promise<boolean> {
    let pid = (await readProcStat(descendantPid))?.ppid;
    for (let steps = 0; pid !== undefined && pid > 0 && steps < MAX_ANCESTRY; steps += 1) {
        const stat = await readProcStat(pid);
        if (!stat) return false;
        if (stat.pid === ancestor.pid) return stat.startTicks === ancestor.startTicks;
        pid = stat.ppid;
    }
    return false;
}

/** 进程的环境变量；别的用户的进程或已退出的进程为 null。 */
export async function readEnviron(pid: number): Promise<Record<string, string> | null> {
    let text: string;
    try {
        text = await readFile(`/proc/${pid}/environ`, "utf8");
    } catch (error) {
        if (isGone(error) || systemErrorCode(error) === "EACCES" || systemErrorCode(error) === "EPERM") return null;
        throw error;
    }
    const env: Record<string, string> = {};
    for (const entry of text.split("\0")) {
        const separator = entry.indexOf("=");
        if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
    return env;
}

/** 本机全部进程的 `stat`（只读 stat，比 `readProcessTable` 便宜）：收集某个进程的后代用。 */
export async function readProcStats(): Promise<ProcStat[]> {
    const pids = (await readdir("/proc")).filter((name) => /^[0-9]+$/u.test(name)).map(Number);
    const rows = await Promise.all(pids.map((pid) => readProcStat(pid)));
    return rows.filter((row): row is ProcStat => row !== null);
}

/** 本次开机的标识：重启之后的登记一律视为已结束。 */
export async function readBootId(): Promise<string> {
    return (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
}

export type ProcessEntry = ProcStat & {cmdline: string; cwd: string | null};

/** 本机全部进程（读不到的跳过）。cwd 读不到（别的用户的进程）时为 null。 */
export async function readProcessTable(): Promise<ProcessEntry[]> {
    const entries = await readdir("/proc");
    const pids = entries.filter((name) => /^[0-9]+$/u.test(name)).map(Number);
    const rows = await Promise.all(pids.map(async (pid): Promise<ProcessEntry | null> => {
        const stat = await readProcStat(pid);
        if (!stat) return null;
        let cmdline = "";
        let cwd: string | null = null;
        try {
            cmdline = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean).join(" ");
        } catch (error) {
            if (!isGone(error) && systemErrorCode(error) !== "EACCES") throw error;
        }
        try {
            cwd = await readlink(`/proc/${pid}/cwd`);
        } catch (error) {
            if (!isGone(error) && systemErrorCode(error) !== "EACCES" && systemErrorCode(error) !== "EPERM") throw error;
        }
        return {...stat, cmdline, cwd};
    }));
    return rows.filter((row): row is ProcessEntry => row !== null);
}

/**
 * 进程所在的用户级 systemd 服务单元（cgroup 为 `…/app.slice/<unit>.service`）；不在服务单元里为 null。
 * 以 `app-` 开头的单元是桌面程序（终端模拟器、托盘程序）按 XDG 惯例起的，不算：nbdev 只认 `systemd-run` 这类显式的服务。
 */
export async function systemdUnitOf(pid: number): Promise<string | null> {
    let text: string;
    try {
        text = await readFile(`/proc/${pid}/cgroup`, "utf8");
    } catch (error) {
        if (isGone(error)) return null;
        throw error;
    }
    const match = /\/app\.slice\/([^/\n]+\.service)(?:\/|$)/mu.exec(text);
    const unit = match?.[1];
    return unit && !unit.startsWith("app-") ? unit : null;
}

/** `/proc/stat` 的 `btime`（开机时刻，Unix 秒）。 */
export async function bootTime(): Promise<number> {
    const text = await readFile("/proc/stat", "utf8");
    const match = /^btime (\d+)$/mu.exec(text);
    if (!match) throw new Error("/proc/stat 里没有 btime");
    return Number(match[1]);
}

/**
 * 进程启动时刻（ISO 时间）。Linux 的 USER_HZ 固定为 100（`/proc/<pid>/stat` 的时钟周期单位），
 * Node 拿不到 `sysconf(_SC_CLK_TCK)`，这里按 100 换算；只用于显示。
 */
export function startTimeIso(bootSeconds: number, startTicks: string): string {
    return new Date((bootSeconds + Number(startTicks) / 100) * 1000).toISOString();
}
