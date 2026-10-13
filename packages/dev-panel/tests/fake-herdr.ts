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
};

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
                socket.write(`${JSON.stringify(override ? {id: request.id, error: override} : respond(fake, request))}\n`);
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

function respond(fake: FakeHerdr, request: {id: string; method: string; params: Record<string, unknown>}): unknown {
    const {id, method, params} = request;
    const paneById = (paneId: unknown) => fake.panes.find((pane) => pane.pane_id === paneId);
    switch (method) {
    case "ping":
        return {id, result: {type: "pong", version: "fake", protocol: 22}};
    case "pane.list":
        return {id, result: {type: "pane_list", panes: fake.panes.map(({shell_pid: _shell, foreground_pids: _fg, state_change_seq: _seq, ...pane}) => pane)}};
    case "session.snapshot":
        return {id, result: {type: "session_snapshot", snapshot: {
            version: "fake",
            protocol: 22,
            workspaces: [{workspace_id: "w9", number: 9, label: "fake"}],
            tabs: [],
            panes: fake.panes.map(({shell_pid: _shell, foreground_pids: _fg, state_change_seq: _seq, ...pane}) => ({workspace_id: "w9", tab_id: "w9:t0", ...pane})),
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
    default:
        return {id, error: {code: "unknown_method", message: method}};
    }
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
