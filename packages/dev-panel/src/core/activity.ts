import {HerdrError, type HerdrClient, type HerdrPane, type HerdrStatus} from "../herdr/client.js";
import type {Warning} from "./errors.js";
import type {SessionRef} from "./identity.js";
import {evaluateLeases, processLiveness, readLeases, type EvaluatedLease, type LeaseContext, type LeaseRecord} from "./leases.js";
import {bootTime, processAlive, readProcessTable} from "./procfs.js";
import {listTaskIds, readTaskRecord, type TaskStatus} from "./records.js";
import {discoverRuns, type PaneProcesses, type RunView} from "./runs.js";
import {currentBootId, readProcRecords} from "./procs.js";
import {chooseExecutionCheckout, taskSourceInBranchWork} from "./sources.js";
import type {TransitionState} from "./status.js";

/**
 * “谁在动”：运行时数据（租约、会话、运行）的汇总。全部现算、只读：不取锁、不写文件，herdr 只走只读方法。
 */

export type HerdrSnapshot = {available: boolean; socketPath: string | null; version: string | null; panes: HerdrPane[]; processes: PaneProcesses[] | null};

export type SessionView = SessionRef & {
    /** 会话进程是否还在；租约没记进程、herdr 里也找不到时为 null（不知道）。 */
    alive: boolean | null;
    managed: boolean;
    herdr: {paneId: string; status: HerdrStatus} | null;
    leases: Array<{workId: string; taskId: string; acquiredAt: string; lastActivityAt: string; lastAction: string; stale: boolean}>;
    runs: RunView[];
};

export type Activity = {
    leases: EvaluatedLease[];
    sessions: SessionView[];
    unownedRuns: RunView[];
    ignoredProcesses: number;
    herdr: {available: boolean; socketPath: string | null; version: string | null};
};

/** 读一次 herdr：pane 列表（带 agent 与 agent_session，不必另调 agent.list）与各 pane 的进程信息（并发；单个 pane 失败就跳过）。 */
export async function readHerdrSnapshot(herdr: HerdrClient | null, warnings: Warning[]): Promise<HerdrSnapshot> {
    if (!herdr) return {available: false, socketPath: null, version: null, panes: [], processes: null};
    // ping 与 pane.list 并发：herdr 的单次调用常要多等约 100 毫秒（见 docs/herdr.md），串行会叠加。
    const [availability, listed] = await Promise.all([herdr.availability(), herdr.listPanes().then((panes) => ({panes}), (error: unknown) => ({error}))]);
    if (!availability.ok) return {available: false, socketPath: herdr.socketPath, version: null, panes: [], processes: null};
    let panes: HerdrPane[];
    try {
        if ("error" in listed) throw listed.error;
        panes = listed.panes;
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        warnings.push({code: "herdr_unavailable", message: `读 herdr 的 pane 列表失败：${error.message}`, details: {code: error.code, socketPath: herdr.socketPath}});
        return {available: false, socketPath: herdr.socketPath, version: availability.version, panes: [], processes: null};
    }
    return {available: true, socketPath: herdr.socketPath, version: availability.version, panes, processes: await readPaneProcesses(herdr, panes, warnings)};
}

/** 各 pane 的进程信息（并发；单个 pane 失败就跳过并给 `herdr_partial`）。面板用自己维护的 pane 列表调它，不再另取 pane 列表。 */
export async function readPaneProcesses(herdr: HerdrClient, panes: readonly HerdrPane[], warnings: Warning[]): Promise<PaneProcesses[]> {
    const failed: string[] = [];
    const infos = await Promise.all(panes.map(async (pane) => {
        try {
            return await herdr.processInfo(pane.paneId);
        } catch (error) {
            if (!(error instanceof HerdrError)) throw error;
            failed.push(`${pane.paneId}（${error.code}）`);
            return null;
        }
    }));
    if (failed.length > 0) warnings.push({code: "herdr_partial", message: `有 ${failed.length} 格 pane 的进程信息没读到，按没有这格处理`, details: {panes: failed}});
    const processes: PaneProcesses[] = [];
    for (const [index, info] of infos.entries()) {
        const pane = panes[index]!;
        if (info) processes.push({paneId: pane.paneId, shellPid: info.shellPid, foregroundPids: info.foregroundPids, session: pane.session});
    }
    return processes;
}

/** 一批 (Work, Task) 的当前状态：按过渡期规则从 master 或执行 worktree 读 README；读不到或没写状态为 null。 */
export async function readTaskStatuses(mainRoot: string, transition: TransitionState, pairs: ReadonlyArray<{workId: string; taskId: string}>): Promise<(workId: string, taskId: string) => TaskStatus | null> {
    const statuses = new Map<string, TaskStatus | null>();
    const executionTasks = new Map<string, Promise<{root: string; tasks: string[]} | null>>();
    const executionOf = (workId: string) => {
        let cached = executionTasks.get(workId);
        if (!cached) {
            const copies = transition.branchChanges.get(workId);
            cached = copies
                ? chooseExecutionCheckout(mainRoot, workId, copies, transition.registry).then(async (execution) => ({root: execution.chosen.root, tasks: await listTaskIds(execution.chosen.root, workId)}))
                : Promise.resolve(null);
            executionTasks.set(workId, cached);
        }
        return cached;
    };
    const ignored: Warning[] = [];
    for (const {workId, taskId} of pairs) {
        const key = `${workId}/${taskId}`;
        if (statuses.has(key)) continue;
        const execution = await executionOf(workId);
        const source = execution ? taskSourceInBranchWork(transition.registry, workId, taskId, execution.tasks.includes(taskId)) : "master";
        // 状态只用来判租约有没有因 Task 关闭而失效；记录读不出的警告由 status 的记录读取统一给出，这里不重复。
        const record = await readTaskRecord(source === "branch" ? execution!.root : mainRoot, workId, taskId, new Map(), ignored);
        statuses.set(key, record.status.origin === "recorded" ? record.status.value : null);
    }
    return (workId, taskId) => statuses.get(`${workId}/${taskId}`) ?? null;
}

