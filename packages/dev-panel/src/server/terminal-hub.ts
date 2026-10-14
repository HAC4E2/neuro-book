import {randomBytes} from "node:crypto";
import type {ServerWebSocket} from "bun";
import {newActionId, readAuditStatus, type AuditWriter} from "../core/audit.js";
import {PANEL_DEVELOPER} from "../core/identity.js";
import {HerdrError, type HerdrClient, type HerdrSnapshotPane} from "../herdr/client.js";
import type {ControlRegistry} from "./control-registry.js";
import type {Notifier, PaneLocks} from "./notifier.js";
import {PANEL_KEYS} from "./session-io.js";
import type {PanelState} from "./state.js";
import {readPtySize, type TerminalSize} from "./terminal-size.js";
import {clampSize, startTerminalStream, type StreamLine, type TerminalStream, type ToolsStatus} from "./terminal-stream.js";

/**
 * 网页终端的中枢（t12）：每条 `/ws/terminal` 连接一个子进程，观看时是 observe，接管时是 control。合同见 docs/panel.md 的“网页终端”。
 * - 只开放本仓库里 herdr 认得出 Agent 的 pane（普通 shell pane 在 t14），按 terminal id 认终端（pane 移动会换 pane id）；
 * - 接管的握手在这个终端的锁里（与 t11 的通知、文字、按键同一把），等第一行最多 5 秒；
 * - 接管登记在 `ControlRegistry`，通知、会话页的文字与按键据此停发（herdr 不拦 API 写入）；
 * - 结束原因只按三样归类：第一行是帧还是结束、是不是我们发过 release、终端还在不在（不看原因文案，设计审查 S4）；
 * - 尺寸从 pane 的 pty 读（`readPtySize`）；读到了，释放前改回接管前的尺寸，读不到就不改回。
 */

export type TerminalSocketData = {kind: "terminal"; instance: string; connectionId: string; loginSession: string; paneId: string; terminalId: string};
type Socket = ServerWebSocket<TerminalSocketData>;

const LIMIT_TOTAL = 16;
const LIMIT_PER_TERMINAL = 4;
const FALLBACK_SIZE = {cols: 120, rows: 40};
const WATCH_RECHECK_MS = 5_000;
/** 接管的几个时限：握手等第一行、没有心跳、没有输入。合同里的值是缺省值；测试可以改小（`TerminalHubOptions.timings`）。 */
export type TerminalTimings = {handshakeMs: number; heartbeatMs: number; idleMs: number};
const DEFAULT_TIMINGS: TerminalTimings = {handshakeMs: 5_000, heartbeatMs: 15_000, idleMs: 15 * 60_000};
const BACKPRESSURE_BYTES = 1024 * 1024;
const MAX_INPUT = 64 * 1024;

export const TERMINAL_CLOSE = {panelExit: 1001, badMessage: 4400, sessionClosed: 4401, notAllowed: 4403, gone: 4404, limit: 4409, dropped: 4410, unavailable: 4503} as const;

type ReleaseReason = "user" | "hidden" | "disconnect" | "heartbeat" | "idle" | "taken_over" | "pane_closed" | "panel_exit" | "session_closed";
type Stats = {inputs: number; inputBytes: number; enters: number; pastes: number; pasteBytes: number; resizes: number; buttons: number};
type Control = {actionId: string; since: number; before: TerminalSize | null; size: {cols: number; rows: number}; lastAlive: number; lastInput: number; stats: Stats; handedOff: boolean; timer: ReturnType<typeof setInterval>};
type Conn = {
    id: string;
    ws: Socket;
    loginSession: string;
    device: string;
    terminalId: string;
    paneId: string;
    /** 打开时这格的 Agent 会话；非 Agent 的 pane 为 null（只能观看，D2）。 */
    sessionKey: string | null;
    agent: string | null;
    mode: "watch" | "handshake" | "control";
    stream: TerminalStream | null;
    watchSize: {cols: number; rows: number};
    sizeKnown: boolean;
    watchTimer: ReturnType<typeof setInterval> | null;
    /** 连续几次 observe 没出一帧就结束（一行都没有，或第一行就是 `terminal.closed`；终端还在）：到 3 次就关连接，不无限重起。 */
    failures: number;
    control: Control | null;
    closed: boolean;
    /** 接管的握手在进行（含排锁）：这期间连接关了，由握手收尾（改回尺寸、写审计、收子进程），`close` 不插手。 */
    handshaking: boolean;
};

