import {afterEach, describe, expect, test} from "bun:test";
import {checkoutKeys, resolveTaskExecution} from "../src/core/checkouts.js";
import {classifyDoc, listDocPaths, readDocFile, readDocTree} from "../src/core/docs.js";
import {unsafePathReason} from "../src/core/paths.js";
import {readTaskRecord} from "../src/core/records.js";
import {listCheckouts, locateRepository} from "../src/core/repo.js";
import {createNameIndexCache, searchCheckouts, validateSearchQuery, type SearchHit} from "../src/core/search.js";
import {readTransitionState} from "../src/core/status.js";
import {readTaskDetail} from "../src/core/task-detail.js";
import {createHerdrClient, HERDR_PANEL_READ_METHODS, HERDR_READ_METHODS, type HerdrEvent} from "../src/herdr/client.js";
import {claudePane, shellPane, startFakeHerdr, type FakeHerdr} from "./fake-herdr.js";
import {cleanupFixtures, createFixture, taskReadme, type Fixture} from "./git-fixture.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    await cleanupFixtures();
});

async function fakeHerdr(fixture: Fixture, panes: Parameters<typeof startFakeHerdr>[1]): Promise<FakeHerdr> {
    const fake = await startFakeHerdr(fixture.root, panes);
    closers.push(() => fake.close());
    return fake;
}

describe("Task 的当前情况与执行 checkout", () => {
    test("当前情况取“当前状态”一节的第一行；执行 checkout 依次按 README、目录名、登记表、Work 的执行 worktree、master", async () => {
        const fixture = await createFixture("panel-execution");
        await fixture.write(".agents/works/w00001-seed/tasks/t02-impl/README.md", `${taskReadme("t02-impl", "status: active\n")}\n## 当前状态\n\n- 第二轮评审中。\n- 下一步写 Spec。\n\n## 执行位置\n\n代码在 worktree \`.worktree/w00001-t02-impl\`；草稿在 \`t02/drafts\`。见 [Spec](../../../../../docs/specs/ui/x.md) 与 [别的](https://example.com)。\n`);
        await fixture.commit("t02 on master");
        const impl = await fixture.addWorktree("w00001-t02-impl", "t02/impl");
        const drafts = await fixture.addWorktree("w00001-t02-drafts", "t02/drafts");
        await fixture.write("src/feature.ts", "export const x = 1;\n", impl);
        await fixture.commit("feat: 实现", impl);
        const context = await locateRepository(fixture.main);
        const transition = await readTransitionState(context.mainRoot);

        const record = await readTaskRecord(fixture.main, "w00001-seed", "t02-impl", new Map(), []);
        expect(record.currentState).toBe("第二轮评审中。");
        expect((await readTaskRecord(fixture.main, "w00001-seed", "t01-seed", new Map(), [])).currentState).toBeNull();

        const execution = await resolveTaskExecution(context.mainRoot, transition, "w00001-seed", "t02-impl", fixture.main);
        expect(execution.candidates.map((candidate) => [candidate.root, candidate.rule])).toEqual([[impl, "readme"], [drafts, "readme"], [fixture.main, "master"]]);
        const detail = await readTaskDetail(context.mainRoot, transition, {workId: "w00001-seed", taskId: "t02-impl", recordRoot: fixture.main}, []);
        expect([detail.specs, detail.commits.checkout, detail.commits.range, detail.commits.entries.map((entry) => entry.subject)]).toEqual([["docs/specs/ui/x.md"], "w00001-t02-impl", "branch", ["feat: 实现"]]);

        // 没写执行位置：按目录名，否则 master；master 上取碰过 Task 目录的提交。
        const byName = await resolveTaskExecution(context.mainRoot, transition, "w00001-seed", "t01-seed", fixture.main);
        expect(byName.chosen.rule).toBe("master");
        const seed = await readTaskDetail(context.mainRoot, transition, {workId: "w00001-seed", taskId: "t01-seed", recordRoot: fixture.main}, []);
        expect([seed.commits.range, seed.commits.entries.map((entry) => entry.subject)]).toEqual(["task", ["seed"]]);
    });

    test("checkout 的 key：主工作区是 main，worktree 用目录名，撞名时改用路径哈希", () => {
        const keys = checkoutKeys([
            {root: "/r", branch: "master", head: "a", isMain: true, prunable: false},
            {root: "/r/.worktree/x", branch: "b", head: "a", isMain: false, prunable: false},
            {root: "/elsewhere/x", branch: "c", head: "a", isMain: false, prunable: false},
            {root: "/r/.worktree/main", branch: "d", head: "a", isMain: false, prunable: false},
        ]);
        expect(keys.get("/r")).toBe("main");
        expect([keys.get("/r/.worktree/x"), keys.get("/elsewhere/x"), keys.get("/r/.worktree/main")].every((key) => /^h-[0-9a-f]{12}$/u.test(key ?? ""))).toBe(true);
    });
});

