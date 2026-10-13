import {execFile as execFileCallback} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {ackAnswers, askQuestions, createTask, createWork, editRecordFile, locateRepository, PANEL_DEVELOPER, parseTaskId, parseWorkId, publishArtifact, readGovernanceLineLimits, submitAnswer} from "@notnotype/dev-panel";
import {GOVERNANCE_NON_EMPTY_LINE_LIMITS, verifyWorkContracts} from "#scripts/ci/agent-governance-contract";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

/**
 * nbdev（packages/dev-panel）写出的记录必须通过治理检查，两边的编号格式必须一致。
 * 依赖方向是根脚本依赖包的公开入口；本测试在 Node 下运行，也守住“公开入口只用 Node 兼容 API”。
 */
const execFile = promisify(execFileCallback);
const fixtureRoots: string[] = [];

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function runGit(cwd: string, args: string[]): Promise<string> {
    const {stdout} = await execFile("git", args, {cwd, encoding: "utf8"});
    return stdout.trim();
}

async function writeText(root: string, relativePath: string, content: string): Promise<void> {
    await mkdir(dirname(join(root, relativePath)), {recursive: true});
    await writeFile(join(root, relativePath), content, "utf8");
}

async function createRepository(name: string): Promise<string> {
    const root = await createTestTmpRoot(name, `${name}-test`);
    fixtureRoots.push(root);
    const main = join(root, "main");
    await mkdir(join(main, ".agents/works"), {recursive: true});
    await runGit(main, ["init", "--quiet", "--initial-branch", "master"]);
    await runGit(main, ["config", "user.email", "dev-panel-records@example.invalid"]);
    await runGit(main, ["config", "user.name", "Dev Panel Records"]);
    await runGit(main, ["config", "commit.gpgsign", "false"]);
    await writeText(main, ".gitignore", "/.local/*\n");
    await runGit(main, ["add", ".gitignore"]);
    await runGit(main, ["commit", "--quiet", "-m", "init"]);
    return main;
}

