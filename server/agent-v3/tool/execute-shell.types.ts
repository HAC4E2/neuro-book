/**
 * shell 执行结果。
 */
export type ShellExecutionResult = {
    command: string;
    cwd: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
};
