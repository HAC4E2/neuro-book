import type {HerdrClient} from "../herdr/client.js";
import {adoptionOf, listArtifactIds, listDocuments, questionStates, readArtifact, versionPath, type Adoption, type ArtifactKind, type DocumentEntry} from "./artifacts.js";
import {verifiedProvenance} from "./provenance.js";
import {readActivity, type Activity, type SessionView} from "./activity.js";
import {NbdevError, type Warning} from "./errors.js";
import type {Caller} from "./identity.js";
import type {RunView} from "./runs.js";
import {gitOutput, runGit, splitNul} from "./git.js";
import {parseTaskId, parseWorkId, taskRefNumber, workNumberLabel, workRefNumber} from "./ids.js";
import {
    listTaskIds,
    listWorkIds,
    readCommitDates,
    readTaskRecord,
    readWorkRecord,
    taskDirPath,
    workReadmePath,
    type TaskRecord,
    type TaskStatus,
    type WorkRecord,
} from "./records.js";
import {readRegistry, type Registry} from "./registry.js";
import {listCheckouts, MASTER_REF, WORKS_ROOT, type CheckoutInfo, type RepoContext} from "./repo.js";
import {findConflicts, nextWorkNumber, scanNumbers, type NumberConflict} from "./scan.js";
import {chooseExecutionCheckout, findBranchRecordChanges, taskSourceInBranchWork, type ExecutionCheckout} from "./sources.js";

/** 记录从哪里读：`master` 是主工作区（已提交的或标了 `uncommitted` 的）；`branch` 是过渡期的执行 worktree。 */
export type RecordSource = {source: "master" | "branch"; branch: string | null; checkout: string};

/** 某个 Task 上的一份有效租约（谁在动）；临时数据，会话结束就消失。 */
export type ActiveLease = {sessionKey: string; agent: string; label: string | null; taskId: string; lastActivityAt: string; stale: boolean};

/** 一个产物的摘要；没有发布记录的（例如 nbdev 之前的评审板）`state` 为 `unpublished`，可以浏览但不进收件箱。 */
export type ArtifactSummary = {
    artifactId: string;
    kind: ArtifactKind | null;
    title: string | null;
    version: number | null;
    state: "open" | "closed" | "unpublished";
    publishedAt: string | null;
    openRequired: number;
    adoption: Adoption | null;
};

/** 收件箱：只放要开发者动手的事。`askedBy` 是运行时的会话键（provenance），读不到为 null。 */
export type InboxItem =
    | {kind: "question"; workId: string; taskId: string; artifactId: string; questionId: string; label: string; type: string; version: number; since: number; askedBy: string | null}
    | {kind: "number_conflict"; label: string; live: boolean};

export type TaskView = TaskRecord & RecordSource & {uncommitted: boolean; leases: ActiveLease[]; artifacts: ArtifactSummary[]; documents: DocumentEntry[]};
export type WorkView = WorkRecord & RecordSource & {
    artifacts: ArtifactSummary[];
    documents: DocumentEntry[];
    activeLeases: ActiveLease[];
    uncommitted: boolean;
    executionRule: ExecutionCheckout["rule"] | null;
    otherCopies: Array<{branch: string | null; checkout: string}>;
    taskCounts: Record<TaskStatus | "unset" | "invalid", number>;
    tasks: TaskView[];
};

export type ProjectStatus = {
    mainRoot: string;
    callerRoot: string;
    callerBranch: string | null;
    /** 调用者是谁（只读地解析，不取租约）；调用方没给时为 null。 */
    caller: Caller | null;
    works: WorkView[];
    inbox: InboxItem[];
    conflicts: NumberConflict[];
    registryOnly: string[];
    nextWorkNumber: string;
    sessions: SessionView[];
    unownedRuns: RunView[];
    ignoredProcesses: number;
    herdr: Activity["herdr"];
};

export type StatusOptions = {herdr?: HerdrClient | null; caller?: Caller | null; now?: Date; selfPid?: number};

export type StatusFilter = {workRef?: string; taskRef?: string};

/** 读到的过渡期信息，写操作的来源判断也复用它。 */
export type TransitionState = {
    checkouts: CheckoutInfo[];
    registry: Registry;
    branchChanges: Map<string, CheckoutInfo[]>;
    warnings: Warning[];
};

export async function readTransitionState(mainRoot: string): Promise<TransitionState> {
    const checkouts = await listCheckouts(mainRoot);
    const {registry} = await readRegistry(mainRoot);
    const {changes, warnings} = await findBranchRecordChanges(mainRoot, checkouts);
    return {checkouts, registry, branchChanges: changes, warnings};
}

/** 在一组 id 里按完整 id 或编号解析引用；找不到返回空数组，几个同号时返回全部。 */
export function matchRef(ids: readonly string[], ref: string, kind: "work" | "task"): string[] {
    if (ids.includes(ref)) return [ref];
    const number = kind === "work" ? workRefNumber(ref) : taskRefNumber(ref);
    if (number === null || ref.includes("-")) return [];
    return ids.filter((id) => (kind === "work" ? parseWorkId(id)?.number : parseTaskId(id)?.number) === number);
}

