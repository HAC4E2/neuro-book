import {HerdrError, type HerdrClient} from "../herdr/client.js";
import {readHerdrSnapshot, readTaskStatuses, buildLeaseContext} from "./activity.js";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import type {Caller, SessionCaller} from "./identity.js";
import {evaluateLeases, readLeases, releaseLeases, sweepLeaseTemporaries, touchLease, type EvaluatedLease, type LeaseRecord, type ReleaseReason} from "./leases.js";
import {listTaskIds, listWorkIds} from "./records.js";
import type {RepoContext} from "./repo.js";
import {chooseExecutionCheckout} from "./sources.js";
import {matchRef, readTransitionState, type TransitionState} from "./status.js";

/**
 * 租约的操作：命令行与（以后的）面板共用。`caller` 由调用方在边界上解析好传进来；面板以开发者身份写入时为 null，只释放、不取得。
 * herdr pane 标签只写调用者自己所在的 pane，并且只在调用者确实在 herdr 里、不是 `--as` 的外部身份时才写。
 */
export type LeaseOptions = {caller: Caller | null; herdr: HerdrClient | null; now?: () => Date};
export type LeaseEffects = {lease: LeaseRecord | null; released: LeaseRecord[]};

type TagTarget = {caller: SessionCaller; paneId: string; herdr: HerdrClient};

function tagTarget(options: LeaseOptions): TagTarget | null {
    const {caller, herdr} = options;
    if (!caller || caller.kind !== "session" || caller.via === "as" || !caller.herdr || !herdr || caller.herdr.socketPath !== herdr.socketPath) return null;
    return {caller, paneId: caller.herdr.paneId, herdr};
}

function tokensOf(lease: {workId: string; taskId: string}): {work: string; task: string} {
    return {work: lease.workId.slice(0, 6), task: lease.taskId.slice(0, lease.taskId.indexOf("-"))};
}

async function writeTags(target: TagTarget, lease: {workId: string; taskId: string} | null, warnings: Warning[]): Promise<void> {
    try {
        if (lease) await target.herdr.reportTaskTokens(target.paneId, tokensOf(lease));
        else await target.herdr.clearTaskTokens(target.paneId);
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        warnings.push({code: "herdr_tag_failed", message: `写 herdr pane 标签失败（只影响显示）：${error.message}`, details: {paneId: target.paneId, code: error.code}});
    }
}

/**
 * 调用者自己的有效租约，最近活动的在前。`stillOpen` 指定的 Task 按未关闭算：`task status … done` 释放租约时，
 * 状态已经提交成 done，要知道 pane 标签此前指向的是不是它，得按关闭之前的样子算。
 */
async function callerValidLeases(mainRoot: string, transition: TransitionState, sessionKey: string, now: Date, stillOpen: {workId: string; taskId: string} | null = null): Promise<EvaluatedLease[]> {
    const {leases} = await readLeases(mainRoot);
    const mine = leases.filter((lease) => lease.session.key === sessionKey);
    const context = await buildLeaseContext(mainRoot, transition, mine, {available: false, socketPath: null, version: null, panes: [], processes: null}, now);
    const taskStatus = context.taskStatus;
    const adjusted = stillOpen ? {...context, taskStatus: (workId: string, taskId: string) => (workId === stillOpen.workId && taskId === stillOpen.taskId ? null : taskStatus(workId, taskId))} : context;
    return evaluateLeases(mine, adjusted).filter((lease) => lease.state === "valid").sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
}

function nowOf(options: LeaseOptions): Date {
    return (options.now ?? (() => new Date()))();
}

/** 租约目录与文件上可能碰到、又不该让命令失败的系统错误。 */
const LEASE_IO_ERRORS = new Set(["EACCES", "EPERM", "EISDIR", "ENOTDIR", "EROFS", "ENOSPC"]);

/**
 * 租约是运行时数据：记录已经提交之后，租约读写失败只能是警告，否则调用者会以为记录没改而重跑或手动提交。
 * 只接住租约读写会产生的几类错误（`write_failed`、`invalid_record` 与上面的系统错误），其余照常抛出。
 */
async function guardLeaseIo<T>(warnings: Warning[], what: string, fallback: T, action: () => Promise<T>): Promise<T> {
    try {
        return await action();
    } catch (error) {
        const known = error instanceof NbdevError && (error.code === "write_failed" || error.code === "invalid_record");
        const systemCode = systemErrorCode(error);
        if (!known && !(systemCode !== undefined && LEASE_IO_ERRORS.has(systemCode))) throw error;
        warnings.push({
            code: "lease_write_failed",
            message: `${what}失败（记录操作不受影响）：${error instanceof Error ? error.message : String(error)}`,
            details: {...(error instanceof NbdevError ? error.details : {}), code: error instanceof NbdevError ? error.code : systemCode},
        });
        return fallback;
    }
}

