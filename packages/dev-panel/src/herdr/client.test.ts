import {afterEach, describe, expect, test} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {claudePane, startFakeHerdr} from "../../tests/fake-herdr.js";
import {createHerdrClient, HERDR_CLI_METHODS, HERDR_READ_METHODS, resolveHerdrSocket} from "./client.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fake() {
    const root = await mkdtemp(join(tmpdir(), "nbdev-hc-"));
    const herdr = await startFakeHerdr(root, [claudePane("w9:p1", "11111111-1111-4111-8111-111111111111", {shell_pid: 10, foreground_pids: [11, 12]})]);
    cleanups.push(async () => {
        await herdr.close();
        await rm(root, {recursive: true, force: true});
    });
    return herdr;
}

describe("herdr 客户端", () => {
    test("socket 位置的解析顺序", () => {
        expect(resolveHerdrSocket({HERDR_SOCKET_PATH: "/x.sock", HERDR_SESSION: "s"})).toBe("/x.sock");
        expect(resolveHerdrSocket({HERDR_SESSION: "nbdev-test"})).toMatch(/\.config\/herdr\/sessions\/nbdev-test\/herdr\.sock$/u);
        expect(resolveHerdrSocket({})).toMatch(/\.config\/herdr\/herdr\.sock$/u);
    });

    test("读 pane 列表、进程信息，写与清标签", async () => {
        const herdr = await fake();
        const client = createHerdrClient({socketPath: herdr.socketPath, allow: HERDR_CLI_METHODS});
        expect(await client.availability()).toEqual({ok: true, version: "fake", socketPath: herdr.socketPath});
        expect(await client.listPanes()).toEqual([{paneId: "w9:p1", terminalId: "term_w9:p1", agent: "claude", status: "idle", session: {agent: "claude", kind: "id", value: "11111111-1111-4111-8111-111111111111"}}]);
        expect(await client.processInfo("w9:p1")).toEqual({paneId: "w9:p1", shellPid: 10, foregroundGroupId: 11, foregroundPids: [11, 12]});
        expect(await client.processInfo("w9:missing")).toBeNull();
        expect(await client.getAgent("w9:missing")).toBeNull();
        await client.reportTaskTokens("w9:p1", {work: "w00022", task: "t07"});
        await client.clearTaskTokens("w9:p1");
        expect(herdr.requests.filter((request) => request.method === "pane.report_metadata").map((request) => request.params)).toEqual([
            {pane_id: "w9:p1", source: "nbdev", tokens: {work: "w00022", task: "t07"}, ttl_ms: 86_400_000},
            {pane_id: "w9:p1", source: "nbdev", tokens: {work: null, task: null}, ttl_ms: 86_400_000},
        ]);
    });

    test("白名单外的方法在客户端就拒绝，不发出去；只读清单里没有写标签", async () => {
        const herdr = await fake();
        const readOnly = createHerdrClient({socketPath: herdr.socketPath, allow: HERDR_READ_METHODS});
        await expect(readOnly.reportTaskTokens("w9:p1", {work: "w00022", task: "t07"})).rejects.toMatchObject({code: "method_not_allowed"});
        expect(herdr.requests).toEqual([]);
    });

    test("连不上为 server_not_running；总时限用完之后的调用直接超时", async () => {
        const offline = createHerdrClient({socketPath: join(tmpdir(), "nbdev-no-such-herdr.sock"), allow: HERDR_CLI_METHODS});
        expect(await offline.availability()).toMatchObject({ok: false, reason: "server_not_running"});
        const herdr = await fake();
        const exhausted = createHerdrClient({socketPath: herdr.socketPath, allow: HERDR_CLI_METHODS, budgetMs: 0});
        await expect(exhausted.listPanes()).rejects.toMatchObject({code: "timeout"});
        expect(herdr.requests).toEqual([]);
    });
});
