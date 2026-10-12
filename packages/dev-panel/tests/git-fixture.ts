import {spawn} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {createTestTmpRoot, resolveTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

/**
 * 测试里的 Git 子进程（含被测核心库与命令行起的）不读开发者的全局配置，
 * 也不会从临时根往上爬到外层仓库（`repository_not_found` 的用例依赖这一点）。
 */
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CEILING_DIRECTORIES = resolveTmpRoot();
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) delete process.env[name];

export const CLI_PATH = resolve(import.meta.dirname, "..", "src", "cli.ts");

export type RunResult = {exitCode: number; stdout: string; stderr: string};

export function run(command: string, args: readonly string[], cwd: string, input?: string): Promise<RunResult> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, [...args], {cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"]});
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", rejectPromise);
        child.on("close", (code) => resolvePromise({exitCode: code ?? 1, stdout, stderr}));
        child.stdin.end(input ?? "");
    });
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
    const result = await run("git", args, cwd);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} 失败（${result.exitCode}）：${result.stderr}`);
    return result.stdout.trim();
}

export function workReadme(workId: string, extra = ""): string {
    return `---\nschema: nbook.work/v1\nworkId: ${workId}\nissueId: null\n${extra}---\n\n# ${workId}\n\n## 目标\n\n${workId} 的目标。\n`;
}

export function taskReadme(taskId: string, extra = ""): string {
    return `---\nschema: nbook.task/v2\ntaskId: ${taskId}\n${extra}---\n\n# ${taskId}\n\n正文。\n`;
}

export type Fixture = {
    /** 临时根；仓库建在它的子目录里（根目录有测试支持包的标记文件）。 */
    root: string;
    /** 主工作区。 */
    main: string;
    write(relativePath: string, content: string, base?: string): Promise<void>;
    addWork(workId: string, taskIds: readonly string[], base?: string, extra?: {work?: string; task?: string}): Promise<void>;
    commit(message: string, base?: string): Promise<string>;
    addWorktree(name: string, branch: string, from?: string): Promise<string>;
    cli(args: readonly string[], cwd?: string): Promise<RunResult & {json: CliEnvelope | null}>;
};

export type CliEnvelope = {
    schema: string;
    ok: boolean;
    data: Record<string, unknown> | null;
    warnings: Array<{code: string; message: string; details?: Record<string, unknown>}>;
    errors: Array<{code: string; message: string; details?: Record<string, unknown>}>;
};

const fixtureRoots: string[] = [];

/** 新建一个临时仓库：`<root>/main` 是主工作区，带 `.gitignore` 与一个已提交的种子 Work（w00001-seed/t01-seed）。 */
export async function createFixture(name: string): Promise<Fixture> {
    const root = await createTestTmpRoot(`dev-panel-${name}`, `dev-panel ${name}`);
    fixtureRoots.push(root);
    const main = join(root, "main");
    await mkdir(main, {recursive: true});
    await git(main, "init", "--quiet", "--initial-branch", "master");
    await git(main, "config", "user.email", "dev-panel-test@example.invalid");
    await git(main, "config", "user.name", "Dev Panel Test");
    await git(main, "config", "commit.gpgsign", "false");
    const fixture: Fixture = {
        root,
        main,
        async write(relativePath, content, base = main) {
            const path = join(base, relativePath);
            await mkdir(dirname(path), {recursive: true});
            await writeFile(path, content, "utf8");
        },
        async addWork(workId, taskIds, base = main, extra = {}) {
            await fixture.write(`.agents/works/${workId}/README.md`, workReadme(workId, extra.work), base);
            for (const taskId of taskIds) await fixture.write(`.agents/works/${workId}/tasks/${taskId}/README.md`, taskReadme(taskId, extra.task), base);
        },
        async commit(message, base = main) {
            await git(base, "add", "--all");
            await git(base, "commit", "--quiet", "--allow-empty", "-m", message);
            return git(base, "rev-parse", "HEAD");
        },
        async addWorktree(worktreeName, branch, from = "master") {
            const path = join(main, ".worktree", worktreeName);
            await git(main, "worktree", "add", "--quiet", "-b", branch, path, from);
            return path;
        },
        async cli(args, cwd = main) {
            const result = await run(process.execPath, [CLI_PATH, ...args], cwd);
            let json: CliEnvelope | null = null;
            if (args.includes("--json") && result.stdout.trim() !== "") json = JSON.parse(result.stdout) as CliEnvelope;
            return {...result, json};
        },
    };
    await fixture.write(".gitignore", "/.local/*\n/.worktree/\n");
    await fixture.addWork("w00001-seed", ["t01-seed"]);
    await fixture.commit("seed");
    return fixture;
}

/**
 * 放一个“已退出进程留下的”记录锁：pid 是本测试进程，但启动时刻对不上，nbdev 会判它已死并接管。
 * 用 pid 加错误的启动时刻，而不是找一个已退出的 pid，避免 pid 被复用时测试变得不确定。
 */
export async function writeDeadLock(mainRoot: string): Promise<void> {
    const lockDir = join(mainRoot, ".local/agent/registry.json.lock");
    await mkdir(lockDir, {recursive: true});
    await writeFile(join(lockDir, "owner.json"), JSON.stringify({
        schema: "nbdev.lock-owner/v1",
        token: "crashed",
        pid: process.pid,
        startTicks: "0",
        startedAt: "2026-10-12T00:00:00.000Z",
        command: "crashed nbdev",
        cwd: mainRoot,
    }));
}

/** 删除本文件建过的全部临时根；在 `afterEach` 里调用。 */
export async function cleanupFixtures(): Promise<void> {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
}
