import {rm} from "node:fs/promises";
import {createServer, type Server, type Socket} from "node:net";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

/** 假 herdr：Unix socket 上按 JSON 行回应，数据由测试给定，并记下收到的每个请求。 */
export type FakePane = {
    pane_id: string;
    terminal_id: string;
    agent: string | null;
    agent_status: string;
    agent_session: {agent: string; kind: string; source: string; value: string} | null;
    cwd?: string | null;
    foreground_cwd?: string | null;
    shell_pid?: number | null;
    foreground_pids?: number[];
    /** 快照里 Agent 的状态序号；缺省 0。 */
    state_change_seq?: number;
    focused?: boolean;
    /** `agent.explain` 的回应：命中的规则 id、退路、`live_prompt_box` 的区域预览（undefined 表示清单里没有这条规则）。 */
    explain?: {matched: string | null; fallback: string | null; preview?: string};
    /** `agent.read source=visible` 的屏幕（带 ANSI）。 */
    visible?: string;
    /** `agent.prompt` 时这格 pane 怎么反应：进入工作（缺省）、没反应（herdr 等到点回 `agent_prompt_stalled`）、
     * 回车前后弹出确认界面（回应里状态是旧的 working，之后变 blocked）、投递的瞬间换了会话。 */
    on_prompt?: "working" | "stall" | "blocked_after" | "switch_session";
};

/** 设计审查的假 TUI 画的 Claude 空输入框（`tests/fixtures/screens.json` 的 fake-idle-empty）。 */
export const EMPTY_CLAUDE_SCREEN = "● 上一轮的回复。\n\n────────────────────────────────────────────────────────────\n❯ \n────────────────────────────────────────────────────────────\n  ? for shortcuts\n";
export const HERDR_KEYS = new Set(["up", "down", "shift+tab", "enter", "esc", "ctrl+c", "y", "n"]);

export type FakeHerdr = {
    socketPath: string;
    panes: FakePane[];
    requests: Array<{method: string; params: Record<string, unknown>; at: number}>;
    /** 给了就在回 `subscription_started` 之后这么多毫秒断开订阅连接（模拟“连上就断”）。 */
    dropSubscriptionsAfterMs: number | null;
    /** 按方法改写回应：`hang` 不回应（模拟 herdr 卡住），`{code, message}` 回一个错误。 */
    overrides: Record<string, "hang" | {code: string; message: string}>;
    /** 当前开着的订阅连接数。 */
    subscriberCount(): number;
    /** 给每条订阅连接推一行事件（不按订阅类型过滤）。 */
    emit(event: string, data: Record<string, unknown>): void;
    /** 断开全部订阅连接（模拟 herdr 重启或连接中断）。 */
    dropSubscribers(): void;
    /** `agent.prompt` 收到的文字与 `agent.send_keys` 收到的键。 */
    prompts: Array<{target: string; text: string}>;
    keys: Array<{target: string; keys: string[]}>;
    close(): Promise<void>;
};

/** Unix socket 路径上限 107 字节：给定目录太深时，在测试临时根下另建一个名字短的目录放 socket，关闭时一起删掉。 */
async function socketPathFor(root: string): Promise<{socketPath: string; ownDir: string | null}> {
    const preferred = join(root, "herdr.sock");
    if (Buffer.byteLength(preferred) <= 100) return {socketPath: preferred, ownDir: null};
    const ownDir = await createTestTmpRoot("fh", "dev-panel fake herdr socket");
    return {socketPath: join(ownDir, "herdr.sock"), ownDir};
}