export type TerminalHubOptions = {
    state: PanelState;
    client: HerdrClient | null;
    tools: ToolsStatus;
    audit: AuditWriter;
    notifier: Notifier;
    locks: PaneLocks;
    controls: ControlRegistry;
    log: (message: string) => void;
    timings?: Partial<TerminalTimings>;
};

const streamOf = (conn: Conn): TerminalStream | null => conn.stream;
const keyOf = (pane: HerdrSnapshotPane) => (pane.session ? `${pane.session.agent}:${pane.session.value}` : null);

export class TerminalHub {
    private readonly conns = new Map<string, Conn>();
    private exiting = false;
    private readonly timings: TerminalTimings;

    constructor(private readonly options: TerminalHubOptions) {
        this.timings = {...DEFAULT_TIMINGS, ...options.timings};
    }

    status(): {available: boolean; reason: string | null} {
        return this.options.tools.available ? {available: true, reason: null} : {available: false, reason: this.options.tools.reason};
    }

    isControlled(terminalId: string): boolean {
        return this.options.controls.isControlled(terminalId);
    }

    private send(conn: Conn, message: Record<string, unknown>): void {
        if (conn.closed) return;
        const sent = conn.ws.send(JSON.stringify(message));
        // 0：超过 Bun 的 backpressureLimit 被丢了。缺了帧的画面不能接着画，关掉让页面重连（第一帧就是整屏）。
        if (sent === 0) this.closeConn(conn, TERMINAL_CLOSE.dropped, "积压太多，重新连接");
        else if (conn.ws.getBufferedAmount() > BACKPRESSURE_BYTES) conn.stream?.pause();
    }

    private closeConn(conn: Conn, code: number, reason: string): void {
        if (conn.closed) return;
        conn.ws.close(code, reason);
    }

    private paneOf(terminalId: string): HerdrSnapshotPane | null {
        return this.options.state.herdr.current().panes.find((pane) => pane.terminalId === terminalId) ?? null;
    }

    private inRepo(pane: HerdrSnapshotPane): boolean {
        const roots = this.options.state.checkouts.filter((checkout) => !checkout.prunable).map((checkout) => checkout.root);
        return [pane.cwd, pane.foregroundCwd].some((path) => path !== null && roots.some((root) => path === root || path.startsWith(`${root}/`)));
    }

    /** 结束之后这个终端还在不在：先对账一次再看（流结束常常就是 pane 关了，监视器的快照可能还没更新）。 */
    private async terminalExists(terminalId: string): Promise<boolean> {
        await this.options.state.herdr.refresh();
        return this.paneOf(terminalId) !== null;
    }

    /** 读不到尺寸的终端：同一个终端只在第一次读不到时记一行原因，读到之后再读不到才再记。 */
    private readonly sizeUnknown = new Set<string>();

    private async readSize(conn: Conn): Promise<TerminalSize | null> {
        if (!this.options.client) return null;
        const size = await readPtySize(this.options.client, conn.paneId, {
            onUnknown: (reason) => {
                if (this.sizeUnknown.has(conn.terminalId)) return;
                this.sizeUnknown.add(conn.terminalId);
                this.options.log(`读不到终端 ${conn.terminalId}（${conn.paneId}）的 pty 尺寸，观看按 120×40、释放时不改回：${reason}`);
            },
        });
        if (size) this.sizeUnknown.delete(conn.terminalId);
        return size;
    }

