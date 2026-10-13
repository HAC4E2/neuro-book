import {lstat} from "node:fs/promises";
import {join} from "node:path";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {runGit} from "./git.js";
import {SLUG_PATTERN} from "./ids.js";
import {resolveTaskTarget, touchCallerLease, type LeaseOptions} from "./lease-ops.js";
import type {LeaseRecord} from "./leases.js";
import type {RepoContext} from "./repo.js";
import {runWriteTransaction} from "./transaction.js";

/**
 * `nbdev worktree new <workRef> <taskRef>`（t14）：按 Work 规则“创建与执行”一节建一个 Task 一个的 worktree 与分支，
 * 在登记表写 Task 的 `home`（绝对路径，与 `checkout.root` 比，见 docs/file-formats.md），续期调用者的租约。不装依赖，只提示命令。
 *
 * `worktree add` 一律用 `/usr/bin/git`：omp 会接管会话 shell 里的 `git worktree add`（全局规则“worktree”一节），
 * 用绝对路径直接起的子进程碰不到它。仓库定位等其它 Git 调用照旧走 `PATH`。`worktree add` 在锁外做（可能要几十秒），
 * 锁内只写 `home` 一步；写失败只给警告，不回滚已建的 worktree。
 */

export const WORKTREE_GIT = "/usr/bin/git";
/** 与根 CONTRIBUTING 的 Conventional Commit 类型一致。 */
export const WORKTREE_TYPES = ["feat", "fix", "docs", "refactor", "test", "build", "ci", "chore"] as const;

export type WorktreeInput = {workRef: string; taskRef: string; slug: string | null; type: string; from: string};
export type WorktreeResult = {workId: string; taskId: string; path: string; branch: string; from: string; home: string | null; installHint: string; lease: LeaseRecord | null};

async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return false;
        throw error;
    }
}

async function branchExists(mainRoot: string, branch: string): Promise<boolean> {
    return (await runGit(mainRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {readOnly: true})).exitCode === 0;
}

async function occupied(mainRoot: string, path: string, branch: string): Promise<{path: boolean; branch: boolean}> {
    return {path: await pathExists(path), branch: await branchExists(mainRoot, branch)};
}

function targetExists(path: string, branch: string, which: {path: boolean; branch: boolean}): NbdevError {
    const what = which.path ? `路径已存在：${path}` : `分支已存在：${branch}`;
    return new NbdevError("target_exists", `${what}（不自动改名、不覆盖）`, {details: {path, branch, pathExists: which.path, branchExists: which.branch}});
}

export async function createWorktree(context: RepoContext, input: WorktreeInput, options: LeaseOptions): Promise<{data: WorktreeResult; warnings: Warning[]}> {
    if (!(WORKTREE_TYPES as readonly string[]).includes(input.type)) throw new NbdevError("usage", `--type 只收 ${WORKTREE_TYPES.join("、")}：${input.type}`);
    const {workId, taskId} = await resolveTaskTarget(context, input.workRef, input.taskRef);
    const workNumber = workId.slice(0, workId.indexOf("-"));
    const taskNumber = taskId.slice(0, taskId.indexOf("-"));
    const slug = input.slug ?? taskId.slice(taskId.indexOf("-") + 1);
    if (!SLUG_PATTERN.test(slug)) throw new NbdevError("invalid_slug", `短名只能是小写字母、数字与连字符：${slug}`, {details: {slug}});
    const name = `${workNumber}-${taskNumber}-${slug}`;
    const path = join(context.mainRoot, ".worktree", name);
    const branch = `${input.type}/${name}`;
    const from = await runGit(context.mainRoot, ["rev-parse", "--verify", "--quiet", `${input.from}^{commit}`], {readOnly: true});
    if (from.exitCode !== 0) throw new NbdevError("usage", `--from 不是已有的分支或提交：${input.from}`, {details: {from: input.from}});
    const before = await occupied(context.mainRoot, path, branch);
    if (before.path || before.branch) throw targetExists(path, branch, before);
    try {
        await lstat(WORKTREE_GIT);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") throw new NbdevError("git_failed", `${WORKTREE_GIT} 不存在：worktree add 只用它，不退回 PATH 里的 git`);
        throw error;
    }
    const added = await runGit(context.mainRoot, ["worktree", "add", "-b", branch, path, input.from], {binary: WORKTREE_GIT});
    if (added.exitCode !== 0) {
        // 两个会话同时建同一个：先查不存在、后由 git 失败的那一个也报 target_exists（t14 设计审查 S9）。
        const after = await occupied(context.mainRoot, path, branch);
        if (after.path || after.branch) throw targetExists(path, branch, after);
        throw new NbdevError("git_failed", `git worktree add 失败（退出码 ${added.exitCode}）：${added.stderr.trim()}`, {details: {path, branch, from: input.from, stderr: added.stderr.trim()}});
    }
    const warnings: Warning[] = [];
    let home: string | null = null;
    try {
        const {result, warnings: txWarnings} = await runWriteTransaction(context, {repoWrites: false}, async (tx) => {
            await tx.scan();
            return {message: null, result: tx.setHome(workId, taskId, path)};
        });
        warnings.push(...txWarnings);
        if (result) home = path;
        else warnings.push({code: "home_not_written", message: `登记表里没有 ${workId}/${taskId}，没有写 home（执行位置仍可按目录名认出）`, details: {workId, taskId}});
    } catch (error) {
        if (!(error instanceof NbdevError)) throw error;
        warnings.push({code: "home_not_written", message: `worktree 已建好，但没能在登记表写 home：${error.message}`, details: {code: error.code}});
    }
    const lease = await touchCallerLease(context, {workId, taskId, action: "worktree new"}, options, warnings);
    const installHint = `cd ${path} && bun install（网络慢时 prox bun install）`;
    return {data: {workId, taskId, path, branch, from: input.from, home, installHint, lease}, warnings};
}
