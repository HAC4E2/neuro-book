import {afterEach, describe, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {SessionCaller} from "../src/core/identity.js";
import {createTask, setTaskStatus} from "../src/core/operations.js";
import {locateRepository} from "../src/core/repo.js";
import {claudePane, startFakeHerdr} from "./fake-herdr.js";
import {cleanupFixtures, createFixture, type Fixture} from "./git-fixture.js";
import {startFakeClaude} from "./processes.js";

/** 租约与记录提交之间的合同：提交失败时怎么处理租约，以及几种只给警告的情形。 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    await cleanupFixtures();
});

const bob: SessionCaller = {kind: "session", ref: {key: "external:bob", agent: "external", sessionId: null, label: "bob", parentSessionId: null, nestedSessionId: null}, via: "as", process: null, herdr: null};

/** 占住主工作区的 index.lock，让提交以 git_lock_timeout 失败（写事务只等 gitLockWaitMs）。 */
async function holdIndexLock(fixture: Fixture): Promise<void> {
    const indexLock = join(fixture.main, ".git/index.lock");
    await writeFile(indexLock, "");
    closers.push(() => rm(indexLock, {force: true}));
}

async function leaseFiles(fixture: Fixture): Promise<Record<string, string>> {
    const dir = join(fixture.main, ".local/agent/run/leases");
    const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
    return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(join(dir, name), "utf8")] as const)));
}

describe("提交失败时的租约", () => {
    test("task new 提交失败但文件已写、号已领：仍取得新 Task 的租约", async () => {
        const fixture = await createFixture("lease-commit-failed-new");
        const context = await locateRepository(fixture.main);
        await holdIndexLock(fixture);
        const outcome = await createTask(context, {workRef: "w00001", slug: "blocked", title: "被挡"}, {caller: bob, herdr: null, gitLockWaitMs: 300});
        expect(outcome.commit).toMatchObject({committed: false, reason: "git_lock_timeout"});
        expect(outcome.data.lease).toMatchObject({taskId: "t02-blocked", session: {key: "external:bob"}});
    });

    test("task status active 提交失败：不动租约", async () => {
        const fixture = await createFixture("lease-commit-failed-status");
        const context = await locateRepository(fixture.main);
        expect((await fixture.cli(["lease", "take", "w00001", "t01", "--as", "bob", "--json"])).exitCode).toBe(0);
        const before = await leaseFiles(fixture);
        await holdIndexLock(fixture);
        const outcome = await setTaskStatus(context, {workRef: "w00001", taskRef: "t01", status: "active"}, {caller: bob, herdr: null, gitLockWaitMs: 300});
        expect(outcome.commit).toMatchObject({committed: false, reason: "git_lock_timeout"});
        expect(outcome.data).toMatchObject({lease: null, released: []});
        expect(await leaseFiles(fixture)).toEqual(before);
    });
});

describe("只给警告的情形", () => {
    test("写命令认不出调用者：照常完成，给 caller_unknown，不取租约", async () => {
        const fixture = await createFixture("lease-caller-unknown");
        const result = await fixture.cli(["task", "new", "w00001", "nobody", "--title", "没人认领", "--json"]);
        expect([result.exitCode, result.json?.warnings.map((warning) => warning.code)]).toEqual([0, ["registry_initialized", "caller_unknown"]]);
        expect(result.json?.data).toMatchObject({lease: null});
        expect(await leaseFiles(fixture)).toEqual({});
    });

    test("写 pane 标签被 herdr 拒绝：租约照常取得，给 herdr_tag_failed", async () => {
        const fixture = await createFixture("lease-tag-failed");
        const claude = await startFakeClaude(randomUUID());
        closers.push(() => claude.stop());
        const fake = await startFakeHerdr(fixture.root, [claudePane("w9:p1", claude.sessionId, {foreground_pids: [claude.pid], cwd: fixture.main})]);
        closers.push(() => fake.close());
        fake.overrides["pane.report_metadata"] = {code: "internal_error", message: "boom"};
        const taken = await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main, {HERDR_PANE_ID: "w9:p1", HERDR_SOCKET_PATH: fake.socketPath});
        expect([taken.exitCode, taken.json?.warnings.map((warning) => [warning.code, warning.details?.code])]).toEqual([0, [["herdr_tag_failed", "internal_error"]]]);
        expect(taken.json?.data).toMatchObject({lease: {session: {key: `claude:${claude.sessionId}`}}});
    });
});
