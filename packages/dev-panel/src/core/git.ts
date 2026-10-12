import {spawn} from "node:child_process";
import {NbdevError} from "./errors.js";

export type GitResult = {exitCode: number; stdout: string; stderr: string};

export type GitOptions = {
    /** 读操作加 `--no-optional-locks`：不刷新、不写回 index，不与别的会话抢 index.lock。 */
    readOnly?: boolean;
    input?: string;
};

/**
 * 这些变量会把 Git 指到别的仓库或别的 index（例如在 hook 里被调用时）；
 * 去掉它们，保证路径限定的提交落在主工作区自己的 index 上。
 */
const LOCATION_VARIABLES = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
] as const;

function gitEnvironment(): NodeJS.ProcessEnv {
    // 路径一律按字面匹配：记录文件名里出现 * ? [ 时，通配解释会让 add 与 commit 把别人的文件一起暂存并提交。
    const env: NodeJS.ProcessEnv = {...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1"};
    for (const name of LOCATION_VARIABLES) delete env[name];
    return env;
}

/** 异步运行 Git，不因非零退出码抛错；调用方按退出码分支。只读的扫描靠它并行发出多条 Git 命令。 */
export function runGit(root: string, args: readonly string[], options: GitOptions = {}): Promise<GitResult> {
    const fullArgs = options.readOnly ? ["--no-optional-locks", "-C", root, ...args] : ["-C", root, ...args];
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("git", fullArgs, {env: gitEnvironment(), stdio: ["pipe", "pipe", "pipe"]});
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", (error) => rejectPromise(new NbdevError("git_failed", `无法启动 git：${error.message}`, {cause: error, details: {args: fullArgs}})));
        child.on("close", (code, signal) => {
            resolvePromise({
                exitCode: code ?? (signal ? 128 : 1),
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
        child.stdin.end(options.input ?? "");
    });
}

/** 运行 Git，非零退出码抛 `git_failed`（带参数、退出码与 stderr）。 */
export async function gitOutput(root: string, args: readonly string[], options: GitOptions = {}): Promise<string> {
    const result = await runGit(root, args, options);
    if (result.exitCode !== 0) {
        throw new NbdevError("git_failed", `git ${args.join(" ")} 失败（退出码 ${result.exitCode}）：${result.stderr.trim()}`, {
            details: {root, args: [...args], exitCode: result.exitCode, stderr: result.stderr.trim()},
        });
    }
    return result.stdout;
}

/** 按 NUL 拆分 `-z` 输出，去掉末尾的空项。 */
export function splitNul(output: string): string[] {
    const parts = output.split("\0");
    if (parts.at(-1) === "") parts.pop();
    return parts;
}

export function splitLines(output: string): string[] {
    return output.split("\n").filter((line) => line !== "");
}
