import {HerdrError, type HerdrClient, type HerdrEvent, type HerdrSnapshotPane, type HerdrSubscription} from "../herdr/client.js";

/**
 * 面板常驻的 herdr 状态：快照加订阅，会话页与活动共用这一份（不再各自调 pane.list，两份会对不上）。
 * - 协议 22 没有 `events_lost`：订阅连接断开就当作可能漏了事件，退避重连后用快照对账；另外每 30 秒对账一次，
 *   对账时各 Agent 的 `state_change_seq` 与记下的不同，就是漏了状态事件（计进 `missedEvents`）。
 * - 重试只有一条链：已经排着一次重试时不再排第二次，30 秒的对账在重试期间跳过；退避计数只在订阅稳定保持 10 秒后清零，
 *   快照成功不清零（否则“连上就断”的订阅会一直以 500 毫秒重连）。
 * - 状态事件为主（0.9.3 上约 0.2 秒推送，见 docs/herdr.md）；有浏览器连着时另外每 500 毫秒轮询一次 `pane.list`，
 *   没有浏览器、只有待发的通知时放慢到 15 秒（兜底，herdr 日志一天多约 2 MB）。会话 id 变了 herdr 不推事件，靠轮询与对账发现。
 * - `pane.agent_status_changed` 只能逐格订阅：pane 增减时开一条新的订阅连接，等它回 `subscription_started` 再关旧的，然后对账。
 * - 投递窗口要知道这一格中途有没有经过 `blocked`（`watchStatus`）：herdr 的 `state_change_seq` 是全服务器共用的一个计数，
 *   数不出一格变了几次，只能看这一格的状态事件。
 */

export type HerdrMode = "starting" | "subscribed" | "polling" | "unavailable" | "disabled";
export type HerdrState = {
    available: boolean;
    mode: HerdrMode;
    version: string | null;
    socketPath: string | null;
    panes: HerdrSnapshotPane[];
    at: string | null;
    error: string | null;
    missedEvents: number;
    reconnects: number;
    /** 累计的失败次数（快照失败与订阅断开），用来看退避是否在起作用。 */
    retries: number;
};

/**
 * 看一格 pane 一段时间里的状态事件（投递窗口用）。`statuses()` 是收到的状态，按到达顺序；`intact()` 为假表示这段时间里订阅断过、
 * 或换了一条不再订这格的连接，`statuses()` 可能不全。用完 `close()`。
 */
export type StatusWatch = {statuses(): readonly HerdrSnapshotPane["status"][]; intact(): boolean; close(): void};
type Watch = {paneId: string; statuses: HerdrSnapshotPane["status"][]; intact: boolean};

export type HerdrMonitorTimings = {reconcileMs: number; pollMs: number; pendingPollMs: number; backoffInitialMs: number; backoffMaxMs: number; stableMs: number};
export const DEFAULT_HERDR_TIMINGS: HerdrMonitorTimings = {reconcileMs: 30_000, pollMs: 500, pendingPollMs: 15_000, backoffInitialMs: 500, backoffMaxMs: 30_000, stableMs: 10_000};

const GLOBAL_EVENTS = ["pane.created", "pane.closed", "pane.updated", "pane.moved", "pane.exited", "pane.agent_detected", "workspace.created", "workspace.closed", "workspace.renamed"];
/** 退避：初值 500 毫秒、每次乘 2、上限 30 秒，再加 0 到 20% 的抖动（多个面板或重启后不同时重连）。 */
export function backoffDelay(attempt: number, random: () => number = Math.random, timings: Pick<HerdrMonitorTimings, "backoffInitialMs" | "backoffMaxMs"> = DEFAULT_HERDR_TIMINGS): number {
    const base = Math.min(timings.backoffMaxMs, timings.backoffInitialMs * 2 ** attempt);
    return Math.round(base * (1 + 0.2 * random()));
}

/** 会话页显示用到的字段；订阅与轮询之间的切换不在里面（重连时会来回切，单独推送只会让页面空转）。 */
function fingerprint(state: HerdrState): string {
    return JSON.stringify([state.available, state.panes.map((pane) => [pane.paneId, pane.status, pane.agent, pane.session?.value ?? null, pane.cwd, pane.foregroundCwd, pane.workspaceLabel])]);
}

