import {afterEach, describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {parseTaskId} from "../src/core/ids.js";
import {parseRegistry} from "../src/core/registry.js";
import {cleanupFixtures, createFixture, git, writeDeadLock, type Fixture} from "./git-fixture.js";

afterEach(cleanupFixtures);

async function concurrentTaskNew(fixture: Fixture, count: number) {
    return Promise.all(Array.from({length: count}, (_, index) => fixture.cli(["task", "new", "w00001", `job-${index}`, "--title", `并发 ${index}`, "--json"])));
}

describe("并发领号（真实进程）", () => {
    test("场景 3：10 个进程同时 task new，号各不相同且连续，登记表是合法 JSON，git log 多 10 个提交", async () => {
        const fixture = await createFixture("concurrency");
        const results = await concurrentTaskNew(fixture, 10);
        for (const result of results) expect(result.exitCode).toBe(0);
        const numbers = results.map((result) => parseTaskId(String(result.json?.data?.taskId))?.number).sort((left, right) => left! - right!);
        expect(numbers).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        const registry = parseRegistry(await readFile(join(fixture.main, ".local/agent/registry.json"), "utf8"), "registry.json");
        expect(registry.works.find((work) => work.workId === "w00001-seed")?.tasks.filter((task) => task.status === "claimed")).toHaveLength(10);
        expect(await git(fixture.main, "rev-list", "--count", "HEAD")).toBe("11");
        expect(await git(fixture.main, "status", "--porcelain")).toBe("");
    }, 60_000);

    test("崩溃残留：预置已退出进程留下的锁，再并发领号，全部成功且号不重复", async () => {
        const fixture = await createFixture("stale-lock");
        await writeDeadLock(fixture.main);
        const results = await concurrentTaskNew(fixture, 10);
        for (const result of results) expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
        const taskIds = results.map((result) => String(result.json?.data?.taskId));
        expect(taskIds.map((taskId) => parseTaskId(taskId)?.number).sort((left, right) => left! - right!)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect(results.flatMap((result) => result.json?.warnings ?? []).filter((warning) => warning.code === "lock_taken_over")).toHaveLength(1);
        const registry = parseRegistry(await readFile(join(fixture.main, ".local/agent/registry.json"), "utf8"), "registry.json");
        const claimed = registry.works.find((work) => work.workId === "w00001-seed")!.tasks.filter((task) => task.status === "claimed").map((task) => parseTaskId(task.taskId)?.number);
        expect(new Set(claimed).size).toBe(claimed.length);
    }, 60_000);
});