describe("文档树与差异", () => {
    test("按类型分组；worktree 附与主工作区的差异：分支新增、改动、删去，master 上新增而分支没有的", async () => {
        const fixture = await createFixture("panel-docs");
        await fixture.write("docs/specs/ui/shell.md", "---\nstatus: draft\n---\n\n# 外壳\n");
        await fixture.write("docs/specs/ui/old.md", "# 旧\n");
        await fixture.write("docs/proposals/p.md", "# 提案\n");
        await fixture.write("packages/demo/docs/a.md", "# 包文档\n");
        await fixture.write("packages/demo/docs/adr/0001-x.md", "# 决定\n");
        await fixture.write("packages/demo/src/readme.md", "# 不是文档\n");
        await fixture.write(".agents/skills/s/SKILL.md", "# 技能\n");
        await fixture.write("docs/specs/ui/evidences/x.md", "# 证据里的\n");
        await fixture.commit("docs");
        const worktree = await fixture.addWorktree("w00001-line", "feat/w00001");
        await fixture.write("docs/specs/ui/shell.md", "---\nstatus: draft\n---\n\n# 外壳 v2\n", worktree);
        await fixture.write("docs/specs/ui/new.md", "# 新\n", worktree);
        await fixture.commit("branch docs", worktree);
        await fixture.write("docs/specs/ui/draft.md", "# 未提交\n", worktree);
        const {git} = await import("./git-fixture.js");
        await git(worktree, "rm", "--quiet", "docs/specs/ui/old.md");
        await fixture.commit("branch removes old", worktree);
        await fixture.write("docs/specs/ui/later.md", "# master 后来加的\n");
        await fixture.commit("master adds later");

        const mainDocs = await listDocPaths(fixture.main);
        expect(mainDocs).toEqual([".agents/skills/s/SKILL.md", "docs/proposals/p.md", "docs/specs/ui/later.md", "docs/specs/ui/old.md", "docs/specs/ui/shell.md", "packages/demo/docs/a.md", "packages/demo/docs/adr/0001-x.md"]);
        expect([classifyDoc("docs/specs/ui/shell.md"), classifyDoc("packages/demo/docs/adr/0001-x.md"), classifyDoc("AGENTS.md"), classifyDoc("packages/demo/src/readme.md")]).toEqual([
            {group: "spec", section: "specs/ui"}, {group: "adr", section: "packages/demo"}, {group: "entry", section: ""}, null,
        ]);
        expect((await readDocTree(fixture.main, true, mainDocs)).changes).toEqual([]);
        const tree = await readDocTree(worktree, false, mainDocs);
        expect(tree.changes).toEqual([
            {path: "docs/specs/ui/draft.md", change: "added"},
            {path: "docs/specs/ui/later.md", change: "master_only"},
            {path: "docs/specs/ui/new.md", change: "added"},
            {path: "docs/specs/ui/old.md", change: "deleted"},
            {path: "docs/specs/ui/shell.md", change: "modified"},
        ]);
        const file = await readDocFile(worktree, "docs/specs/ui/shell.md");
        expect([file?.title, file?.frontmatter, file?.recent.map((entry) => entry.subject)]).toEqual(["外壳 v2", {status: "draft"}, ["branch docs", "docs"]]);
        expect(await readDocFile(worktree, "docs/specs/ui/old.md")).toBeNull();
    });
});

