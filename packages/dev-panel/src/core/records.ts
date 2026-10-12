import {readdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {systemErrorCode, type Warning} from "./errors.js";
import {firstParagraph, parseFrontmatter, readSection, readTitle} from "./frontmatter.js";
import {gitOutput} from "./git.js";
import {TASK_ID_PATTERN, WORK_ID_PATTERN} from "./ids.js";
import {WORKS_ROOT} from "./repo.js";

export const TASK_STATUSES = ["planned", "active", "done", "shelved"] as const;
export const WORK_STATUSES = ["active", "done", "shelved"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type WorkStatus = (typeof WORK_STATUSES)[number];

/**
 * 读到的值与它的出处：`recorded` 来自 frontmatter 或指定的一节；`inferred` 只用于 Work 目标（取第一段）；
 * `commit` 只用于 updated 的回退（最后一次提交的日期）；`unset` 没有；`invalid` 有但取值不合法。
 */
export type Recorded<T> =
    | {value: T; origin: "recorded" | "inferred" | "commit"}
    | {value: null; origin: "unset"}
    | {value: null; origin: "invalid"; raw: unknown};

export type WorkRecord = {
    workId: string;
    readmePath: string;
    title: string | null;
    issueId: string | null;
    goal: Recorded<string>;
    status: Recorded<WorkStatus>;
    updated: Recorded<string>;
};

export type TaskRecord = {
    workId: string;
    taskId: string;
    readmePath: string;
    title: string | null;
    status: Recorded<TaskStatus>;
    updated: Recorded<string>;
};

export function workReadmePath(workId: string): string {
    return `${WORKS_ROOT}/${workId}/README.md`;
}

export function taskDirPath(workId: string, taskId: string): string {
    return `${WORKS_ROOT}/${workId}/tasks/${taskId}`;
}

export function taskReadmePath(workId: string, taskId: string): string {
    return `${taskDirPath(workId, taskId)}/README.md`;
}

async function listPhysicalDirectories(path: string, pattern: RegExp): Promise<string[]> {
    try {
        const entries = await readdir(path, {withFileTypes: true});
        return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && pattern.test(entry.name)).map((entry) => entry.name).sort();
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return [];
        throw error;
    }
}

/** 一个 checkout 工作区里合格式的 Work 目录（含未跟踪的）。 */
export function listWorkIds(checkoutRoot: string): Promise<string[]> {
    return listPhysicalDirectories(resolve(checkoutRoot, WORKS_ROOT), WORK_ID_PATTERN);
}

/** 一个 Work 的 `tasks/` 下合格式的 Task 目录；只读这一层，不递归。 */
export function listTaskIds(checkoutRoot: string, workId: string): Promise<string[]> {
    return listPhysicalDirectories(resolve(checkoutRoot, WORKS_ROOT, workId, "tasks"), TASK_ID_PATTERN);
}

function recordedStatus<T extends string>(data: Record<string, unknown> | null, allowed: readonly T[]): Recorded<T> {
    if (!data || !Object.hasOwn(data, "status") || data.status === null || data.status === undefined) return {value: null, origin: "unset"};
    const raw = data.status;
    if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) return {value: raw as T, origin: "recorded"};
    return {value: null, origin: "invalid", raw};
}

function recordedUpdated(data: Record<string, unknown> | null, fallback: string | undefined): Recorded<string> {
    const raw = data?.updated;
    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(raw)) return {value: raw, origin: "recorded"};
    if (raw !== undefined && raw !== null) return {value: null, origin: "invalid", raw};
    if (fallback) return {value: fallback, origin: "commit"};
    return {value: null, origin: "unset"};
}

async function readText(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "EISDIR") return null;
        throw error;
    }
}

function frontmatterWarning(path: string, reason: string): Warning {
    return {code: "unreadable_record", message: `记录无法读取（${reason}）：${path}`, details: {path, reason}};
}

