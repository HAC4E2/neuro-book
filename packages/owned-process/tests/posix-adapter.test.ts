import {afterEach, describe, expect, it, vi} from "vitest";

import {spawnPosixOwnedProcess} from "#owned-process/posix-adapter";

const originalKill = process.kill.bind(process);

afterEach(() => {
    vi.restoreAllMocks();
});

describe("POSIX Owned Process failure", () => {
    it.runIf(process.platform !== "win32")("进程组信号失败会进入结构化ownership failure", async () => {
        vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
            if (pid < 0 && signal === "SIGTERM") throw permissionError();
            return originalKill(pid, signal);
        });
        const lease = spawnPosixOwnedProcess({
            command: process.execPath,
            args: ["-e", "setTimeout(() => process.exit(0), 500)"],
            stdout: "ignore",
            stderr: "ignore",
        });

        await expect(lease.terminate("timeout")).rejects.toMatchObject({
            name: "OwnedProcessError",
            stage: "process-group-signal",
        });
    });

    it.runIf(process.platform !== "win32")("进程组探测失败不会从timer回调抛出未捕获异常", async () => {
        vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
            if (pid < 0 && signal === 0) throw permissionError();
            return originalKill(pid, signal);
        });
        const lease = spawnPosixOwnedProcess({
            command: process.execPath,
            args: ["-e", "setInterval(() => undefined, 60000)"],
            stdout: "ignore",
            stderr: "ignore",
            graceMs: 50,
            hardKillWaitMs: 500,
        });

        await expect(lease.terminate("timeout")).rejects.toMatchObject({
            name: "OwnedProcessError",
            stage: "process-group-probe",
        });
    });
});

/** 构造POSIX权限错误，验证Adapter不会让它逃出event/timer回调。 */
function permissionError(): NodeJS.ErrnoException {
    return Object.assign(new Error("operation not permitted"), {code: "EPERM"});
}
