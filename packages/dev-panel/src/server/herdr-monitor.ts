import {HerdrError, type HerdrClient, type HerdrEvent, type HerdrSnapshotPane, type HerdrSubscription} from "../herdr/client.js";

/**
 * 面板常驻的 herdr 状态：快照加订阅，会话页与活动共用这一份（不再各自调 pane.list，两份会对不上）。
 * - 协议 22 没有 `events_lost`：订阅连接断开就当作可能漏了事件，退避重连后用快照对账；另外每 30 秒对账一次，
 *   对账时各 Agent 的 `state_change_seq` 与记下的不同，就是漏了状态事件（计进 `missedEvents`）。
 * - 真实会话会不会推送 `pane.agent_status_changed` 没有核实，所以有浏览器连着时每 500 毫秒轮询一次 `pane.list`，事件只当加速。
 * - `pane.agent_status_changed` 只能逐格订阅：pane 增减时开一条新的订阅连接，等它回 `subscription_started` 再关旧的，然后对账。
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
};

const GLOBAL_EVENTS = ["pane.created", "pane.closed", "pane.updated", "pane.moved", "pane.exited", "pane.agent_detected", "workspace.created", "workspace.closed", "workspace.renamed"];
const RECONCILE_MS = 30_000;
const POLL_MS = 500;
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 30_000;

/** 退避：初值 500 毫秒、每次乘 2、上限 30 秒，再加 0 到 20% 的抖动（多个面板或重启后不同时重连）。 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** attempt);
    return Math.round(base * (1 + 0.2 * random()));
}

function fingerprint(panes: readonly HerdrSnapshotPane[]): string {
    return JSON.stringify(panes.map((pane) => [pane.paneId, pane.status, pane.agent, pane.session?.value ?? null, pane.cwd, pane.foregroundCwd, pane.workspaceLabel]));
}

export class HerdrMonitor {
    private state: HerdrState;
    private subscription: HerdrSubscription | null = null;
    private subscribedPanes = "";
    private attempts = 0;
    private seq = new Map<string, number>();
    private timers = new Set<ReturnType<typeof setTimeout>>();
    private reconcileTimer: ReturnType<typeof setInterval> | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private refreshing: Promise<void> | null = null;
    private refreshAgain = false;
    private stopped = false;

    constructor(private readonly client: HerdrClient | null, private readonly onChange: () => void, private readonly log: (message: string) => void) {
        this.state = {available: false, mode: client ? "starting" : "disabled", version: null, socketPath: client?.socketPath ?? null, panes: [], at: null, error: null, missedEvents: 0, reconnects: 0};
    }

    current(): HerdrState {
        return this.state;
    }

    /** 不阻塞：服务先开始监听，herdr 的状态随后补上。 */
    start(): void {
        if (!this.client) return;
        void this.refresh();
        this.reconcileTimer = setInterval(() => void this.refresh(), RECONCILE_MS);
    }

    /** 有浏览器连着时开 500 毫秒的轮询，没有时关掉。 */
    setActive(active: boolean): void {
        if (!this.client || this.stopped) return;
        if (active && !this.pollTimer) this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
        if (!active && this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    stop(): void {
        this.stopped = true;
        if (this.reconcileTimer) clearInterval(this.reconcileTimer);
        if (this.pollTimer) clearInterval(this.pollTimer);
        for (const timer of this.timers) clearTimeout(timer);
        this.subscription?.close();
        this.subscription = null;
    }

    private later(ms: number, action: () => void): void {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (!this.stopped) action();
        }, ms);
        this.timers.add(timer);
    }

    private update(patch: Partial<HerdrState>): void {
        const before = `${fingerprint(this.state.panes)}|${this.state.available}|${this.state.mode}`;
        this.state = {...this.state, ...patch, at: new Date().toISOString()};
        if (`${fingerprint(this.state.panes)}|${this.state.available}|${this.state.mode}` !== before) this.onChange();
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
            this.attempts = 0;
            this.ensureSubscription();
        } catch (error) {
            if (!(error instanceof HerdrError)) throw error;
            this.update({available: false, mode: "unavailable", panes: [], error: `${error.code}：${error.message}`});
            const delay = backoffDelay(this.attempts++);
            this.log(`herdr 不可用（${error.code}），${delay} 毫秒后重试`);
            this.later(delay, () => void this.refresh());
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
            previous?.close();
            this.update({mode: "subscribed"});
            void this.refresh();
        }, (error: unknown) => {
            this.log(`herdr 订阅没有开始：${error instanceof Error ? error.message : String(error)}`);
            this.update({mode: this.state.available ? "polling" : "unavailable"});
        });
        void next.closed.then(({reason}) => {
            if (this.stopped || this.subscription !== next) return;
            this.subscription = null;
            this.subscribedPanes = "";
            this.update({mode: "polling", reconnects: this.state.reconnects + 1});
            const delay = backoffDelay(this.attempts++);
            this.log(`herdr 订阅断开（${reason}），${delay} 毫秒后重连并对账`);
            this.later(delay, () => void this.refresh());
        });
    }

    private onEvent(event: HerdrEvent): void {
        if (event.event === "pane.agent_status_changed" && typeof event.data.pane_id === "string" && typeof event.data.agent_status === "string") {
            const paneId = event.data.pane_id;
            const status = event.data.agent_status as HerdrSnapshotPane["status"];
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
                return {...pane, status: fresh.status, agent: fresh.agent, session: fresh.session, cwd: fresh.cwd, foregroundCwd: fresh.foregroundCwd};
            })});
        } catch (error) {
            if (!(error instanceof HerdrError)) throw error;
            this.log(`轮询 herdr 的 pane 列表失败（${error.code}），改用快照对账`);
            void this.refresh();
        }
    }
}