/**
 * 读一个目录下全部产物的摘要，把 open 的必答题放进收件箱。提问者只在主工作区里找（provenance 在主工作区的 .local 下），
 * 来自分支的产物 `askedBy` 为 null。
 */
async function summarizeArtifacts(root: string, mainRoot: string, workId: string, taskId: string | null, inbox: InboxItem[], warnings: Warning[]): Promise<ArtifactSummary[]> {
    const summaries: ArtifactSummary[] = [];
    for (const artifactId of await listArtifactIds(root, workId, taskId)) {
        const ref = {workId, taskId, artifactId};
        const snapshot = await readArtifact(root, ref);
        warnings.push(...snapshot.warnings);
        const latest = snapshot.latest;
        if (!latest) {
            summaries.push({artifactId, kind: null, title: null, version: null, state: "unpublished", publishedAt: null, openRequired: 0, adoption: null});
            continue;
        }
        const open = questionStates(latest, snapshot.answers, snapshot.answeredVersions).filter((state) => state.state === "open" && state.question.required);
        if (taskId !== null) {
            for (const {question} of open) {
                const asker = root === mainRoot ? await verifiedProvenance(mainRoot, versionPath(ref, question.since), warnings) : null;
                inbox.push({kind: "question", workId, taskId, artifactId, questionId: question.id, label: question.label, type: question.type, version: latest.version, since: question.since, askedBy: asker?.session.key ?? null});
            }
        }
        summaries.push({artifactId, kind: latest.kind, title: latest.title, version: latest.version, state: latest.state, publishedAt: latest.publishedAt, openRequired: open.length, adoption: adoptionOf(snapshot.answers, snapshot.acks)});
    }
    return summaries;
}

/** “最近更新”：frontmatter 的 `updated` 与产物目录最后一次提交的日期中较晚的那个（发布、答复、确认都不改 README）。 */
function laterUpdated(updated: TaskRecord["updated"], artifactsDate: string | undefined): TaskRecord["updated"] {
    if (artifactsDate === undefined) return updated;
    if (updated.value !== null && updated.value >= artifactsDate) return updated;
    return {value: artifactsDate, origin: "commit"};
}

function emptyCounts(): WorkView["taskCounts"] {
    return {planned: 0, active: 0, done: 0, shelved: 0, unset: 0, invalid: 0};
}

/** 主工作区里未提交（含未跟踪）的记录路径；`-uall` 才能把未跟踪目录拆到具体文件。 */
async function uncommittedPaths(mainRoot: string): Promise<string[]> {
    const output = await gitOutput(mainRoot, ["status", "--porcelain", "-z", "-uall", "--no-renames", "--", `${WORKS_ROOT}/`], {readOnly: true});
    return splitNul(output).map((entry) => entry.slice(3));
}

/**
 * 汇总全部 Work 与 Task 的状态、来源与编号冲突。只读：不取锁，不写任何文件。
 */