describe("nbdev 记录与治理检查一致", () => {
    it("核心库建出的 Work 与 Task（含 t100）全部通过 verifyWorkContracts", async () => {
        const main = await createRepository("dev-panel-records");
        const context = await locateRepository(main);
        const work = await createWork(context, {slug: "records", title: "记录", goal: "核对记录格式。", taskSlug: "first"});
        expect(work.data).toMatchObject({workId: "w00001-records", taskId: "t01-first"});
        expect(work.commit.committed).toBe(true);

        await writeText(main, ".agents/works/w00001-records/tasks/t99-seed/README.md", "---\nschema: nbook.task/v2\ntaskId: t99-seed\n---\n\n# 种子\n");
        await runGit(main, ["add", ".agents/works/w00001-records/tasks/t99-seed/README.md"]);
        await runGit(main, ["commit", "--quiet", "-m", "seed t99"]);
        const task = await createTask(context, {workRef: "w00001", slug: "three-digit", title: "三位"});
        expect(task.data.taskId).toBe("t100-three-digit");
        expect(task.commit.committed).toBe(true);

        expect(verifyWorkContracts(main)).toEqual([]);
        expect(await runGit(main, ["status", "--porcelain"])).toBe("");
    }, 30_000);

    it("发布、登记、代录、确认之后，记录仍然通过 verifyWorkContracts（在 Node 下导入，页面解析器按需加载）", async () => {
        const main = await createRepository("dev-panel-artifacts");
        const context = await locateRepository(main);
        await createWork(context, {slug: "records", title: "记录", goal: "核对产物格式。", taskSlug: "first"});
        await writeText(main, ".agents/works/w00001-records/tasks/t01-first/artifacts/review/index.html", [
            "<!doctype html><title>评审板</title>",
            '<section data-nbdev-question="layout" data-nbdev-type="single"><h2>版式</h2>',
            '<div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>',
        ].join("\n"));
        const target = {workRef: "w00001", taskRef: "t01", artifactId: "review"};
        expect((await publishArtifact(context, {...target, kind: "design"})).commit.committed).toBe(true);
        expect((await askQuestions(context, {workRef: "w00001", taskRef: "t01", questions: [{id: "order", type: "text", label: "顺序"}]})).commit.committed).toBe(true);
        expect((await submitAnswer(context, {...target, values: {layout: "cards"}, submittedBy: {kind: "agent-transcribed"}})).commit.committed).toBe(true);
        expect((await ackAnswers(context, target)).commit.committed).toBe(true);
        expect(verifyWorkContracts(main)).toEqual([]);
        expect(await runGit(main, ["status", "--porcelain"])).toBe("");
    }, 30_000);

    it("面板与命令行同时新建 Work：编号不同（防撞号的主判据），记录格式通过 verifyWorkContracts；面板编辑过的 README 仍然通过", async () => {
        const main = await createRepository("dev-panel-concurrent-create");
        const context = await locateRepository(main);
        const [panel, cli] = await Promise.all([
            createWork(context, {slug: "panel", title: "面板建的", goal: "面板。", taskSlug: "first"}, {caller: PANEL_DEVELOPER}),
            createWork(context, {slug: "cli", title: "命令行建的", goal: "命令行。", taskSlug: "first"}),
        ]);
        expect([panel.commit.committed, cli.commit.committed]).toEqual([true, true]);
        expect(panel.data.workId.slice(0, 6)).not.toBe(cli.data.workId.slice(0, 6));
        const path = `.agents/works/${panel.data.workId}/tasks/t01-first/README.md`;
        const text = await readFile(join(main, path));
        const edited = await editRecordFile(context, {path, content: `${text.toString("utf8")}\n面板补的一段。\n`, baseHash: createHash("sha256").update(text).digest("hex")}, {caller: PANEL_DEVELOPER});
        expect(edited.commit.committed).toBe(true);
        expect(verifyWorkContracts(main)).toEqual([]);
        expect(await runGit(main, ["status", "--porcelain"])).toBe("");
    }, 30_000);

    it("面板按文本读出的治理入口行数上限与治理检查导出的常量一致", async () => {
        expect(await readGovernanceLineLimits(join(dirname(new URL(import.meta.url).pathname), "../.."))).toEqual(GOVERNANCE_NON_EMPTY_LINE_LIMITS);
    });

    it("编号格式与治理检查逐个一致", async () => {
        const root = await createTestTmpRoot("dev-panel-id-format", "dev-panel-id-format-test");
        fixtureRoots.push(root);
        const taskIds = ["t00-a", "t01-a", "t09-a", "t10-a", "t99-a", "t100-a", "t101-a", "t999-a", "t000-a", "t001-a", "t050-a", "t1-a", "t1000-a"];
        await writeText(root, ".agents/works/w00001-ids/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-ids\nissueId: null\n---\n\n# ids\n");
        for (const taskId of taskIds) {
            await writeText(root, `.agents/works/w00001-ids/tasks/${taskId}/README.md`, `---\nschema: nbook.task/v2\ntaskId: ${taskId}\n---\n\n# ${taskId}\n`);
        }
        const workIds = ["w00000-a", "w00002-a", "w99999-a", "w0001-a", "w000001-a"];
        for (const workId of workIds) {
            await writeText(root, `.agents/works/${workId}/README.md`, `---\nschema: nbook.work/v1\nworkId: ${workId}\nissueId: null\n---\n\n# ${workId}\n`);
            await writeText(root, `.agents/works/${workId}/tasks/t01-a/README.md`, "---\nschema: nbook.task/v2\ntaskId: t01-a\n---\n\n# t01\n");
        }
        const failures = verifyWorkContracts(root);
        for (const taskId of taskIds) {
            const rejectedByGovernance = failures.includes(`Work Task 标识格式无效：.agents/works/w00001-ids/tasks/${taskId}`);
            expect([taskId, parseTaskId(taskId) === null]).toEqual([taskId, rejectedByGovernance]);
        }
        for (const workId of workIds) {
            const rejectedByGovernance = failures.includes(`Work 标识格式无效：${workId}`);
            expect([workId, parseWorkId(workId) === null]).toEqual([workId, rejectedByGovernance]);
        }
    });
});
