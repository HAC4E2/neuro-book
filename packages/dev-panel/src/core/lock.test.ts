import {afterEach, describe, expect, test} from "bun:test";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {cleanupFixtures, createFixture} from "../../tests/git-fixture.js";
import {acquireRecordsLock, agentPaths, inspectLock, prepareAgentDirectories, processStartTicks, takeOverDeadLock} from "./lock.js";
import {locateRepository} from "./repo.js";
import {runWriteTransaction} from "./transaction.js";

afterEach(cleanupFixtures);

/** 直接放一个锁目录，模拟别的进程持锁（`startTicks` 对不上即为已退出的进程）。 */
async function placeLock(lockDir: string, owner: {token: string; startTicks: string | null}): Promise<void> {
    await mkdir(lockDir, {recursive: true});
    await writeFile(join(lockDir, "owner.json"), JSON.stringify({
        schema: "nbdev.lock-owner/v1",
        token: owner.token,
        pid: process.pid,
        startTicks: owner.startTicks ?? await processStartTicks(process.pid),
        startedAt: new Date().toISOString(),
        command: "test",
        cwd: "/",
    }));
}

async function lockToken(lockDir: string): Promise<string | null> {
    try {
        return JSON.parse(await readFile(join(lockDir, "owner.json"), "utf8")).token as string;
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
        throw error;
    }
}

describe("记录锁", () => {
    test("两个等待者看到同一个死锁：慢的一方接管时改走的是快的一方刚建的活锁，要原样改回去", async () => {
        const fixture = await createFixture("lock-race");
        await prepareAgentDirectories(fixture.main);
        const {lockDir, tmpRoot} = agentPaths(fixture.main);
        await placeLock(lockDir, {token: "dead", startTicks: "0"});
        const stale = await inspectLock(lockDir);
        if (stale === null || stale === "changed") throw new Error("应当看到死锁");
        expect(stale.owner?.token).toBe("dead");

        const fast = await acquireRecordsLock(fixture.main);
        expect(fast.takeovers.map((warning) => warning.code)).toEqual(["lock_taken_over"]);
        expect(await takeOverDeadLock(lockDir, tmpRoot, stale)).toBe("lost_race");
        expect(await fast.isHeld()).toBe(true);
        expect(await fast.release()).toBeNull();
        expect(await inspectLock(lockDir)).toBeNull();
    });

    test("锁已被别人拿走时，放锁既不删锁目录也不删持锁者文件，只给警告", async () => {
        const fixture = await createFixture("lock-release");
        await prepareAgentDirectories(fixture.main);
        const {lockDir, tmpRoot} = agentPaths(fixture.main);
        const mine = await acquireRecordsLock(fixture.main);
        await rename(lockDir, join(tmpRoot, "moved-away"));
        await placeLock(lockDir, {token: "someone-else", startTicks: null});

        await expect(mine.assertHealthy("落位")).rejects.toMatchObject({code: "lock_compromised"});
        expect(await mine.release()).toMatchObject({code: "lock_release_skipped"});
        expect(await lockToken(lockDir)).toBe("someone-else");
    });

    test("持锁者活着时等到超时，报出持锁者；没有持锁者信息的旧格式锁目录直接接管", async () => {
        const fixture = await createFixture("lock-timeout");
        await prepareAgentDirectories(fixture.main);
        const {lockDir} = agentPaths(fixture.main);
        await placeLock(lockDir, {token: "alive", startTicks: null});
        const started = Date.now();
        await expect(acquireRecordsLock(fixture.main, 300)).rejects.toMatchObject({code: "lock_timeout", details: {holder: {pid: process.pid, alive: true}}});
        expect(Date.now() - started).toBeGreaterThanOrEqual(300);

        await rm(lockDir, {recursive: true});
        await mkdir(lockDir);
        await writeFile(join(lockDir, "junk"), "");
        const taken = await acquireRecordsLock(fixture.main, 300);
        expect(taken.takeovers).toEqual([expect.objectContaining({code: "lock_taken_over", details: expect.objectContaining({problem: "锁目录里没有持锁者文件"})})]);
        await taken.release();
    });

    test("写入之前发现锁被拿走：放锁不碰别人的锁，等它放开后重新取锁、从头再算，不报错", async () => {
        const fixture = await createFixture("lock-reacquire");
        const context = await locateRepository(fixture.main);
        const {lockDir, tmpRoot} = agentPaths(fixture.main);
        let calls = 0;
        let tokenWhenOtherReleased = null as string | null;
        const outcome = await runWriteTransaction(context, {}, async (tx) => {
            calls += 1;
            if (calls === 1) {
                await rename(lockDir, join(tmpRoot, `stolen-${Date.now()}`));
                await placeLock(lockDir, {token: "intruder", startTicks: null});
                setTimeout(() => {
                    void (async () => {
                        tokenWhenOtherReleased = await lockToken(lockDir);
                        await rm(lockDir, {recursive: true, force: true});
                    })();
                }, 300);
            }
            tx.createFile(".agents/works/w00001-seed/tasks/t01-seed/notes.md", `第 ${calls} 次\n`);
            return {message: "docs(w00001): 测试重新取锁", result: calls};
        });
        expect(outcome.result).toBe(2);
        expect(tokenWhenOtherReleased).toBe("intruder");
        expect(outcome.commit).toMatchObject({committed: true});
        expect(outcome.warnings.map((warning) => warning.code)).toContain("lock_reacquired");
        expect(await readFile(join(fixture.main, ".agents/works/w00001-seed/tasks/t01-seed/notes.md"), "utf8")).toBe("第 2 次\n");
    });
});
