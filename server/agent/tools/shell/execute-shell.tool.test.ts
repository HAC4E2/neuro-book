import {describe, expect, it} from "vitest";
import path from "node:path";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import {executeShellTool} from "nbook/server/agent/tools/shell/execute-shell.tool";

/**
 * 构造跨平台的 stdout 测试命令。
 */
function createStdoutCommand(): string {
    return process.platform === "win32"
        ? "[Console]::Out.WriteLine('hello-shell')"
        : "printf 'hello-shell\\n'";
}

/**
 * 构造跨平台的非零退出命令。
 */
function createFailedCommand(): string {
    return process.platform === "win32"
        ? "[Console]::Error.WriteLine('failed-shell'); exit 7"
        : "printf 'failed-shell\\n' >&2; exit 7";
}

/**
 * 构造跨平台的超时测试命令。
 */
function createTimeoutCommand(): string {
    return process.platform === "win32"
        ? "Start-Sleep -Milliseconds 1500"
        : "sleep 1.5";
}

/**
 * 构造只包含 workspace scope 的工具上下文。
 */
function createWorkspaceContext(workspace: string): AgentToolContext {
    return {
        getScope: () => ({
            studio: {workspace},
        }),
    } as AgentToolContext;
}

describe("executeShellTool", () => {
    it("会把 Agent bin 加入 PATH 以支持 workspace 命令", async () => {
        const result = await executeShellTool.execute({
            command: "workspace --help",
            timeoutMs: 10_000,
        }, {} as never);

        expect(result.content).toContain("Exit code: 0");
        expect(result.content).toContain("工作区内容节点");
    });

    it("会以纯文本返回 stdout，不把输出包成 JSON 字符串", async () => {
        const result = await executeShellTool.execute({
            command: createStdoutCommand(),
            timeoutMs: 5_000,
        }, {} as never);

        expect(result.content).toContain("Exit code: 0");
        expect(result.content).toContain("STDOUT:\nhello-shell");
        expect(result.content).toContain("STDERR:\n(empty)");
        expect(result.content).not.toContain("\\nhello-shell");
    });

    it("Windows PowerShell 管道会默认使用 UTF-8 传递中文", async () => {
        if (process.platform !== "win32") {
            return;
        }

        const result = await executeShellTool.execute({
            command: "'银龙姬' | ForEach-Object { [Console]::Out.WriteLine($_) }",
            timeoutMs: 5_000,
        }, {} as never);

        expect(result.content).toContain("Exit code: 0");
        expect(result.content).toContain("STDOUT:\n银龙姬");
    });

    it("存在当前小说时默认在 workspace 容器下运行命令", async () => {
        const result = await executeShellTool.execute({
            command: createStdoutCommand(),
            timeoutMs: 5_000,
        }, createWorkspaceContext("workspace/silver-dragon-hime"));

        const expectedWorkdir = path.resolve(process.cwd(), "workspace");
        expect(result.content).toContain(`Working directory: ${expectedWorkdir}`);
        expect(result.content).toContain("STDOUT:\nhello-shell");
    });

    it("非零退出码会作为文本结果返回", async () => {
        const result = await executeShellTool.execute({
            command: createFailedCommand(),
            timeoutMs: 5_000,
        }, {} as never);

        expect(result.content).toContain("Exit code: 7");
        expect(result.content).toContain("STDERR:\nfailed-shell");
    });

    it("命令超时时会返回 timed out 状态", async () => {
        const result = await executeShellTool.execute({
            command: createTimeoutCommand(),
            timeoutMs: 1_000,
        }, {} as never);

        expect(result.content).toContain("Timed out: true");
    });

    it("拒绝项目根目录外的 workdir", async () => {
        await expect(executeShellTool.execute({
            command: createStdoutCommand(),
            workdir: "..",
            timeoutMs: 5_000,
        }, {} as never)).rejects.toThrow("workdir must be within the project root");
    });

    it("支持在指定 workspace 内直接运行 workspace 命令", async () => {
        const result = await executeShellTool.execute({
            command: "workspace schema location --json",
            workdir: "workspace/silver-dragon-hime",
            timeoutMs: 10_000,
        }, {} as never);

        expect(result.content).toContain("Exit code: 0");
        expect(result.content).toContain("\"type\"");
    });
});
