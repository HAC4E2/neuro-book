import {createConnection} from "node:net";
import {homedir} from "node:os";
import {join} from "node:path";
import {systemErrorCode} from "../core/errors.js";

/**
 * herdr 的 socket 客户端：一行一个 JSON，请求 `{id, method, params}`，响应 `{id, result}` 或 `{id, error: {code, message}}`。
 * herdr 的 socket 没有鉴权，连上就能调全部方法（含 `server.stop`、`pane.run`），所以白名单由调用方显式传入，
 * 白名单外的方法在这里直接拒绝、不发出去。命令行用 `HERDR_CLI_METHODS`；`status` 用只读的 `HERDR_READ_METHODS`；
 * 面板用 `HERDR_PANEL_METHODS`：只读的 `HERDR_PANEL_READ_METHODS` 加 t11 的通知、文字与按键（`agent.prompt`、`agent.send_keys`）
 * 与它们之前的核对（`agent.get`、`agent.explain`、`agent.read`，都不改界面）；t12 再补终端的。其中没有 `pane.report_metadata`：标签只由会话自己的命令行写。
 */
export const HERDR_READ_METHODS: readonly string[] = ["ping", "pane.list", "pane.process_info"];
export const HERDR_PANEL_READ_METHODS: readonly string[] = [...HERDR_READ_METHODS, "session.snapshot", "events.subscribe"];
export const HERDR_PANEL_METHODS: readonly string[] = [...HERDR_PANEL_READ_METHODS, "agent.get", "agent.explain", "agent.read", "agent.prompt", "agent.send_keys"];
export const HERDR_CLI_METHODS: readonly string[] = [...HERDR_READ_METHODS, "pane.report_metadata"];

const TAG_SOURCE = "nbdev";
const TAG_TTL_MS = 86_400_000;
const DEFAULT_CALL_TIMEOUT_MS = 2_000;

export type HerdrStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type HerdrAgentSession = {agent: string; kind: string; value: string};
/** `cwd` 是 pane 的 shell 所在目录，`foregroundCwd` 是前台进程所在目录；herdr 不知道时为 null。`focused`：herdr 当前聚焦的那一格（开发者的键盘最可能在那里）。 */
export type HerdrPane = {paneId: string; terminalId: string; agent: string | null; status: HerdrStatus; session: HerdrAgentSession | null; cwd: string | null; foregroundCwd: string | null; focused: boolean};
/** `agent.get` 与 `agent.prompt` 返回的一个 Agent：比 pane 多一个状态序号（每次状态变化加 1）。 */
export type HerdrAgentInfo = HerdrPane & {stateChangeSeq: number | null};
/** `agent.explain` 里投递判据要用的几项：命中的规则、退路、`live_prompt_box` 的区域预览（规则不在清单里时为 null）。 */
export type HerdrExplain = {state: string | null; matchedRule: string | null; fallbackReason: string | null; screenDetectionSkipped: boolean; livePromptBoxPreview: string | null; manifestVersion: string | null};
export type HerdrProcessInfo = {paneId: string; shellPid: number | null; foregroundGroupId: number | null; foregroundPids: number[]};
/** 一格 pane 在快照里的样子：pane 本身，加上它所在的 workspace 与 Agent 的状态序号（`state_change_seq`，对账时判断有没有漏掉状态事件）。 */
export type HerdrSnapshotPane = HerdrPane & {workspaceId: string; workspaceLabel: string | null; tabId: string; stateChangeSeq: number | null};
export type HerdrSessionSnapshot = {version: string; panes: HerdrSnapshotPane[]};
/** 订阅里收到的一条事件：`event` 是事件类型（如 `pane.agent_status_changed`），`data` 原样。 */
export type HerdrEvent = {event: string; data: Record<string, unknown>};
/** 一条订阅连接：`ready` 在收到 `subscription_started` 时兑现，被拒或连不上时拒绝；`closed` 在连接断开时兑现（主动 `close()` 也算）。 */
export type HerdrSubscription = {ready: Promise<void>; closed: Promise<{reason: string}>; close(): void};
export type HerdrAvailability = {ok: true; version: string; socketPath: string} | {ok: false; reason: string; socketPath: string; detail: string};