export async function startFakeHerdr(root: string, panes: FakePane[]): Promise<FakeHerdr> {
    const {socketPath, ownDir} = await socketPathFor(root);
    const requests: FakeHerdr["requests"] = [];
    const subscribers = new Set<Socket>();
    const fake: FakeHerdr = {
        socketPath,
        panes,
        requests,
        overrides: {},
        dropSubscriptionsAfterMs: null,
        prompts: [],
        keys: [],
        subscriberCount: () => subscribers.size,
        emit(event, data) {
            for (const socket of subscribers) socket.write(`${JSON.stringify({event, data})}\n`);
        },
        dropSubscribers() {
            for (const socket of subscribers) socket.destroy();
            subscribers.clear();
        },
        close: async () => {},
    };
    const sockets = new Set<Socket>();
    const server: Server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => {
            sockets.delete(socket);
            subscribers.delete(socket);
        });
        let buffer = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
            buffer += chunk;
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                const request = JSON.parse(line) as {id: string; method: string; params: Record<string, unknown>};
                requests.push({method: request.method, params: request.params, at: Date.now()});
                const override = fake.overrides[request.method];
                if (override === "hang") {
                    newline = buffer.indexOf("\n");
                    continue;
                }
                if (request.method === "events.subscribe" && !override) {
                    subscribers.add(socket);
                    if (fake.dropSubscriptionsAfterMs !== null) setTimeout(() => socket.destroy(), fake.dropSubscriptionsAfterMs);
                }
                const reply = override ? {id: request.id, error: override} : respond(fake, request);
                if (reply instanceof Promise) void reply.then((value) => socket.write(`${JSON.stringify(value)}\n`));
                else socket.write(`${JSON.stringify(reply)}\n`);
                newline = buffer.indexOf("\n");
            }
        });
    });
    await new Promise<void>((resolvePromise) => server.listen(socketPath, resolvePromise));
    fake.close = async () => {
        // 挂起的连接（`hang`）不会自己结束，server.close 会一直等它们。
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
        await rm(socketPath, {force: true});
        if (ownDir) await rm(ownDir, {recursive: true, force: true});
    };
    return fake;
}

