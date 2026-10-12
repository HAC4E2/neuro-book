import {afterEach, describe, expect, test} from "bun:test";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {claudePane, shellPane, startFakeHerdr, type FakeHerdr} from "../../tests/fake-herdr.js";
import "../../tests/git-fixture.js";
import {spawnMarked, stopProcess, type MarkedChild} from "../../tests/processes.js";
import {createHerdrClient, HERDR_CLI_METHODS} from "../herdr/client.js";
import {resolveCaller} from "./identity.js";
import {processStartTicks} from "./procfs.js";

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

const client = (socketPath: string) => createHerdrClient({socketPath, allow: HERDR_CLI_METHODS});

/**
 * 扮成 Claude 主进程的子进程，环境是干净的。不能用测试进程自己：它若是从真实的 Claude 会话里跑起来的，
 * `/proc/<pid>/environ` 里带着那个会话的 id，会被当成嵌套调用归到真实会话上。
 */
async function claudeProcess(env: Record<string, string> = {}): Promise<{pid: number; startTicks: string}> {
    const child = await sleeper(env);
    return {pid: child.pid, startTicks: (await processStartTicks(child.pid))!};
}

describe("认出调用者", () => {
    test("--as 优先于环境变量，认成外部会话", async () => {
        const {caller} = await resolveCaller({env: {CLAUDE_CODE_SESSION_ID: randomUUID(), CLAUDE_PID: "1"}, as: "review-bot", herdr: null});
        expect(caller).toEqual({kind: "session", ref: {key: "external:review-bot", agent: "external", sessionId: null, label: "review-bot", parentSessionId: null}, via: "as", process: null, herdr: null});
        await expect(resolveCaller({env: {}, as: "带空格 的标签", herdr: null})).rejects.toMatchObject({code: "usage"});
    });

    test("Claude 会话、它的子代理与它派出的 omp -p 都认成同一个会话；进程记 CLAUDE_PID 与启动时刻", async () => {
        const sessionId = randomUUID();
        const claude = await claudeProcess();
        const base = {CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(claude.pid)};
        const keys = [];
        for (const env of [base, {...base, CLAUDE_CODE_CHILD_SESSION: "1"}, {...base, OMPCODE: "1", CLAUDECODE: "1"}]) {
            const {caller} = await resolveCaller({env, herdr: null});
            if (caller.kind !== "session") throw new Error("应认出会话");
            keys.push(caller.ref.key);
            expect(caller.process).toEqual(claude);
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
            expect(warnings.map((warning) => warning.code)).toEqual(["claude_env_untrusted"]);
        }
    });

    test("嵌套的 claude -p 归到外层会话，记 parentSessionId 与外层进程", async () => {
        const outer = randomUUID();
        const inner = randomUUID();
        const outerClaude = await claudeProcess();
        const nested = await claudeProcess({CLAUDE_CODE_SESSION_ID: outer, CLAUDE_PID: String(outerClaude.pid)});
        const {caller} = await resolveCaller({env: {CLAUDE_CODE_SESSION_ID: inner, CLAUDE_PID: String(nested.pid)}, herdr: null});
        expect(caller).toMatchObject({kind: "session", ref: {key: `claude:${outer}`, sessionId: outer, parentSessionId: outer}, process: outerClaude});
    });

    test("herdr 里的 Claude 会话记下 pane；列表里找不到这个会话时 managed 为 false", async () => {
        const sessionId = randomUUID();
        const claude = await claudeProcess();
        const fake = await fakeHerdr([claudePane("w9:p1", sessionId), claudePane("w9:p2", randomUUID())]);
        const env = {CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(claude.pid)};
        const managed = await resolveCaller({env: {...env, HERDR_PANE_ID: "w9:p2"}, herdr: client(fake.socketPath)});
        expect(managed.caller).toMatchObject({herdr: {socketPath: fake.socketPath, paneId: "w9:p1", terminalId: "term_w9:p1", managed: true}});
        fake.panes.splice(0, 1);
        const unmanaged = await resolveCaller({env: {...env, HERDR_PANE_ID: "w9:p2"}, herdr: client(fake.socketPath)});
        expect(unmanaged.caller).toMatchObject({kind: "session", ref: {key: `claude:${sessionId}`}, herdr: {paneId: "w9:p2", managed: false}});
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
            ref: {key: "omp:/home/x/.omp/s.jsonl", agent: "omp", sessionId: "/home/x/.omp/s.jsonl", label: null, parentSessionId: null},
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
});
