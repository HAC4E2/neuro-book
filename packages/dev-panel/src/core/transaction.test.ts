import {afterEach, describe, expect, test} from "bun:test";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {cleanupFixtures, createFixture, git, run, taskReadme, writeDeadLock, type Fixture} from "../../tests/git-fixture.js";
import {acquireRecordsLock} from "./lock.js";
import {createTask, createWork, setRecordStatus} from "./operations.js";
import {readRegistry} from "./registry.js";
import {locateRepository} from "./repo.js";
import {resolveCommitOutcome} from "./transaction.js";

afterEach(cleanupFixtures);

const NOW = () => new Date(2026, 9, 12, 10, 0, 0);

async function headFiles(fixture: Fixture): Promise<string[]> {
    return (await git(fixture.main, "show", "--name-only", "--format=", "HEAD")).split("\n").filter(Boolean).sort();
}

describe("写事务", () => {
    test("work new：领号、建两个 README、只提交这两个文件；暂存区里别人的改动原样留着；首次写入导入登记表", async () => {
        const fixture = await createFixture("tx-work-new");
        await fixture.write("notes.txt", "别的会话的改动\n");
        await git(fixture.main, "add", "notes.txt");
        await rm(join(fixture.main, ".local"), {recursive: true, force: true});

        const outcome = await createWork(await locateRepository(fixture.main), {slug: "panel", title: "面板", goal: "做个面板。", taskSlug: "design"}, {now: NOW});
        expect(outcome.data).toMatchObject({workId: "w00002-panel", taskId: "t01-design"});
        expect(outcome.commit).toMatchObject({committed: true, viaOtherCommit: false});
        expect(await headFiles(fixture)).toEqual([".agents/works/w00002-panel/README.md", ".agents/works/w00002-panel/tasks/t01-design/README.md"]);
        expect(await git(fixture.main, "diff", "--cached", "--name-only")).toBe("notes.txt");
        expect(await git(fixture.main, "log", "-1", "--format=%s")).toBe("docs(w00002): nbdev 新建 Work w00002-panel 与 t01-design");
        const task = await readFile(join(fixture.main, ".agents/works/w00002-panel/tasks/t01-design/README.md"), "utf8");
        expect(task).toContain("status: planned\nupdated: 2026-10-12\n");
        expect(task).not.toContain("行为合同未变");
        expect(outcome.warnings.map((warning) => warning.code)).toContain("registry_initialized");
        const {registry} = await readRegistry(fixture.main);
        expect(registry.works.map((work) => [work.workId, work.status, work.tasks.map((t) => [t.taskId, t.status])])).toEqual([
            ["w00001-seed", "imported", [["t01-seed", "imported"]]],
            ["w00002-panel", "claimed", [["t01-design", "claimed"]]],
        ]);
        expect(await readdir(join(fixture.main, ".local/agent/run/tmp"))).toEqual([]);
    });

    test("主工作区不在 master：不取锁、不写任何文件", async () => {
        const fixture = await createFixture("tx-not-master");
        await git(fixture.main, "checkout", "--quiet", "-b", "other");
        const context = await locateRepository(fixture.main);
        await expect(createWork(context, {slug: "x", title: "x", goal: "x", taskSlug: "y"})).rejects.toMatchObject({code: "main_not_on_master"});
        expect(await git(fixture.main, "status", "--porcelain", "--ignored")).toBe("");
    });

    test("task new 要求 Work README 已提交；未跟踪的 Work 报 work_not_committed", async () => {
        const fixture = await createFixture("tx-uncommitted-work");
        await fixture.addWork("w00002-untracked", ["t01-a"]);
        await expect(createTask(await locateRepository(fixture.main), {workRef: "w00002", slug: "b", title: "b"})).rejects.toMatchObject({code: "work_not_committed"});
        expect(await git(fixture.main, "rev-list", "--count", "HEAD")).toBe("1");
    });

    test("task status：未提交改动默认拒绝；带上后改回 HEAD 原值得到 nothing_to_commit；同值不提交", async () => {
        const fixture = await createFixture("tx-status");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "status: planned\nupdated: 2026-10-12\n"));
        await fixture.commit("status planned");
        const context = await locateRepository(fixture.main);
        const path = join(fixture.main, ".agents/works/w00001-seed/tasks/t01-seed/README.md");
        await writeFile(path, taskReadme("t01-seed", "status: active\nupdated: 2026-10-12\n"));

        await expect(setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "planned"}, {now: NOW})).rejects.toMatchObject({code: "uncommitted_changes"});
        const reverted = await setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "planned", includeUncommitted: true}, {now: NOW});
        expect(reverted.data.changed).toBe(true);
        expect(reverted.commit).toEqual({committed: false, reason: "nothing_to_commit", paths: [".agents/works/w00001-seed/tasks/t01-seed/README.md"]});
        expect(await git(fixture.main, "rev-list", "--count", "HEAD")).toBe("2");

        const same = await setRecordStatus(context, {workRef: "w00001", taskRef: "t01-seed", status: "planned"}, {now: NOW});
        expect(same.data.changed).toBe(false);
        expect(same.commit.committed).toBe(false);

        const done = await setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "done"}, {now: NOW});
        expect(done.commit).toMatchObject({committed: true});
        expect(await readFile(path, "utf8")).toBe(taskReadme("t01-seed", "status: done\nupdated: 2026-10-12\n"));
        await expect(setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "draft"})).rejects.toMatchObject({code: "invalid_status"});
        await expect(setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "active", expectedHash: "0".repeat(64)})).rejects.toMatchObject({code: "hash_mismatch"});
    });

    test("index.lock 短暂被占时重试成功；超过预算报 committed: false 并列出已写文件", async () => {
        const fixture = await createFixture("tx-index-lock");
        const context = await locateRepository(fixture.main);
        const indexLock = join(fixture.main, ".git/index.lock");
        await writeFile(indexLock, "");
        setTimeout(() => void rm(indexLock, {force: true}), 600);
        const retried = await createTask(context, {workRef: "w00001", slug: "retry", title: "重试"}, {gitLockWaitMs: 5_000});
        expect(retried.commit).toMatchObject({committed: true});

        await writeFile(indexLock, "");
        const failed = await createTask(context, {workRef: "w00001", slug: "blocked", title: "被挡"}, {gitLockWaitMs: 500});
        await rm(indexLock, {force: true});
        expect(failed.data.taskId).toBe("t03-blocked");
        expect(failed.commit).toMatchObject({committed: false, reason: "git_lock_timeout", writtenPaths: [".agents/works/w00001-seed/tasks/t03-blocked/README.md"]});
        expect(await git(fixture.main, "status", "--porcelain", "-uall")).toBe("?? .agents/works/w00001-seed/tasks/t03-blocked/README.md");
    });

    test("没有 Git 提交身份：在写任何东西之前报 git_identity_missing", async () => {
        const fixture = await createFixture("tx-no-identity");
        await git(fixture.main, "config", "--unset", "user.email");
        await git(fixture.main, "config", "--unset", "user.name");
        await git(fixture.main, "config", "user.useConfigOnly", "true");
        await expect(createTask(await locateRepository(fixture.main), {workRef: "w00001", slug: "x", title: "x"})).rejects.toMatchObject({code: "git_identity_missing"});
        expect(await git(fixture.main, "status", "--porcelain", "--ignored")).toBe("");
    });

    test("不是锁冲突的提交失败：128 但从没见过 index.lock 时提前停下报 git_failed；pre-commit 拒绝也报 git_failed", async () => {
        const fixture = await createFixture("tx-git-failed");
        const context = await locateRepository(fixture.main);
        const objects = join(fixture.main, ".git/objects");
        await run("chmod", ["-R", "a-w", objects], fixture.main);
        const started = Date.now();
        let unwritable;
        try {
            unwritable = await createTask(context, {workRef: "w00001", slug: "no-objects", title: "对象库不可写"});
        } finally {
            await run("chmod", ["-R", "u+w", objects], fixture.main);
        }
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(unwritable.commit).toMatchObject({committed: false, reason: "git_failed", writtenPaths: [".agents/works/w00001-seed/tasks/t02-no-objects/README.md"]});

        await fixture.write(".git/hooks/pre-commit", "#!/bin/sh\necho 拒绝 >&2\nexit 1\n");
        await run("chmod", ["+x", join(fixture.main, ".git/hooks/pre-commit")], fixture.main);
        const rejected = await createTask(context, {workRef: "w00001", slug: "hooked", title: "被钩子拒绝"});
        expect(rejected.commit).toMatchObject({committed: false, reason: "git_failed"});
        expect(rejected.commit.committed === false && rejected.commit.reason === "git_failed" ? rejected.commit.detail : "").toContain("拒绝");
    });

    test("resolveCommitOutcome：被别的提交带走、无需提交、真失败三种判定", async () => {
        const fixture = await createFixture("tx-resolve");
        const startHead = await git(fixture.main, "rev-parse", "HEAD");
        const path = ".agents/works/w00001-seed/tasks/t02-new/README.md";
        await fixture.write(path, taskReadme("t02-new"));
        const blob = await git(fixture.main, "hash-object", "--", path);
        const expectedBlobs = new Map([[path, blob]]);

        expect(await resolveCommitOutcome(fixture.main, {startHead, paths: [path], expectedBlobs, lastFailure: null, timedOut: true}))
            .toMatchObject({committed: false, reason: "git_lock_timeout", writtenPaths: [path]});

        await git(fixture.main, "add", "--", path);
        await git(fixture.main, "commit", "--quiet", "-m", "别的会话不带路径的提交");
        const other = await git(fixture.main, "rev-parse", "HEAD");
        expect(await resolveCommitOutcome(fixture.main, {startHead, paths: [path], expectedBlobs, lastFailure: {exitCode: 1, stdout: "", stderr: ""}, timedOut: false}))
            .toEqual({committed: true, sha: other, paths: [path], viaOtherCommit: true});
        expect(await resolveCommitOutcome(fixture.main, {startHead: other, paths: [path], expectedBlobs, lastFailure: null, timedOut: false}))
            .toEqual({committed: false, reason: "nothing_to_commit", paths: [path]});
    });

    test("崩溃残留：已退出进程留下的锁被接管；锁被占时等到超时并报出持锁者", async () => {
        const fixture = await createFixture("tx-stale-lock");
        await writeDeadLock(fixture.main);
        const context = await locateRepository(fixture.main);
        const afterCrash = await createTask(context, {workRef: "w00001", slug: "after-crash", title: "崩溃之后"});
        expect(afterCrash.commit).toMatchObject({committed: true});
        expect(afterCrash.warnings.map((warning) => warning.code)).toContain("lock_taken_over");

        const held = await acquireRecordsLock(fixture.main);
        try {
            const started = Date.now();
            await expect(createTask(context, {workRef: "w00001", slug: "waits", title: "等锁"}, {lockWaitMs: 400}))
                .rejects.toMatchObject({code: "lock_timeout", details: {holder: {pid: process.pid, alive: true}}});
            expect(Date.now() - started).toBeGreaterThanOrEqual(400);
        } finally {
            await held.release();
        }
    });
});
