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
/**
 * 测试常从 herdr 里的 Claude 会话跑起来：去掉继承来的会话与 herdr 变量（按前缀删，免得漏掉新加的），
 * 再把 herdr socket 指到一个不存在的路径，被测的命令行就碰不到默认 herdr。用例需要时经 `fixture.cli(…, env)` 显式给。
 */
for (const name of Object.keys(process.env)) {
    if (name.startsWith("HERDR_") || name.startsWith("CLAUDE") || name === "OMPCODE") delete process.env[name];
}
process.env.HERDR_SOCKET_PATH = join(resolveTmpRoot(), "no-herdr-in-tests.sock");

export const CLI_PATH = resolve(import.meta.dirname, "..", "src", "cli.ts");

export type RunResult = {exitCode: number; stdout: string; stderr: string};

/** 运行子进程；超过 `timeoutMs` 就 SIGKILL 结束它并报错，测试超时不会留下孤儿进程。`env` 叠加在清洗过的环境上。 */
export function run(command: string, args: readonly string[], cwd: string, input?: string, timeoutMs = 60_000, env: Record<string, string> = {}): Promise<RunResult> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, [...args], {cwd, env: {...process.env, ...env}, stdio: ["pipe", "pipe", "pipe"]});
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            rejectPromise(new Error(`${command} ${args.join(" ")} 超过 ${timeoutMs} 毫秒，已结束；stderr：${stderr}`));
        }, timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            rejectPromise(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolvePromise({exitCode: code ?? 1, stdout, stderr});
        });
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
    cli(args: readonly string[], cwd?: string, env?: Record<string, string>): Promise<RunResult & {json: CliEnvelope | null}>;
};

export type CliEnvelope = {
    schema: string;
    ok: boolean;
    data: Record<string, unknown> | null;
    warnings: Array<{code: string; message: string; details?: Record<string, unknown>}>;
    errors: Array<{code: string; message: string; details?: Record<string, unknown>}>;
};

const fixtureRoots: string[] = [];

/** 面板服务的环境：审计（`XDG_CONFIG_HOME`）指到临时根，不碰真实的 `~/.config/nbdev/`。 */
export function panelEnv(fixture: Pick<Fixture, "root">): NodeJS.ProcessEnv {
    return {HOME: join(fixture.root, "home"), XDG_CONFIG_HOME: join(fixture.root, "config")};
}

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
        async cli(args, cwd = main, env = {}) {
            const result = await run(process.execPath, [CLI_PATH, ...args], cwd, undefined, 60_000, env);
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