    /** 升级之后：pane 在本仓库里（D2 起不要求 Agent）、terminal id 对得上、上限；不过就以关闭码告诉页面原因。 */
    open(ws: Socket): void {
        const data = ws.data;
        const conn: Conn = {
            id: data.connectionId, ws, loginSession: data.loginSession, device: PANEL_DEVELOPER.device, terminalId: data.terminalId, paneId: data.paneId,
            sessionKey: null, agent: null, mode: "watch", stream: null, watchSize: FALLBACK_SIZE, sizeKnown: false, watchTimer: null, failures: 0, control: null, closed: false, handshaking: false,
        };
        this.conns.set(conn.id, conn);
        if (this.exiting) return this.closeConn(conn, TERMINAL_CLOSE.panelExit, "面板正在退出");
        if (!this.options.tools.available) return this.closeConn(conn, TERMINAL_CLOSE.unavailable, this.options.tools.reason);
        const pane = this.paneOf(conn.terminalId);
        if (!pane || pane.paneId !== conn.paneId) return this.closeConn(conn, TERMINAL_CLOSE.gone, "这个终端不在了，或者 pane 换了；刷新会话页");
        // 观看开放到本仓库里的任意 pane（D2，决定点 20）：没有 Agent 会话的 pane（开发服务、日志、shell）也能只读看；接管另有闸门。
        if (!this.inRepo(pane)) return this.closeConn(conn, TERMINAL_CLOSE.notAllowed, "只开放本仓库里的 pane");
        const open = [...this.conns.values()].filter((entry) => !entry.closed && entry !== conn);
        if (open.length >= LIMIT_TOTAL || open.filter((entry) => entry.terminalId === conn.terminalId).length >= LIMIT_PER_TERMINAL) {
            return this.closeConn(conn, TERMINAL_CLOSE.limit, `终端连接超过上限（一个终端 ${LIMIT_PER_TERMINAL} 个、整个面板 ${LIMIT_TOTAL} 个）`);
        }
        conn.sessionKey = keyOf(pane);
        conn.agent = pane.agent;
        void this.startWatch(conn);
    }

    private controller(conn: Conn): Record<string, unknown> | null {
        const entry = this.options.controls.get(conn.terminalId);
        if (!entry) return null;
        return {by: entry.connectionId === conn.id ? "this" : "other_browser", since: entry.since, device: entry.device};
    }

    private sendState(conn: Conn): void {
        const size = conn.mode === "control" && conn.control ? conn.control.size : conn.watchSize;
        this.send(conn, {t: "state", mode: conn.mode === "control" ? "control" : "watch", cols: size.cols, rows: size.rows, sizeKnown: conn.sizeKnown, controller: this.controller(conn), paneId: conn.paneId, terminalId: conn.terminalId, agent: conn.agent});
    }

    /** 观看：尺寸取 pty（本面板正在接管时取接管的尺寸）；读不到用 120×40，状态里标“尺寸不确定”。 */
    private async startWatch(conn: Conn): Promise<void> {
        if (conn.closed || this.exiting || !this.options.tools.available) return;
        const controlling = [...this.conns.values()].find((entry) => entry.terminalId === conn.terminalId && entry.mode === "control" && entry.control);
        const size = controlling?.control ? controlling.control.size : await this.readSize(conn);
        // 读尺寸期间另一次重起（5 秒复查、别的连接接管或释放、页面要 resync）已经起了 observe：不再起第二个，否则旧的成了收不到的孤儿。
        if (conn.closed || this.exiting || conn.mode !== "watch" || conn.stream) return;
        conn.sizeKnown = size !== null;
        conn.watchSize = size ?? FALLBACK_SIZE;
        this.spawn(conn, "observe", false);
        this.sendState(conn);
        conn.watchTimer ??= setInterval(() => void this.recheckWatch(conn), WATCH_RECHECK_MS);
    }

    /** 观看期间每 5 秒复查真实尺寸（TUI 改尺寸没有任何事件，设计审查实测）；接管期间不复查（TUI 改不动正被接管的终端）。 */
    private async recheckWatch(conn: Conn): Promise<void> {
        if (conn.closed || conn.mode !== "watch" || this.options.controls.isControlled(conn.terminalId)) return;
        const size = await this.readSize(conn);
        if (conn.closed || conn.mode !== "watch") return;
        const next = size ?? FALLBACK_SIZE;
        if (next.cols !== conn.watchSize.cols || next.rows !== conn.watchSize.rows || (size !== null) !== conn.sizeKnown) await this.restartWatch(conn);
    }

    private async restartWatch(conn: Conn): Promise<void> {
        if (conn.mode !== "watch") return;
        const stream = conn.stream;
        conn.stream = null;
        await stream?.stop();
        await this.startWatch(conn);
    }

    /** 看这个终端的其它连接按新尺寸重起 observe（本面板接管、resize、释放之后）。 */
    private restartWatchers(terminalId: string, except: Conn): void {
        for (const conn of this.conns.values()) if (conn !== except && conn.terminalId === terminalId && conn.mode === "watch" && !conn.closed) void this.restartWatch(conn);
    }