function respond(fake: FakeHerdr, request: {id: string; method: string; params: Record<string, unknown>}): unknown | Promise<unknown> {
    const {id, method, params} = request;
    const paneById = (paneId: unknown) => fake.panes.find((pane) => pane.pane_id === paneId);
    switch (method) {
    case "ping":
        return {id, result: {type: "pong", version: "fake", protocol: 22}};
    case "pane.list":
        return {id, result: {type: "pane_list", panes: fake.panes.map(({shell_pid: _shell, foreground_pids: _fg, state_change_seq: _seq, explain: _explain, visible: _visible, on_prompt: _prompt, ...pane}) => pane)}};
    case "session.snapshot":
        return {id, result: {type: "session_snapshot", snapshot: {
            version: "fake",
            protocol: 22,
            workspaces: [{workspace_id: "w9", number: 9, label: "fake"}],
            tabs: [],
            panes: fake.panes.map(({shell_pid: _shell, foreground_pids: _fg, state_change_seq: _seq, explain: _explain, visible: _visible, on_prompt: _prompt, ...pane}) => ({workspace_id: "w9", tab_id: "w9:t0", ...pane})),
            layouts: [],
            agents: fake.panes.filter((pane) => pane.agent !== null).map((pane) => ({pane_id: pane.pane_id, agent: pane.agent, agent_status: pane.agent_status, state_change_seq: pane.state_change_seq ?? 0})),
        }}};
    case "events.subscribe":
        return {id, result: {type: "subscription_started"}};
    case "pane.process_info": {
        const pane = paneById(params.pane_id);
        if (!pane) return {id, error: {code: "pane_not_found", message: `pane ${String(params.pane_id)} not found`}};
        const pids = pane.foreground_pids ?? [];
        return {id, result: {type: "pane_process_info", process_info: {
            pane_id: pane.pane_id,
            shell_pid: pane.shell_pid ?? null,
            foreground_process_group_id: pids[0] ?? null,
            foreground_processes: pids.map((pid) => ({pid, name: "fake", argv: [], cmdline: "fake", cwd: "/"})),
        }}};
    }
    case "pane.report_metadata":
        return paneById(params.pane_id) ? {id, result: {type: "ok"}} : {id, error: {code: "pane_not_found", message: "pane not found"}};
    case "agent.get": {
        const pane = paneById(params.target);
        if (!pane?.agent) return {id, error: {code: "agent_not_found", message: "agent not found"}};
        return {id, result: {type: "agent_info", agent: agentInfo(pane)}};
    }
    case "agent.explain": {
        const pane = paneById(params.target);
        if (!pane?.agent) return {id, error: {code: "agent_not_found", message: "agent not found"}};
        const explain = pane.explain ?? {matched: "live_prompt_box", fallback: null, preview: "❯\n"};
        return {id, result: {type: "agent_explain", explain: {
            agent: pane.agent, state: pane.agent_status, matched_rule: explain.matched ? {id: explain.matched, priority: 950, region: "prompt_box_body", state: "idle"} : null,
            fallback_reason: explain.fallback, screen_detection_skipped: pane.agent === "omp", manifest_version: pane.agent === "omp" ? null : "fake",
            evaluated_rules: explain.preview === undefined ? [] : [{id: "live_prompt_box", matched: explain.matched === "live_prompt_box", evidence: {region_preview: explain.preview}}],
        }}};
    }
    case "agent.read": {
        const pane = paneById(params.target);
        if (!pane?.agent) return {id, error: {code: "agent_not_found", message: "agent not found"}};
        return {id, result: {type: "pane_read", read: {pane_id: pane.pane_id, source: params.source, format: params.format, text: pane.visible ?? EMPTY_CLAUDE_SCREEN, truncated: false}}};
    }
    case "agent.send_keys": {
        const pane = paneById(params.target);
        if (!pane?.agent) return {id, error: {code: "agent_not_found", message: "agent not found"}};
        const keys = Array.isArray(params.keys) ? params.keys.map(String) : [];
        if (keys.some((key) => !HERDR_KEYS.has(key))) return {id, error: {code: "invalid_key", message: "invalid key"}};
        fake.keys.push({target: pane.pane_id, keys});
        return {id, result: {type: "ok"}};
    }
    case "agent.prompt": {
        const pane = paneById(params.target);
        if (!pane?.agent) return {id, error: {code: "agent_not_found", message: "agent not found"}};
        if (pane.agent_status === "blocked") return {id, error: {code: "agent_blocked", message: "agent is blocked"}};
        fake.prompts.push({target: pane.pane_id, text: String(params.text)});
        const behavior = pane.on_prompt ?? "working";
        if (behavior === "stall") return new Promise((done) => setTimeout(() => done({id, error: {code: "agent_prompt_stalled", message: "stalled"}}), 50));
        const seq = (pane.state_change_seq ?? 0) + 1;
        if (behavior === "blocked_after") {
            const stale = agentInfo({...pane, agent_status: "working"});
            pane.agent_status = "blocked";
            pane.state_change_seq = seq + 1;
            return {id, result: {type: "agent_prompted", agent: stale}};
        }
        if (behavior === "switch_session" && pane.agent_session) pane.agent_session = {...pane.agent_session, value: `${pane.agent_session.value}-new`};
        pane.agent_status = "working";
        pane.state_change_seq = seq;
        return {id, result: {type: "agent_prompted", agent: agentInfo(pane)}};
    }
    default:
        return {id, error: {code: "unknown_method", message: method}};
    }
}

function agentInfo(pane: FakePane): Record<string, unknown> {
    const {shell_pid: _shell, foreground_pids: _fg, explain: _explain, visible: _visible, on_prompt: _prompt, ...rest} = pane;
    return {...rest, focused: pane.focused ?? false, state_change_seq: pane.state_change_seq ?? 0};
}

/** 一格扮成 Claude 会话的 pane。 */
export function claudePane(paneId: string, sessionId: string, extra: Partial<FakePane> = {}): FakePane {
    return {
        pane_id: paneId,
        terminal_id: `term_${paneId}`,
        agent: "claude",
        agent_status: "idle",
        agent_session: {agent: "claude", kind: "id", source: "herdr:claude", value: sessionId},
        ...extra,
    };
}

/** 一格普通 shell pane（没有 Agent）。 */
export function shellPane(paneId: string, extra: Partial<FakePane> = {}): FakePane {
    return {pane_id: paneId, terminal_id: `term_${paneId}`, agent: null, agent_status: "unknown", agent_session: null, ...extra};
}
