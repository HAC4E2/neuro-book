import {spawn} from "node:child_process";

import {OwnedProcessError} from "#owned-process/types";
import type {
    OwnedProcessCompletion,
    OwnedProcessLease,
    OwnedProcessSpec,
    OwnedProcessTerminationReason,
} from "#owned-process/types";

/** POSIX Adapter用独立process group拥有目标及其后代。 */
export function spawnPosixOwnedProcess(spec: OwnedProcessSpec): OwnedProcessLease {
    const graceMs = validWindow(spec.graceMs, 500, "graceMs");
    const hardKillWaitMs = validWindow(spec.hardKillWaitMs, 3_000, "hardKillWaitMs");
    const child = spawn(spec.command, spec.args ?? [], {
        cwd: spec.cwd,
        env: spec.env,
        detached: true,
        stdio: [spec.stdin ?? "ignore", spec.stdout ?? "pipe", spec.stderr ?? "pipe"],
    });
    let terminationReason: OwnedProcessTerminationReason | undefined;
    let terminationPromise: Promise<OwnedProcessCompletion> | undefined;
    let hardKillTimer: NodeJS.Timeout | undefined;
    let hardWaitTimer: NodeJS.Timeout | undefined;
    let groupPollTimer: NodeJS.Timeout | undefined;
    let closeResult: {exitCode: number | null; signal: NodeJS.Signals | null} | undefined;
    let settled = false;
    let resolveCompletion!: (value: OwnedProcessCompletion) => void;
    let rejectCompletion!: (error: unknown) => void;

    const completion = new Promise<OwnedProcessCompletion>((resolvePromise, rejectPromise) => {
        resolveCompletion = resolvePromise;
        rejectCompletion = rejectPromise;
    });
    child.once("error", (error) => rejectOnce(new OwnedProcessError(
            `无法启动自有进程：${error.message}`,
            {stage: "spawn", cause: error},
        )));
    child.once("exit", () => {
        // root自然退出时，后台后代仍可能持有stdio；保留同一process group所有权并清理。
        if (!terminationReason) beginGroupCleanup();
    });
    child.once("close", (exitCode, signal) => {
        if (settled) return;
        closeResult = {exitCode, signal};
        if (!hardKillTimer) beginGroupCleanup();
        settleIfClosed();
    });

    return {
        stdout: child.stdout ?? undefined,
        stderr: child.stderr ?? undefined,
        completion,
        terminate(reason) {
            if (terminationPromise) return terminationPromise;
            if (settled) return completion;
            terminationReason = reason;
            terminationPromise = completion;
            beginGroupCleanup();
            return terminationPromise;
        },
    };

    /** TERM后升级到KILL，并为完整stdio收口设置最终上限。 */
    function beginGroupCleanup(): void {
        if (hardKillTimer || settled) return;
        try {
            signalGroup(child.pid, "SIGTERM");
        } catch (error) {
            rejectOnce(groupError("process-group-signal", child.pid, "SIGTERM", error));
            return;
        }
        hardKillTimer = setTimeout(() => {
            try {
                signalGroup(child.pid, "SIGKILL");
            } catch (error) {
                rejectOnce(groupError("process-group-signal", child.pid, "SIGKILL", error));
            }
        }, graceMs);
        groupPollTimer = setInterval(settleIfClosed, 25);
        hardWaitTimer = setTimeout(() => rejectOnce(new OwnedProcessError(
            `强制终止后仍未确认进程组收口：pid=${child.pid ?? "unknown"}`,
            {stage: "hard-kill-wait"},
        )), graceMs + hardKillWaitMs);
    }

    /** 只有root close且整个process group消失后才提交completion。 */
    function settleIfClosed(): void {
        if (settled || !closeResult) return;
        try {
            if (groupExists(child.pid)) return;
        } catch (error) {
            rejectOnce(groupError("process-group-probe", child.pid, undefined, error));
            return;
        }
        settled = true;
        clearTimers();
        resolveCompletion({
            exitCode: closeResult.exitCode,
            signal: closeResult.signal,
            ...(terminationReason ? {terminationReason} : {}),
        });
    }

    /** 只允许一个失败终态。 */
    function rejectOnce(error: unknown): void {
        if (settled) return;
        settled = true;
        clearTimers();
        rejectCompletion(error);
    }

    /** 清理本lease创建的所有timer。 */
    function clearTimers(): void {
        if (hardKillTimer) clearTimeout(hardKillTimer);
        if (hardWaitTimer) clearTimeout(hardWaitTimer);
        if (groupPollTimer) clearInterval(groupPollTimer);
    }
}

/** 把process.kill失败归一化为Owned Process结构化错误。 */
function groupError(
    stage: "process-group-signal" | "process-group-probe",
    pid: number | undefined,
    signal: NodeJS.Signals | undefined,
    cause: unknown,
): OwnedProcessError {
    const action = signal ? `发送${signal}` : "探测";
    return new OwnedProcessError(`无法${action}自有进程组：pid=${pid ?? "unknown"}`, {stage, cause});
}

/** 检查独立process group是否仍有成员。 */
function groupExists(pid: number | undefined): boolean {
    if (!pid) return false;
    try {
        process.kill(-pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
    }
}

/** 向目标独立process group发信号；进程已退出时保持幂等。 */
function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
    if (!pid) return;
    try {
        process.kill(-pid, signal);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
}

/** 拒绝负数和非有限生命周期窗口。 */
function validWindow(value: number | undefined, fallback: number, field: string): number {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved) || resolved < 0) throw new Error(`${field}必须是非负有限数。`);
    return resolved;
}