    private spawn(conn: Conn, kind: "observe" | "control", takeover: boolean, onFirst?: (line: StreamLine | null) => void): TerminalStream {
        if (!this.options.tools.available) throw new Error("终端工具不可用");
        const size = kind === "control" ? conn.control?.size ?? conn.watchSize : conn.watchSize;
        let first = true;
        /** 这条流出过帧没有：没出过帧就结束（一行都没有，或第一行就是 `terminal.closed`）算一次失败。 */
        let framed = false;
        const stream = startTerminalStream(this.options.tools.tools, kind, conn.terminalId, size, takeover, {
            onLine: (line) => {
                if (first) {
                    first = false;
                    onFirst?.(line);
                }
                if (line.type === "closed") {
                    this.options.log(`终端流 ${conn.terminalId}（${kind}）结束：${line.reason}`);
                    return;
                }
                if (!framed && kind === "observe") conn.failures = 0;
                framed = true;
                if (conn.stream === stream) this.send(conn, {t: "frame", seq: line.seq, full: line.full, w: line.width, h: line.height, b: line.bytes});
            },
            onBadLine: (line) => this.options.log(`终端流 ${conn.terminalId} 有一行读不懂，已跳过：${line}`),
            onStderr: (text) => this.options.log(`终端流 ${conn.terminalId}（${kind}）：${text.trim()}`),
        });
        conn.stream = stream;
        void stream.exited.then(() => {
            if (first) onFirst?.(null);
            void this.onStreamEnd(conn, stream, !framed);
        });
        return stream;
    }

    /** 流结束：不是被替换、不是我们收的，按三样归类（见类注释）。 */
    private async onStreamEnd(conn: Conn, stream: TerminalStream, endedWithoutFrame: boolean): Promise<void> {
        if (conn.stream !== stream || conn.closed) return;
        if (conn.mode === "handshake") return;
        if (conn.mode === "control" && conn.control) {
            if (stream.released) return;
            const exists = this.exiting ? true : await this.terminalExists(conn.terminalId);
            await this.finishControl(conn, this.exiting ? "panel_exit" : conn.control.handedOff || exists ? "taken_over" : "pane_closed", false);
            if (!exists) return this.closeConn(conn, TERMINAL_CLOSE.gone, "这个终端不在了");
            if (!this.exiting) await this.startWatch(conn);
            return;
        }
        if (this.exiting) return;
        conn.stream = null;
        if (!(await this.terminalExists(conn.terminalId))) return this.closeConn(conn, TERMINAL_CLOSE.gone, "这个终端不在了");
        if (endedWithoutFrame) conn.failures += 1;
        if (conn.failures >= 3) return this.closeConn(conn, TERMINAL_CLOSE.gone, "观看的流连续结束，终端可能不可用");
        await Bun.sleep(200);
        await this.startWatch(conn);
    }

    message(ws: Socket, raw: string | Buffer): void {
        const conn = this.conns.get(ws.data.connectionId);
        if (!conn || conn.closed) return;
        let message: Record<string, unknown>;
        try {
            const value = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as unknown;
            if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SyntaxError("不是对象");
            message = value as Record<string, unknown>;
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            return this.closeConn(conn, TERMINAL_CLOSE.badMessage, "消息不是 JSON 对象");
        }
        switch (message.t) {
        case "takeover": return void this.takeover(conn, message);
        case "input": return this.input(conn, message);
        case "resize": return this.resize(conn, message);
        case "key": return void this.key(conn, message);
        case "alive":
            if (conn.control) conn.control.lastAlive = Date.now();
            return;
        case "release":
            if (conn.mode === "control") void this.release(conn, message.reason === "hidden" ? "hidden" : "user", false);
            return;
        // 页面上新挂的视图错过了第一帧（手机的文字视图与终端画面之间切换）：观看时重起 observe，第一帧就是整屏。接管时不理（control 不能重起而不重新抢）。
        case "resync":
            if (conn.mode === "watch") void this.restartWatch(conn);
            return;
        default: return this.closeConn(conn, TERMINAL_CLOSE.badMessage, `不认识的消息：${String(message.t)}`);
        }
    }

    drain(ws: Socket): void {
        const conn = this.conns.get(ws.data.connectionId);
        if (conn && ws.getBufferedAmount() <= BACKPRESSURE_BYTES) conn.stream?.resume();
    }

    private error(conn: Conn, code: string, message: string): void {
        this.send(conn, {t: "error", code, message});
    }

