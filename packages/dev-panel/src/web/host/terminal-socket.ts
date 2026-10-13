import {onScopeDispose, reactive} from "vue";
import {ApiError, getJson} from "./api.js";
import {panelState} from "./panel-data.js";

/**
 * 网页终端的连接（页面宿主用，t12）：一个终端视图一条 `/ws/terminal`。合同见 docs/panel.md 的“网页终端”。
 * - 页面切到后台：接管先发 release（原因 hidden），然后连观看一起关掉；切回来再连，只恢复观看（不自动重新接管）；
 * - 接管期间每 5 秒发一次心跳（服务端 15 秒没收到就释放）；
 * - 断线后重连前先取一次 `/api/meta`，回 401 就停（与 `/ws` 一样）；服务端用 4403、4404、4409、4503 关闭时不重连，显示原因。
 * 帧经 `source.subscribe` 交给零件（`TerminalView`、`TerminalTextView`），零件不碰连接；连接推过帧之后才挂上的零件错过了整屏，
 * 观看时发 `resync` 让服务端重起 observe（接管时只能等下一次输出）。
 */

export type TerminalFrame = {seq: number; full: boolean; w: number; h: number; bytes: Uint8Array};
export type TerminalSource = {subscribe(listener: (frame: TerminalFrame) => void): () => void};
export type TerminalController = {by: "this" | "other_browser"; since: string; device: string} | null;
export type TerminalNotice = {kind: "need_confirm"; reason: "controlled_elsewhere" | "other_browser"; text: string | null; since: string | null} | {kind: "error"; code: string; message: string} | {kind: "released"; reason: string; restored: boolean; notRestored: string | null};

const HEARTBEAT_MS = 5_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;
/** 服务端以这些码关闭时不重连：原因是固定的（不在本仓库、终端没了、超上限、终端功能不可用、登录失效）。 */
const FINAL_CODES = new Set([4400, 4401, 4403, 4404, 4409, 4503]);

function decode(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

export function useTerminalSocket(target: {paneId: string; terminalId: string}) {
    const state = reactive({
        status: "connecting" as "connecting" | "open" | "paused" | "closed",
        mode: "watch" as "watch" | "control",
        cols: 120,
        rows: 40,
        sizeKnown: false,
        controller: null as TerminalController,
        /** 服务端关掉连接、不再重连的原因（显示给开发者）。 */
        closedReason: null as string | null,
        notice: null as TerminalNotice | null,
        pending: false,
    });
    const listeners = new Set<(frame: TerminalFrame) => void>();
    let ws: WebSocket | null = null;
    /** 这条连接已经推过帧：之后新挂上的视图错过了整屏，观看时请服务端重起 observe（接管时只能等下一次输出）。 */
    let framed = false;
    const source: TerminalSource = {
        subscribe(listener) {
            listeners.add(listener);
            if (framed && state.mode === "watch") send({t: "resync"});
            return () => listeners.delete(listener);
        },
    };
    let attempts = 0;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const send = (message: Record<string, unknown>) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const stopHeartbeat = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
    };

    function onMessage(event: MessageEvent): void {
        let message: Record<string, unknown>;
        try {
            message = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch (error) {
            console.warn("终端连接推来一条读不懂的消息，已忽略", error);
            return;
        }
        if (message.t === "frame") {
            framed = true;
            const frame: TerminalFrame = {seq: message.seq as number, full: message.full === true, w: message.w as number, h: message.h as number, bytes: decode(message.b as string)};
            for (const listener of listeners) listener(frame);
            return;
        }
        if (message.t === "state") {
            state.mode = message.mode === "control" ? "control" : "watch";
            state.cols = message.cols as number;
            state.rows = message.rows as number;
            state.sizeKnown = message.sizeKnown === true;
            state.controller = (message.controller as TerminalController) ?? null;
            state.pending = false;
            stopHeartbeat();
            if (state.mode === "control") heartbeat = setInterval(() => send({t: "alive"}), HEARTBEAT_MS);
            return;
        }
        if (message.t === "need_confirm") {
            const detail = (message.detail ?? {}) as Record<string, unknown>;
            state.notice = {kind: "need_confirm", reason: message.reason === "other_browser" ? "other_browser" : "controlled_elsewhere", text: typeof detail.text === "string" ? detail.text : null, since: typeof detail.since === "string" ? detail.since : null};
            state.pending = false;
            return;
        }
        if (message.t === "released") {
            state.notice = {kind: "released", reason: String(message.reason), restored: message.restored === true, notRestored: typeof message.notRestored === "string" ? message.notRestored : null};
            stopHeartbeat();
            return;
        }
        if (message.t === "error") {
            state.notice = {kind: "error", code: String(message.code), message: String(message.message)};
            state.pending = false;
        }
    }

    async function probe(): Promise<boolean> {
        try {
            await getJson<unknown>("/api/meta");
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 401) {
                panelState.unauthorized = true;
                return false;
            }
            console.warn("重连终端前探测面板失败，照常重连", caught);
        }
        return true;
    }

    function connect(): void {
        if (disposed || document.visibilityState === "hidden") return;
        state.status = "connecting";
        state.closedReason = null;
        framed = false;
        const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/terminal?pane=${encodeURIComponent(target.paneId)}&terminal=${encodeURIComponent(target.terminalId)}`);
        ws = socket;
        socket.addEventListener("open", () => {
            state.status = "open";
            attempts = 0;
        });
        socket.addEventListener("message", onMessage);
        socket.addEventListener("close", (event) => {
            if (ws !== socket) return;
            ws = null;
            stopHeartbeat();
            state.mode = "watch";
            if (disposed || state.status === "paused") return;
            if (FINAL_CODES.has(event.code)) {
                state.status = "closed";
                state.closedReason = event.reason || `终端连接关闭（${event.code}）`;
                return;
            }
            state.status = "connecting";
            attempts += 1;
            const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(attempts - 1, 4));
            reconnect = setTimeout(() => {
                reconnect = null;
                void probe().then((go) => {
                    if (go) connect();
                });
            }, delay);
        });
    }

    /** 切到后台：接管先释放，再连观看一起关；切回来再连（只恢复观看）。 */
    function onVisibility(): void {
        if (document.visibilityState === "hidden") {
            if (state.mode === "control") send({t: "release", reason: "hidden"});
            state.status = "paused";
            if (reconnect) clearTimeout(reconnect);
            reconnect = null;
            ws?.close(1000, "页面切到后台");
            ws = null;
            stopHeartbeat();
            state.mode = "watch";
            return;
        }
        if (state.status === "paused") connect();
    }
    const onPageHide = () => ws?.close(1000, "离开页面");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    connect();
    onScopeDispose(() => {
        disposed = true;
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onPageHide);
        if (reconnect) clearTimeout(reconnect);
        stopHeartbeat();
        ws?.close(1000, "离开会话详情");
        ws = null;
    });

    return {
        state,
        source,
        takeover(cols: number, rows: number, expectedSession: string, force: boolean): void {
            state.notice = null;
            state.pending = true;
            send({t: "takeover", cols, rows, expectedSession, force});
        },
        release(): void {
            send({t: "release"});
        },
        input(data: string, paste: boolean): void {
            send({t: "input", data, ...(paste ? {paste: true} : {})});
        },
        resize(cols: number, rows: number): void {
            send({t: "resize", cols, rows});
        },
        key(key: string): void {
            send({t: "key", key});
        },
        dismissNotice(): void {
            state.notice = null;
        },
    };
}

export type TerminalSocket = ReturnType<typeof useTerminalSocket>;
