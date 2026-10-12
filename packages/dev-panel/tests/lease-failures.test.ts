import {afterEach, describe, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {chmod, readdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {claudePane, startFakeHerdr} from "./fake-herdr.js";
import {cleanupFixtures, createFixture, git, type Fixture} from "./git-fixture.js";

/**
 * 租约是运行时数据：记录已经提交之后，租约读写失败只给警告，命令照常成功并带回提交信息；一个读不了的租约文件不影响 `status`。
 * 用权限制造失败，root 下权限不起作用，跳过。
 */
const asRoot = process.getuid?.() === 0;
const restores: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const restore of restores.splice(0)) await restore();
    await cleanupFixtures();
});

function leasesDir(fixture: Fixture): string {
    return join(fixture.main, ".local/agent/run/leases");
}

async function lockDown(path: string, mode: number): Promise<void> {
    await chmod(path, mode);
    restores.push(() => chmod(path, 0o755));
}

describe("租约读写失败不让记录操作失败", () => {
    test.skipIf(asRoot)("租约目录不可写：task status done 退出 0，带 lease_write_failed 警告与 data.commit；续期同样只是警告", async () => {
        const fixture = await createFixture("lease-dir-readonly");
        expect((await fixture.cli(["lease", "take", "w00001", "t01", "--as", "bob", "--json"])).exitCode).toBe(0);
        await lockDown(leasesDir(fixture), 0o555);

        const renewed = await fixture.cli(["task", "status", "w00001", "t01", "active", "--as", "carol", "--json"]);
        expect([renewed.exitCode, renewed.json?.ok]).toEqual([0, true]);
        expect(renewed.json?.warnings.map((warning) => warning.code)).toContain("lease_write_failed");

        const done = await fixture.cli(["task", "status", "w00001", "t01", "done", "--as", "carol", "--json"]);
        expect([done.exitCode, done.json?.ok]).toEqual([0, true]);
        expect(done.json?.warnings.map((warning) => warning.code)).toContain("lease_write_failed");
        expect(done.json?.data).toMatchObject({next: "done", changed: true, released: [], commit: {committed: true}});
        expect(await git(fixture.main, "show", "HEAD:.agents/works/w00001-seed/tasks/t01-seed/README.md")).toContain("status: done");
    });

    test.skipIf(asRoot)("单个租约文件读不了：status、lease list 照常出结果并警告；它的会话续期时整份重写", async () => {
        const fixture = await createFixture("lease-file-unreadable");
        expect((await fixture.cli(["lease", "take", "w00001", "t01", "--as", "bob", "--json"])).exitCode).toBe(0);
        const [file] = (await readdir(leasesDir(fixture))).filter((name) => name.endsWith(".json"));
        await lockDown(join(leasesDir(fixture), file!), 0o000);

        const status = await fixture.cli(["status", "--json"]);
        expect(status.exitCode).toBe(0);
        expect(status.json?.warnings.map((warning) => warning.code)).toContain("unreadable_lease");
        const list = await fixture.cli(["lease", "list", "--json"]);
        expect([list.exitCode, (list.json?.data as {leases: unknown[]}).leases]).toEqual([0, []]);
        expect((await fixture.cli(["task", "status", "w00001", "t01", "active", "--as", "carol", "--json"])).exitCode).toBe(0);

        const rewritten = await fixture.cli(["task", "status", "w00001", "t01", "planned", "--as", "bob", "--json"]);
        expect([rewritten.exitCode, rewritten.json?.warnings.map((warning) => warning.code)]).toEqual([0, []]);
        expect(JSON.parse(await readFile(join(leasesDir(fixture), file!), "utf8"))).toMatchObject({session: {key: "external:bob"}, lastAction: "task status"});
    });
});

describe("坏的租约文件", () => {
    test("herdr 可用时，session 只有 key 的租约文件：status 与 lease list 照常出结果，给 unreadable_lease", async () => {
        const fixture = await createFixture("lease-bad-session");
        expect((await fixture.cli(["lease", "take", "w00001", "t01", "--as", "bob", "--json"])).exitCode).toBe(0);
        const [file] = (await readdir(leasesDir(fixture))).filter((name) => name.endsWith(".json"));
        const path = join(leasesDir(fixture), file!);
        await writeFile(path, JSON.stringify({...JSON.parse(await readFile(path, "utf8")), session: {key: "external:bob"}}));
        const fake = await startFakeHerdr(fixture.root, [claudePane("w9:p1", randomUUID())]);
        restores.push(() => fake.close());
        for (const args of [["status", "--json"], ["lease", "list", "--json"]]) {
            const result = await fixture.cli(args, fixture.main, {HERDR_SOCKET_PATH: fake.socketPath});
            expect([args[0], result.exitCode, result.json?.warnings.map((warning) => warning.code)]).toEqual([args[0], 0, ["unreadable_lease"]]);
        }
    });
});