    private async takeover(conn: Conn, message: Record<string, unknown>): Promise<void> {
        if (conn.mode !== "watch") return this.error(conn, "busy", "正在接管或握手");
        const size = clampSize(message.cols, message.rows);
        if (!size) return this.closeConn(conn, TERMINAL_CLOSE.badMessage, "尺寸不是整数");
        const force = message.force === true;
        const audit = await readAuditStatus(this.options.audit.paths);
        if (!audit.enabled) return this.error(conn, "audit_unavailable", `审计不可用，不能接管：${audit.detail}`);
        const pane = this.paneOf(conn.terminalId);
        // 接管的闸门显式要求 Agent 会话（D2）：观看放开到任意 pane 之后，非 Agent 的 pane 两边都是 null，不能靠“会话没变”放行。
        // 回错误、不关连接，照常观看。
        if (pane && (pane.agent === null || keyOf(pane) === null || typeof message.expectedSession !== "string" || message.expectedSession === "")) {
            return this.error(conn, "not_allowed", "只有 Agent 会话能接管键盘；这一格只能看");
        }
        if (!pane || keyOf(pane) !== message.expectedSession) return this.error(conn, "session_changed", "这个 pane 上的会话换了，刷新之后再接管");
        conn.paneId = pane.paneId;
        // 连接按终端建，不随会话换：开着时 shell 里起了 Agent，或同一格换了会话，审计与状态要记接管时核对过的这一个。
        conn.sessionKey = keyOf(pane);
        conn.agent = pane.agent;
        const other = [...this.conns.values()].find((entry) => entry !== conn && entry.terminalId === conn.terminalId && entry.mode === "control" && entry.control);
        if (other && !force) {
            this.send(conn, {t: "need_confirm", reason: "other_browser", detail: {since: new Date(other.control!.since).toISOString(), device: other.device}});
            return;
        }
        conn.mode = "handshake";
        conn.handshaking = true;
        try {
            await this.options.locks.run(conn.terminalId, () => this.handshake(conn, size, force, other ?? null));
        } finally {
            conn.handshaking = false;
            if (conn.closed) await this.dispose(conn);
        }
    }

    private async handshake(conn: Conn, size: {cols: number; rows: number}, force: boolean, other: Conn | null): Promise<void> {
        if (conn.closed || this.exiting) {
            conn.mode = "watch";
            return;
        }
        const before = other?.control ? other.control.before : await this.readSize(conn);
        const actionId = newActionId();
        const target = {paneId: conn.paneId, terminalId: conn.terminalId, sessionKey: conn.sessionKey};
        try {
            await this.options.audit.append({actionId, phase: "intent", action: "takeover", device: conn.device, target, detail: {cols: size.cols, rows: size.rows, before, takeover: force, loginSession: conn.loginSession.slice(0, 8)}});
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            conn.mode = "watch";
            return this.error(conn, "audit_unavailable", `审计写不进去，不能接管：${error.message}`);
        }
        const watching = conn.stream;
        conn.stream = null;
        await watching?.stop();
        // 等锁、读尺寸、写意图、收 observe 期间连接关了或面板要退出：不再起 control（什么都没改过）。
        if (conn.closed || this.exiting) {
            conn.mode = "watch";
            await this.auditResult(conn, actionId, "takeover", target, {result: "failed", why: conn.closed ? "disconnect" : "panel_exit"});
            return;
        }
        // 本面板的另一个浏览器在接管：把接管前的尺寸交给新的接管者，那边释放时不改回（Claude 不会连排两次）。
        if (other?.control) other.control.handedOff = true;
        const now = Date.now();
        conn.control = {actionId, since: now, before, size, lastAlive: now, lastInput: now, stats: {inputs: 0, inputBytes: 0, enters: 0, pastes: 0, pasteBytes: 0, resizes: 0, buttons: 0}, handedOff: false, timer: setInterval(() => this.checkControl(conn), Math.min(5_000, Math.ceil(this.timings.heartbeatMs / 3)))};
        const first = await new Promise<StreamLine | null | "timeout">((resolve) => {
            const timer = setTimeout(() => resolve("timeout"), this.timings.handshakeMs);
            this.spawn(conn, "control", force || other !== null, (line) => {
                clearTimeout(timer);
                resolve(line);
            });
        });
        if (first !== null && first !== "timeout" && first.type === "frame") {
            conn.mode = "control";
            this.options.controls.set(conn.terminalId, {connectionId: conn.id, paneId: conn.paneId, since: new Date(now).toISOString(), device: conn.device});
            await this.auditResult(conn, actionId, "takeover", target, {result: "attached"});
            // 已经接上、尺寸已改成网页的，连接却在等第一帧时关了（或面板要退出）：照常释放，改回尺寸、写释放行。
            if (conn.closed || this.exiting) return this.release(conn, this.exiting ? "panel_exit" : "disconnect", true);
            this.sendState(conn);
            this.restartWatchers(conn.terminalId, conn);
            return;
        }
        // spawn 在回调里给 conn.stream 赋了值，类型收窄看不到：经函数读。
        const stream = streamOf(conn);
        clearInterval(conn.control.timer);
        conn.control = null;
        conn.mode = "watch";
        conn.stream = null;
        await stream?.stop();
        if (conn.closed) return this.auditResult(conn, actionId, "takeover", target, {result: "failed", why: "disconnect"});
        if (first === "timeout") {
            await this.auditResult(conn, actionId, "takeover", target, {result: "failed", why: "timeout"});
            this.error(conn, "takeover_timeout", "接管的握手 5 秒没有回应，没有接管");
        } else if (!(await this.terminalExists(conn.terminalId))) {
            await this.auditResult(conn, actionId, "takeover", target, {result: "failed", why: "pane_closed"});
            return this.closeConn(conn, TERMINAL_CLOSE.gone, "这个终端不在了");
        } else if (!force && other === null) {
            await this.auditResult(conn, actionId, "takeover", target, {result: "controlled_elsewhere"});
            this.send(conn, {t: "need_confirm", reason: "controlled_elsewhere", detail: {text: first?.type === "closed" ? first.reason : null}});
        } else {
            await this.auditResult(conn, actionId, "takeover", target, {result: "failed", why: "refused"});
            this.error(conn, "takeover_failed", `没有接管：${first?.type === "closed" ? first.reason : "流结束了"}`);
        }
        await this.startWatch(conn);
    }

