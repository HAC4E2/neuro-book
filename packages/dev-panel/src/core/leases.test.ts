import {afterEach, describe, expect, test} from "bun:test";
import {readdir, readFile, rm, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import "../../tests/git-fixture.js";
import {spawnMarked, stopProcess, type MarkedChild} from "../../tests/processes.js";
import type {SessionCaller} from "./identity.js";
import {evaluateLeases, getLease, LEASES_DIR, leaseId, processLiveness, readLeases, releaseLeases, sweepLeaseTemporaries, touchLease, type LeaseContext, type LeaseRecord} from "./leases.js";
import {processStartTicks} from "./procfs.js";
import {parseRegistry} from "./registry.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempMain(): Promise<string> {
    const root = await createTestTmpRoot("dev-panel-leases", "dev-panel leases");
    cleanups.push(async () => rm(root, {recursive: true, force: true}));
    return root;
}

async function liveProcess(): Promise<{child: MarkedChild; ref: {pid: number; startTicks: string}}> {
    const child = await spawnMarked("sleep", ["30"]);
    cleanups.push(() => stopProcess(child));
    return {child, ref: {pid: child.pid, startTicks: (await processStartTicks(child.pid))!}};
}

function claude(sessionId: string, process: {pid: number; startTicks: string} | null, herdr: SessionCaller["herdr"] = null): SessionCaller {
    return {kind: "session", ref: {key: `claude:${sessionId}`, agent: "claude", sessionId, label: null, parentSessionId: null}, via: "claude-env", process, herdr};
}

const T0 = new Date("2026-10-12T10:00:00.000Z");
const hours = (count: number) => new Date(T0.getTime() + count * 3_600_000);

function context(overrides: Partial<LeaseContext> = {}): LeaseContext {
    return {now: T0, taskStatus: () => "active", processAlive: () => true, herdr: null, ...overrides};
}

function lease(sessionKey: string, overrides: Partial<LeaseRecord> = {}): LeaseRecord {
    return {
        schema: "nbdev.lease/v1",
        leaseId: leaseId(sessionKey, "w00001-a", "t01-a"),
        workId: "w00001-a",
        taskId: "t01-a",
        session: {key: sessionKey, agent: "claude", sessionId: sessionKey.slice(7), label: null, parentSessionId: null, process: {pid: 100, startTicks: "5"}, herdr: null},
        acquiredAt: T0.toISOString(),
        lastActivityAt: T0.toISOString(),
        lastAction: "task new",
        releasedAt: null,
        releaseReason: null,
        ...overrides,
    };
}

describe("租约的有效性（现算）", () => {
    test("依次判定：已释放、Task 已关闭、超过 24 小时、会话进程不在、被同一进程的新会话取代；超过 2 小时只淡化", () => {
        const base = lease("claude:aaa");
        const states = (leases: LeaseRecord[], overrides: Partial<LeaseContext> = {}) => evaluateLeases(leases, context(overrides)).map((entry) => [entry.state, entry.stale]);
        expect(states([base])).toEqual([["valid", false]]);
        expect(states([{...base, releasedAt: T0.toISOString(), releaseReason: "released"}])).toEqual([["released", false]]);
        expect(states([base], {taskStatus: () => "done"})).toEqual([["task_closed", false]]);
        expect(states([base], {taskStatus: () => "shelved", now: hours(30)})).toEqual([["task_closed", true]]);
        expect(states([base], {now: hours(25)})).toEqual([["expired", true]]);
        expect(states([base], {now: hours(3)})).toEqual([["valid", true]]);
        expect(states([base], {processAlive: () => false})).toEqual([["session_gone", false]]);
        const cleared = lease("claude:bbb", {lastActivityAt: hours(1).toISOString(), taskId: "t02-b", leaseId: leaseId("claude:bbb", "w00001-a", "t02-b")});
        expect(states([base, cleared], {now: hours(1)})).toEqual([["superseded", false], ["valid", false]]);
    });

    test("herdr 不判失效，只决定 managed；只在同一个 socket 评估时才算", () => {
        const managed = lease("claude:aaa", {session: {...lease("claude:aaa").session, herdr: {socketPath: "/a.sock", paneId: "w1:p1", terminalId: "t"}}});
        const evaluate = (herdr: LeaseContext["herdr"]) => evaluateLeases([managed], context({herdr}))[0]!;
        expect(evaluate({socketPath: "/a.sock", sessionIds: new Set(["aaa"])})).toMatchObject({state: "valid", managed: true});
        expect(evaluate({socketPath: "/a.sock", sessionIds: new Set()})).toMatchObject({state: "valid", managed: false});
        expect(evaluate({socketPath: "/b.sock", sessionIds: new Set(["aaa"])})).toMatchObject({state: "valid", managed: false});
        expect(evaluate(null)).toMatchObject({state: "valid", managed: false});
    });
});

