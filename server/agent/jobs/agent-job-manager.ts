import {existsSync} from "node:fs";
import {appendFile, mkdir, readFile} from "node:fs/promises";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";
import {appLogger} from "nbook/server/app-logs/logger";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";

export type AgentJobKind = "workflow" | "invoke_agent" | "bash";

export type AgentJobStatus = "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";

/** 对外快照（管理工具 / HTTP / 气泡消费的稳定形状） */
export type AgentJobSnapshot = {
    jobId: string;
    kind: AgentJobKind;
    /** 人话标题（任务列表与气泡展示） */
    title: string;
    /** 发起者 = 结果回流收件人；用户从 UI 直接触发时为 null */
    ownerSessionId: number | null;
    /** 发起工具调用 id（前端气泡锚定）；非工具发起为空 */
    originToolCallId?: string;
    status: AgentJobStatus;
    createdAt: number;
    endedAt?: number;
    /** kind 专属观测指针：workflow→{runId}；bash→{command}；invoke_agent→{sessionId} */
    ref: JsonValue;
    /** 有界进行中预览 / 结果摘要；完整结果走 kind 专属查询面 */
    preview?: string;
    error?: string;
};

/** 单个 Job 的完整详情。列表只返回快照，避免把大型结果重复传给所有消费者。 */
export type AgentJobDetail = AgentJobSnapshot & {
    /** completed 时保存执行器返回的完整结构化结果；其他状态或无结构化结果时为空。 */
    result?: JsonValue;
};

/** job 执行回调拿到的运行上下文 */
export type JobRunContext = {
    /** cancel_job 触发；invoke/workflow Agent activity 走 Harness 有界取消，bash 走 owned-process。 */
    signal: AbortSignal;
    /** 更新进行中预览（任务列表/气泡实时可见） */
    setPreview(text: string): void;
    /** 标记 job 进入等待人工应答状态（workflow ask 挂起用）；恢复运行时再 setRunning */
    setWaiting(text: string): void;
    setRunning(): void;
};

/** job 结束产物：resultPreview 进快照，message 作为回流 followup 的完整正文 */
export type JobOutcome = {
    resultPreview: string;
    /** get_job / 单 Job HTTP 详情返回的完整结构化结果，不做裁剪。 */
    result?: JsonValue;
    /** 回流 followup 的完整正文；缺省时由 Manager 用标题和 resultPreview 组装结果卡。 */
    message?: string;
};

/** Job 执行器主动报告取消终态，供底层 Run 被直接取消时保持状态一致。 */
export class AgentJobCancelledError extends Error {
    constructor(message = "后台任务已取消") {
        super(message);
        this.name = "AgentJobCancelledError";
    }
}

export type SpawnJobSpec = {
    kind: AgentJobKind;
    title: string;
    ownerSessionId?: number;
    originToolCallId?: string;
    ref?: JsonValue;
    run: (ctx: JobRunContext) => Promise<JobOutcome>;
    /** kind 专属取消传播钩子（bash=owned-process terminate；workflow=Run signal）。 */
    onCancel?: () => void | Promise<void>;
    /** 缺省：有 owner 则 followup 回流，无则 none */
    deliver?: "followup" | "none";
};

/** 登记表行（append-only 状态翻转；不存观测载荷） */
type RegistryLine = {
    at: number;
    jobId: string;
    kind: AgentJobKind;
    title: string;
    ownerSessionId: number | null;
    originToolCallId?: string;
    status: AgentJobStatus;
    error?: string;
};

type JobRecord = {
    snapshot: AgentJobSnapshot;
    /** 仅详情面消费；不进入 list() 投影与薄登记表。 */
    result?: JsonValue;
    controller: AbortController;
    promise: Promise<void>;
    spec: SpawnJobSpec;
};

/**
 * 统一后台任务管理器（Task 111 PLAN-E）。
 *
 * Job = 有身份、有状态机、有观测面、有回流策略的后台工作单元：
 * - 回流走 harness invokeAgent(mode:"prompt")：owner 空闲立即触发一轮、忙时自动进 followup 队列；
 *   回流只带 message 文本（结果卡），不带 payload——payload 会撞 owner profile 的 PayloadSchema 校验，
 *   完整数据让 agent 用 get_job / workflow runs API 查询；
 * - 崩溃恢复：jobs.jsonl 薄登记表（只记身份与状态翻转），启动扫描把 running/waiting 标 interrupted
 *   并给 owner 补发中断通知——「重启丢回流」从静默变显式；
 * - 观测：一期 HTTP 轮询（/api/agent/jobs），SSE 面记 TODO。
 */
export class AgentJobManager {
    private readonly jobs = new Map<string, JobRecord>();
    /** jobs.jsonl 必须保持状态翻转顺序，避免迟到的 running 行覆盖 terminal 行。 */
    private persistQueue: Promise<void> = Promise.resolve();
    /** clearFinished 移除的条目若回流投递仍在途，其 promise 挂在此链上，waitIdle 仍会等它。 */
    private removedSettle: Promise<void> = Promise.resolve();
    /** 结果回流属于 Job 的收尾边界；停服时必须能取消在途的 owner invocation。 */
    private readonly deliveryController = new AbortController();
    /** shutdown 开始后不再启动新的结果回流 invocation。 */
    private shuttingDown = false;

