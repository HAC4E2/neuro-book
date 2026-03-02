import {describe, expect, it} from "vitest";
import {executeShellTool} from "nbook/server/agent-v3/tool/execute-shell.tool";

describe("execute_shell", () => {
    it("会执行简单命令", async () => {
        const result = await executeShellTool.execute({
            command: process.platform === "win32" ? "Write-Output hello" : "printf hello",
            timeoutMs: 5_000,
        }, {
            writeOutput() {},
        });

        expect(result.content).toContain("Exit code: 0");
        expect(result.content).toContain("hello");
    });

    it("会拒绝项目根目录外的 workdir", async () => {
        expect(executeShellTool.execute({
            command: "pwd",
            workdir: "..\\..\\..\\..",
            timeoutMs: 5_000,
        }, {
            writeOutput() {
            },
        })).rejects.toThrow(/workdir 必须位于项目根目录内/);
    });

    it("会截断超长 stdout", async () => {
        const command = process.platform === "win32"
            ? "\"x\" * 61000"
            : "python -c \"print('x'*61000)\"";
        const result = await executeShellTool.execute({
            command,
            timeoutMs: 10_000,
        }, {
            writeOutput() {},
        });

        expect(result.content).toContain("Truncated: stdout=true");
        expect(result.content).toContain("输出已截断");
    });

    it("会标记超时命令", async () => {
        const command = process.platform === "win32"
            ? "Start-Sleep -Milliseconds 2000"
            : "sleep 2";
        const result = await executeShellTool.execute({
            command,
            timeoutMs: 1_000,
        }, {
            writeOutput() {},
        });

        expect(result.content).toContain("Timed out: true");
    }, 10_000);
});
