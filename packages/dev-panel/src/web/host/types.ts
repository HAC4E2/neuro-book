/**
 * 面板接口回应里的数据形状（与 src/server/views.ts 对应）。只声明前端用到的字段。
 * 前端不导入服务端与核心库的模块：两边各自构建，类型在这里按合同（docs/panel.md）写一份。
 */

export type RecordedValue<T extends string = string> = {value: T | null; origin: "recorded" | "inferred" | "commit" | "unset" | "invalid"; raw?: unknown};
export type TaskStatus = "planned" | "active" | "done" | "shelved";
export type WorkStatus = "active" | "done" | "shelved";
export type ActiveLease = {sessionKey: string; agent: string; label: string | null; taskId: string; lastActivityAt: string; stale: boolean};

export type OverviewTask = {
    taskId: string; title: string | null; status: RecordedValue<TaskStatus>; updated: RecordedValue; currentState: string | null;
    source: "master" | "branch"; uncommitted: boolean; openRequired: number; artifactCount: number; leaseCount: number;
};
export type OverviewWork = {
    workId: string; title: string | null; status: RecordedValue<WorkStatus>; goal: RecordedValue; updated: RecordedValue; source: "master" | "branch";
    branch: string | null; checkoutKey: string | null; executionRule: string | null; uncommitted: boolean;
    taskCounts: Record<TaskStatus | "unset" | "invalid", number>; openRequired: number; activeLeases: ActiveLease[]; tasks: OverviewTask[];
};
export type InboxQuestion = {kind: "question"; workId: string; taskId: string; artifactId: string; questionId: string; label: string; type: string; version: number; since: number; askedBy: string | null; askerActive: boolean | null};
export type InboxConflict = {kind: "number_conflict"; label: string; live: boolean};
export type InboxItem = InboxQuestion | InboxConflict;
export type Overview = {
    works: OverviewWork[];
    inbox: InboxItem[];
    nextWorkNumber: string;
    sessions: {total: number; byStatus: Record<string, number>; unownedRuns: number; herdr: {available: boolean; mode: string}};
};

export type Meta = {
    instance: string; startedAt: string; ready: boolean; codeChanged: boolean; build: {failed: boolean; message: string | null};
    herdr: {available: boolean; mode: string; version: string | null; at: string | null; error: string | null};
    parts: Record<string, {revision: number; at: string | null; error: string | null}>;
    artifactOrigin: string; artifactBase: string;
};

export type ArtifactSummary = {artifactId: string; kind: string | null; title: string | null; version: number | null; state: "open" | "closed" | "unpublished"; publishedAt: string | null; openRequired: number; adoption: "none" | "waiting" | "adopted" | null};
export type DocumentEntry = {path: string; title: string | null};
export type TaskView = OverviewTask & {
    workId: string; readmePath: string; branch: string | null; checkout: string; checkoutKey: string | null; leases: ActiveLease[]; artifacts: ArtifactSummary[]; documents: DocumentEntry[];
};
export type WorkSession = {key: string; agent: string; label: string | null; alive: boolean | null; herdr: {paneId: string; status: string} | null; leases: Array<{taskId: string; lastActivityAt: string; stale: boolean}>; runs: number};
export type WorkView = Omit<OverviewWork, "tasks"> & {readmePath: string; artifacts: ArtifactSummary[]; documents: DocumentEntry[]; otherCopies: Array<{branch: string | null; checkout: string}>; tasks: TaskView[]; sessions: WorkSession[]};

export type ExecutionCandidate = {key: string; root: string; branch: string | null; rule: "readme" | "name" | "home" | "work" | "master"};
export type CommitEntry = {sha: string; date: string; author: string; subject: string};
export type TaskDetail = {
    readme: {path: string; text: string | null};
    evidences: Array<{name: string; path: string; kind: "file" | "dir"; size: number | null}>;
    specs: string[];
    execution: {chosen: ExecutionCandidate; candidates: ExecutionCandidate[]};
    commits: {checkout: string; range: "branch" | "task"; entries: CommitEntry[]};
};
export type TaskPageData = {task: TaskView; work: {workId: string; title: string | null; source: string; branch: string | null}; detail: TaskDetail};
