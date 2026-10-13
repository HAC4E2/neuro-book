import type {AuditStatus, AuditWriter} from "../core/audit.js";
import {newActionId, readAuditStatus} from "../core/audit.js";
import {NbdevError, type Warning} from "../core/errors.js";
import {PANEL_DEVELOPER} from "../core/identity.js";
import {computeNotifyJobs, newAttemptId, pointerMessage, readNotifyRecords, readTaskNotifyInput, writeNotifyRecord, type NotifyJob, type NotifyRecord, type NotifyResult} from "../core/notify.js";
import {HerdrError, type HerdrAgentInfo, type HerdrClient, type HerdrSnapshotPane} from "../herdr/client.js";
import {checkDeliverable, deliverText, PROMPT_WAIT_MS, sessionKeyOf, type CheckFailure, type DeliveryContext, type DeliveryOutcome, type DeliveryTarget} from "./delivery.js";
import type {PanelState} from "./state.js";

/**
 * 面板的通知循环（t11）：记录、活动或 herdr 状态变了（以及每 15 秒兜底）就现算待发的通知，对能投的发一行指针消息。
 * 判据见 docs/panel.md 的“通知”与 docs/herdr.md 的“投递”。
 * - 只在审计初始化之后开放；`init.json` 的时刻也是启用时刻，早于它的答复只能手动发。
 * - 只对 herdr 0.9.1 与 0.9.3 自动投递：`ping` 不报 API 能力，herdr 又静默忽略不认识的参数，只能按版本放行。
 * - 同一格 pane 的所有发送（通知、会话页的文字与按键）经 `PaneLocks` 串行。
 */

export const AUTO_NOTIFY_VERSIONS: readonly string[] = ["0.9.1", "0.9.3"];
const FALLBACK_MS = 15_000;
const STABLE_MS = 3_000;
const RECENT_MS = 24 * 3600_000;

/**
 * 一条通知任务在界面上的状态：
 * `audit_unavailable` 审计没初始化；`legacy` 只有早于启用时刻的答复；`waiting_herdr` herdr 不可用；
 * `no_target` 提问者不在 herdr 里（结束了、外部会话）；`replaced` 提问者原来的 pane 上换了会话；`not_in_repository` pane 不在本仓库；
 * `manual_only` 这个 herdr 版本不自动投；`waiting_idle` 在工作；`waiting_blocked` 在等确认；`unknown_status` 状态未知；
 * `waiting_input` 空闲但输入框不是认得出的空（有半截字、菜单、认不出的界面）；`ready` 空闲，稳定 3 秒后投。
 */
export type NotifyJobState =
    | "audit_unavailable" | "legacy" | "waiting_herdr" | "no_target" | "replaced" | "not_in_repository" | "manual_only"
    | "waiting_idle" | "waiting_blocked" | "unknown_status" | "waiting_input" | "ready";
export type NotifyCandidate = {sessionKey: string; paneId: string; agent: string | null; status: string; asker: boolean};
export type NotifyJobView = NotifyJob & {
    state: NotifyJobState;
    paneId: string | null;
    agent: string | null;
    /** 会话已更换时 pane 上现在的会话。 */
    replacedBy: NotifyCandidate | null;
    /** 没有可通知的会话时可以手动选的：持有这个 Task 有效租约、在 herdr 里、pane 在本仓库的会话。 */
    alternatives: NotifyCandidate[];
    /** 最近一次判定不可投的原因与屏幕末尾（`waiting_input`）。 */
    waitReason: string | null;
    screen: string | null;
    /** 自动投递的整行文字（新答复）；手动发送连旧答复一起（`manualMessage`）。 */
    message: string;
    manualMessage: string;
};
export type NotifyAttempt = Omit<NotifyRecord, "schema"> & {intentOnly: boolean};

/** 一格 pane 一把锁：通知、文字、按键不会交错地打进同一个输入框。 */
export class PaneLocks {
    private readonly tails = new Map<string, Promise<unknown>>();

    run<T>(paneId: string, work: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(paneId) ?? Promise.resolve();
        const next = previous.then(work);
        // 队尾只用来排队：这次的失败照样经 `next` 交给调用方，不让它拖垮后面排着的发送。
        const tail = next.catch(() => undefined);
        this.tails.set(paneId, tail);
        void tail.then(() => {
            if (this.tails.get(paneId) === tail) this.tails.delete(paneId);
        });
        return next;
    }
}

export type NotifierOptions = {
    state: PanelState;
    client: HerdrClient | null;
    audit: AuditWriter;
    locks: PaneLocks;
    log: (message: string) => void;
    /** 任务列表或状态变了（界面经 `/ws` 重取）。 */
    onChange: () => void;
};

