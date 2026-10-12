import {afterEach, describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {cleanupFixtures, createFixture, git, taskReadme} from "../../tests/git-fixture.js";
import {setRecordStatus} from "./operations.js";
import {claimTask, emptyRegistry, writeRegistry} from "./registry.js";
import {listCheckouts, locateRepository} from "./repo.js";
import {chooseExecutionCheckout, findBranchRecordChanges} from "./sources.js";
import {readProjectStatus} from "./status.js";

afterEach(cleanupFixtures);

describe("过渡期：判定没迁的 Work", () => {
    test("分支上较新的 Work 标 branch，只在 master 上的 Task 标 master，未分出的 Work 标 master", async () => {
        const fixture = await createFixture("sources-branch");
        await fixture.addWork("w00002-long", ["t01-old"]);
        await fixture.commit("w00002 placeholder");
        const worktree = await fixture.addWorktree("w00002-long", "feat/w00002-long");
        await fixture.write(".agents/works/w00002-long/tasks/t01-old/README.md", taskReadme("t01-old", "status: active\n"), worktree);
        await fixture.write(".agents/works/w00002-long/tasks/t02-branch/README.md", taskReadme("t02-branch", "status: done\n"), worktree);
        await fixture.commit("branch records", worktree);
        await fixture.write(".agents/works/w00002-long/tasks/t03-master/README.md", taskReadme("t03-master", "status: planned\n"));
        await fixture.commit("master-only task");

        const {status} = await readProjectStatus(await locateRepository(fixture.main));
        const work = status.works.find((candidate) => candidate.workId === "w00002-long")!;
        expect(work).toMatchObject({source: "branch", branch: "feat/w00002-long", checkout: worktree, executionRule: "name"});
        const sources = Object.fromEntries(work.tasks.map((task) => [task.taskId, [task.source, task.status.value]]));
        expect(sources).toEqual({"t01-old": ["branch", "active"], "t02-branch": ["branch", "done"], "t03-master": ["master", "planned"]});
        expect(status.works.find((candidate) => candidate.workId === "w00001-seed")?.source).toBe("master");
    });

    test("分支按 t05 把记录恢复成 master 的版本后，回到 master 来源（master 自分出以来又改过也一样）", async () => {
        const fixture = await createFixture("sources-restored");
        const worktree = await fixture.addWorktree("w00009-feature", "feat/w00009");
        await fixture.write(".agents/works/w00001-seed/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-seed\nissueId: null\n---\n\n# v2\n", worktree);
        await fixture.commit("branch edits record", worktree);
        await fixture.write(".agents/works/w00001-seed/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-seed\nissueId: null\n---\n\n# v3\n");
        await fixture.addWork("w00003-master-new", ["t01-a"]);
        await fixture.commit("master moves on");
        let result = await findBranchRecordChanges(fixture.main, await listCheckouts(fixture.main));
        expect([...result.changes.keys()]).toEqual(["w00001-seed"]);

        await git(worktree, "checkout", "master", "--", ".agents/works");
        await fixture.commit("restore records to master", worktree);
        result = await findBranchRecordChanges(fixture.main, await listCheckouts(fixture.main));
        expect(result.changes.size).toBe(0);
    });

    test("按 t05 迁移（先合进 master、再把分支恢复成 master 版本）之后，master 再改记录仍是 master 来源，写入不被拒", async () => {
        const fixture = await createFixture("sources-migrated");
        const worktree = await fixture.addWorktree("w00001-line", "feat/w00001");
        const branchVersion = taskReadme("t01-seed", "status: active\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", branchVersion, worktree);
        await fixture.commit("branch maintains record", worktree);
        expect([...(await findBranchRecordChanges(fixture.main, await listCheckouts(fixture.main))).changes.keys()]).toEqual(["w00001-seed"]);

        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", branchVersion);
        await fixture.commit("migrate record to master");
        await git(worktree, "checkout", "master", "--", ".agents/works");
        await fixture.commit("restore records to master", worktree);
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "status: done\n"));
        await fixture.commit("master edits the migrated record again");
        expect((await findBranchRecordChanges(fixture.main, await listCheckouts(fixture.main))).changes.size).toBe(0);

        const context = await locateRepository(fixture.main);
        const {status} = await readProjectStatus(context, {workRef: "w00001"});
        expect(status.works[0]).toMatchObject({source: "master"});
        const changed = await setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "shelved"});
        expect(changed.commit).toMatchObject({committed: true});
    });

    test("只有未提交的分支记录改动不算没迁，只警告；works 根下的规则文件不算 Work", async () => {
        const fixture = await createFixture("sources-uncommitted");
        await fixture.write(".agents/works/README.md", "规则\n");
        await fixture.commit("rules");
        const worktree = await fixture.addWorktree("w00010-x", "feat/w00010");
        await fixture.write(".agents/works/README.md", "规则改了\n", worktree);
        await fixture.commit("rule change on branch", worktree);
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "status: active\n"), worktree);
        const result = await findBranchRecordChanges(fixture.main, await listCheckouts(fixture.main));
        expect(result.changes.size).toBe(0);
        expect(result.warnings).toEqual([expect.objectContaining({code: "uncommitted_branch_records", details: expect.objectContaining({workIds: ["w00001-seed"]})})]);
    });

    test("执行 worktree：目录名优先于最近改动，时间相同按路径排序", async () => {
        const fixture = await createFixture("sources-choose");
        const taskWorktree = await fixture.addWorktree("w00002-t03-slice", "feat/w00002-t03");
        const lineWorktree = await fixture.addWorktree("w00002-mainline", "feat/w00002");
        const otherA = await fixture.addWorktree("a-copy", "copy-a");
        const otherB = await fixture.addWorktree("b-copy", "copy-b");
        const checkouts = await listCheckouts(fixture.main);
        const pick = (roots: string[]) => checkouts.filter((checkout) => roots.includes(checkout.root));

        const byName = await chooseExecutionCheckout(fixture.main, "w00002-x", pick([taskWorktree, lineWorktree, otherA]), emptyRegistry());
        expect(byName).toMatchObject({rule: "name", chosen: {root: lineWorktree}});
        expect(byName.others.map((other) => other.root)).toEqual([otherA, taskWorktree].sort());

        const tie = await chooseExecutionCheckout(fixture.main, "w00001-seed", pick([otherB, otherA]), emptyRegistry());
        expect(tie).toMatchObject({rule: "recent", chosen: {root: otherA}});
    });

    test("没迁的 Work 里经 nbdev 领号新建（登记表 claimed）的 Task 算 master 来源", async () => {
        const fixture = await createFixture("sources-claimed");
        const worktree = await fixture.addWorktree("w00001-line", "feat/w00001");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "status: active\n"), worktree);
        await fixture.commit("branch edit", worktree);
        await fixture.write(".agents/works/w00001-seed/tasks/t02-new/README.md", taskReadme("t02-new", "status: planned\n"));
        await fixture.commit("nbdev task on master");
        await git(worktree, "merge", "--quiet", "--no-edit", "master");
        const registry = emptyRegistry();
        claimTask(registry, "w00001-seed", "t02-new", "2026-10-12T00:00:00.000Z");
        await writeRegistry(fixture.main, registry);

        const {status} = await readProjectStatus(await locateRepository(fixture.main), {workRef: "w00001"});
        expect(status.works[0]?.tasks.map((task) => [task.taskId, task.source])).toEqual([["t01-seed", "branch"], ["t02-new", "master"]]);
        expect(JSON.parse(await readFile(join(fixture.main, ".local/agent/registry.json"), "utf8")).schema).toBe("nbdev.registry/v1");
    });
});