    /** 结果行与释放行的设备与意图行一样取自连接（t13 起不同设备的连接各记各的）。 */
    private async auditResult(conn: Conn, actionId: string, action: "takeover" | "release", target: Record<string, unknown>, detail: Record<string, unknown>): Promise<void> {
        try {
            await this.options.audit.append({actionId, phase: "result", action, device: conn.device, target, detail});
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            this.options.log(`写审计结果失败（${action}，${actionId}）：${error.message}`);
        }
    }

    private checkControl(conn: Conn): void {
        const control = conn.control;
        if (!control || conn.mode !== "control") return;
        const now = Date.now();
        if (now - control.lastAlive > this.timings.heartbeatMs) void this.release(conn, "heartbeat", false);
        else if (now - control.lastInput > this.timings.idleMs) void this.release(conn, "idle", false);
    }

    private input(conn: Conn, message: Record<string, unknown>): void {
        if (conn.mode !== "control" || !conn.control || !conn.stream) return;
        if (typeof message.data !== "string" || message.data.length > MAX_INPUT) return this.closeConn(conn, TERMINAL_CLOSE.badMessage, "输入不是文字或太长");
        const stats = conn.control.stats;
        const bytes = Buffer.byteLength(message.data);
        stats.inputs += 1;
        stats.inputBytes += bytes;
        stats.enters += (message.data.match(/\r/gu) ?? []).length;
        if (message.paste === true) {
            stats.pastes += 1;
            stats.pasteBytes += bytes;
        }
        conn.control.lastInput = Date.now();
        conn.control.lastAlive = Date.now();
        conn.stream.send({type: "input", text: message.data});
    }

    private resize(conn: Conn, message: Record<string, unknown>): void {
        if (conn.mode !== "control" || !conn.control || !conn.stream) return;
        const size = clampSize(message.cols, message.rows);
        if (!size) return this.closeConn(conn, TERMINAL_CLOSE.badMessage, "尺寸不是整数");
        if (size.cols === conn.control.size.cols && size.rows === conn.control.size.rows) return;
        conn.control.size = size;
        conn.control.stats.resizes += 1;
        conn.stream.send({type: "resize", cols: size.cols, rows: size.rows});
        this.sendState(conn);
        this.restartWatchers(conn.terminalId, conn);
    }