const keyOf = (pane: Pick<HerdrSnapshotPane, "session">) => (pane.session ? `${pane.session.agent}:${pane.session.value}` : null);

export class Notifier {
    jobs: NotifyJobView[] = [];
    audit: AuditStatus | null = null;
    private records: NotifyRecord[] = [];
    /** 第一次看到这格 pane 空闲时的状态序号与时刻（S2：防状态抖动）。 */
    private readonly stable = new Map<string, {seq: number | null; since: number}>();
    /**
     * 判定不可投的 pane：原因、屏幕末尾、时刻与当时的状态序号。之后只在状态序号变了（`agent.get`，不读屏）或过了 15 秒时才重读屏幕：
     * 工作与空闲之间的切换可能快过一次现算，只看监视器里的状态会漏掉。
     */
    private readonly waits = new Map<string, {reason: string; screen: string | null; at: number; seq: number | null}>();
    private running: Promise<void> | null = null;
    private again = false;
    private timer: ReturnType<typeof setInterval> | null = null;
    private stableTimer: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;
    private fingerprint = "";
    private readonly inFlight = new Set<Promise<unknown>>();

    constructor(private readonly options: NotifierOptions) {}

    start(): void {
        if (this.timer || this.stopped) return;
        this.timer = setInterval(() => void this.tick(), FALLBACK_MS);
        void this.tick();
    }

