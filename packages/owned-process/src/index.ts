import {spawnPosixOwnedProcess} from "#owned-process/posix-adapter";
import type {OwnedProcessLease, OwnedProcessSpec} from "#owned-process/types";
import {spawnWindowsOwnedProcess} from "#owned-process/windows-adapter";

export type {
    OwnedProcessCompletion,
    OwnedProcessLease,
    OwnedProcessSpec,
    OwnedProcessStdio,
    OwnedProcessTerminationReason,
} from "#owned-process/types";
export {OwnedProcessError} from "#owned-process/types";

/**
 * 启动NeuroBook拥有的进程树。
 * Windows在目标创建前建立Job Object；POSIX监督器持有独立process group。
 * 两个平台都在宿主IPC断开时收口目标树。
 */
export function spawnOwnedProcess(spec: OwnedProcessSpec): OwnedProcessLease {
    return process.platform === "win32"
        ? spawnWindowsOwnedProcess(spec)
        : spawnPosixOwnedProcess(spec);
}
