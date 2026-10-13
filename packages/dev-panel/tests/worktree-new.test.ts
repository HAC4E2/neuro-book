import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, readFileSync} from "node:fs";
import {chmod, mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {cleanupFixtures, createFixture, git} from "./git-fixture.js";

/**
 * t14 的 `worktree new`（L3，临时仓库）：按 Work 规则命名、写登记表的 `home`（绝对路径）、已被占用时退出码 3、
 * `worktree add` 一定由 `/usr/bin/git` 执行（PATH 里的假 git 只在 `worktree add` 时失败并记一行，其余原样交给真 git）。
 */

afterEach(async () => {
    await cleanupFixtures();
});

describe("worktree new（场景 4）", () => {
    test("建出 .worktree/w00001-t01-seed 与 feat/w00001-t01-seed，登记表写绝对路径的 home；再建一次与只剩分支时都是 3，不改名", async () => {
        const fixture = await createFixture("worktree-new");
        const first = await fixture.cli(["worktree", "new", "w00001", "t01", "--json"]);
        expect([first.exitCode, first.json?.errors]).toEqual([0, []]);
        const path = join(fixture.main, ".worktree", "w00001-t01-seed");
        expect(first.json?.data).toMatchObject({workId: "w00001-seed", taskId: "t01-seed", path, branch: "feat/w00001-t01-seed", from: "master", home: path});
        expect(existsSync(join(path, ".agents"))).toBe(true);
        expect((await git(fixture.main, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("master");
        const registry = JSON.parse(readFileSync(join(fixture.main, ".local/agent/registry.json"), "utf8")) as {works: Array<{workId: string; tasks: Array<{taskId: string; home: string | null}>}>};
        expect(registry.works.find((work) => work.workId === "w00001-seed")!.tasks.find((task) => task.taskId === "t01-seed")!.home).toBe(path);

        const again = await fixture.cli(["worktree", "new", "w00001", "t01", "--json"]);
        expect([again.exitCode, again.json?.errors[0]?.code]).toEqual([3, "target_exists"]);
        expect(again.json?.errors[0]?.details).toMatchObject({pathExists: true});

        await git(fixture.main, "worktree", "remove", path);
        const branchOnly = await fixture.cli(["worktree", "new", "w00001", "t01", "--json"]);
        expect([branchOnly.exitCode, branchOnly.json?.errors[0]?.code]).toEqual([3, "target_exists"]);
        expect(branchOnly.json?.errors[0]?.details).toMatchObject({pathExists: false, branchExists: true});
        expect(existsSync(join(fixture.main, ".worktree", "w00001-t01-seed-2"))).toBe(false);
    }, 60_000);

    test("worktree add 由 /usr/bin/git 执行：PATH 里的假 git 遇到 worktree add 就失败并记一行，命令照样成功、记录里没有 worktree add", async () => {
        const fixture = await createFixture("worktree-usr-git");
        await fixture.addWork("w00001-seed", ["t02-other"]);
        await fixture.commit("t02");
        const bin = join(fixture.root, "fake-git-bin");
        await mkdir(bin, {recursive: true});
        const log = join(fixture.root, "fake-git.log");
        await writeFile(log, "");
        await writeFile(join(bin, "git"), `#!/bin/sh\ncase " $* " in\n  *" worktree add "*) echo "worktree add $*" >> '${log}'; exit 1 ;;\nesac\nexec /usr/bin/git "$@"\n`);
        await chmod(join(bin, "git"), 0o755);
        const result = await fixture.cli(["worktree", "new", "w00001", "t02", "--slug", "short", "--type", "fix", "--json"], fixture.main, {PATH: `${bin}:${process.env.PATH ?? ""}`});
        expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
        expect(result.json?.data).toMatchObject({branch: "fix/w00001-t02-short", path: join(fixture.main, ".worktree", "w00001-t02-short")});
        expect(readFileSync(log, "utf8")).toBe("");
    }, 60_000);

    test("--type 只收 CONTRIBUTING 的几种；--slug 要合规", async () => {
        const fixture = await createFixture("worktree-usage");
        expect((await fixture.cli(["worktree", "new", "w00001", "t01", "--type", "feature", "--json"])).exitCode).toBe(2);
        expect((await fixture.cli(["worktree", "new", "w00001", "t01", "--slug", "Bad_Slug", "--json"])).exitCode).toBe(2);
        expect((await fixture.cli(["worktree", "new", "w00001", "t09", "--json"])).exitCode).toBe(5);
    }, 60_000);
});
