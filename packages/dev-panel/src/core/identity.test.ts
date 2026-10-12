import {afterEach, describe, expect, test} from "bun:test";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {claudePane, shellPane, startFakeHerdr, type FakeHerdr} from "../../tests/fake-herdr.js";
import "../../tests/git-fixture.js";
import {spawnMarked, startFakeClaude, stopProcess, type FakeClaude, type MarkedChild} from "../../tests/processes.js";
import {createHerdrClient, HERDR_CLI_METHODS} from "../herdr/client.js";
import {resolveCaller, type SessionRef} from "./identity.js";
import {processStartTicks} from "./procfs.js";
import {readFile} from "node:fs/promises";
import {setTimeout as sleep} from "node:timers/promises";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fakeHerdr(panes: Parameters<typeof startFakeHerdr>[1]): Promise<FakeHerdr> {
    const root = await createTestTmpRoot("dev-panel-identity", "dev-panel identity fake herdr");
    const fake = await startFakeHerdr(root, panes);
    cleanups.push(async () => {
        await fake.close();
        await rm(root, {recursive: true, force: true});
    });
    return fake;
}

/** 一个不存在的 socket 路径（放在本测试自己的临时根里，用完删掉）。 */
async function missingSocket(): Promise<string> {
    const root = await createTestTmpRoot("dev-panel-no-herdr", "dev-panel no herdr");
    cleanups.push(() => rm(root, {recursive: true, force: true}));
    return join(root, "missing.sock");
}

async function sleeper(env: Record<string, string> = {}): Promise<MarkedChild> {
    const child = await spawnMarked("sleep", ["30"], {env});
    cleanups.push(() => stopProcess(child));
    return child;
}

const client = (socketPath: string, callTimeoutMs?: number) => createHerdrClient({socketPath, allow: HERDR_CLI_METHODS, callTimeoutMs});

async function claudeHost(sessionId: string): Promise<FakeClaude> {
    const host = await startFakeClaude(sessionId);
    cleanups.push(() => host.stop());
    return host;
}

/** 在 Claude 进程下起一个子进程，当作调用 nbdev 的进程（`selfPid`）：nbdev 要求环境里的 `CLAUDE_PID` 是它的祖先。 */
async function toolUnder(host: FakeClaude): Promise<number> {
    return host.spawn("sleep", ["30"]);
}

/** `sh -c 'sleep … & wait'` 这类进程的第一个子进程（就绪之前轮询）。 */
async function firstChild(pid: number): Promise<number> {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
        const children = (await readFile(`/proc/${pid}/task/${pid}/children`, "utf8").catch(() => "")).trim();
        if (children !== "") return Number(children.split(" ")[0]);
        await sleep(5);
    }
    throw new Error(`进程 ${pid} 一直没有子进程`);
}

const ref = (fields: Pick<SessionRef, "key" | "agent" | "sessionId"> & Partial<SessionRef>): SessionRef => ({label: null, parentSessionId: null, nestedSessionId: null, ...fields});