    /** 收口：不再开始新的投递，等进行中的结束（上限为等待时限加 2 秒，小于单元的 `TimeoutStopSec`）。 */
    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        if (this.stableTimer) clearTimeout(this.stableTimer);
        let limit: ReturnType<typeof setTimeout> | null = null;
        await Promise.race([
            Promise.all([...this.inFlight, this.running]),
            new Promise((done) => {
                limit = setTimeout(done, PROMPT_WAIT_MS + 2_000);
            }),
        ]);
        if (limit) clearTimeout(limit);
    }

    /** 还在排队、会自动发出的任务数（驱动 herdr 监视的兜底轮询）。 */
    pendingCount(): number {
        return this.jobs.filter((job) => ["waiting_herdr", "waiting_idle", "waiting_blocked", "unknown_status", "waiting_input", "ready"].includes(job.state)).length;
    }

    /** 最近 24 小时的尝试与选择，同一次尝试的意图与结果合成一条（只有意图的标 `intentOnly`：面板在投递途中退出）。 */
    recent(now = Date.now()): NotifyAttempt[] {
        const byAttempt = new Map<string, NotifyAttempt>();
        for (const {schema: _schema, ...record} of this.records) {
            if (now - Date.parse(record.at) > RECENT_MS) continue;
            const known = byAttempt.get(record.attemptId);
            if (record.result === "pending") {
                if (!known) byAttempt.set(record.attemptId, {...record, intentOnly: true});
            } else byAttempt.set(record.attemptId, {...record, intentOnly: false});
        }
        return [...byAttempt.values()].sort((left, right) => right.at.localeCompare(left.at));
    }

    /** 现算并投递（单飞：进行中又被要求就在结束后再来一次）。 */
    tick(): Promise<void> {
        if (this.stopped) return Promise.resolve();
        if (this.running) {
            this.again = true;
            return this.running;
        }
        this.running = this.once().catch((error: unknown) => {
            this.options.log(`通知循环出错：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }).finally(() => {
            this.running = null;
            if (this.again && !this.stopped) {
                this.again = false;
                void this.tick();
            }
        });
        return this.running;
    }

    private deliveryContext(): DeliveryContext | null {
        if (!this.options.client) return null;
        return {client: this.options.client, repoRoots: this.options.state.checkouts.filter((checkout) => !checkout.prunable).map((checkout) => checkout.root)};
    }

    private async once(): Promise<void> {
        await this.compute();
        const context = this.deliveryContext();
        if (!context || !this.audit?.enabled) return;
        for (const job of this.jobs) {
            if (this.stopped) return;
            if (job.paneId === null) continue;
            if (job.state === "waiting_input" && !await this.screenMayHaveChanged(context, job.paneId)) continue;
            if (job.state !== "ready" && job.state !== "waiting_input") continue;
            await this.tryAuto(context, job);
        }
    }

    private async screenMayHaveChanged(context: DeliveryContext, paneId: string): Promise<boolean> {
        const wait = this.waits.get(paneId);
        if (!wait || Date.now() - wait.at >= FALLBACK_MS) return true;
        try {
            const info = await context.client.agentGet(paneId);
            return info !== null && info.stateChangeSeq !== wait.seq;
        } catch (error) {
            if (!(error instanceof HerdrError)) throw error;
            this.options.log(`读 ${paneId} 的状态序号失败（${error.code}），这次不重读屏幕`);
            return false;
        }
    }

    /** 重读答复、尝试记录与审计状态，按 herdr 的当前状态给每条任务定状态。 */
    async compute(): Promise<void> {
        const {state} = this.options;
        const warnings: Warning[] = [];
        this.audit = await readAuditStatus(this.options.audit.paths);
        const tasks = [];
        for (const work of state.records.part.value?.records.works ?? []) {
            for (const task of work.tasks) {
                // 只看主工作区里的 Task（答复只入 master）；全部确认过的也要看：别的会话的确认不算提问者办完（I2）。
                if (task.source !== "master" || !task.artifacts.some((artifact) => artifact.adoption !== null && artifact.adoption !== "none")) continue;
                tasks.push(await readTaskNotifyInput(state.context.mainRoot, work.workId, task.taskId, warnings));
            }
        }
        this.records = await readNotifyRecords(state.context.mainRoot, warnings);
        for (const warning of warnings) if (warning.code === "unreadable_notify_record") this.options.log(warning.message);
        // 审计没初始化时没有启用时刻：全部当作旧答复，状态显示为 `audit_unavailable`。
        const enabledAt = this.audit.enabled ? this.audit.initAt : "9999-12-31T23:59:59.999Z";
        const herdr = state.herdr.current();
        for (const pane of herdr.panes) {
            if (pane.status !== "idle" && pane.status !== "done") {
                this.waits.delete(pane.paneId);
                this.stable.delete(pane.paneId);
            }
        }
        this.jobs = computeNotifyJobs({tasks, records: this.records, enabledAt}).map((job) => this.view(job));
        state.herdr.setPending(this.pendingCount() > 0);
        const print = JSON.stringify([this.audit.enabled, this.jobs.map((job) => [job.workId, job.taskId, job.sessionKey, job.state, job.answers, job.legacy.length, job.paneId, job.replacedBy?.sessionKey ?? null, job.alternatives.map((entry) => entry.sessionKey), job.waitReason]), this.records.length]);
        if (print !== this.fingerprint) {
            this.fingerprint = print;
            this.options.onChange();
        }
    }

    private view(job: NotifyJob): NotifyJobView {
        const {state} = this.options;
        const herdr = state.herdr.current();
        const roots = state.checkouts.filter((checkout) => !checkout.prunable).map((checkout) => checkout.root);
        const inRepo = (pane: HerdrSnapshotPane) => [pane.cwd, pane.foregroundCwd].some((path) => path !== null && roots.some((root) => path === root || path.startsWith(`${root}/`)));
        const candidate = (pane: HerdrSnapshotPane): NotifyCandidate => ({sessionKey: keyOf(pane)!, paneId: pane.paneId, agent: pane.agent, status: pane.status, asker: keyOf(pane) === job.sessionKey});
        // 按会话键找提问者，与租约是否有效无关（I4）。
        const pane = herdr.panes.find((entry) => keyOf(entry) === job.sessionKey) ?? null;
        const askerPane = !pane && job.askerPaneId ? herdr.panes.find((entry) => entry.paneId === job.askerPaneId) ?? null : null;
        const replacedBy = askerPane && askerPane.agent !== null && keyOf(askerPane) !== null && inRepo(askerPane) ? candidate(askerPane) : null;
        const leaseHolders = new Set((state.activity.part.value?.activity.leases ?? []).filter((lease) => lease.state === "valid" && lease.workId === job.workId && lease.taskId === job.taskId).map((lease) => lease.session.key));
        const alternatives = herdr.panes.filter((entry) => {
            const key = keyOf(entry);
            return key !== null && key !== job.sessionKey && entry.agent !== null && inRepo(entry) && leaseHolders.has(key);
        }).map(candidate);
        const wait = pane ? this.waits.get(pane.paneId) ?? null : null;
        let jobState: NotifyJobState;
        if (!this.audit?.enabled) jobState = "audit_unavailable";
        else if (job.answers.length === 0) jobState = "legacy";
        else if (!herdr.available) jobState = "waiting_herdr";
        else if (!pane) jobState = replacedBy ? "replaced" : "no_target";
        else if (!inRepo(pane)) jobState = "not_in_repository";
        else if (!herdr.version || !AUTO_NOTIFY_VERSIONS.includes(herdr.version)) jobState = "manual_only";
        else if (pane.status === "working") jobState = "waiting_idle";
        else if (pane.status === "blocked") jobState = "waiting_blocked";
        else if (pane.status !== "idle" && pane.status !== "done") jobState = "unknown_status";
        else jobState = wait ? "waiting_input" : "ready";
        return {
            ...job,
            state: jobState,
            paneId: pane?.paneId ?? null,
            agent: pane?.agent ?? null,
            replacedBy,
            alternatives,
            waitReason: wait?.reason ?? null,
            screen: wait?.screen ?? null,
            message: pointerMessage(job),
            manualMessage: pointerMessage({...job, ...job.withLegacy}),
        };
    }

    private track<T>(work: Promise<T>): Promise<T> {
        this.inFlight.add(work);
        // 只为收口时等它：失败照样经 `work` 交给调用方。
        void work.catch(() => undefined).finally(() => this.inFlight.delete(work));
        return work;
    }

    private wakeAfterStable(): void {
        if (this.stableTimer || this.stopped) return;
        this.stableTimer = setTimeout(() => {
            this.stableTimer = null;
            void this.tick();
        }, STABLE_MS + 100);
    }

    /** 自动投递：先记下空闲时的状态序号与时刻，稳定 3 秒、判定可投之后才发。 */
    private async tryAuto(context: DeliveryContext, job: NotifyJobView): Promise<void> {
        const paneId = job.paneId!;
        const target = {paneId, sessionKey: job.sessionKey};
        await this.track(this.options.locks.run(paneId, async () => {
            if (this.stopped) return;
            const seen = this.stable.get(paneId);
            if (!seen) {
                let info: HerdrAgentInfo | null;
                try {
                    info = await context.client.agentGet(paneId);
                } catch (error) {
                    if (!(error instanceof HerdrError)) throw error;
                    this.options.log(`通知 ${job.workId}/${job.taskId}：读 ${paneId} 的状态失败（${error.code}），下次再试`);
                    return;
                }
                if (info) this.stable.set(paneId, {seq: info.stateChangeSeq, since: Date.now()});
                this.wakeAfterStable();
                return;
            }
            const checked = await checkDeliverable(context, target, {stable: seen, stableMs: STABLE_MS});
            if (!checked.ok) {
                if (checked.code === "not_stable") {
                    this.stable.delete(paneId);
                    this.wakeAfterStable();
                } else if (checked.code === "not_deliverable") this.waits.set(paneId, {reason: checked.detail, screen: checked.screen, at: Date.now(), seq: checked.agent?.stateChangeSeq ?? null});
                else this.options.log(`通知 ${job.workId}/${job.taskId} → ${job.sessionKey} 这次不投：${checked.detail}`);
                return;
            }
            this.waits.delete(paneId);
            await this.send(context, job, target, checked.agent, false);
        }));
        await this.compute();
    }

    /** 写意图（审计与尝试记录），投递，再写结果。意图写不进去就不投（fail closed）。 */
    private async send(context: DeliveryContext, job: NotifyJob, target: DeliveryTarget, before: HerdrAgentInfo, manual: boolean): Promise<DeliveryOutcome> {
        const {mainRoot} = this.options.state.context;
        const answers = (manual ? [...job.answers, ...job.legacy] : job.answers).map((entry) => entry.answerId);
        const text = pointerMessage(manual ? {...job, ...job.withLegacy} : job);
        const attemptId = newAttemptId();
        const actionId = newActionId();
        const base = {attemptId, workId: job.workId, taskId: job.taskId, sessionKey: target.sessionKey, askerKey: job.sessionKey, paneId: target.paneId, answers, manual};
        const auditTarget = {paneId: target.paneId, sessionKey: target.sessionKey, workId: job.workId, taskId: job.taskId};
        await this.options.audit.append({actionId, phase: "intent", action: "notify", device: PANEL_DEVELOPER.device, target: auditTarget, detail: {text, answers, manual, askerKey: job.sessionKey}});
        await writeNotifyRecord(mainRoot, {...base, at: new Date().toISOString(), result: "pending", code: null, message: null});
        const outcome = await deliverText(context, target, text, before);
        await writeNotifyRecord(mainRoot, {...base, at: new Date().toISOString(), result: outcome.result, code: outcome.code, message: outcome.message});
        await this.auditResult(actionId, "notify", auditTarget, {result: outcome.result, code: outcome.code});
        this.options.log(`通知 ${job.workId}/${job.taskId} → ${target.sessionKey}（${target.paneId}）：${outcome.result}${outcome.code ? `（${outcome.code}）` : ""}`);
        return outcome;
    }

    /** 结果行：意图已经记下、动作已经做了，写不进去只记日志（不能让开发者以为没发）。 */
    async auditResult(actionId: string, action: "notify" | "prompt" | "keys", target: Record<string, unknown>, detail: Record<string, unknown>): Promise<void> {
        try {
            await this.options.audit.append({actionId, phase: "result", action, device: PANEL_DEVELOPER.device, target, detail});
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            this.options.log(`写审计结果失败（${action}，${actionId}）：${error.message}`);
        }
    }

    private findJob(workId: string, taskId: string, sessionKey: string): NotifyJobView {
        const job = this.jobs.find((entry) => entry.workId === workId && entry.taskId === taskId && entry.sessionKey === sessionKey);
        if (!job) throw new NbdevError("question_not_found", `没有待发的通知：${workId}/${taskId} → ${sessionKey}`, {details: {workId, taskId, sessionKey}});
        return job;
    }

    /**
     * 手动发送：会话已更换后发给新会话、没有可通知的会话时选一个、旧答复或这个 herdr 版本不自动投时发给提问者。
     * 过同样的判据（身份、仓库、空闲、紧贴投递的复核）；正向白名单不过时先回 409 `not_deliverable` 带屏幕末尾，
     * 开发者看过之后带 `confirmScreen` 再发。目标只能是这条任务列出的会话。
     */
    async sendManual(input: {workId: string; taskId: string; sessionKey: string; target: DeliveryTarget; confirmScreen: boolean}): Promise<DeliveryOutcome> {
        await this.compute();
        if (!this.audit?.enabled) throw auditUnavailable(this.audit);
        const context = this.deliveryContext();
        if (!context) throw new NbdevError("herdr_unavailable", "面板没有连 herdr");
        const job = this.findJob(input.workId, input.taskId, input.sessionKey);
        const candidates = [...(job.paneId ? [{paneId: job.paneId, sessionKey: job.sessionKey}] : []), ...(job.replacedBy ? [job.replacedBy] : []), ...job.alternatives];
        if (!candidates.some((entry) => entry.paneId === input.target.paneId && entry.sessionKey === input.target.sessionKey)) {
            throw new NbdevError("session_changed", `${input.target.paneId} 上的 ${input.target.sessionKey} 不是这条通知可以发的会话；刷新之后再选`, {details: {reason: "not_a_candidate"}});
        }
        const outcome = await this.track(this.options.locks.run(input.target.paneId, async () => {
            const checked = await checkDeliverable(context, input.target);
            if (checked.ok) return this.send(context, job, input.target, checked.agent, true);
            if (checked.code === "not_deliverable" && input.confirmScreen && checked.agent) return this.send(context, job, input.target, checked.agent, true);
            throw checkError(checked);
        }));
        await this.compute();
        return outcome;
    }

    /** 开发者选了“不通知”：记 `skipped`，这些答复（连旧答复）对这个提问者算办完。 */
    async skip(input: {workId: string; taskId: string; sessionKey: string}): Promise<void> {
        await this.compute();
        const job = this.findJob(input.workId, input.taskId, input.sessionKey);
        await writeNotifyRecord(this.options.state.context.mainRoot, {
            attemptId: newAttemptId(), at: new Date().toISOString(), workId: job.workId, taskId: job.taskId, sessionKey: job.sessionKey, askerKey: job.sessionKey,
            paneId: null, answers: [...job.answers, ...job.legacy].map((entry) => entry.answerId), result: "skipped" satisfies NotifyResult, code: null, message: null, manual: true,
        });
        await this.compute();
    }
}

export function auditUnavailable(status: AuditStatus | null): NbdevError {
    const detail = status && !status.enabled ? status.detail : "审计不可用";
    return new NbdevError("audit_unavailable", `${detail}；审计初始化之前不开放通知、文字与按键`, {details: {reason: status && !status.enabled ? status.reason : null}});
}

/** 判定失败转成接口的错误：屏幕末尾放进 details，界面据此显示并要求两步确认。 */
export function checkError(failure: CheckFailure): NbdevError {
    const codes = {
        not_found: "session_changed", session_changed: "session_changed", not_in_repository: "not_in_repository", agent_busy: "agent_busy",
        agent_blocked: "agent_busy", status_unknown: "agent_busy", not_stable: "agent_busy", not_deliverable: "not_deliverable", herdr_unavailable: "herdr_unavailable",
    } as const satisfies Record<CheckFailure["code"], string>;
    return new NbdevError(codes[failure.code], failure.detail, {details: {reason: failure.code, screen: failure.screen, status: failure.agent?.status ?? null, sessionKey: failure.agent ? sessionKeyOf(failure.agent) : null}});
}