    /** 接管期间的按钮：单击即发，经 `agent.send_keys`（herdr 按应用当前的模式编码）；计入释放行的统计，不逐条写审计。 */
    private async key(conn: Conn, message: Record<string, unknown>): Promise<void> {
        if (conn.mode !== "control" || !conn.control) return;
        if (typeof message.key !== "string" || !PANEL_KEYS.includes(message.key)) return this.closeConn(conn, TERMINAL_CLOSE.badMessage, "不在按键清单里");
        conn.control.stats.buttons += 1;
        conn.control.lastInput = Date.now();
        try {
            await this.options.client?.agentSendKeys(conn.paneId, [message.key]);
        } catch (error) {
            if (!(error instanceof HerdrError)) throw error;
            this.error(conn, "herdr_unavailable", `按键没发出去（${error.code}）`);
        }
    }

    /** 释放：读到过接管前的尺寸、又不是换手，先改回；再 release，收子进程，写释放行，回到观看。 */
    private async release(conn: Conn, reason: ReleaseReason, closing: boolean): Promise<void> {
        if (conn.mode !== "control" || !conn.control) return;
        const control = conn.control;
        const stream = conn.stream;
        // 子进程已经退出时 send 回 false：照实记“没有改回”。
        const restore = control.before !== null && !control.handedOff && stream !== null && stream.send({type: "resize", cols: control.before!.cols, rows: control.before!.rows});
        conn.mode = "handshake";
        await stream?.stop();
        await this.finishControl(conn, reason, restore);
        if (!closing && !conn.closed && !this.exiting) await this.startWatch(conn);
    }

    private async finishControl(conn: Conn, reason: ReleaseReason, restored: boolean): Promise<void> {
        const control = conn.control;
        if (!control) return;
        clearInterval(control.timer);
        conn.control = null;
        conn.mode = "watch";
        conn.stream = null;
        this.options.controls.release(conn.terminalId, conn.id);
        const why = restored ? null : control.handedOff ? "handed_off" : control.before === null ? "size_unknown" : "stream_ended";
        await this.auditResult(conn, control.actionId, "release", {paneId: conn.paneId, terminalId: conn.terminalId, sessionKey: conn.sessionKey}, {reason, durationMs: Date.now() - control.since, ...control.stats, restored, ...(why ? {notRestored: why} : {})});
        this.send(conn, {t: "released", reason, restored, notRestored: why});
        this.restartWatchers(conn.terminalId, conn);
        void this.options.notifier.tick();
    }

    /** 连接关了（标签页关掉、切到后台、断线）：接管先释放，再收子进程。握手进行中时由握手收尾（见 `takeover`）。 */
    close(ws: Socket): void {
        const conn = this.conns.get(ws.data.connectionId);
        if (!conn) return;
        conn.closed = true;
        if (conn.watchTimer) clearInterval(conn.watchTimer);
        if (!conn.handshaking) void this.dispose(conn);
    }

    private async dispose(conn: Conn): Promise<void> {
        await this.release(conn, "disconnect", true);
        const stream = conn.stream;
        conn.stream = null;
        await stream?.stop();
        this.conns.delete(conn.id);
    }

    /** t13 吊销设备时用：关掉某个登录会话的全部终端连接（接管先释放）。 */
    async closeLoginSession(loginSession: string): Promise<void> {
        await Promise.all([...this.conns.values()].filter((conn) => conn.loginSession === loginSession).map(async (conn) => {
            await this.release(conn, "session_closed", true);
            this.closeConn(conn, TERMINAL_CLOSE.sessionClosed, "登录已失效");
        }));
    }

    /** 面板退出：先释放全部接管（改回尺寸、写释放行），再收观看，最后关连接。之后子进程自己退出的一律记 `panel_exit`。 */
    async stop(): Promise<void> {
        this.exiting = true;
        const conns = [...this.conns.values()];
        await Promise.all(conns.map((conn) => this.release(conn, "panel_exit", true)));
        await Promise.all(conns.map(async (conn) => {
            if (conn.watchTimer) clearInterval(conn.watchTimer);
            const stream = conn.stream;
            conn.stream = null;
            await stream?.stop();
            this.closeConn(conn, TERMINAL_CLOSE.panelExit, "面板退出");
            conn.closed = true;
        }));
    }
}

export function newConnectionId(): string {
    return randomBytes(9).toString("base64url");
}