describe("租约文件", () => {
    test("同一个会话 id 换了进程（claude --resume）续期后重写快照、重新取得，状态有效", async () => {
        const main = await tempMain();
        const first = await liveProcess();
        const taken = await touchLease(main, {caller: claude("aaa", first.ref), workId: "w00001-a", taskId: "t01-a", action: "task new", now: T0});
        await stopProcess(first.child);
        const gone = evaluateLeases([taken], context({processAlive: await processLiveness([taken])}));
        expect(gone[0]?.state).toBe("session_gone");

        const second = await liveProcess();
        const renewed = await touchLease(main, {caller: claude("aaa", second.ref), workId: "w00001-a", taskId: "t01-a", action: "task status", now: hours(1)});
        expect(renewed).toMatchObject({leaseId: taken.leaseId, acquiredAt: hours(1).toISOString(), lastAction: "task status", session: {process: second.ref}});
        expect(evaluateLeases([renewed], context({now: hours(1), processAlive: await processLiveness([renewed])}))[0]?.state).toBe("valid");

        const again = await touchLease(main, {caller: claude("aaa", second.ref), workId: "w00001-a", taskId: "t01-a", action: "lease take", now: hours(2)});
        expect(again.acquiredAt).toBe(hours(1).toISOString());
    });

    test("Task 已关闭后别的会话再续期，读取时仍是 task_closed（不会复活）", async () => {
        const main = await tempMain();
        const owner = await liveProcess();
        await touchLease(main, {caller: claude("aaa", owner.ref), workId: "w00001-a", taskId: "t01-a", action: "task new", now: T0});
        await touchLease(main, {caller: claude("bbb", null), workId: "w00001-a", taskId: "t01-a", action: "lease take", now: T0});
        const {released} = await releaseLeases(main, {kind: "task", workId: "w00001-a", taskId: "t01-a"}, "task_done", hours(1));
        expect(released.map((entry) => entry.session.key).sort()).toEqual(["claude:aaa", "claude:bbb"]);
        const revived = await touchLease(main, {caller: claude("bbb", null), workId: "w00001-a", taskId: "t01-a", action: "lease take", now: hours(1)});
        expect(revived.releasedAt).toBeNull();
        const {leases} = await readLeases(main);
        const states = evaluateLeases(leases, context({now: hours(1), taskStatus: () => "done", processAlive: await processLiveness(leases)}));
        expect(states.map((entry) => [entry.session.key, entry.state]).sort()).toEqual([["claude:aaa", "released"], ["claude:bbb", "task_closed"]]);
    });

    test("按 Task 释放时带 notAfter：最近活动晚于它的租约留着（释放之前刚续期的那份）", async () => {
        const main = await tempMain();
        await touchLease(main, {caller: claude("aaa", null), workId: "w00001-a", taskId: "t01-a", action: "task new", now: T0});
        await touchLease(main, {caller: claude("bbb", null), workId: "w00001-a", taskId: "t01-a", action: "task status", now: hours(2)});
        const {released} = await releaseLeases(main, {kind: "task", workId: "w00001-a", taskId: "t01-a"}, "task_done", hours(2), {notAfter: hours(1)});
        expect(released.map((entry) => entry.session.key)).toEqual(["claude:aaa"]);
        const {leases} = await readLeases(main);
        expect(leases.map((entry) => [entry.session.key, entry.releaseReason]).sort()).toEqual([["claude:aaa", "task_done"], ["claude:bbb", null]]);
    });

    test("按会话释放；只读 24 位 hex 文件名，临时文件不读，坏文件警告后跳过；读不出的旧租约由续期整份重写", async () => {
        const main = await tempMain();
        await touchLease(main, {caller: claude("aaa", null), workId: "w00001-a", taskId: "t01-a", action: "task new", now: T0});
        await touchLease(main, {caller: claude("aaa", null), workId: "w00001-a", taskId: "t02-b", action: "task new", now: T0});
        await touchLease(main, {caller: claude("bbb", null), workId: "w00001-a", taskId: "t01-a", action: "task new", now: T0});
        const {released} = await releaseLeases(main, {kind: "session", sessionKey: "claude:aaa"}, "released", T0);
        expect(released.map((entry) => entry.taskId).sort()).toEqual(["t01-a", "t02-b"]);

        const dir = join(main, LEASES_DIR);
        await writeFile(join(dir, `${"f".repeat(24)}.json.tmp-1-abcd`), "{半个");
        const broken = leaseId("claude:ccc", "w00001-a", "t01-a");
        await writeFile(join(dir, `${broken}.json`), "{坏了");
        const {leases, warnings} = await readLeases(main);
        expect(leases).toHaveLength(3);
        expect(warnings.map((warning) => warning.code)).toEqual(["unreadable_lease"]);
        await expect(getLease(main, broken)).rejects.toMatchObject({code: "invalid_record"});
        const rewritten = await touchLease(main, {caller: claude("ccc", null), workId: "w00001-a", taskId: "t01-a", action: "lease take", now: T0});
        expect(JSON.parse(await readFile(join(dir, `${broken}.json`), "utf8"))).toEqual(rewritten);
    });
});

