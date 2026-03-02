import {spawn} from "node:child_process";
import path from "node:path";
import {z} from "zod";
import type {AgentTool} from "nbook/server/agent-v3/tool/tool.types";
import type {ShellExecutionResult} from "nbook/server/agent-v3/tool/execute-shell.types";

const OUTPUT_LIMIT = 60_000;

export const ExecuteShellInputSchema = z.object({
    command: z.string().trim().min(1, "command 不能为空").describe("要执行的 shell 命令。Windows 使用 PowerShell，其他平台使用 /bin/sh。"),
    workdir: z.string().trim().min(1, "workdir 不能为空").optional().describe("工作目录。必须位于项目根目录内，默认项目根目录。"),
    timeoutMs: z.number().int().min(1_000).max(600_000).optional().default(120_000).describe("超时时间，单位毫秒。"),
});

/**
 * 执行本地 shell 命令。
 */
export const executeShellTool: AgentTool<typeof ExecuteShellInputSchema> = {
    key: "execute_shell",
    description: [
        "Execute a local shell command and return cwd, exit code, timeout status, stdout, and stderr.",
        "workdir defaults to the project root and must stay inside the project root.",
        "Use this only for running scripts or checking the environment.",
    ].join("\n"),
    schema: ExecuteShellInputSchema,
    async execute(input) {
        const result = await executeShellCommand(input);
        return {
            content: renderShellResult(result),
            rawResult: {
                command: result.command,
                cwd: result.cwd,
                exitCode: result.exitCode,
                signal: result.signal,
                timedOut: result.timedOut,
                durationMs: result.durationMs,
                stdout: result.stdout,
                stderr: result.stderr,
                stdoutTruncated: result.stdoutTruncated,
                stderrTruncated: result.stderrTruncated,
            },
        };
    },
};

/**
 * 执行 shell 命令并收集输出。
 */
async function executeShellCommand(input: z.infer<typeof ExecuteShellInputSchema>): Promise<ShellExecutionResult> {
    const cwd = resolveShellWorkdir(input.workdir);
    const startedAt = Date.now();
    const shellCommand = createShellCommand(input.command);

    return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;

        const childProcess = spawn(shellCommand.file, shellCommand.args, {
            cwd,
            windowsHide: true,
        });
        const timeout = setTimeout(() => {
            timedOut = true;
            childProcess.kill();
        }, input.timeoutMs);

        childProcess.stdout.setEncoding("utf8");
        childProcess.stderr.setEncoding("utf8");
        childProcess.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });
        childProcess.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        childProcess.on("error", (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });
        childProcess.on("close", (exitCode, signal) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            const normalizedStdout = truncateOutput(stdout);
            const normalizedStderr = truncateOutput(stderr);
            resolve({
                command: input.command,
                cwd,
                exitCode,
                signal,
                timedOut,
                durationMs: Date.now() - startedAt,
                stdout: normalizedStdout.text,
                stderr: normalizedStderr.text,
                stdoutTruncated: normalizedStdout.truncated,
                stderrTruncated: normalizedStderr.truncated,
            });
        });
    });
}

/**
 * 解析安全工作目录。
 */
function resolveShellWorkdir(workdir: string | undefined): string {
    const projectRoot = process.cwd();
    const resolvedWorkdir = path.resolve(projectRoot, workdir ?? ".");
    const relativePath = path.relative(projectRoot, resolvedWorkdir);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`workdir 必须位于项目根目录内：${projectRoot}`);
    }
    return resolvedWorkdir;
}

/**
 * 根据平台构造 shell 命令。
 */
function createShellCommand(command: string): {file: string; args: string[]} {
    if (process.platform === "win32") {
        return {
            file: "powershell.exe",
            args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        };
    }
    return {
        file: process.env.SHELL || "/bin/sh",
        args: ["-lc", command],
    };
}

/**
 * 截断超长输出。
 */
function truncateOutput(value: string): {text: string; truncated: boolean} {
    if (value.length <= OUTPUT_LIMIT) {
        return {
            text: value,
            truncated: false,
        };
    }
    return {
        text: `${value.slice(0, OUTPUT_LIMIT)}\n[输出已截断，原始长度 ${String(value.length)} 字符]`,
        truncated: true,
    };
}

/**
 * 渲染模型可读结果。
 */
function renderShellResult(result: ShellExecutionResult): string {
    return [
        `Command: ${result.command}`,
        `Working directory: ${result.cwd}`,
        `Exit code: ${result.exitCode === null ? "null" : String(result.exitCode)}`,
        `Signal: ${result.signal ?? "null"}`,
        `Timed out: ${result.timedOut ? "true" : "false"}`,
        `Duration: ${String(result.durationMs)}ms`,
        `Truncated: stdout=${result.stdoutTruncated ? "true" : "false"}, stderr=${result.stderrTruncated ? "true" : "false"}`,
        "",
        "STDOUT:",
        result.stdout.trimEnd() || "(empty)",
        "",
        "STDERR:",
        result.stderr.trimEnd() || "(empty)",
    ].join("\n");
}