/** 现算租约有效性所需的外部事实。 */
export async function buildLeaseContext(mainRoot: string, transition: TransitionState, leases: readonly LeaseRecord[], snapshot: HerdrSnapshot, now: Date): Promise<LeaseContext> {
    return {
        now,
        taskStatus: await readTaskStatuses(mainRoot, transition, leases),
        processAlive: await processLiveness(leases),
        herdr: snapshot.available && snapshot.socketPath
            ? {socketPath: snapshot.socketPath, sessionIds: new Set(snapshot.panes.flatMap((pane) => (pane.session ? [pane.session.value] : [])))}
            : null,
    };
}

/** 经 nbdev 起、还没结束的运行涉及的 pid（监管进程、组长、后代快照）：这些归“在跑”页的第一块，不再算会话的运行或无主的运行。 */
async function registeredRunPids(mainRoot: string, warnings: Warning[]): Promise<Set<number>> {
    const {records, warnings: recordWarnings} = await readProcRecords(mainRoot);
    warnings.push(...recordWarnings);
    const bootId = await currentBootId();
    const pids = new Set<number>();
    for (const record of records) {
        if (record.endedAt || record.bootId !== bootId) continue;
        // 核对启动时刻：登记里的 pid 被复用时不把别人的进程藏起来。
        const refs = [record.supervisor, ...(record.pid !== null && record.startTicks !== null ? [{pid: record.pid, startTicks: record.startTicks}] : []), ...record.descendants];
        for (const ref of refs) if (await processAlive(ref)) pids.add(ref.pid);
    }
    return pids;
}

/**
 * 汇总租约、会话与运行。`selfPid` 的进程与它的祖先不算运行（本次调用 nbdev 的那条命令）。
 * 给了 `snapshot`（面板自己维护的 herdr 状态）就不再调 herdr 取 pane 列表，会话页与活动用同一份 herdr 状态。
 */
export async function readActivity(mainRoot: string, transition: TransitionState, options: {herdr: HerdrClient | null; now: Date; selfPid: number; snapshot?: HerdrSnapshot}): Promise<{activity: Activity; warnings: Warning[]}> {
    const warnings: Warning[] = [];
    const snapshot = options.snapshot ?? await readHerdrSnapshot(options.herdr, warnings);
    const {leases: records, warnings: leaseWarnings} = await readLeases(mainRoot);
    warnings.push(...leaseWarnings);
    const leaseContext = await buildLeaseContext(mainRoot, transition, records, snapshot, options.now);
    const leases = evaluateLeases(records, leaseContext);
    const valid = leases.filter((lease) => lease.state === "valid");
    if (!snapshot.available && valid.some((lease) => lease.session.herdr !== null)) {
        warnings.push({code: "herdr_unavailable", message: "herdr 不可用：租约照常按会话进程与 24 小时判断，但看不出哪些会话能通知", details: {socketPath: snapshot.socketPath}});
    }
    const {runs, ignored} = await discoverRuns({
        processes: await readProcessTable(),
        checkoutRoots: transition.checkouts.filter((checkout) => !checkout.prunable).map((checkout) => checkout.root),
        selfPid: options.selfPid,
        panes: snapshot.processes,
        bootTime: await bootTime(),
        exclude: await registeredRunPids(mainRoot, warnings),
    });

    const sessions = new Map<string, SessionView>();
    const paneOfSession = (sessionId: string | null) => (sessionId ? snapshot.panes.find((pane) => pane.session?.value === sessionId) ?? null : null);
    const sessionView = (ref: SessionRef): SessionView => {
        let view = sessions.get(ref.key);
        if (!view) {
            const pane = paneOfSession(ref.sessionId);
            view = {...ref, alive: pane ? true : null, managed: pane !== null, herdr: pane ? {paneId: pane.paneId, status: pane.status} : null, leases: [], runs: []};
            sessions.set(ref.key, view);
        }
        return view;
    };
    for (const lease of valid.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))) {
        const {process, herdr: _herdr, ...ref} = lease.session;
        const view = sessionView(ref);
        if (process) view.alive = leaseContext.processAlive(process);
        view.leases.push({workId: lease.workId, taskId: lease.taskId, acquiredAt: lease.acquiredAt, lastActivityAt: lease.lastActivityAt, lastAction: lease.lastAction, stale: lease.stale});
    }
    const unownedRuns: RunView[] = [];
    for (const run of runs) {
        if (run.owner) sessionView(run.owner).runs.push(run);
        else unownedRuns.push(run);
    }
    return {
        activity: {
            leases,
            sessions: [...sessions.values()],
            unownedRuns,
            ignoredProcesses: ignored,
            herdr: {available: snapshot.available, socketPath: snapshot.socketPath, version: snapshot.version},
        },
        warnings,
    };
}