/** 取得或续期调用者在这个 Task 上的租约并写标签；未知调用者只给警告，租约写失败也只给警告，不影响记录操作的结果。 */
export async function touchCallerLease(context: RepoContext, target: {workId: string; taskId: string; action: string}, options: LeaseOptions, warnings: Warning[]): Promise<LeaseRecord | null> {
    const {caller} = options;
    if (!caller || caller.kind !== "session") {
        if (caller) warnings.push({code: "caller_unknown", message: "认不出调用者是哪个会话，没有取得租约；herdr 外的会话可以加 --as <标签>", details: {reason: caller.reason}});
        return null;
    }
    const lease = await guardLeaseIo(warnings, "写租约", null, () => touchLease(context.mainRoot, {caller, workId: target.workId, taskId: target.taskId, action: target.action, now: nowOf(options)}));
    if (!lease) return null;
    await guardLeaseIo(warnings, "清理租约目录里过期的临时文件", undefined, () => sweepLeaseTemporaries(context.mainRoot));
    const tags = tagTarget(options);
    if (tags) await writeTags(tags, lease, warnings);
    return lease;
}

/**
 * 释放一组租约，并按调用者自己的租约维护它 pane 上的标签：只有调用者最近活动的那份有效租约在这次被释放时才动标签，
 * 改写成它的下一份有效租约，没有就清空。别的会话 pane 上的标签不动（等 24 小时 TTL）。
 */
async function releaseAndRetag(context: RepoContext, transition: TransitionState, release: () => Promise<{released: LeaseRecord[]; warnings: Warning[]}>, options: LeaseOptions, warnings: Warning[], closing: {workId: string; taskId: string} | null = null): Promise<LeaseRecord[]> {
    const tags = tagTarget(options);
    const now = nowOf(options);
    const before = tags ? await guardLeaseIo(warnings, "读租约", [], () => callerValidLeases(context.mainRoot, transition, tags.caller.ref.key, now, closing)) : [];
    const outcome = await guardLeaseIo(warnings, "释放租约", {released: [], warnings: []}, release);
    warnings.push(...outcome.warnings);
    const {released} = outcome;
    const current = before[0];
    if (tags && current && released.some((lease) => lease.leaseId === current.leaseId)) {
        const after = await guardLeaseIo(warnings, "读租约", [], () => callerValidLeases(context.mainRoot, transition, tags.caller.ref.key, now));
        await writeTags(tags, after[0] ?? null, warnings);
    }
    return released;
}

/**
 * Task 状态改成 done 或 shelved 后释放这个 Task 的全部租约（不论哪个会话、不论由谁调用）。
 * 状态提交与释放之间不持锁，别的会话可能已经把 Task 改回去并续期：释放前重读一次状态，已不是 done 或 shelved 就不释放；
 * 只释放最近活动不晚于这次重读的租约，重读之后才续期的那份留着。
 */
export async function releaseTaskLeases(context: RepoContext, target: {workId: string; taskId: string}, reason: ReleaseReason, options: LeaseOptions, warnings: Warning[]): Promise<LeaseRecord[]> {
    const transition = await readTransitionState(context.mainRoot);
    const checkedAt = nowOf(options);
    const status = (await readTaskStatuses(context.mainRoot, transition, [target]))(target.workId, target.taskId);
    if (status !== "done" && status !== "shelved") {
        warnings.push({code: "lease_release_skipped", message: `${target.workId}/${target.taskId} 已被改成 ${status ?? "未标"}，没有释放它的租约`, details: {...target, status}});
        return [];
    }
    return releaseAndRetag(context, transition, () => releaseLeases(context.mainRoot, {kind: "task", ...target}, reason, nowOf(options), {notAfter: checkedAt}), options, warnings, target);
}