export class HerdrMonitor {
    private state: HerdrState;
    private subscription: HerdrSubscription | null = null;
    private subscribedPanes = "";
    private readonly watches = new Set<Watch>();
    private attempts = 0;
    private seq = new Map<string, number>();
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private stableTimer: ReturnType<typeof setTimeout> | null = null;
    private reconcileTimer: ReturnType<typeof setInterval> | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private pollEvery: number | null = null;
    private active = false;
    private pending = false;
    private refreshing: Promise<void> | null = null;
    private refreshAgain = false;
    private stopped = false;

    constructor(private readonly client: HerdrClient | null, private readonly onChange: () => void, private readonly log: (message: string) => void, private readonly timings: HerdrMonitorTimings = DEFAULT_HERDR_TIMINGS) {
        this.state = {available: false, mode: client ? "starting" : "disabled", version: null, socketPath: client?.socketPath ?? null, panes: [], at: null, error: null, missedEvents: 0, reconnects: 0, retries: 0};
    }

    current(): HerdrState {
        return this.state;
    }

    /** 当前的订阅连接订着这格的状态事件才给；否则为 null（还没连上、断线重连中、pane 刚出现还没换连接）。 */
    watchStatus(paneId: string): StatusWatch | null {
        if (!this.subscription || !this.subscribedPanes.split(",").includes(paneId)) return null;
        const watch: Watch = {paneId, statuses: [], intact: true};
        this.watches.add(watch);
        return {statuses: () => watch.statuses, intact: () => watch.intact, close: () => this.watches.delete(watch)};
    }

    /** 不阻塞：服务先开始监听，herdr 的状态随后补上。 */
    start(): void {
        if (!this.client || this.stopped || this.reconcileTimer) return;
        void this.refresh();
        this.reconcileTimer = setInterval(() => {
            // 重试期间（herdr 不在、订阅断了）交给退避链，对账不另起一条。
            if (this.retryTimer === null && this.state.available) void this.refresh();
        }, this.timings.reconcileMs);
    }

    /** 有浏览器连着时开 500 毫秒的轮询。 */
    setActive(active: boolean): void {
        this.active = active;
        this.applyPolling();
    }

    /** 有待发的通知时（没有浏览器也）开 15 秒的兜底轮询。 */
    setPending(pending: boolean): void {
        this.pending = pending;
        this.applyPolling();
    }

    private applyPolling(): void {
        if (!this.client || this.stopped) return;
        const every = this.active ? this.timings.pollMs : this.pending ? this.timings.pendingPollMs : null;
        if (every === this.pollEvery) return;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = every === null ? null : setInterval(() => void this.poll(), every);
        this.pollEvery = every;
    }

    stop(): void {
        this.stopped = true;
        if (this.reconcileTimer) clearInterval(this.reconcileTimer);
        if (this.pollTimer) clearInterval(this.pollTimer);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        if (this.stableTimer) clearTimeout(this.stableTimer);
        this.subscription?.close();
        this.subscription = null;
        for (const watch of this.watches) watch.intact = false;
    }

