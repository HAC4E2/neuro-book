import {spawn} from "node:child_process";
import {NbdevError, systemErrorCode} from "./errors.js";

/** `timedOut`：给了 `timeoutMs` 且到点被结束（这时退出码是 128，输出不完整）。 */
export type GitResult = {exitCode: number; stdout: string; stderr: string; timedOut?: boolean};

export type GitOptions = {
    /** 读操作加 `--no-optional-locks`：不刷新、不写回 index，不与别的会话抢 index.lock。 */
    readOnly?: boolean;
    input?: string;
    /** 用这个 git 可执行文件（绝对路径），不经 `PATH` 查找：`worktree new` 的 `worktree add` 一律用 `/usr/bin/git`（omp 会接管会话 shell 里的 `git worktree add`）。 */
    binary?: string;
    /**
     * 到点 SIGKILL 子进程，结果标 `timedOut`（面板现算各 checkout 的状态时用，一个慢的不拖住整页）。
     * 只结束 git 本身：git 派生的子进程（fsmonitor 钩子、子模块的 status）继承了输出管道时，要等它们退出才回，限时就不生效。
     * 本仓库没有子模块、没开 fsmonitor，所以不按进程组结束（第 4 批审查第 9 条）。
     */
    timeoutMs?: number;
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

/**
 * Git 子进程的环境。路径缺省一律按字面匹配：记录文件名里出现 * ? [ 时，通配解释会让 add 与 commit 把别人的文件一起暂存并提交。
 * 只有面板的搜索传 `literalPathspecs: false`：它的排除规则（`:(exclude,glob)…`）由服务端写死，不含用户输入。
 */
export function gitEnvironment(options: {literalPathspecs?: boolean} = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {...process.env, GIT_TERMINAL_PROMPT: "0"};
    if (options.literalPathspecs ?? true) env.GIT_LITERAL_PATHSPECS = "1";
    else delete env.GIT_LITERAL_PATHSPECS;
    for (const name of LOCATION_VARIABLES) delete env[name];
    return env;
}

/**
 * 异步运行 Git，不因非零退出码抛错；调用方按退出码分支。只读的扫描靠它并行发出多条 Git 命令。
 * 只有给了 `input` 才开 stdin：不读 stdin 的 Git 子命令先退出时，往它的 stdin 写会得到 EPIPE，
 * Node 下没有监听的 EPIPE 是未处理的异常（t10 实现审查第 7 条）。
 */
export function runGit(root: string, args: readonly string[], options: GitOptions = {}): Promise<GitResult> {
    const fullArgs = options.readOnly ? ["--no-optional-locks", "-C", root, ...args] : ["-C", root, ...args];
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(options.binary ?? "git", fullArgs, {env: gitEnvironment(), stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]});
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdinNote: string | null = null;
        let timedOut = false;
        const timer = options.timeoutMs === undefined ? null : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, options.timeoutMs);
        child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", (error) => {
            if (timer) clearTimeout(timer);
            rejectPromise(new NbdevError("git_failed", `无法启动 git：${error.message}`, {cause: error, details: {args: fullArgs}}));
        });
        child.on("close", (code, signal) => {
            if (timer) clearTimeout(timer);
            const errorText = Buffer.concat(stderr).toString("utf8");
            resolvePromise({
                ...(timedOut ? {timedOut: true} : {}),
                exitCode: code ?? (signal ? 128 : 1),
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: stdinNote === null ? errorText : `${errorText}${errorText === "" || errorText.endsWith("\n") ? "" : "\n"}${stdinNote}\n`,
            });
        });
        if (options.input !== undefined) {
            child.stdin!.on("error", (error) => {
                // Git 没读完输入就退出了：失败由退出码与 stderr 报出，这里只把原因附进 stderr。
                if (systemErrorCode(error) === "EPIPE") {
                    stdinNote = `nbdev：git 在读完输入之前关闭了 stdin（EPIPE）`;
                    return;
                }
                rejectPromise(new NbdevError("git_failed", `写 git 的 stdin 失败：${error.message}`, {cause: error, details: {args: fullArgs}}));
            });
            child.stdin!.end(options.input);
        }
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
