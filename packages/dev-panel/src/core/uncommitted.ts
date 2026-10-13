import {NbdevError} from "./errors.js";
import {gitOutput, runGit, splitNul} from "./git.js";

/**
 * 主工作区里一个文件的未提交改动：路径限定的提交（`git commit -- <路径>`）会把它们一起带进去，所以写之前要让人看过。
 * 状态切换（命令行与面板）与面板编辑共用。
 */

export type UncommittedChanges = {
    /** `git status --porcelain` 的两个字母，可能不止一条（例如未跟踪）。 */
    status: string[];
    /** 已暂存的差异（`git diff --cached`）；没有暂存的改动时为 null。 */
    staged: string | null;
    /** 工作区里还没暂存的差异（`git diff`）；没有时为 null。 */
    unstaged: string | null;
    /** 还没入库的新文件：没有差异可看，整份内容会随提交入库。 */
    untracked: boolean;
};

/** 给人看的差异：不让用户的差异配置（外部 diff、textconv、颜色、缩写的对象 id）改变输出。 */
const DIFF_FLAGS = ["--no-ext-diff", "--no-textconv", "--no-color", "--full-index"];

async function diffText(mainRoot: string, args: readonly string[]): Promise<string | null> {
    const result = await runGit(mainRoot, ["diff", ...DIFF_FLAGS, ...args], {readOnly: true});
    if (result.exitCode !== 0) throw new NbdevError("git_failed", `git diff 失败：${result.stderr.trim()}`, {details: {args: [...args]}});
    return result.stdout === "" ? null : result.stdout;
}

/** 干净时返回 null。 */
export async function readUncommitted(mainRoot: string, path: string): Promise<UncommittedChanges | null> {
    const entries = splitNul(await gitOutput(mainRoot, ["status", "--porcelain", "-z", "-uall", "--no-renames", "--", path], {readOnly: true}));
    if (entries.length === 0) return null;
    const status = entries.map((entry) => entry.slice(0, 2));
    const untracked = status.includes("??");
    return {
        status,
        staged: untracked ? null : await diffText(mainRoot, ["--cached", "--", path]),
        unstaged: untracked ? null : await diffText(mainRoot, ["--", path]),
        untracked,
    };
}

/**
 * 目标是暂存区里一次改名或复制的一端时拒绝：路径限定的提交只带走新名一端，HEAD 里会同时留下旧名与新名，暂存区留下一条删除。
 * 这种局面要在终端里由人处理，不给“一起提交”。
 */
export async function assertNotStagedRename(mainRoot: string, path: string): Promise<void> {
    const fields = splitNul(await gitOutput(mainRoot, ["diff", "--cached", "--no-ext-diff", "-M", "-C", "--name-status", "-z"], {readOnly: true}));
    for (let index = 0; index < fields.length;) {
        const code = fields[index]!;
        if (code.startsWith("R") || code.startsWith("C")) {
            const [from, to] = [fields[index + 1]!, fields[index + 2]!];
            if (from === path || to === path) {
                throw new NbdevError("staged_rename", `${path} 是暂存区里一次${code.startsWith("R") ? "改名" : "复制"}的一端（${from} → ${to}）；只提交它会拆开这次改名，先在终端处理暂存区`, {
                    details: {path, from, to},
                });
            }
            index += 3;
        } else {
            index += 2;
        }
    }
}