describe("租约文件的增长", () => {
    test("缺省跳过修改时间早于 24 小时之前的文件，all 时才读；续期顺手删掉 24 小时前的临时文件", async () => {
        const main = await tempMain();
        const fresh = await touchLease(main, {caller: claude("aaa", null), workId: "w00001-a", taskId: "t01-a", action: "task new", now: T0});
        const old = await touchLease(main, {caller: claude("bbb", null), workId: "w00001-a", taskId: "t01-a", action: "task new", now: T0});
        const dir = join(main, LEASES_DIR);
        const longAgo = new Date(Date.now() - 25 * 3_600_000);
        await utimes(join(dir, `${old.leaseId}.json`), longAgo, longAgo);
        expect((await readLeases(main)).leases.map((entry) => entry.leaseId)).toEqual([fresh.leaseId]);
        expect((await readLeases(main, {all: true})).leases.map((entry) => entry.leaseId).sort()).toEqual([fresh.leaseId, old.leaseId].sort());

        const staleTemporary = `${fresh.leaseId}.json.tmp-1-dead`;
        const recentTemporary = `${fresh.leaseId}.json.tmp-2-live`;
        await writeFile(join(dir, staleTemporary), "{");
        await writeFile(join(dir, recentTemporary), "{");
        await utimes(join(dir, staleTemporary), longAgo, longAgo);
        await sweepLeaseTemporaries(main);
        expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([recentTemporary]);
    });
});

describe("租约文件的校验", () => {
    test("字段不合规的文件一律给 unreadable_lease 后跳过：session 只有 key、时间是乱码、leaseId 与文件名不一致或含路径、取值越界", async () => {
        const main = await tempMain();
        const good = await touchLease(main, {caller: claude("aaa", null), workId: "w00001-a", taskId: "t01-a", action: "task new", now: T0});
        const dir = join(main, LEASES_DIR);
        const variants: Array<[string, (record: Record<string, unknown>) => Record<string, unknown>]> = [
            ["session 只有 key", (record) => ({...record, session: {key: "claude:x"}})],
            ["lastActivityAt 是乱码", (record) => ({...record, lastActivityAt: "垃圾"})],
            ["acquiredAt 不是 ISO 时间", (record) => ({...record, acquiredAt: "2026-10-12"})],
            ["leaseId 含路径", (record) => ({...record, leaseId: "../../../escape"})],
            ["releaseReason 越界", (record) => ({...record, releasedAt: T0.toISOString(), releaseReason: "bogus"})],
            ["只有 releasedAt", (record) => ({...record, releasedAt: T0.toISOString()})],
            ["process 的 pid 不是正整数", (record) => ({...record, session: {...(record.session as object), process: {pid: -1, startTicks: "5"}}})],
            ["herdr 缺字段", (record) => ({...record, session: {...(record.session as object), herdr: {socketPath: "/a.sock"}}})],
            ["workId 不合格式", (record) => ({...record, workId: "../w00001"})],
        ];
        for (const [index, [, mutate]] of variants.entries()) {
            const id = leaseId(`claude:bad${index}`, "w00001-a", "t01-a");
            await writeFile(join(dir, `${id}.json`), JSON.stringify(mutate({...good, leaseId: id})));
        }
        const mismatched = leaseId("claude:mismatch", "w00001-a", "t01-a");
        await writeFile(join(dir, `${mismatched}.json`), JSON.stringify(good));
        const {leases, warnings} = await readLeases(main);
        expect(leases.map((entry) => entry.leaseId)).toEqual([good.leaseId]);
        expect(warnings.map((warning) => warning.code)).toEqual(Array.from({length: variants.length + 1}, () => "unreadable_lease"));
        await expect(getLease(main, mismatched)).rejects.toMatchObject({code: "invalid_record"});
        await expect(getLease(main, "../escape")).rejects.toMatchObject({code: "invalid_record"});
    });
});

describe("登记表的 by", () => {
    test("读取时保留原值；t06 写出的 null 仍合法", () => {
        const by = {key: "claude:aaa", agent: "claude", sessionId: "aaa", label: null, parentSessionId: null};
        const registry = parseRegistry(JSON.stringify({schema: "nbdev.registry/v1", works: [
            {workId: "w00001-a", status: "claimed", at: T0.toISOString(), by, home: null, tasks: [{taskId: "t01-a", status: "claimed", at: T0.toISOString(), by: null, home: null}]},
        ]}), "registry.json");
        expect(registry.works[0]?.by).toEqual(by);
        expect(registry.works[0]?.tasks[0]?.by).toBeNull();
        expect(() => parseRegistry(JSON.stringify({schema: "nbdev.registry/v1", works: [{workId: "w00001-a", status: "claimed", at: "x", by: "坏", home: null, tasks: []}]}), "r")).toThrow();
    });
});