describe("搜索", () => {
    test("搜索词：去掉首尾空白后 2 到 200 字、不含控制字符", () => {
        expect(validateSearchQuery("  ab ")).toBe("ab");
        for (const bad of ["", " a ", "a\nb", "a\0b", "x".repeat(201)]) expect(() => validateSearchQuery(bad)).toThrow();
    });

    test("文件名与内容；排除证据、实验与依赖目录；结果逐行过段检查；同一 checkout 读满上限就停", async () => {
        const fixture = await createFixture("panel-search");
        await fixture.write("docs/panel-guide.md", "面板 needle 一行\n第二行 NEEDLE\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/evidences/needle.txt", "needle in evidence\n");
        await fixture.write("tasks/experiments/x.txt", "needle in experiment\n");
        await fixture.write("lib/node_modules/pkg/index.js", "needle in deps\n");
        await fixture.write("packages/app/.env.example", "NEEDLE=1\n");
        await fixture.write("needle-name.txt", "no match here\n");
        await fixture.commit("search fixture");
        const checkouts = (await listCheckouts(fixture.main)).map((checkout) => ({key: "main", root: checkout.root, head: checkout.head}));
        const hits: SearchHit[] = [];
        const done: Array<{truncated: boolean}> = [];
        await searchCheckouts({q: "needle", checkouts, names: createNameIndexCache(), signal: new AbortController().signal, onHit: (hit) => hits.push(hit), onCheckoutDone: (entry) => done.push(entry)});
        expect(hits.map((hit) => [hit.kind, hit.path, hit.line])).toEqual([
            ["name", "needle-name.txt", null],
            ["content", "docs/panel-guide.md", 1],
            ["content", "docs/panel-guide.md", 2],
        ]);
        expect(done).toEqual([expect.objectContaining({checkout: "main", count: 3, truncated: false, error: null})]);

        const limited: SearchHit[] = [];
        await searchCheckouts({q: "needle", checkouts, names: createNameIndexCache(), signal: new AbortController().signal, limit: 1, onHit: (hit) => limited.push(hit), onCheckoutDone: (entry) => done.push(entry)});
        expect([limited.length, done.at(-1)?.truncated]).toEqual([2, true]);
    });

    test("段检查：拒绝 ..、.git、node_modules、.env*、本机数据目录与 NUL", () => {
        expect(["docs/a.md", "packages/x/.envy-not/a"].map(unsafePathReason)).toEqual([null, "secret"]);
        expect(["../a", "a//b", ".git/config", "x/node_modules/y", ".env", ".local/agent/x", "workspace/a", "a\0b", "/abs"].map(unsafePathReason)).toEqual([
            "traversal", "traversal", "forbidden_segment", "forbidden_segment", "secret", "local_data", "local_data", "nul", "absolute",
        ]);
    });
});

describe("herdr 的快照与订阅", () => {
    test("快照带 cwd、workspace 与状态序号；订阅收到 subscription_started 后逐行回调，断开时 closed 兑现；白名单外的方法不发出去", async () => {
        const fixture = await createFixture("panel-herdr");
        const fake = await fakeHerdr(fixture, [claudePane("w9:p1", "11111111-1111-4111-8111-111111111111", {cwd: fixture.main, state_change_seq: 7}), shellPane("w9:p2", {cwd: "/tmp"})]);
        const client = createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS});
        const snapshot = await client.snapshot();
        expect(snapshot.panes.map((pane) => [pane.paneId, pane.cwd, pane.workspaceLabel, pane.stateChangeSeq])).toEqual([["w9:p1", fixture.main, "fake", 7], ["w9:p2", "/tmp", "fake", null]]);

        const events: HerdrEvent[] = [];
        const subscription = client.subscribe([{type: "pane.created"}], (event) => events.push(event));
        await subscription.ready;
        fake.emit("pane.agent_status_changed", {pane_id: "w9:p1", workspace_id: "w9", agent_status: "working"});
        while (events.length === 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        expect(events).toEqual([{event: "pane.agent_status_changed", data: {pane_id: "w9:p1", workspace_id: "w9", agent_status: "working"}}]);
        fake.dropSubscribers();
        expect(await subscription.closed).toEqual({reason: "closed"});

        const readOnly = createHerdrClient({socketPath: fake.socketPath, allow: HERDR_READ_METHODS});
        await expect(readOnly.snapshot()).rejects.toMatchObject({code: "method_not_allowed"});
        await expect(readOnly.subscribe([], () => undefined).ready).rejects.toMatchObject({code: "method_not_allowed"});
        fake.overrides["events.subscribe"] = {code: "invalid_params", message: "bad"};
        await expect(client.subscribe([], () => undefined).ready).rejects.toMatchObject({code: "invalid_params"});
        expect(fake.requests.filter((request) => request.method === "session.snapshot")).toHaveLength(1);
    });
});