/** 读一个 Work README。`commitDates` 是 `readCommitDates` 的结果，用作 updated 的回退。 */
export async function readWorkRecord(checkoutRoot: string, workId: string, commitDates: ReadonlyMap<string, string>, warnings: Warning[]): Promise<WorkRecord> {
    const readmePath = workReadmePath(workId);
    const text = await readText(resolve(checkoutRoot, readmePath));
    const parsed = text === null ? null : parseFrontmatter(text);
    if (text === null) warnings.push(frontmatterWarning(readmePath, "missing_readme"));
    else if (parsed && !parsed.ok) warnings.push(frontmatterWarning(readmePath, parsed.reason));
    const data = parsed?.ok ? parsed.data : null;
    const body = parsed?.body ?? "";
    const status = recordedStatus(data, WORK_STATUSES);
    if (status.origin === "invalid") warnings.push({code: "invalid_status_value", message: `Work 的 status 取值不合法：${readmePath}`, details: {path: readmePath, raw: status.raw}});
    const goalSection = readSection(body, "目标");
    const inferredGoal = goalSection === null ? firstParagraph(body) : null;
    return {
        workId,
        readmePath,
        title: readTitle(body),
        issueId: typeof data?.issueId === "string" ? data.issueId : null,
        goal: goalSection !== null ? {value: goalSection, origin: "recorded"} : inferredGoal !== null ? {value: inferredGoal, origin: "inferred"} : {value: null, origin: "unset"},
        status,
        updated: recordedUpdated(data, commitDates.get(`${WORKS_ROOT}/${workId}`)),
    };
}

export async function readTaskRecord(checkoutRoot: string, workId: string, taskId: string, commitDates: ReadonlyMap<string, string>, warnings: Warning[]): Promise<TaskRecord> {
    const readmePath = taskReadmePath(workId, taskId);
    const text = await readText(resolve(checkoutRoot, readmePath));
    const parsed = text === null ? null : parseFrontmatter(text);
    if (text === null) warnings.push(frontmatterWarning(readmePath, "missing_readme"));
    else if (parsed && !parsed.ok) warnings.push(frontmatterWarning(readmePath, parsed.reason));
    const data = parsed?.ok ? parsed.data : null;
    const status = recordedStatus(data, TASK_STATUSES);
    if (status.origin === "invalid") warnings.push({code: "invalid_status_value", message: `Task 的 status 取值不合法：${readmePath}`, details: {path: readmePath, raw: status.raw}});
    return {
        workId,
        taskId,
        readmePath,
        title: readTitle(parsed?.body ?? ""),
        status,
        updated: recordedUpdated(data, commitDates.get(taskDirPath(workId, taskId))),
    };
}

/**
 * 一次 `git log` 取 scope 下每个 Work 目录与 Task 目录最后一次被提交碰到的日期（`YYYY-MM-DD`，提交者时间的日期部分）。
 * 日志从新到旧，按路径前缀取第一次出现。
 */
export async function readCommitDates(checkoutRoot: string, rev: string, scope: string): Promise<Map<string, string>> {
    const dates = new Map<string, string>();
    const output = await gitOutput(checkoutRoot, ["log", "--no-renames", "--format=%x1e%cI", "--name-only", rev, "--", scope], {readOnly: true});
    for (const block of output.split("\x1e")) {
        const lines = block.split("\n").filter((line) => line !== "");
        const date = lines[0]?.slice(0, 10);
        if (!date) continue;
        for (const path of lines.slice(1)) {
            const segments = path.split("/");
            if (segments.length < 4 || `${segments[0]}/${segments[1]}` !== WORKS_ROOT) continue;
            const workDir = segments.slice(0, 3).join("/");
            if (!dates.has(workDir)) dates.set(workDir, date);
            if (segments[3] === "tasks" && segments.length >= 6) {
                const taskDir = segments.slice(0, 5).join("/");
                if (!dates.has(taskDir)) dates.set(taskDir, date);
            }
        }
    }
    return dates;
}
