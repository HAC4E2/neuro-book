import type {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";
import {projectAgentChatEntry} from "nbook/server/agent/events/public-chat-entry-projection";
import type {AgentSessionLiveStateDto} from "nbook/shared/dto/agent-session.dto";
import type {SessionEntry, SessionEntryDraft, SessionEntryId, SessionId, SessionProjectionScope} from "nbook/server/agent/session/types";
import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {appLogger} from "nbook/server/app-logs/logger";

export type SessionWriteProjection = true | SessionProjectionScope;

export type SessionWritePlan = {
    target: {
        sessionId: SessionId;
    };
    /** 写入原因，用于错误归因和后续诊断。 */
    cause: string;
    durability?: "immediate" | "savePoint";
    ops: SessionWriteOp[];
};

export type SessionWriteOp =
    | {
        kind: "append";
        entry: SessionEntryDraft;
        projection?: SessionWriteProjection;
    }
    | {
        kind: "appendMany";
        entries: AppendManySessionEntryDraft[];
    }
    | {
        kind: "moveLeaf";
        leafId: SessionEntry["id"] | null;
    };

export type AppendManySessionEntryDraft = Exclude<SessionEntryDraft, {type: "leaf"}> & {
    id?: SessionEntryId;
    parentId?: SessionEntryId | null;
    timestamp?: number;
};

export type SessionWriteResult = {
    entries: SessionEntry[];
    liveStates: Map<SessionId, AgentSessionLiveStateDto>;
};

export type SessionWriteTimingSink = {
    measureWritePlan<T>(task: () => Promise<T>): Promise<T>;
    measureLiveState<T>(sessionId: SessionId, task: () => Promise<T>): Promise<T>;
};

export type SessionWriteExecutionOptions = {
    timing?: SessionWriteTimingSink;
};

export type SessionWriteEntryBatch = {
    sessionId: SessionId;
    cause: string;
    invocationId?: string;
    entries: SessionEntry[];
};

export type SessionWriteExecutorInput = {
    repo: JsonlSessionRepository;
    eventHub: AgentSessionEventHub;
    liveStateProvider: (sessionId: SessionId) => Promise<AgentSessionLiveStateDto>;
    onEntriesWritten?: (batch: SessionWriteEntryBatch) => void | Promise<void>;
    /**
     * invocation 归属校验。Harness 强制取消并释放执行权后，旧异步路径不得再写 session。
     * 没有 invocationId 的用户/系统写入不经过该约束。
     */
    invocationWriteAllowed?: (sessionId: SessionId, invocationId: string) => boolean;
    /**
     * 强制取消终态的窄化授权：只允许 Harness 在释放 ownership 前登记的
     * 精确 `${sessionId}:${invocationId}` tombstone 写一条 aborted lifecycle。
     * 缺失或返回 false 时 fail closed。
     */
    forcedAbortWriteAllowed?: (sessionId: SessionId, invocationId: string) => boolean;
};

/** 写执行器内部权限模型；forced-abort 只能经 enqueueForcedAbort 进入。 */
type SessionWriteAuthority = {kind: "unowned"} | {kind: "invocation"; invocationId: string} | {kind: "forced-abort"; invocationId: string};

/**
 * 强制取消终态的唯一合法 plan 形状：单 session、固定 cause、单个非 projection
 * aborted lifecycle，且 entry.invocationId 与授权一致。任何偏差在入队前同步拒绝，
 * 排队等待期间对象被篡改也会在物理写入前再次拒绝。
 */
export type ForcedAbortSessionWritePlan = {
    target: {sessionId: SessionId};
    cause: "lifecycle.aborted.force";
    ops: [{
        kind: "append";
        entry: Extract<SessionEntryDraft, {type: "invocation_lifecycle"}>;
    }];
};

/**
 * 统一执行 session write plan。
 *
 * Hook、profile 和 tool 只能生成 plan，不能直接 append repo 或 publish event。
 * 第一版不做 batch commit marker；同一个 plan 会先整体校验，再按 op 顺序写入并发布。
 */
export class SessionWriteExecutor {
    private readonly repo: JsonlSessionRepository;
    private readonly eventHub: AgentSessionEventHub;
    private readonly liveStateProvider: (sessionId: SessionId) => Promise<AgentSessionLiveStateDto>;
    private readonly onEntriesWritten?: (batch: SessionWriteEntryBatch) => void | Promise<void>;
    private readonly invocationWriteAllowed?: (sessionId: SessionId, invocationId: string) => boolean;
    private readonly forcedAbortWriteAllowed?: (sessionId: SessionId, invocationId: string) => boolean;
    private readonly writeQueues = new Map<SessionId, Promise<void>>();

    constructor(input: SessionWriteExecutorInput) {
        this.repo = input.repo;
        this.eventHub = input.eventHub;
        this.liveStateProvider = input.liveStateProvider;
        this.onEntriesWritten = input.onEntriesWritten;
        this.invocationWriteAllowed = input.invocationWriteAllowed;
        this.forcedAbortWriteAllowed = input.forcedAbortWriteAllowed;
    }

    /**
     * 执行一组 plan，并在写入后发布 session_entry 和 session_state_changed。
     * 保持 async：参数错误以 rejected promise 暴露，与既有调用方合同一致。
     */
    async execute(plans: SessionWritePlan[], invocationId?: string, options: SessionWriteExecutionOptions = {}): Promise<SessionWriteResult> {
        for (const plan of plans) {
            this.assertValidPlan(plan);
        }
        const sessionIds = [...new Set(plans.map((plan) => plan.target.sessionId))].sort((left, right) => left - right);
        const authority: SessionWriteAuthority = invocationId === undefined
            ? {kind: "unowned"}
            : {kind: "invocation", invocationId};
        return this.withSessionWriteLocks(sessionIds, () => this.executeUnlocked(plans, authority, options));
    }

    /**
     * 强制取消终态入口。非 async 合同：返回前必须完成参数校验并同步占据目标
     * write queue 槽位，保证旧 aborted 先于后续 invocation start 落盘；
     * 授权（tombstone）在物理写入前复核并经 completion 异步拒绝。
     */
    enqueueForcedAbort(plan: ForcedAbortSessionWritePlan, invocationId: string, options: SessionWriteExecutionOptions = {}): {completion: Promise<SessionWriteResult>} {
        this.assertValidPlan(plan);
        this.assertForcedAbortPlan(plan, invocationId);
        const completion = this.withSessionWriteLocks(
            [plan.target.sessionId],
            () => this.executeUnlocked([plan], {kind: "forced-abort", invocationId}, options),
        );
        return {completion};
    }

    private async executeUnlocked(plans: SessionWritePlan[], authority: SessionWriteAuthority, options: SessionWriteExecutionOptions): Promise<SessionWriteResult> {
        const invocationId = authority.kind === "unowned" ? undefined : authority.invocationId;
        const written: SessionEntry[] = [];
        const touchedSessionIds = new Set<SessionId>();

        for (let index = 0; index < plans.length; index++) {
            const plan = plans[index]!;
            if (plan.durability === "savePoint" && this.canMergeSavePoint(plan)) {
                const merge = this.collectSavePointPlans(plans, index);
                await this.measureWritePlan(options, async () => {
                    this.assertOpWriteAllowed(plan.target.sessionId, plan, authority);
                    const entries = await this.repo.appendEntries(plan.target.sessionId, merge.entries);
                    for (const entry of entries) {
                        written.push(entry);
                        this.publishSessionEntry(plan.target.sessionId, invocationId, entry);
                    }
                    await this.notifyEntriesWritten(plan.target.sessionId, plan.cause, invocationId, entries);
                    touchedSessionIds.add(plan.target.sessionId);
                });
                index = merge.endIndex;
                continue;
            }
            for (const op of plan.ops) {
                await this.measureWritePlan(options, async () => {
                    this.assertOpWriteAllowed(plan.target.sessionId, plan, authority);
                    const entries = await this.executeOp(plan.target.sessionId, op);
                    for (const entry of entries) {
                        written.push(entry);
                        this.publishSessionEntry(plan.target.sessionId, invocationId, entry);
                    }
                    await this.notifyEntriesWritten(plan.target.sessionId, plan.cause, invocationId, entries);
                    touchedSessionIds.add(plan.target.sessionId);
                });
            }
        }

        const liveStates = new Map<SessionId, AgentSessionLiveStateDto>();
        for (const sessionId of touchedSessionIds) {
            liveStates.set(sessionId, await this.measureLiveState(options, sessionId, () => this.publishSessionState(sessionId, invocationId)));
        }

        return {entries: written, liveStates};
    }

    /** 在物理写入锁内按 authority 复核写入权：普通写看 active ownership，强制取消看窄化 tombstone。 */
    private assertOpWriteAllowed(sessionId: SessionId, plan: SessionWritePlan, authority: SessionWriteAuthority): void {
        if (authority.kind === "unowned") {
            return;
        }
        if (authority.kind === "invocation") {
            if (this.invocationWriteAllowed && !this.invocationWriteAllowed(sessionId, authority.invocationId)) {
                throw new Error(`invocation ${authority.invocationId} 已失去 session ${sessionId} 的写入权`);
            }
            return;
        }
        this.assertForcedAbortPlan(plan, authority.invocationId);
        if (!this.forcedAbortWriteAllowed?.(sessionId, authority.invocationId)) {
            throw new Error(`强制取消 ${authority.invocationId} 没有 session ${sessionId} 的终态写入授权`);
        }
    }

    private assertForcedAbortPlan(plan: SessionWritePlan, invocationId: string): void {
        const invalid = (): Error => new Error(`强制取消计划形状非法：期望唯一 ${invocationId} 的 aborted lifecycle`);
        if (plan.cause !== "lifecycle.aborted.force"
            || plan.ops.length !== 1
            || plan.ops[0]!.kind !== "append"
            || plan.ops[0]!.projection !== undefined
            || plan.ops[0]!.entry.type !== "invocation_lifecycle"
            || plan.ops[0]!.entry.status !== "aborted"
            || plan.ops[0]!.entry.invocationId !== invocationId) {
            throw invalid();
        }
    }

    private async withSessionWriteLocks<TResult>(sessionIds: SessionId[], task: () => Promise<TResult>): Promise<TResult> {
        const sessionId = sessionIds[0];
        if (sessionId === undefined) {
            return task();
        }
        return this.withSessionWriteLock(sessionId, () => this.withSessionWriteLocks(sessionIds.slice(1), task));
    }
    private async withSessionWriteLock<TResult>(sessionId: SessionId, task: () => Promise<TResult>): Promise<TResult> {
        const previous = this.writeQueues.get(sessionId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => current);
        this.writeQueues.set(sessionId, queued);

        await previous.catch(() => undefined);
        try {
            return await task();
        } finally {
            release();
            if (this.writeQueues.get(sessionId) === queued) {
                this.writeQueues.delete(sessionId);
            }
        }
    }

    private canMergeSavePoint(plan: SessionWritePlan): boolean {
        return plan.ops.every((op) => op.kind === "appendMany" || (op.kind === "append" && !op.projection));
    }

    private collectSavePointPlans(plans: SessionWritePlan[], startIndex: number): {entries: AppendManySessionEntryDraft[]; endIndex: number} {
        const first = plans[startIndex]!;
        const entries: AppendManySessionEntryDraft[] = [];
        let endIndex = startIndex;
        for (let index = startIndex; index < plans.length; index++) {
            const plan = plans[index]!;
            if (plan.durability !== "savePoint" || plan.target.sessionId !== first.target.sessionId || !this.canMergeSavePoint(plan)) {
                break;
            }
            for (const op of plan.ops) {
                if (op.kind === "appendMany") {
                    entries.push(...op.entries);
                    continue;
                }
                if (op.kind === "append") {
                    entries.push(op.entry as AppendManySessionEntryDraft);
                }
            }
            endIndex = index;
        }
        return {entries, endIndex};
    }

    private async executeOp(sessionId: SessionId, op: SessionWriteOp): Promise<SessionEntry[]> {
        if (op.kind === "appendMany") {
            return this.repo.appendEntries(sessionId, op.entries);
        }
        if (op.kind === "moveLeaf") {
            return [await this.repo.moveLeaf(sessionId, op.leafId)];
        }
        const entry = op.projection
            ? await this.repo.appendProjectionEntry(sessionId, op.entry, op.projection === true ? undefined : op.projection)
            : await this.repo.appendEntry(sessionId, op.entry);
        return [entry];
    }

    private assertValidPlan(plan: SessionWritePlan): void {
        if (!plan.target || typeof plan.target.sessionId !== "number" || !Number.isInteger(plan.target.sessionId) || plan.target.sessionId <= 0) {
            throw new Error("SessionWritePlan.target.sessionId 必须是正整数。");
        }
        if (!plan.cause.trim()) {
            throw new Error("SessionWritePlan.cause 不能为空。");
        }
        if (!Array.isArray(plan.ops)) {
            throw new Error("SessionWritePlan.ops 必须是数组。");
        }
    }

    private publishSessionEntry(sessionId: number, invocationId: string | undefined, entry: SessionEntry): void {
        const projected = projectAgentChatEntry(entry, {invocationId});
        if (!projected) {
            return;
        }
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "session",
            event: {
                type: "session_entry",
                entry: projected,
            },
        });
    }

    private async notifyEntriesWritten(sessionId: number, cause: string, invocationId: string | undefined, entries: SessionEntry[]): Promise<void> {
        if (!this.onEntriesWritten || entries.length === 0) {
            return;
        }
        try {
            await this.onEntriesWritten({
                sessionId,
                cause,
                ...(invocationId === undefined ? {} : {invocationId}),
                entries,
            });
        } catch (error) {
            void appLogger.warn("agent.sessionWrite.afterWriteObserverFailed", {
                sessionId,
                cause,
                invocationId: invocationId ?? null,
                entryCount: entries.length,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async publishSessionState(sessionId: number, invocationId?: string): Promise<AgentSessionLiveStateDto> {
        const state = await this.liveStateProvider(sessionId);
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "session",
            event: {
                type: "session_state_changed",
                state,
            },
        });
        return state;
    }

    private measureWritePlan<T>(options: SessionWriteExecutionOptions, task: () => Promise<T>): Promise<T> {
        return options.timing ? options.timing.measureWritePlan(task) : task();
    }

    private measureLiveState<T>(options: SessionWriteExecutionOptions, sessionId: SessionId, task: () => Promise<T>): Promise<T> {
        return options.timing ? options.timing.measureLiveState(sessionId, task) : task();
    }
}