    constructor(
        /** 延迟取 harness：Manager 在 harness 构造期创建，回流时才解引用 */
        private readonly harness: () => NeuroAgentHarness,
        /** 登记表路径（<workspaceRoot>/.nbook/agent/jobs.jsonl）；空字符串 = 关闭持久化（隔离测试用） */
        private readonly registryPath: string,
    ) {}

    /** 启动一个后台 job：登记 + 落盘 + 后台执行 + settle 回流 */
    spawn(spec: SpawnJobSpec): AgentJobSnapshot {
        const snapshot: AgentJobSnapshot = {
            jobId: `job_${randomUUID().slice(0, 8)}`,
            kind: spec.kind,
            title: spec.title,
            ownerSessionId: spec.ownerSessionId ?? null,
            originToolCallId: spec.originToolCallId,
            status: "running",
            createdAt: Date.now(),
            ref: spec.ref ?? null,
        };
        const controller = new AbortController();
        const record: JobRecord = {snapshot, controller, spec, promise: Promise.resolve()};
        this.jobs.set(snapshot.jobId, record);
        void this.persist(snapshot);
        record.promise = this.execute(record);
        return {...snapshot};
    }

    list(filter?: {ownerSessionId?: number; status?: AgentJobStatus}): AgentJobSnapshot[] {
        return [...this.jobs.values()]
            .map((record) => ({...record.snapshot}))
            .filter((job) => (filter?.ownerSessionId === undefined || job.ownerSessionId === filter.ownerSessionId)
                && (filter?.status === undefined || job.status === filter.status))
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    get(jobId: string): AgentJobDetail | null {
        const record = this.jobs.get(jobId);
        return record ? {...record.snapshot, ...(record.result === undefined ? {} : {result: record.result})} : null;
    }

    /** 请求取消：置 abort 信号 + 调用 kind 专属钩子；实际状态翻转由执行路径收尾时落 */
    async cancel(jobId: string): Promise<AgentJobSnapshot> {
        const record = this.jobs.get(jobId);
        if (!record) throw new Error(`job ${jobId} 不存在`);
        if (record.snapshot.status !== "running" && record.snapshot.status !== "waiting") {
            return {...record.snapshot};
        }
        record.controller.abort();
        try {
            await record.spec.onCancel?.();
        } catch (error) {
            void appLogger.warn("agent.jobs.cancelHookFailed", {jobId, error: error instanceof Error ? error.message : String(error)});
        }
        return {...record.snapshot};
    }

    /** harness.close 统一等待：所有 job 落定（含回流完成） */
    async waitIdle(): Promise<void> {
        const waited = new Set<Promise<void>>();
        while (true) {
            const pending = [...this.jobs.values()]
                .map((record) => record.promise)
                .filter((promise) => !waited.has(promise));
            if (pending.length === 0) break;
            for (const promise of pending) waited.add(promise);
            await Promise.allSettled(pending);
        }
        await this.removedSettle;
    }

    /**
     * 清除内存中的已结束任务（任务中心「清除已结束」按钮）；返回清除数量。
     * 仅内存回收——jobs.jsonl 登记表是 append-only 审计面，不受影响。
     */
    clearFinished(): number {
        let removed = 0;
        for (const [jobId, record] of this.jobs) {
            const status = record.snapshot.status;
            if (status === "running" || status === "waiting") continue;
            this.jobs.delete(jobId);
            // 终态翻转发生在回流投递之前：被清条目可能仍有在途 followup，保住 waitIdle 合同
            this.removedSettle = Promise.allSettled([this.removedSettle, record.promise]).then(() => {});
            removed++;
        }
        return removed;
    }

    /** 取消所有仍活跃的 Job；Harness dispose 用它解除 waiting Job。 */
    async cancelActive(): Promise<void> {
        const active = [...this.jobs.values()]
            .filter((record) => record.snapshot.status === "running" || record.snapshot.status === "waiting")
            .map((record) => record.snapshot.jobId);
        await Promise.all(active.map((jobId) => this.cancel(jobId)));
    }

    /** 停服收口：先取消活跃任务，再等待执行、结果投递和登记表写入全部完成。 */
    async shutdown(): Promise<void> {
        this.shuttingDown = true;
        this.deliveryController.abort(new Error("agent job manager shutdown"));
        await this.cancelActive();
        await this.waitIdle();
        await this.persistQueue;
    }

    /**
     * 启动恢复：把上次进程留下的 running/waiting job 标 interrupted，并给 owner 补发中断通知。
     * 由 harness 构造尾部 fire-and-forget 调用（与 profile bootSweep 同模式）。
     */
    async recoverInterrupted(): Promise<void> {
        if (!this.registryPath || !existsSync(this.registryPath)) return;
        await this.persistQueue;
        const lines = (await readFile(this.registryPath, "utf8")).split("\n").filter(Boolean);
        const last = new Map<string, RegistryLine>();
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line) as RegistryLine;
                last.set(parsed.jobId, parsed);
            } catch {
                // 损坏行跳过：登记表是尽力而为的恢复面，不是 truth
            }
        }
        for (const entry of last.values()) {
            if (entry.status !== "running" && entry.status !== "waiting") continue;
            const interrupted: RegistryLine = {...entry, at: Date.now(), status: "interrupted", error: "进程重启，后台任务丢失"};
            await this.persistLine(interrupted);
            if (entry.ownerSessionId !== null) {
                await this.sendFollowup(entry.ownerSessionId, [
                    `[后台任务中断] ${entry.title}（${entry.jobId}）`,
                    "服务重启导致该后台任务丢失，未能产出结果。如仍需要请重新发起。",
                ].join("\n"));
            }
        }
    }

    private async execute(record: JobRecord): Promise<void> {
        const {snapshot, spec, controller} = record;
        const ctx: JobRunContext = {
            signal: controller.signal,
            setPreview: (text) => {
                snapshot.preview = clip(text, 400);
            },
            setWaiting: (text) => {
                snapshot.status = "waiting";
                snapshot.preview = clip(text, 400);
                void this.persist(snapshot);
            },
            setRunning: () => {
                snapshot.status = "running";
                void this.persist(snapshot);
            },
        };
        let outcome: JobOutcome | null = null;
        let failure: string | null = null;
        try {
            outcome = await spec.run(ctx);
        } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
            if (error instanceof AgentJobCancelledError) {
                controller.abort();
            }
        }
        snapshot.endedAt = Date.now();
        if (controller.signal.aborted) {
            snapshot.status = "cancelled";
            snapshot.error = failure ?? undefined;
        } else if (failure !== null) {
            snapshot.status = "failed";
            snapshot.error = failure;
        } else {
            snapshot.status = "completed";
            snapshot.preview = clip(outcome!.resultPreview, 400);
            record.result = outcome!.result;
        }
        await this.persist(snapshot);
        await this.deliverResult(record, outcome, failure);
    }

    /** settle 回流：完成/失败/取消都告知 owner（agent 读到结果卡后向用户汇报或继续编排） */
    private async deliverResult(record: JobRecord, outcome: JobOutcome | null, failure: string | null): Promise<void> {
        const {snapshot, spec} = record;
        const deliver = spec.deliver ?? (snapshot.ownerSessionId !== null ? "followup" : "none");
        if (deliver === "none" || snapshot.ownerSessionId === null || this.shuttingDown) return;
        const header = snapshot.status === "completed"
            ? `[后台任务完成] ${snapshot.title}（${snapshot.jobId}）`
            : snapshot.status === "cancelled"
                ? `[后台任务已取消] ${snapshot.title}（${snapshot.jobId}）`
                : `[后台任务失败] ${snapshot.title}（${snapshot.jobId}）：${failure ?? "未知错误"}`;
        const content = snapshot.status === "completed" && outcome?.message
            ? outcome.message
            : [header, snapshot.status === "completed" ? outcome?.resultPreview ?? "" : ""].filter(Boolean).join("\n");
        try {
            await this.sendFollowup(snapshot.ownerSessionId, [
                "<system-reminder>",
                content,
                "</system-reminder>",
            ].join("\n"));
        } catch (error) {
            void appLogger.error("agent.jobs.deliverFailed", {
                jobId: snapshot.jobId,
                ownerSessionId: snapshot.ownerSessionId,
            }, error, "后台任务结果回流失败");
        }
    }

    /** mode:"prompt" 兼顾两态：owner 空闲立即触发一轮，忙时 harness 自动进 followup 队列。 */
    private async sendFollowup(sessionId: number, text: string): Promise<void> {
        if (this.deliveryController.signal.aborted) return;
        await this.harness().invokeAgent({
            sessionId,
            mode: "prompt",
            message: {text},
            caller: {kind: "system"},
            signal: this.deliveryController.signal,
        });
    }

    private async persist(snapshot: AgentJobSnapshot): Promise<void> {
        await this.persistLine({
            at: Date.now(),
            jobId: snapshot.jobId,
            kind: snapshot.kind,
            title: snapshot.title,
            ownerSessionId: snapshot.ownerSessionId,
            originToolCallId: snapshot.originToolCallId,
            status: snapshot.status,
            error: snapshot.error,
        });
    }

    private async persistLine(line: RegistryLine): Promise<void> {
        if (!this.registryPath) return;
        this.persistQueue = this.persistQueue.then(async () => {
            await this.appendRegistryLine(line);
        });
        await this.persistQueue;
    }

    /** 单次物理 append；调用方必须经过 persistQueue 串行化。 */
    private async appendRegistryLine(line: RegistryLine): Promise<void> {
        try {
            await mkdir(dirname(this.registryPath), {recursive: true});
            await appendFile(this.registryPath, `${JSON.stringify(line)}\n`, "utf8");
        } catch (error) {
            void appLogger.warn("agent.jobs.persistFailed", {jobId: line.jobId, error: error instanceof Error ? error.message : String(error)});
        }
    }
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