/** herdr 调用失败：`code` 是 herdr 的错误码（如 `pane_not_found`、`agent_blocked`，herdr 自己等待到点是 `timeout`），或本客户端的 `server_not_running`、`client_timeout`（本地时限）、`protocol_error`、`method_not_allowed`。 */
export class HerdrError extends Error {
    readonly code: string;

    constructor(code: string, message: string, options: {cause?: unknown} = {}) {
        super(message, options.cause === undefined ? undefined : {cause: options.cause});
        this.name = "HerdrError";
        this.code = code;
    }
}

export type HerdrClient = {
    readonly socketPath: string;
    availability(): Promise<HerdrAvailability>;
    listPanes(): Promise<HerdrPane[]>;
    /** pane 不存在时为 null。 */
    processInfo(paneId: string): Promise<HerdrProcessInfo | null>;
    reportTaskTokens(paneId: string, tokens: {work: string; task: string}): Promise<void>;
    clearTaskTokens(paneId: string): Promise<void>;
    /** `session.snapshot`：全部 pane（带 cwd 与 Agent 状态）与 Agent 的状态序号。 */
    snapshot(): Promise<HerdrSessionSnapshot>;
    /** `agent.get`：pane 上没有 herdr 认得的 Agent 时为 null（`agent_not_found`）。 */
    agentGet(target: string): Promise<HerdrAgentInfo | null>;
    agentExplain(target: string): Promise<HerdrExplain>;
    /**
     * `agent.read`：`ansi` 保留转义序列（`strip_ansi: false`）。读 Claude 只用 `visible` 与 `detection`：它在备用屏上，
     * `recent` 加行数会滚动它的界面、工作中直接报错；`recent_unwrapped` 加 `lines` 只给 omp（普通回滚，读它没有副作用）。
     */
    agentRead(target: string, source: "visible" | "detection" | "recent_unwrapped", format?: "text" | "ansi", lines?: number): Promise<string>;
    /** `agent.prompt`：单次时限是等待时限加 2 秒。返回体里的 `agent` 是 herdr 回应时看到的状态（可能是旧值）。 */
    agentPrompt(target: string, text: string, wait: {until: HerdrStatus[]; timeoutMs: number}): Promise<{type: string; agent: HerdrAgentInfo | null}>;
    agentSendKeys(target: string, keys: readonly string[]): Promise<void>;
    /** `events.subscribe`：单独开一条长连接，之后每读到一行事件回调一次。订阅类型由调用方写死。 */
    subscribe(subscriptions: ReadonlyArray<Record<string, unknown>>, onEvent: (event: HerdrEvent) => void, onMalformed?: (line: string) => void): HerdrSubscription;
};

