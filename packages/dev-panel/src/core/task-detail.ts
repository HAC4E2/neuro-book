import {lstat, readdir, readFile} from "node:fs/promises";
import {posix, resolve} from "node:path";
import {resolveTaskExecution, type TaskExecution} from "./checkouts.js";
import {isNbdevError, systemErrorCode, type Warning} from "./errors.js";
import {gitOutput} from "./git.js";
import {taskDirPath, taskReadmePath} from "./records.js";
import {MASTER_REF} from "./repo.js";
import type {TransitionState} from "./status.js";

/** Task 页要的、`status` 里没有的部分：README 原文、证据、链到的 Spec、执行 checkout 与提交。只读。 */

export type EvidenceEntry = {name: string; path: string; kind: "file" | "dir"; size: number | null};
export type CommitEntry = {sha: string; date: string; author: string; subject: string};
export type TaskDetail = {
    workId: string;
    taskId: string;
    readme: {path: string; text: string | null};
    evidences: EvidenceEntry[];
    /** README 里链到的 Spec（仓库根相对路径，去掉锚点）。 */
    specs: string[];
    execution: TaskExecution;
    /**
     * 执行 checkout 上的提交：在 worktree 里是它的分支相对 master 新增的提交（实现提交）；
     * 在主工作区里是碰过 Task 目录的提交（记录提交）。各最多 20 个。
     */
    commits: {checkout: string; range: "branch" | "task"; entries: CommitEntry[]};
};

const COMMIT_LIMIT = 20;

async function readText(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "EISDIR") return null;
        throw error;
    }
}

async function listEvidences(recordRoot: string, taskDir: string): Promise<EvidenceEntry[]> {
    let names: string[];
    try {
        names = (await readdir(resolve(recordRoot, taskDir, "evidences"))).sort();
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return [];
        throw error;
    }
    const entries: EvidenceEntry[] = [];
    for (const name of names) {
        const path = `${taskDir}/evidences/${name}`;
        const stats = await lstat(resolve(recordRoot, path)).catch((error: unknown) => {
            if (systemErrorCode(error) === "ENOENT") return null;
            throw error;
        });
        if (!stats || stats.isSymbolicLink()) continue;
        entries.push({name, path, kind: stats.isDirectory() ? "dir" : "file", size: stats.isFile() ? stats.size : null});
    }
    return entries;
}

/** Markdown 链接里指向 `docs/specs/` 的 `.md`，相对 README 所在目录解析。 */
export function linkedSpecs(readmePath: string, text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/gu)) {
        const target = match[1]!.replace(/[#?].*$/u, "");
        if (target === "" || /^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("/")) continue;
        const resolved = posix.normalize(posix.join(posix.dirname(readmePath), target));
        if (resolved.startsWith("docs/specs/") && resolved.endsWith(".md")) found.add(resolved);
    }
    return [...found].sort();
}

function parseLog(output: string): CommitEntry[] {
    return output.split("\x1e").map((block) => block.trim()).filter((block) => block !== "").map((block) => {
        const [sha = "", date = "", author = "", subject = ""] = block.split("\x1f");
        return {sha, date, author, subject};
    });
}

export async function readTaskDetail(mainRoot: string, transition: TransitionState, task: {workId: string; taskId: string; recordRoot: string}, warnings: Warning[]): Promise<TaskDetail> {
    const {workId, taskId, recordRoot} = task;
    const taskDir = taskDirPath(workId, taskId);
    const readmePath = taskReadmePath(workId, taskId);
    const text = await readText(resolve(recordRoot, readmePath));
    const execution = await resolveTaskExecution(mainRoot, transition, workId, taskId, recordRoot);
    const chosen = execution.chosen;
    const onMain = chosen.rule === "master";
    const format = "--format=%x1e%H%x1f%cI%x1f%an%x1f%s";
    let entries: CommitEntry[] = [];
    try {
        entries = parseLog(await gitOutput(chosen.root, onMain ? ["log", `-n${COMMIT_LIMIT}`, format, "HEAD", "--", taskDir] : ["log", `-n${COMMIT_LIMIT}`, format, `${MASTER_REF}..HEAD`], {readOnly: true}));
    } catch (error) {
        if (!isNbdevError(error) || error.code !== "git_failed") throw error;
        warnings.push({code: "commits_unreadable", message: `读不出 ${chosen.key} 上的提交：${error.message}`, details: {checkout: chosen.key}});
    }
    return {
        workId,
        taskId,
        readme: {path: readmePath, text},
        evidences: await listEvidences(recordRoot, taskDir),
        specs: text === null ? [] : linkedSpecs(readmePath, text),
        execution,
        commits: {checkout: chosen.key, range: onMain ? "task" : "branch", entries},
    };
}