    /** 排一次退避重试；已经排着一次就不再排（只有一条重试链）。 */
    private scheduleRetry(reason: string): void {
        this.state = {...this.state, retries: this.state.retries + 1};
        if (this.retryTimer !== null || this.stopped) return;
        const delay = backoffDelay(this.attempts++, Math.random, this.timings);
        this.log(`${reason}，${delay} 毫秒后重试`);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (!this.stopped) void this.refresh();
        }, delay);
    }

    private update(patch: Partial<HerdrState>): void {
        const before = fingerprint(this.state);
        this.state = {...this.state, ...patch, at: new Date().toISOString()};
        if (fingerprint(this.state) !== before) this.onChange();
    }

    /** 快照对账（单飞：进行中又要对账，就在这一轮结束后再来一次）。 */
    refresh(): Promise<void> {
        if (this.refreshing) {
            this.refreshAgain = true;
            return this.refreshing;
        }
        this.refreshing = this.doRefresh().finally(() => {
            this.refreshing = null;
            if (this.refreshAgain && !this.stopped) {
                this.refreshAgain = false;
                void this.refresh();
            }
        });
        return this.refreshing;
    }

    private async doRefresh(): Promise<void> {
        if (!this.client || this.stopped) return;
        try {
            const snapshot = await this.client.snapshot();
            // 序号变了、而我们手上的状态还不是快照里的：中间的状态事件漏了（断线、换订阅连接，或 herdr 根本没推）。
            const shown = new Map(this.state.panes.map((pane) => [pane.paneId, pane.status]));
            let missed = 0;
            for (const pane of snapshot.panes) {
                if (pane.stateChangeSeq === null) continue;
                const known = this.seq.get(pane.paneId);
                if (known !== undefined && known !== pane.stateChangeSeq && shown.get(pane.paneId) !== pane.status) missed += 1;
                this.seq.set(pane.paneId, pane.stateChangeSeq);
            }
            this.update({available: true, version: snapshot.version, panes: snapshot.panes, error: null, missedEvents: this.state.missedEvents + missed, mode: this.subscription ? "subscribed" : "polling"});
            this.ensureSubscription();
        } catch (error) {
            if (!(error instanceof HerdrError)) throw error;
            this.update({available: false, mode: "unavailable", panes: [], error: `${error.code}：${error.message}`});
            this.scheduleRetry(`herdr 不可用（${error.code}）`);
        }
    }

    /** pane 集合变了就换一条订阅连接：新的回 `subscription_started` 之后才关旧的，再对账一次补上换线期间的变化。 */
    private ensureSubscription(): void {
        if (!this.client || this.stopped) return;
        const agentPanes = this.state.panes.filter((pane) => pane.agent !== null).map((pane) => pane.paneId).sort();
        const key = agentPanes.join(",");
        if (this.subscription && key === this.subscribedPanes) return;
        const subscriptions = [...GLOBAL_EVENTS.map((type) => ({type})), ...agentPanes.map((paneId) => ({type: "pane.agent_status_changed", pane_id: paneId}))];
        const next = this.client.subscribe(subscriptions, (event) => this.onEvent(event), (line) => this.log(`herdr 订阅里有一行读不懂，已跳过：${line.slice(0, 200)}`));
        next.ready.then(() => {
            if (this.stopped) {
                next.close();
                return;
            }
            const previous = this.subscription;
            this.subscription = next;
            this.subscribedPanes = key;
            for (const watch of this.watches) if (!agentPanes.includes(watch.paneId)) watch.intact = false;
            previous?.close();
            this.update({mode: "subscribed"});
            // 订阅稳定保持一段时间才把退避清零。
            if (this.stableTimer) clearTimeout(this.stableTimer);
            this.stableTimer = setTimeout(() => {
                this.stableTimer = null;
                if (this.subscription === next) this.attempts = 0;
            }, this.timings.stableMs);
            void this.refresh();
        }, (error: unknown) => {
            this.log(`herdr 订阅没有开始：${error instanceof Error ? error.message : String(error)}`);
            this.update({mode: this.state.available ? "polling" : "unavailable"});
        });
        void next.closed.then(({reason}) => {
            if (this.stopped || this.subscription !== next) return;
            this.subscription = null;
            this.subscribedPanes = "";
            for (const watch of this.watches) watch.intact = false;
            if (this.stableTimer) clearTimeout(this.stableTimer);
            this.stableTimer = null;
            this.update({mode: "polling", reconnects: this.state.reconnects + 1});
            this.scheduleRetry(`herdr 订阅断开（${reason}），重连并对账`);
        });
    }

    private onEvent(event: HerdrEvent): void {
        if (event.event === "pane.agent_status_changed" && typeof event.data.pane_id === "string" && typeof event.data.agent_status === "string") {
            const paneId = event.data.pane_id;
            const status = event.data.agent_status as HerdrSnapshotPane["status"];
            for (const watch of this.watches) if (watch.paneId === paneId) watch.statuses.push(status);
            this.update({panes: this.state.panes.map((pane) => (pane.paneId === paneId ? {...pane, status} : pane))});
            return;
        }
        // 其余事件（pane 增减、移动、workspace 变化）按快照重取，pane 集合变了会换订阅。
        void this.refresh();
    }

    private async poll(): Promise<void> {
        if (!this.client || this.stopped || !this.state.available) return;
        try {
            const listed = await this.client.listPanes();
            const known = new Set(this.state.panes.map((pane) => pane.paneId));
            if (listed.length !== known.size || listed.some((pane) => !known.has(pane.paneId))) {
                void this.refresh();
                return;
            }
            const byId = new Map(listed.map((pane) => [pane.paneId, pane]));
            this.update({panes: this.state.panes.map((pane) => {
                const fresh = byId.get(pane.paneId)!;
                return {...pane, status: fresh.status, agent: fresh.agent, session: fresh.session, cwd: fresh.cwd, foregroundCwd: fresh.foregroundCwd, focused: fresh.focused};
            })});
        } catch (error) {
            if (!(error instanceof HerdrError)) throw error;
            this.log(`轮询 herdr 的 pane 列表失败（${error.code}），改用快照对账`);
            void this.refresh();
        }
    }
}
