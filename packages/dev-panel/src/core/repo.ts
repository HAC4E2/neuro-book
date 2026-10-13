import {lstat} from "node:fs/promises";
import {resolve} from "node:path";
import {NbdevError, systemErrorCode} from "./errors.js";
import {gitOutput, runGit} from "./git.js";

export const WORKS_ROOT = ".agents/works";
export const MASTER_REF = "refs/heads/master";

/** 命令行所在的位置：主工作区（记录所在）与调用者所在的 checkout。 */
export type RepoContext = {mainRoot: string; callerRoot: string; callerBranch: string | null};

export type CheckoutInfo = {
    root: string;
    /** 分支短名；分离 HEAD 时为 null。 */
    branch: string | null;
    head: string;
    isMain: boolean;
    prunable: boolean;
};

/**
 * 从任意 cwd 定位主工作区与调用者的 checkout。
 * 主工作区取 `git worktree list` 的第一项：从 linked worktree 里调用时也能找到记录所在的那一份。
 */
export async function locateRepository(cwd: string): Promise<RepoContext> {
    const toplevel = await runGit(cwd, ["rev-parse", "--show-toplevel"], {readOnly: true});
    if (toplevel.exitCode !== 0) {
        throw new NbdevError("repository_not_found", `不在 Git 仓库里：${cwd}`, {details: {cwd, stderr: toplevel.stderr.trim()}});
    }
    const callerRoot = toplevel.stdout.trim();
    const checkouts = await listCheckouts(callerRoot);
    const main = checkouts.find((checkout) => checkout.isMain);
    if (!main) throw new NbdevError("repository_not_found", `找不到主工作区：${callerRoot}`, {details: {cwd}});
    const worksStats = await lstat(resolve(main.root, WORKS_ROOT)).catch((error: unknown) => {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    });
    if (!worksStats || !worksStats.isDirectory() || worksStats.isSymbolicLink()) {
        throw new NbdevError("records_root_not_found", `主工作区没有 ${WORKS_ROOT}/ 目录：${main.root}`, {details: {mainRoot: main.root}});
    }
    const caller = checkouts.find((checkout) => checkout.root === callerRoot);
    return {mainRoot: main.root, callerRoot, callerBranch: caller?.branch ?? null};
}

/** 解析 `git worktree list --porcelain`：第一项是主工作区。 */
export async function listCheckouts(anyRoot: string): Promise<CheckoutInfo[]> {
    const output = await gitOutput(anyRoot, ["worktree", "list", "--porcelain", "-z"], {readOnly: true});
    const checkouts: CheckoutInfo[] = [];
    let current: CheckoutInfo | null = null;
    for (const line of output.split("\0")) {
        if (line === "") {
            if (current) checkouts.push(current);
            current = null;
            continue;
        }
        const separator = line.indexOf(" ");
        const key = separator < 0 ? line : line.slice(0, separator);
        const value = separator < 0 ? "" : line.slice(separator + 1);
        if (key === "worktree") {
            if (current) checkouts.push(current);
            current = {root: value, branch: null, head: "", isMain: checkouts.length === 0, prunable: false};
        } else if (current && key === "HEAD") {
            current.head = value;
        } else if (current && key === "branch") {
            current.branch = value.startsWith("refs/heads/") ? value.slice("refs/heads/".length) : value;
        } else if (current && key === "prunable") {
            current.prunable = true;
        }
    }
    if (current) checkouts.push(current);
    return checkouts;
}

/**
 * 写记录之前的前置检查：主工作区必须检出 `master`，且不在合并、变基或 cherry-pick 中
 * （这些状态下路径限定的提交会失败或带进别的内容）。
 */
export async function assertMainWritable(mainRoot: string): Promise<void> {
    const head = await runGit(mainRoot, ["symbolic-ref", "--quiet", "HEAD"], {readOnly: true});
    const ref = head.exitCode === 0 ? head.stdout.trim() : null;
    if (ref !== MASTER_REF) {
        throw new NbdevError("main_not_on_master", `主工作区检出的不是 master（当前：${ref ?? "分离 HEAD"}），不写记录`, {
            details: {mainRoot, head: ref},
        });
    }
    const markers = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"];
    const output = await gitOutput(mainRoot, ["rev-parse", "--path-format=absolute", ...markers.flatMap((marker) => ["--git-path", marker])], {readOnly: true});
    const paths = output.split("\n").filter((line) => line !== "");
    for (const [index, path] of paths.entries()) {
        const exists = await lstat(path).then(() => true, (error: unknown) => {
            if (systemErrorCode(error) === "ENOENT") return false;
            throw error;
        });
        if (exists) {
            throw new NbdevError("main_busy", `主工作区正在进行 ${markers[index]} 对应的操作，不写记录`, {details: {mainRoot, marker: markers[index]}});
        }
    }
}

/** 一个路径是否已提交在指定提交里。 */
export async function existsInCommit(root: string, rev: string, relativePath: string): Promise<boolean> {
    const result = await runGit(root, ["cat-file", "-e", `${rev}:${relativePath}`], {readOnly: true});
    return result.exitCode === 0;
}