export async function readProjectStatus(context: RepoContext, filter: StatusFilter = {}, options: StatusOptions = {}): Promise<{status: ProjectStatus; warnings: Warning[]}> {
    const {mainRoot} = context;
    const transition = await readTransitionState(mainRoot);
    const warnings: Warning[] = [...transition.warnings];
    const {activity, warnings: activityWarnings} = await readActivity(mainRoot, transition, {herdr: options.herdr ?? null, now: options.now ?? new Date(), selfPid: options.selfPid ?? process.pid});
    warnings.push(...activityWarnings);
    const activeOf = (workId: string): ActiveLease[] => activity.leases
        .filter((lease) => lease.state === "valid" && lease.workId === workId)
        .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
        .map((lease) => ({sessionKey: lease.session.key, agent: lease.session.agent, label: lease.session.label, taskId: lease.taskId, lastActivityAt: lease.lastActivityAt, stale: lease.stale}));
    const head = await runGit(mainRoot, ["symbolic-ref", "--quiet", "HEAD"], {readOnly: true});
    if (head.exitCode !== 0 || head.stdout.trim() !== MASTER_REF) {
        warnings.push({code: "main_not_on_master", message: "主工作区检出的不是 master，照常读工作区", details: {head: head.exitCode === 0 ? head.stdout.trim() : null}});
    }

    const mainWorkIds = await listWorkIds(mainRoot);
    let workIds = [...new Set([...mainWorkIds, ...transition.branchChanges.keys()])].sort();
    if (filter.workRef !== undefined) {
        const matched = matchRef(workIds, filter.workRef, "work");
        if (matched.length === 0) throw new NbdevError("work_not_found", `找不到 Work：${filter.workRef}`, {details: {workRef: filter.workRef}});
        if (matched.length > 1) throw new NbdevError("ambiguous_work", `Work 编号对应多个目录：${matched.join("、")}`, {details: {workRef: filter.workRef, candidates: matched}});
        workIds = matched;
    } else if (filter.taskRef !== undefined) {
        throw new NbdevError("usage", "--task 需要同时指定 --work");
    }

    const dirty = await uncommittedPaths(mainRoot);
    const inbox: InboxItem[] = [];
    const mainDates = await readCommitDates(mainRoot, "HEAD", WORKS_ROOT);
    const mainCheckout = transition.checkouts.find((checkout) => checkout.isMain)!;

    const works = await Promise.all(workIds.map(async (workId): Promise<WorkView> => {
        const copies = transition.branchChanges.get(workId);
        const execution = copies ? await chooseExecutionCheckout(mainRoot, workId, copies, transition.registry) : null;
        const executionRoot = execution?.chosen.root ?? mainRoot;
        const executionDates = execution ? await readCommitDates(executionRoot, "HEAD", `${WORKS_ROOT}/${workId}`) : mainDates;
        const record = await readWorkRecord(executionRoot, workId, executionDates, warnings);
        const executionTasks = execution ? await listTaskIds(executionRoot, workId) : [];
        const masterTasks = await listTaskIds(mainRoot, workId);
        let taskIds = [...new Set([...executionTasks, ...masterTasks])].sort();
        const workLeases = activeOf(workId);
        if (filter.taskRef !== undefined) {
            const matched = matchRef(taskIds, filter.taskRef, "task");
            if (matched.length === 0) throw new NbdevError("task_not_found", `找不到 Task：${workId}/${filter.taskRef}`, {details: {workId, taskRef: filter.taskRef}});
            if (matched.length > 1) throw new NbdevError("ambiguous_task", `Task 编号对应多个目录：${matched.join("、")}`, {details: {workId, candidates: matched}});
            taskIds = matched;
        }
        const tasks = await Promise.all(taskIds.map(async (taskId): Promise<TaskView> => {
            const source = execution ? taskSourceInBranchWork(transition.registry, workId, taskId, executionTasks.includes(taskId)) : "master";
            const root = source === "branch" ? executionRoot : mainRoot;
            const dates = source === "branch" ? executionDates : mainDates;
            const task = await readTaskRecord(root, workId, taskId, dates, warnings);
            const prefix = `${taskDirPath(workId, taskId)}/`;
            return {
                ...task,
                updated: laterUpdated(task.updated, dates.get(`${taskDirPath(workId, taskId)}/artifacts`)),
                artifacts: await summarizeArtifacts(root, mainRoot, workId, taskId, inbox, warnings),
                documents: await listDocuments(root, taskDirPath(workId, taskId)),
                source,
                branch: source === "branch" ? execution!.chosen.branch : mainCheckout.branch,
                checkout: root,
                uncommitted: source === "master" && dirty.some((path) => path.startsWith(prefix)),
                leases: workLeases.filter((lease) => lease.taskId === taskId),
            };
        }));
        const counts = emptyCounts();
        for (const task of tasks) counts[task.status.origin === "recorded" ? task.status.value : task.status.origin === "invalid" ? "invalid" : "unset"] += 1;
        return {
            ...record,
            source: execution ? "branch" : "master",
            branch: execution ? execution.chosen.branch : mainCheckout.branch,
            checkout: executionRoot,
            uncommitted: !execution && dirty.includes(workReadmePath(workId)),
            artifacts: await summarizeArtifacts(executionRoot, mainRoot, workId, null, inbox, warnings),
            documents: await listDocuments(executionRoot, `${WORKS_ROOT}/${workId}`),
            executionRule: execution?.rule ?? null,
            otherCopies: execution?.others.map((other) => ({branch: other.branch, checkout: other.root})) ?? [],
            activeLeases: workLeases,
            taskCounts: counts,
            tasks,
        };
    }));

    const scan = await scanNumbers(mainRoot, transition.checkouts, transition.registry);
    const {conflicts, registryOnly} = await findConflicts(mainRoot, scan);
    if (conflicts.length > 0) {
        warnings.push({code: "number_conflicts", message: `有 ${conflicts.length} 处撞号，其中 ${conflicts.filter((conflict) => conflict.live).length} 处 live`, details: {labels: conflicts.map((conflict) => conflict.label)}});
    }
    // 各 Task 并发读取，收件箱的题按 Work、Task、产物、题号排好；编号冲突接在后面。
    const questionKey = (item: InboxItem) => (item.kind === "question" ? `${item.workId}/${item.taskId}/${item.artifactId}/${item.questionId}` : "");
    inbox.sort((left, right) => questionKey(left).localeCompare(questionKey(right)));
    const workPrefixes = filter.workRef === undefined ? null : works.map((work) => work.workId.slice(0, 6));
    for (const conflict of conflicts) {
        if (workPrefixes && !workPrefixes.some((prefix) => conflict.label.startsWith(prefix))) continue;
        inbox.push({kind: "number_conflict", label: conflict.label, live: conflict.live});
    }
    return {
        status: {
            mainRoot,
            callerRoot: context.callerRoot,
            callerBranch: context.callerBranch,
            caller: options.caller ?? null,
            works,
            inbox,
            conflicts,
            registryOnly,
            nextWorkNumber: workNumberLabel(nextWorkNumber(scan)),
            sessions: activity.sessions,
            unownedRuns: activity.unownedRuns,
            ignoredProcesses: activity.ignoredProcesses,
            herdr: activity.herdr,
        },
        warnings,
    };
}