/** 按引用找到 Work 与 Task（`master` 或过渡期的执行 worktree 里都算）。租约是运行时数据，来自分支的 Task 也能取得。 */
async function resolveLeaseTarget(context: RepoContext, transition: TransitionState, workRef: string, taskRef: string): Promise<{workId: string; taskId: string}> {
    const workIds = [...new Set([...await listWorkIds(context.mainRoot), ...transition.branchChanges.keys()])];
    const works = matchRef(workIds, workRef, "work");
    if (works.length === 0) throw new NbdevError("work_not_found", `找不到 Work：${workRef}`, {details: {workRef}});
    if (works.length > 1) throw new NbdevError("ambiguous_work", `Work 编号对应多个目录：${works.join("、")}`, {details: {workRef, candidates: works}});
    const workId = works[0]!;
    const copies = transition.branchChanges.get(workId);
    const execution = copies ? await chooseExecutionCheckout(context.mainRoot, workId, copies, transition.registry) : null;
    const taskIds = [...new Set([...await listTaskIds(context.mainRoot, workId), ...(execution ? await listTaskIds(execution.chosen.root, workId) : [])])];
    const tasks = matchRef(taskIds, taskRef, "task");
    if (tasks.length === 0) throw new NbdevError("task_not_found", `找不到 Task：${workId}/${taskRef}`, {details: {workId, taskRef}});
    if (tasks.length > 1) throw new NbdevError("ambiguous_task", `Task 编号对应多个目录：${tasks.join("、")}`, {details: {workId, candidates: tasks}});
    return {workId, taskId: tasks[0]!};
}

function requireSession(caller: Caller | null): SessionCaller {
    if (caller?.kind === "session") return caller;
    throw new NbdevError("caller_unknown", "认不出调用者是哪个会话；herdr 外的会话加 --as <标签>", {details: {reason: caller?.reason ?? "no_identity"}});
}

/** `nbdev lease take`：Task 已 done 或 shelved 时报 `task_closed`。 */
export async function takeLease(context: RepoContext, input: {workRef: string; taskRef: string}, options: LeaseOptions): Promise<{data: LeaseEffects & {workId: string; taskId: string}; warnings: Warning[]}> {
    requireSession(options.caller);
    const warnings: Warning[] = [];
    const transition = await readTransitionState(context.mainRoot);
    const target = await resolveLeaseTarget(context, transition, input.workRef, input.taskRef);
    const status = (await readTaskStatuses(context.mainRoot, transition, [target]))(target.workId, target.taskId);
    if (status === "done" || status === "shelved") {
        throw new NbdevError("task_closed", `${target.workId}/${target.taskId} 已是 ${status}，不能再取得租约`, {details: {...target, status}});
    }
    const lease = await touchCallerLease(context, {...target, action: "lease take"}, options, warnings);
    return {data: {...target, lease, released: []}, warnings};
}

/** `nbdev release`：释放调用者在这个 Task 上的租约；不带 Task 时释放调用者的全部租约（子代理与父会话同一个身份）。 */
export async function releaseCallerLeases(context: RepoContext, input: {workRef?: string; taskRef?: string}, options: LeaseOptions): Promise<{data: LeaseEffects; warnings: Warning[]}> {
    const caller = requireSession(options.caller);
    const warnings: Warning[] = [];
    const transition = await readTransitionState(context.mainRoot);
    const target = input.workRef !== undefined && input.taskRef !== undefined ? await resolveLeaseTarget(context, transition, input.workRef, input.taskRef) : null;
    const released = await releaseAndRetag(context, transition, () => releaseLeases(context.mainRoot, {kind: "session", sessionKey: caller.ref.key, ...(target ?? {})}, "released", nowOf(options)), options, warnings);
    return {data: {lease: null, released}, warnings};
}

/** `nbdev lease list`：现算状态；默认不列已释放与 Task 已关闭的。 */
export async function listLeases(context: RepoContext, input: {workRef?: string; taskRef?: string; all?: boolean}, options: {herdr: HerdrClient | null; now?: () => Date}): Promise<{data: {leases: EvaluatedLease[]}; warnings: Warning[]}> {
    const warnings: Warning[] = [];
    const transition = await readTransitionState(context.mainRoot);
    const snapshot = await readHerdrSnapshot(options.herdr, warnings);
    const {leases: records, warnings: leaseWarnings} = await readLeases(context.mainRoot, {all: input.all === true});
    warnings.push(...leaseWarnings);
    const now = (options.now ?? (() => new Date()))();
    let leases = evaluateLeases(records, await buildLeaseContext(context.mainRoot, transition, records, snapshot, now));
    if (input.workRef !== undefined) {
        const workIds = matchRef([...new Set(leases.map((lease) => lease.workId))], input.workRef, "work");
        leases = leases.filter((lease) => workIds.includes(lease.workId));
        if (input.taskRef !== undefined) {
            const taskIds = matchRef([...new Set(leases.map((lease) => lease.taskId))], input.taskRef, "task");
            leases = leases.filter((lease) => taskIds.includes(lease.taskId));
        }
    }
    if (!input.all) leases = leases.filter((lease) => lease.state !== "released" && lease.state !== "task_closed");
    return {data: {leases: leases.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))}, warnings};
}