describe("认出调用者", () => {
    test("--as 优先于环境变量，认成外部会话", async () => {
        const {caller} = await resolveCaller({env: {CLAUDE_CODE_SESSION_ID: randomUUID(), CLAUDE_PID: "1"}, as: "review-bot", herdr: null});
        expect(caller).toEqual({kind: "session", ref: ref({key: "external:review-bot", agent: "external", sessionId: null, label: "review-bot"}), via: "as", process: null, herdr: null});
        await expect(resolveCaller({env: {}, as: "带空格 的标签", herdr: null})).rejects.toMatchObject({code: "usage"});
    });

    test("Claude 会话、它的子代理与它派出的 omp -p 都认成同一个会话；进程记 CLAUDE_PID 与启动时刻", async () => {
        const sessionId = randomUUID();
        const host = await claudeHost(sessionId);
        const selfPid = await toolUnder(host);
        const base = {CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(host.pid)};
        const keys = [];
        for (const env of [base, {...base, CLAUDE_CODE_CHILD_SESSION: "1"}, {...base, OMPCODE: "1", CLAUDECODE: "1"}]) {
            const {caller} = await resolveCaller({env, herdr: null, selfPid});
            if (caller.kind !== "session") throw new Error("应认出会话");
            keys.push(caller.ref.key);
            expect(caller.process).toEqual({pid: host.pid, startTicks: host.startTicks});
        }
        expect(new Set(keys)).toEqual(new Set([`claude:${sessionId}`]));
    });

    test("Claude 环境变量不可信时忽略并警告：缺 CLAUDE_PID、进程已不在、id 不是 UUID", async () => {
        const dead = spawn("true");
        await once(dead, "exit");
        for (const env of [
            {CLAUDE_CODE_SESSION_ID: randomUUID()},
            {CLAUDE_CODE_SESSION_ID: randomUUID(), CLAUDE_PID: String(dead.pid)},
            {CLAUDE_CODE_SESSION_ID: "not-a-uuid", CLAUDE_PID: "1"},
        ]) {
            const {caller, warnings} = await resolveCaller({env, herdr: null});
            expect(caller).toEqual({kind: "unknown", reason: "no_identity", herdrPaneId: null});
            expect(warnings.map((warning) => [warning.code, warning.details?.reason])).toEqual([["claude_env_untrusted", "invalid"]]);
        }
    });

    test("CLAUDE_PID 活着、但不是调用者的祖先（变量从别处继承来）：不信，给 not_ancestor", async () => {
        const host = await claudeHost(randomUUID());
        const {caller, warnings} = await resolveCaller({env: {CLAUDE_CODE_SESSION_ID: host.sessionId, CLAUDE_PID: String(host.pid)}, herdr: null, selfPid: process.pid});
        expect(caller).toEqual({kind: "unknown", reason: "no_identity", herdrPaneId: null});
        expect(warnings.map((warning) => [warning.code, warning.details?.reason])).toEqual([["claude_env_untrusted", "not_ancestor"]]);
    });

    test("嵌套的 claude -p 归到外层会话，记外层 id、内层 id 与外层进程；外层不是内层的祖先时不算嵌套", async () => {
        const outer = randomUUID();
        const inner = randomUUID();
        const outerHost = await claudeHost(outer);
        // 外层会话派出的“内层 claude”：环境里带着外层的会话 id 与 CLAUDE_PID（由 outerHost 加上）。
        const nested = await outerHost.spawn("sh", ["-c", "sleep 30 & wait"]);
        const {caller} = await resolveCaller({env: {CLAUDE_CODE_SESSION_ID: inner, CLAUDE_PID: String(nested)}, herdr: null, selfPid: await firstChild(nested)});
        expect(caller).toMatchObject({kind: "session", ref: {key: `claude:${outer}`, sessionId: outer, parentSessionId: outer, nestedSessionId: inner}, process: {pid: outerHost.pid, startTicks: outerHost.startTicks}});

        // 环境里同样带着外层的 id 与 CLAUDE_PID，但不是外层派出的（父进程链上没有外层）：按内层自己的会话认。
        const unrelated = await spawnMarked("sh", ["-c", "sleep 30 & wait"], {env: {CLAUDE_CODE_SESSION_ID: outer, CLAUDE_PID: String(outerHost.pid)}});
        cleanups.push(() => stopProcess(unrelated));
        const alone = await resolveCaller({env: {CLAUDE_CODE_SESSION_ID: inner, CLAUDE_PID: String(unrelated.pid)}, herdr: null, selfPid: await firstChild(unrelated.pid)});
        expect(alone.caller).toMatchObject({kind: "session", ref: {key: `claude:${inner}`, parentSessionId: null, nestedSessionId: null}, process: {pid: unrelated.pid}});
    });

    test("herdr 里的 Claude 会话记下 pane；列表里找不到这个会话时 managed 为 false", async () => {
        const sessionId = randomUUID();
        const host = await claudeHost(sessionId);
        const selfPid = await toolUnder(host);
        const fake = await fakeHerdr([claudePane("w9:p1", sessionId), claudePane("w9:p2", randomUUID())]);
        const env = {CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(host.pid)};
        const managed = await resolveCaller({env: {...env, HERDR_PANE_ID: "w9:p2"}, herdr: client(fake.socketPath), selfPid});
        expect(managed.caller).toMatchObject({herdr: {socketPath: fake.socketPath, paneId: "w9:p1", terminalId: "term_w9:p1", managed: true}});
        fake.panes.splice(0, 1);
        const unmanaged = await resolveCaller({env: {...env, HERDR_PANE_ID: "w9:p2"}, herdr: client(fake.socketPath), selfPid});
        expect(unmanaged.caller).toMatchObject({kind: "session", ref: {key: `claude:${sessionId}`}, herdr: {paneId: "w9:p2", managed: false}});
    });

    test("有 HERDR_PANE_ID 时 ping 与 pane.list 同时发出", async () => {
        const sessionId = randomUUID();
        const host = await claudeHost(sessionId);
        const selfPid = await toolUnder(host);
        const fake = await fakeHerdr([claudePane("w9:p1", sessionId)]);
        fake.overrides.ping = "hang";
        const resolving = resolveCaller({env: {CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(host.pid), HERDR_PANE_ID: "w9:p1"}, herdr: client(fake.socketPath, 300), selfPid});
        // ping 挂着没有回应时，pane.list 已经发到了 herdr。
        for (let attempt = 0; attempt < 200 && !fake.requests.some((request) => request.method === "pane.list"); attempt += 1) await sleep(5);
        expect(fake.requests.map((request) => request.method).sort()).toEqual(["pane.list", "ping"]);
        expect((await resolving).warnings.map((warning) => warning.code)).toEqual(["herdr_unavailable"]);
    });

    test("只有 HERDR_PANE_ID：用 pane 上的 Agent 会话认人，进程记前台主进程；普通 shell pane、不存在的 pane、herdr 不可用时为未知", async () => {
        const omp = await sleeper();
        const fake = await fakeHerdr([
            {pane_id: "w9:p3", terminal_id: "term_3", agent: "omp", agent_status: "working", agent_session: {agent: "omp", kind: "path", source: "herdr:omp", value: "/home/x/.omp/s.jsonl"}, foreground_pids: [omp.pid]},
            shellPane("w9:p4"),
        ]);
        const {caller} = await resolveCaller({env: {HERDR_PANE_ID: "w9:p3", OMPCODE: "1"}, herdr: client(fake.socketPath)});
        expect(caller).toEqual({
            kind: "session",
            ref: ref({key: "omp:/home/x/.omp/s.jsonl", agent: "omp", sessionId: "/home/x/.omp/s.jsonl"}),
            via: "herdr-pane",
            process: {pid: omp.pid, startTicks: (await processStartTicks(omp.pid))!},
            herdr: {socketPath: fake.socketPath, paneId: "w9:p3", terminalId: "term_3", status: "working", managed: true},
        });
        expect((await resolveCaller({env: {HERDR_PANE_ID: "w9:p4"}, herdr: client(fake.socketPath)})).caller).toEqual({kind: "unknown", reason: "pane_without_agent", herdrPaneId: "w9:p4"});
        expect((await resolveCaller({env: {HERDR_PANE_ID: "w9:gone"}, herdr: client(fake.socketPath)})).caller).toEqual({kind: "unknown", reason: "no_identity", herdrPaneId: "w9:gone"});
        const offline = await resolveCaller({env: {HERDR_PANE_ID: "w9:p3"}, herdr: client(await missingSocket())});
        expect(offline.caller).toEqual({kind: "unknown", reason: "herdr_unavailable", herdrPaneId: "w9:p3"});
        expect(offline.warnings.map((warning) => warning.code)).toEqual(["herdr_unavailable"]);
    });

    test("只有 HERDR_PANE_ID、pane.process_info 不回应：身份仍按 pane 认，进程记 null，给 herdr_partial", async () => {
        const fake = await fakeHerdr([{pane_id: "w9:p3", terminal_id: "term_3", agent: "omp", agent_status: "working", agent_session: {agent: "omp", kind: "path", source: "herdr:omp", value: "/o.jsonl"}}]);
        fake.overrides["pane.process_info"] = "hang";
        const {caller, warnings} = await resolveCaller({env: {HERDR_PANE_ID: "w9:p3", OMPCODE: "1"}, herdr: client(fake.socketPath, 200)});
        expect(caller).toMatchObject({kind: "session", ref: {key: "omp:/o.jsonl"}, via: "herdr-pane", process: null, herdr: {paneId: "w9:p3"}});
        expect(warnings.map((warning) => [warning.code, warning.details?.code])).toEqual([["herdr_partial", "timeout"]]);
    });
});
