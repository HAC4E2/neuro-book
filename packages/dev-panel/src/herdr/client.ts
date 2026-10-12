import {createConnection} from "node:net";
import {homedir} from "node:os";
import {join} from "node:path";
import {systemErrorCode} from "../core/errors.js";

/**
 * herdr 的 socket 客户端：一行一个 JSON，请求 `{id, method, params}`，响应 `{id, result}` 或 `{id, error: {code, message}}`。
 * herdr 的 socket 没有鉴权，连上就能调全部方法（含 `server.stop`、`pane.run`），所以白名单由调用方显式传入，
 * 白名单外的方法在这里直接拒绝、不发出去。命令行用 `HERDR_CLI_METHODS`；`status` 用只读的 `HERDR_READ_METHODS`；
 * 面板的清单由 t11 按 Proposal 第八节第 7 条定（其中没有 `pane.report_metadata`：标签只由会话自己的命令行写）。
 */
export const HERDR_READ_METHODS: readonly string[] = ["ping", "agent.list", "agent.get", "pane.list", "pane.process_info"];
export const HERDR_CLI_METHODS: readonly string[] = [...HERDR_READ_METHODS, "pane.report_metadata"];

const TAG_SOURCE = "nbdev";
const TAG_TTL_MS = 86_400_000;
const DEFAULT_CALL_TIMEOUT_MS = 2_000;

export type HerdrStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type HerdrAgentSession = {agent: string; kind: string; value: string};
export type HerdrPane = {paneId: string; terminalId: string; agent: string | null; status: HerdrStatus; session: HerdrAgentSession | null};
export type HerdrProcessInfo = {paneId: string; shellPid: number | null; foregroundGroupId: number | null; foregroundPids: number[]};
export type HerdrAvailability = {ok: true; version: string; socketPath: string} | {ok: false; reason: string; socketPath: string; detail: string};

/** herdr 调用失败：`code` 是 herdr 的错误码（如 `agent_not_found`），或本客户端的 `server_not_running`、`timeout`、`protocol_error`、`method_not_allowed`。 */
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
    /** pane 上没有认得出的 Agent 时为 null。 */
    getAgent(target: string): Promise<HerdrPane | null>;
    /** pane 不存在时为 null。 */
    processInfo(paneId: string): Promise<HerdrProcessInfo | null>;
    reportTaskTokens(paneId: string, tokens: {work: string; task: string}): Promise<void>;
    clearTaskTokens(paneId: string): Promise<void>;
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
    };
}

let requestCounter = 0;

/**
 * 每次调用开一个连接，读到第一个换行为止并核对 `id`。单次调用超时 `callTimeoutMs`；
 * `budgetMs` 给整个客户端一个总时限，用完后的调用直接报 `timeout`（`status` 不能因为 herdr 卡住而等几十秒）。
 */
export function createHerdrClient(options: {socketPath: string; allow: readonly string[]; callTimeoutMs?: number; budgetMs?: number; memoizePanes?: boolean}): HerdrClient {
    const {socketPath, allow} = options;
    let panesMemo: Promise<HerdrPane[]> | null = null;
    const callTimeout = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const deadline = options.budgetMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.budgetMs;
    let available: Promise<HerdrAvailability> | null = null;

    function call(method: string, params: Record<string, unknown>): Promise<unknown> {
        if (!allow.includes(method)) return Promise.reject(new HerdrError("method_not_allowed", `herdr 方法不在白名单里：${method}`));
        const remaining = deadline - Date.now();
        if (remaining <= 0) return Promise.reject(new HerdrError("timeout", `herdr 调用超过总时限：${method}`));
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
            const timer = setTimeout(() => finish(() => rejectPromise(new HerdrError("timeout", `herdr 调用超时：${method}`))), Math.min(callTimeout, remaining));
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
            available ??= call("ping", {}).then(
                (result): HerdrAvailability => ({ok: true, version: isRecord(result) && typeof result.version === "string" ? result.version : "unknown", socketPath}),
                (error: unknown): HerdrAvailability => ({
                    ok: false,
                    reason: error instanceof HerdrError ? error.code : "connect_failed",
                    socketPath,
                    detail: error instanceof Error ? error.message : String(error),
                }),
            );
            return available;
        },
        listPanes() {
            const fetchPanes = async () => {
                const result = await call("pane.list", {});
                const panes = isRecord(result) && Array.isArray(result.panes) ? result.panes : null;
                if (!panes) throw new HerdrError("protocol_error", "pane.list 的响应缺少 panes");
                return panes.map(toPane).filter((pane): pane is HerdrPane => pane !== null);
            };
            // 只读命令一次调用里多处要 pane 列表（认调用者、汇总会话），herdr 的单次调用常要多等约 100 毫秒（见 docs/herdr.md），
            // 所以同一个客户端只取一次。只给一次命令用完即弃的客户端开；常驻的客户端（面板）每次要读最新的 pane。
            if (!options.memoizePanes) return fetchPanes();
            panesMemo ??= fetchPanes();
            return panesMemo;
        },
        async getAgent(target) {
            try {
                const result = await call("agent.get", {target});
                const pane = toPane(isRecord(result) ? result.agent : null);
                if (!pane) throw new HerdrError("protocol_error", "agent.get 的响应缺少 agent");
                return pane;
            } catch (error) {
                if (error instanceof HerdrError && error.code === "agent_not_found") return null;
                throw error;
            }
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
    };
}
