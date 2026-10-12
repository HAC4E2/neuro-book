import {NbdevError, type Warning} from "./errors.js";
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

export type TaskView = TaskRecord & RecordSource & {uncommitted: boolean};
export type WorkView = WorkRecord & RecordSource & {
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
    works: WorkView[];
    conflicts: NumberConflict[];
    registryOnly: string[];
    nextWorkNumber: string;
};

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
export async function readProjectStatus(context: RepoContext, filter: StatusFilter = {}): Promise<{status: ProjectStatus; warnings: Warning[]}> {
    const {mainRoot} = context;
    const transition = await readTransitionState(mainRoot);
    const warnings: Warning[] = [...transition.warnings];
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
        if (filter.taskRef !== undefined) {
            const matched = matchRef(taskIds, filter.taskRef, "task");
            if (matched.length === 0) throw new NbdevError("task_not_found", `找不到 Task：${workId}/${filter.taskRef}`, {details: {workId, taskRef: filter.taskRef}});
            if (matched.length > 1) throw new NbdevError("ambiguous_task", `Task 编号对应多个目录：${matched.join("、")}`, {details: {workId, candidates: matched}});
            taskIds = matched;
        }
        const tasks = await Promise.all(taskIds.map(async (taskId): Promise<TaskView> => {
            const source = execution ? taskSourceInBranchWork(transition.registry, workId, taskId, executionTasks.includes(taskId)) : "master";
            const root = source === "branch" ? executionRoot : mainRoot;
            const task = await readTaskRecord(root, workId, taskId, source === "branch" ? executionDates : mainDates, warnings);
            const prefix = `${taskDirPath(workId, taskId)}/`;
            return {
                ...task,
                source,
                branch: source === "branch" ? execution!.chosen.branch : mainCheckout.branch,
                checkout: root,
                uncommitted: source === "master" && dirty.some((path) => path.startsWith(prefix)),
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
            executionRule: execution?.rule ?? null,
            otherCopies: execution?.others.map((other) => ({branch: other.branch, checkout: other.root})) ?? [],
            taskCounts: counts,
            tasks,
        };
    }));

    const scan = await scanNumbers(mainRoot, transition.checkouts, transition.registry);
    const {conflicts, registryOnly} = await findConflicts(mainRoot, scan);
    if (conflicts.length > 0) {
        warnings.push({code: "number_conflicts", message: `有 ${conflicts.length} 处撞号，其中 ${conflicts.filter((conflict) => conflict.live).length} 处 live`, details: {labels: conflicts.map((conflict) => conflict.label)}});
    }
    return {
        status: {
            mainRoot,
            callerRoot: context.callerRoot,
            callerBranch: context.callerBranch,
            works,
            conflicts,
            registryOnly,
            nextWorkNumber: workNumberLabel(nextWorkNumber(scan)),
        },
        warnings,
    };
}
