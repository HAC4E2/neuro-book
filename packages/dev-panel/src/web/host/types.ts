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

export type ArtifactListItem = ArtifactSummary & {workId: string; taskId: string | null; taskTitle: string | null; workTitle: string | null; category: "design" | "report" | "review" | "questions" | "unpublished" | "other"};
export type DocumentListItem = DocumentEntry & {workId: string; taskId: string | null; checkoutKey: string | null};
export type EvidenceListItem = {workId: string; taskId: string; taskTitle: string | null; count: number};
export type ArtifactsData = {artifacts: ArtifactListItem[]; documents: DocumentListItem[]; evidences: EvidenceListItem[]};

export type QuestionOption = {value: string; label: string};
export type QuestionOutcome = null | {kind: "withdrawn"; in: number; reason: "explicit" | "closed"} | {kind: "superseded"; in: number; by: null | {workId: string; taskId: string; artifactId: string; questionId: string}};
export type VersionQuestion = {id: string; type: "single" | "multi" | "text" | "confirm"; label: string; options: QuestionOption[]; required: boolean; recommend: string[]; origin: "markup" | "ask"; page: string | null; about: string | null; since: number; outcome: QuestionOutcome};
export type AnswerUse = {answerId: string; value: unknown; artifactVersion: number; submittedAt: string; comment: string | null};
export type QuestionState = {question: VersionQuestion; state: "open" | "answered" | "withdrawn" | "superseded"; answer: AnswerUse | null; stale: (AnswerUse & {reason: string; code: "stale_value" | "invalid_value"}) | null};
export type AnswerRecord = {answerId: string; artifactVersion: number; submittedAt: string; submittedBy: {kind: "developer"; device: string} | {kind: "agent-transcribed"}; values: Record<string, unknown>; comments: Record<string, string>; note: string | null};
export type AckRecord = {ackId: string; answers: string[]; through: string; included: string[]; ackedAt: string};
export type ArtifactPageData = {
    ref: {workId: string; taskId: string | null; artifactId: string};
    checkoutKey: string | null; versions: number[]; latestVersion: number | null; version: number | null; kind: string | null; title: string | null;
    state: "open" | "closed" | "unpublished"; publishedAt: string | null; questions: QuestionState[]; answers: AnswerRecord[]; acks: AckRecord[];
    unpublishedChanges: boolean | null; pageUrl: string | null; pageIsCurrent: boolean;
};

export type CheckoutRef = {key: string; branch: string | null; isMain: boolean};
export type DocEntry = {path: string; group: string; section: string};
export type DocChange = {path: string; change: "added" | "modified" | "deleted" | "master_only"};
export type DocTreeData = {checkout: CheckoutRef; checkouts: Array<CheckoutRef & {root: string; head: string}>; docs: DocEntry[]; changes: DocChange[]};
export type DocFileData = {checkout: CheckoutRef; path: string; text: string; title: string | null; frontmatter: Record<string, unknown> | null; body: string; recent: CommitEntry[]; changedIn: string[]};

export type RunView = {pid: number; startedAt: string; command: string; cwd: string; checkout: string; ownerVia: string | null; paneId: string | null; unit: string | null; sessionHint: string | null; sessionAlive: boolean | null; descendants: Array<{pid: number; command: string}>};
export type SessionLease = {workId: string; taskId: string; acquiredAt: string; lastActivityAt: string; lastAction: string; stale: boolean};
export type SessionView = {key: string; agent: string; sessionId: string | null; label: string | null; alive: boolean | null; managed: boolean; herdr: {paneId: string; status: string} | null; leases: SessionLease[]; runs: RunView[]};
export type PaneView = {paneId: string; agent: string | null; status: string; session: {agent: string; value: string} | null; cwd: string | null; foregroundCwd: string | null; workspaceLabel: string | null; inRepository: boolean};
export type SessionsData = {
    herdr: {available: boolean; mode: string; version: string | null; at: string | null; error: string | null; missedEvents: number; reconnects: number};
    panes: PaneView[]; sessions: SessionView[]; unownedRuns: RunView[]; ignoredProcesses: number;
    checkouts: Array<CheckoutRef & {root: string; head: string; executionOf: string[]}>;
};

export type SearchRecordMatch = {type: "record"; kind: "work" | "task" | "artifact" | "session"; workId?: string; taskId?: string | null; artifactId?: string; title?: string | null; key?: string; label?: string | null};
export type SearchHit = {type: "hit"; checkout: string; kind: "name" | "content"; path: string; line: number | null; text: string | null};
export type SearchCheckoutDone = {type: "checkout_done"; checkout: string; count: number; truncated: boolean; elapsedMs: number; error: string | null};