/** socket 位置：`HERDR_SOCKET_PATH` > `HERDR_SESSION`（命名会话）> 默认会话。 */
export function resolveHerdrSocket(env: NodeJS.ProcessEnv): string {
    if (env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
    if (env.HERDR_SESSION) return join(homedir(), ".config", "herdr", "sessions", env.HERDR_SESSION, "herdr.sock");
    return join(homedir(), ".config", "herdr", "herdr.sock");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPane(value: unknown): HerdrPane | null {
    if (!isRecord(value) || typeof value.pane_id !== "string") return null;
    const session = isRecord(value.agent_session) && typeof value.agent_session.value === "string" && typeof value.agent_session.agent === "string"
        ? {agent: value.agent_session.agent, kind: typeof value.agent_session.kind === "string" ? value.agent_session.kind : "", value: value.agent_session.value}
        : null;
    const status = typeof value.agent_status === "string" && ["idle", "working", "blocked", "done", "unknown"].includes(value.agent_status) ? value.agent_status as HerdrStatus : "unknown";
    return {
        paneId: value.pane_id,
        terminalId: typeof value.terminal_id === "string" ? value.terminal_id : "",
        agent: typeof value.agent === "string" ? value.agent : null,
        status,
        session,
        cwd: typeof value.cwd === "string" ? value.cwd : null,
        foregroundCwd: typeof value.foreground_cwd === "string" ? value.foreground_cwd : null,
        focused: value.focused === true,
    };
}

function toAgentInfo(value: unknown): HerdrAgentInfo | null {
    const pane = toPane(value);
    if (!pane || !isRecord(value)) return null;
    return {...pane, stateChangeSeq: typeof value.state_change_seq === "number" ? value.state_change_seq : null};
}

function toExplain(value: unknown): HerdrExplain {
    const explain = isRecord(value) && isRecord(value.explain) ? value.explain : null;
    if (!explain) throw new HerdrError("protocol_error", "agent.explain 的响应缺少 explain");
    const rules = Array.isArray(explain.evaluated_rules) ? explain.evaluated_rules : [];
    const box = rules.find((rule) => isRecord(rule) && rule.id === "live_prompt_box");
    const evidence = isRecord(box) && isRecord(box.evidence) ? box.evidence : null;
    return {
        state: typeof explain.state === "string" ? explain.state : null,
        matchedRule: isRecord(explain.matched_rule) && typeof explain.matched_rule.id === "string" ? explain.matched_rule.id : null,
        fallbackReason: typeof explain.fallback_reason === "string" ? explain.fallback_reason : null,
        screenDetectionSkipped: explain.screen_detection_skipped === true,
        livePromptBoxPreview: evidence && typeof evidence.region_preview === "string" ? evidence.region_preview : null,
        manifestVersion: typeof explain.manifest_version === "string" ? explain.manifest_version : null,
    };
}

function toSnapshot(value: unknown): HerdrSessionSnapshot {
    const snapshot = isRecord(value) && isRecord(value.snapshot) ? value.snapshot : null;
    if (!snapshot || !Array.isArray(snapshot.panes)) throw new HerdrError("protocol_error", "session.snapshot 的响应缺少 snapshot.panes");
    const labels = new Map<string, string | null>();
    for (const workspace of Array.isArray(snapshot.workspaces) ? snapshot.workspaces : []) {
        if (isRecord(workspace) && typeof workspace.workspace_id === "string") labels.set(workspace.workspace_id, typeof workspace.label === "string" ? workspace.label : null);
    }
    const seq = new Map<string, number>();
    for (const agent of Array.isArray(snapshot.agents) ? snapshot.agents : []) {
        if (isRecord(agent) && typeof agent.pane_id === "string" && typeof agent.state_change_seq === "number") seq.set(agent.pane_id, agent.state_change_seq);
    }
    const panes: HerdrSnapshotPane[] = [];
    for (const raw of snapshot.panes) {
        const pane = toPane(raw);
        if (!pane || !isRecord(raw)) continue;
        const workspaceId = typeof raw.workspace_id === "string" ? raw.workspace_id : "";
        panes.push({...pane, workspaceId, workspaceLabel: labels.get(workspaceId) ?? null, tabId: typeof raw.tab_id === "string" ? raw.tab_id : "", stateChangeSeq: seq.get(pane.paneId) ?? null});
    }
    return {version: typeof snapshot.version === "string" ? snapshot.version : "unknown", panes};
}

let requestCounter = 0;

/**
 * 每次调用开一个连接，读到第一个换行为止并核对 `id`。单次调用超时 `callTimeoutMs`。
 * 下面三个选项都只给一次命令用完即弃的客户端（命令行）开；常驻的客户端（面板）不开，否则 herdr 一时不在就永远判为不可用、
 * 预算期过了就永远超时、pane 列表永远是旧的：
 * - `budgetMs`：整个客户端的总时限，从创建时算起，用完后的调用直接报 `timeout`（`status` 不能因为 herdr 卡住而等几十秒）；
 * - `memoizeAvailability`：`availability()` 只 ping 一次；
 * - `memoizePanes`：`listPanes()` 只取一次。
 */
export function createHerdrClient(options: {socketPath: string; allow: readonly string[]; callTimeoutMs?: number; budgetMs?: number; memoizeAvailability?: boolean; memoizePanes?: boolean}): HerdrClient {
    const {socketPath, allow} = options;
    let panesMemo: Promise<HerdrPane[]> | null = null;
    const callTimeout = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const deadline = options.budgetMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.budgetMs;
    let available: Promise<HerdrAvailability> | null = null;

    /** `timeoutMs`：单次调用的时限，缺省是客户端的；`agent.prompt` 要等 herdr 的 `wait`，单独给（t11 设计审查 S1）。 */
    function call(method: string, params: Record<string, unknown>, timeoutMs = callTimeout): Promise<unknown> {
        if (!allow.includes(method)) return Promise.reject(new HerdrError("method_not_allowed", `herdr 方法不在白名单里：${method}`));
        const remaining = deadline - Date.now();
        if (remaining <= 0) return Promise.reject(new HerdrError("client_timeout", `herdr 调用超过总时限：${method}`));
        const id = `nbdev:${process.pid}:${++requestCounter}`;
        return new Promise((resolvePromise, rejectPromise) => {
            const socket = createConnection(socketPath);
            let buffer = "";
            let settled = false;
            const finish = (outcome: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                socket.destroy();
                outcome();
            };
            // 本地的时限用 `client_timeout`，与 herdr 自己回的 `timeout`（等待到点）区分开。
            const timer = setTimeout(() => finish(() => rejectPromise(new HerdrError("client_timeout", `herdr 调用超时：${method}`))), Math.min(timeoutMs, remaining));
            socket.setEncoding("utf8");
            socket.on("connect", () => socket.write(`${JSON.stringify({id, method, params})}\n`));
            socket.on("data", (chunk: string) => {
                buffer += chunk;
                const newline = buffer.indexOf("\n");
                if (newline < 0) return;
                const line = buffer.slice(0, newline);
                finish(() => {
                    let response: unknown;
                    try {
                        response = JSON.parse(line);
                    } catch (error) {
                        rejectPromise(new HerdrError("protocol_error", `herdr 的响应不是合法 JSON：${method}`, {cause: error}));
                        return;
                    }
                    if (!isRecord(response) || response.id !== id) {
                        rejectPromise(new HerdrError("protocol_error", `herdr 的响应 id 对不上：${method}`));
                    } else if (isRecord(response.error)) {
                        rejectPromise(new HerdrError(typeof response.error.code === "string" ? response.error.code : "unknown_error", typeof response.error.message === "string" ? response.error.message : method));
                    } else if (!("result" in response)) {
                        rejectPromise(new HerdrError("protocol_error", `herdr 的响应缺少 result：${method}`));
                    } else {
                        resolvePromise(response.result);
                    }
                });
            });
            socket.on("error", (error) => finish(() => {
                const code = systemErrorCode(error);
                rejectPromise(new HerdrError(code === "ENOENT" || code === "ECONNREFUSED" ? "server_not_running" : "connect_failed", `连不上 herdr（${socketPath}）：${error.message}`, {cause: error}));
            }));
            socket.on("close", () => finish(() => rejectPromise(new HerdrError("protocol_error", `herdr 没有回应就关闭了连接：${method}`))));
        });
    }

    return {
        socketPath,
        availability() {
            const ping = () => call("ping", {}).then(
                (result): HerdrAvailability => ({ok: true, version: isRecord(result) && typeof result.version === "string" ? result.version : "unknown", socketPath}),
                (error: unknown): HerdrAvailability => ({
                    ok: false,
                    reason: error instanceof HerdrError ? error.code : "connect_failed",
                    socketPath,
                    detail: error instanceof Error ? error.message : String(error),
                }),
            );
            if (!options.memoizeAvailability) return ping();
            available ??= ping();
            return available;
        },
        listPanes() {
            const fetchPanes = async () => {
                const result = await call("pane.list", {});
                const panes = isRecord(result) && Array.isArray(result.panes) ? result.panes : null;
                if (!panes) throw new HerdrError("protocol_error", "pane.list 的响应缺少 panes");
                return panes.map(toPane).filter((pane): pane is HerdrPane => pane !== null);
            };
            // 只读命令一次调用里多处要 pane 列表（认调用者、汇总会话），herdr 的单次调用常要多等约 100 毫秒（见 docs/herdr.md）。
            if (!options.memoizePanes) return fetchPanes();
            panesMemo ??= fetchPanes();
            return panesMemo;
        },
        async processInfo(paneId) {
            try {
                const result = await call("pane.process_info", {pane_id: paneId});
                const info = isRecord(result) && isRecord(result.process_info) ? result.process_info : null;
                if (!info) throw new HerdrError("protocol_error", "pane.process_info 的响应缺少 process_info");
                const processes = Array.isArray(info.foreground_processes) ? info.foreground_processes : [];
                return {
                    paneId,
                    shellPid: typeof info.shell_pid === "number" ? info.shell_pid : null,
                    foregroundGroupId: typeof info.foreground_process_group_id === "number" ? info.foreground_process_group_id : null,
                    foregroundPids: processes.flatMap((entry) => isRecord(entry) && typeof entry.pid === "number" ? [entry.pid] : []),
                };
            } catch (error) {
                if (error instanceof HerdrError && error.code === "pane_not_found") return null;
                throw error;
            }
        },
        async reportTaskTokens(paneId, tokens) {
            await call("pane.report_metadata", {pane_id: paneId, source: TAG_SOURCE, tokens: {work: tokens.work, task: tokens.task}, ttl_ms: TAG_TTL_MS});
        },
        async clearTaskTokens(paneId) {
            await call("pane.report_metadata", {pane_id: paneId, source: TAG_SOURCE, tokens: {work: null, task: null}, ttl_ms: TAG_TTL_MS});
        },
        async snapshot() {
            return toSnapshot(await call("session.snapshot", {}));
        },
        async agentGet(target) {
            try {
                const result = await call("agent.get", {target});
                const info = toAgentInfo(isRecord(result) ? result.agent : null);
                if (!info) throw new HerdrError("protocol_error", "agent.get 的响应缺少 agent");
                return info;
            } catch (error) {
                if (error instanceof HerdrError && (error.code === "agent_not_found" || error.code === "pane_not_found")) return null;
                throw error;
            }
        },
        async agentExplain(target) {
            return toExplain(await call("agent.explain", {target}));
        },
        async agentRead(target, source, format = "text", lines) {
            const result = await call("agent.read", {target, source, format, strip_ansi: format === "text", ...(lines === undefined ? {} : {lines})});
            const read = isRecord(result) && isRecord(result.read) ? result.read : null;
            if (!read || typeof read.text !== "string") throw new HerdrError("protocol_error", "agent.read 的响应缺少 read.text");
            return read.text;
        },
        async agentPrompt(target, text, wait) {
            const result = await call("agent.prompt", {target, text, wait: {until: wait.until, timeout_ms: wait.timeoutMs}}, wait.timeoutMs + 2_000);
            const info = toAgentInfo(isRecord(result) ? result.agent : null);
            return {type: isRecord(result) && typeof result.type === "string" ? result.type : "unknown", agent: info};
        },
        async agentSendKeys(target, keys) {
            await call("agent.send_keys", {target, keys: [...keys]});
        },
        subscribe(subscriptions, onEvent, onMalformed) {
            return openSubscription(socketPath, allow, callTimeout, subscriptions, onEvent, onMalformed ?? (() => undefined));
        },
    };
}

/**
 * 订阅连接：先发 `events.subscribe`，第一行是 `{id, result: {type: "subscription_started"}}`（或 `{id, error}`），之后每行一个 `{event, data}`。
 * 开始之后读不懂的行交给 `onMalformed` 后跳过（不让一行坏数据断掉整条订阅）；连接断开时 `closed` 兑现，由调用方重连并对账。
 */
function openSubscription(socketPath: string, allow: readonly string[], callTimeout: number, subscriptions: ReadonlyArray<Record<string, unknown>>, onEvent: (event: HerdrEvent) => void, onMalformed: (line: string) => void): HerdrSubscription {
    let resolveReady!: () => void;
    let rejectReady!: (error: HerdrError) => void;
    const ready = new Promise<void>((resolvePromise, rejectPromise) => {
        resolveReady = resolvePromise;
        rejectReady = rejectPromise;
    });
    // 没人等 ready 时（例如调用方只看 closed），拒绝不能变成未处理的拒绝。
    ready.catch(() => undefined);
    let resolveClosed!: (value: {reason: string}) => void;
    const closed = new Promise<{reason: string}>((resolvePromise) => {
        resolveClosed = resolvePromise;
    });
    if (!allow.includes("events.subscribe")) {
        rejectReady(new HerdrError("method_not_allowed", "herdr 方法不在白名单里：events.subscribe"));
        resolveClosed({reason: "method_not_allowed"});
        return {ready, closed, close() {}};
    }
    const id = `nbdev:${process.pid}:${++requestCounter}`;
    const socket = createConnection(socketPath);
    let started = false;
    let ended = false;
    let buffer = "";
    const end = (reason: string, error?: HerdrError) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        socket.destroy();
        if (!started) rejectReady(error ?? new HerdrError("protocol_error", `订阅没有开始就断开了：${reason}`));
        resolveClosed({reason});
    };
    const timer = setTimeout(() => {
        if (!started) end("timeout", new HerdrError("timeout", "herdr 订阅超时：没有收到 subscription_started"));
    }, callTimeout);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({id, method: "events.subscribe", params: {subscriptions}})}\n`));
    socket.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0 && !ended) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            let message: unknown;
            try {
                message = JSON.parse(line);
            } catch {
                if (!started) end("protocol_error", new HerdrError("protocol_error", "herdr 订阅的回应不是合法 JSON"));
                else onMalformed(line);
                continue;
            }
            if (!started) {
                if (isRecord(message) && message.id === id && isRecord(message.error)) {
                    end("rejected", new HerdrError(typeof message.error.code === "string" ? message.error.code : "unknown_error", typeof message.error.message === "string" ? message.error.message : "events.subscribe 被拒"));
                } else if (isRecord(message) && message.id === id && isRecord(message.result) && message.result.type === "subscription_started") {
                    started = true;
                    clearTimeout(timer);
                    resolveReady();
                } else {
                    end("protocol_error", new HerdrError("protocol_error", "herdr 订阅的第一行不是 subscription_started"));
                }
                continue;
            }
            if (isRecord(message) && typeof message.event === "string" && isRecord(message.data)) onEvent({event: message.event, data: message.data});
            else onMalformed(line);
        }
    });
    socket.on("error", (error) => {
        const code = systemErrorCode(error);
        end("error", new HerdrError(code === "ENOENT" || code === "ECONNREFUSED" ? "server_not_running" : "connect_failed", `连不上 herdr（${socketPath}）：${error.message}`, {cause: error}));
    });
    socket.on("close", () => end("closed"));
    return {ready, closed, close: () => end("closed_by_client")};
}
