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
};

export type FakeHerdr = {
    socketPath: string;
    panes: FakePane[];
    requests: Array<{method: string; params: Record<string, unknown>}>;
    /** 按方法改写回应：`hang` 不回应（模拟 herdr 卡住），`{code, message}` 回一个错误。 */
    overrides: Record<string, "hang" | {code: string; message: string}>;
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
    const fake: FakeHerdr = {socketPath, panes, requests, overrides: {}, close: async () => {}};
    const sockets = new Set<Socket>();
    const server: Server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        let buffer = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
            buffer += chunk;
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                const request = JSON.parse(line) as {id: string; method: string; params: Record<string, unknown>};
                requests.push({method: request.method, params: request.params});
                const override = fake.overrides[request.method];
                if (override === "hang") {
                    newline = buffer.indexOf("\n");
                    continue;
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
        return {id, result: {type: "pane_list", panes: fake.panes.map(({shell_pid: _shell, foreground_pids: _fg, ...pane}) => pane)}};
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
