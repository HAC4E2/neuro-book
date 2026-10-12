import {afterEach, describe, expect, test} from "bun:test";
import {spawn} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {once} from "node:events";
import {readdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {submitAnswer} from "../src/core/artifact-ops.js";
import {readArtifact} from "../src/core/artifacts.js";
import {askerOf} from "../src/core/provenance.js";
import {locateRepository} from "../src/core/repo.js";
import {CLI_PATH, cleanupFixtures, createFixture, git, run, taskReadme, type CliEnvelope, type Fixture} from "./git-fixture.js";
import {startFakeClaude, type FakeClaude} from "./processes.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    await cleanupFixtures();
});

const TASK_DIR = ".agents/works/w00001-seed/tasks/t01-seed";
const DIR = `${TASK_DIR}/artifacts/review`;
const REF = {workId: "w00001-seed", taskId: "t01-seed", artifactId: "review"};
const BOARD = resolve(import.meta.dirname, "fixtures/t03-review/index.html");
const NO_PARSE5 = resolve(import.meta.dirname, "no-parse5-preload.ts");

function page(first = "layout"): string {
    return [
        "<!doctype html><title>评审板</title>",
        `<section data-nbdev-question="${first}" data-nbdev-type="single"><h2>版式</h2>`,
        '<div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>',
        '<section data-nbdev-question="approve" data-nbdev-type="confirm"><h2>批准</h2></section>',
    ].join("\n");
}

function data<T>(envelope: CliEnvelope | null): T {
    return envelope?.data as T;
}

async function published(name: string, html = page()): Promise<Fixture> {
    const fixture = await createFixture(name);
    await fixture.write(`${DIR}/index.html`, html);
    const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
    expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
    return fixture;
}

async function claudeSession(): Promise<FakeClaude> {
    const host = await startFakeClaude(randomUUID());
    closers.push(() => host.stop());
    return host;
}

type InboxJson = Array<{kind: string; artifactId?: string; questionId?: string; askedBy?: string | null}>;

async function inbox(fixture: Fixture): Promise<InboxJson> {
    const status = await fixture.cli(["status", "--json"]);
    expect(status.exitCode).toBe(0);
    return data<{inbox: InboxJson}>(status.json).inbox.filter((item) => item.kind === "question");
}

/** 起一个挂着 `answers --wait` 的命令行子进程，等它在 stderr 报“等待中”才返回。 */
async function startWaiter(fixture: Fixture, args: string[]): Promise<{child: ReturnType<typeof spawn>; result: Promise<{exitCode: number | null; stdout: string; stderr: string}>}> {
    const child = spawn(process.execPath, [CLI_PATH, "answers", ...args, "--wait", "--json"], {cwd: fixture.main, env: process.env, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
    });
    const waiting = new Promise<void>((resolveWaiting, rejectWaiting) => {
        child.stderr!.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
            if (stderr.includes("等待中")) resolveWaiting();
        });
        child.once("exit", () => rejectWaiting(new Error(`等待的命令提前退出了：${stderr}`)));
    });
    const result = once(child, "exit").then(([code]) => ({exitCode: code as number | null, stdout, stderr}));
    closers.push(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await once(child, "exit");
        }
    });
    await waiting;
    return {child, result};
}

describe("产物与答复的命令（场景）", () => {
    test("场景 1：Claude 会话发布评审板拷贝：题与页面一致，提问者是这个会话的租约", async () => {
        const fixture = await createFixture("cli-publish-claude");
        const board = (await readFile(BOARD, "utf8"))
            .replace('<section class="q" id="r3-home">\n        <h2><span class="badge success">', '<section class="q" id="r3-home" data-nbdev-question="home-layout" data-nbdev-type="single">\n        <h2><span class="badge success" data-nbdev-skip>')
            .replace('<div class="cand"><a class="pv" href="r3/home.html#A">', '<div class="cand" data-nbdev-option="cards"><a class="pv" href="r3/home.html#A">')
            .replace('<div class="cand"><a class="pv" href="r3/home.html#B">', '<div class="cand" data-nbdev-option="table"><a class="pv" href="r3/home.html#B">')
            .replace('<section class="q" id="r2-docs">\n        <h2><span class="badge', '<section class="q" id="r2-docs" data-nbdev-question="docs-tree" data-nbdev-type="confirm">\n        <h2><span data-nbdev-skip class="badge');
        await fixture.write(`${DIR}/index.html`, board);
        const claude = await claudeSession();
        const result = await claude.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--json"], fixture.main);
        expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
        const published = data<{version: number; questions: Array<{id: string; type: string; options: Array<{value: string}>}>; lease: {leaseId: string; session: {key: string}}}>(result.json);
        expect([published.version, published.questions.map((question) => [question.id, question.type, question.options.map((option) => option.value)])]).toEqual([1, [["home-layout", "single", ["cards", "table"]], ["docs-tree", "confirm", []]]]);
        expect(published.lease.session.key).toBe(`claude:${claude.sessionId}`);
        expect(await askerOf(fixture.main, REF, "docs-tree")).toMatchObject({leaseId: published.lease.leaseId, session: {key: `claude:${claude.sessionId}`}});
        expect((await inbox(fixture)).map((item) => [item.questionId, item.askedBy])).toEqual([["docs-tree", `claude:${claude.sessionId}`], ["home-layout", `claude:${claude.sessionId}`]]);
    });

    test("场景 2：答了一道题后换掉另一道的题号：旧题号被取代，已答的题标针对 v1，收件箱不算被取代的题", async () => {
        const fixture = await published("cli-renumber");
        expect((await fixture.cli(["answers", "record", "w00001", "t01", "review", "--set", "approve=yes", "--as", "bob", "--json"])).exitCode).toBe(0);
        await fixture.write(`${DIR}/index.html`, page("layout-v2"));
        const v2 = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--as", "bob", "--json"]);
        expect([v2.exitCode, data<{dropped: string[]}>(v2.json).dropped]).toEqual([0, ["layout"]]);
        const answers = await fixture.cli(["answers", "w00001", "t01", "review", "--json"]);
        const view = data<{artifacts: Array<{version: number; questions: Array<{question: {id: string}; state: string; answer: {value: unknown; artifactVersion: number} | null}>}>}>(answers.json).artifacts[0]!;
        expect([view.version, view.questions.map((state) => [state.question.id, state.state, state.answer?.artifactVersion ?? null])]).toEqual([2, [["layout", "superseded", null], ["approve", "answered", 1], ["layout-v2", "open", null]]]);
        expect((await inbox(fixture)).map((item) => item.questionId)).toEqual(["layout-v2"]);
        const pending = await fixture.cli(["answers", "--pending", "--json"]);
        expect(data<{artifacts: Array<{questions: Array<{question: {id: string}}>}>}>(pending.json).artifacts.map((artifact) => artifact.questions.map((state) => state.question.id))).toEqual([["layout-v2"]]);
    });

    test("场景 3：ask 登记的题进收件箱，ask withdraw 之后消失", async () => {
        const fixture = await createFixture("cli-ask");
        const asked = await fixture.cli(["ask", "w00001", "t01", "--id", "migrate-order", "--type", "text", "--label", "迁移顺序怎么排", "--as", "bob", "--json"]);
        expect([asked.exitCode, data<{artifactId: string; version: number}>(asked.json)]).toEqual([0, expect.objectContaining({artifactId: "questions", version: 1})]);
        expect((await inbox(fixture)).map((item) => [item.artifactId, item.questionId, item.askedBy])).toEqual([["questions", "migrate-order", "external:bob"]]);
        expect((await fixture.cli(["ask", "withdraw", "w00001", "t01", "migrate-order", "--as", "bob", "--json"])).exitCode).toBe(0);
        expect(await inbox(fixture)).toEqual([]);
        const fromFile = join(fixture.root, "questions.json");
        await writeFile(fromFile, JSON.stringify({questions: [{id: "pick", type: "single", label: "选一个", options: "a:甲|b:乙", recommend: "a"}, {id: "ok", type: "confirm", label: "同意吗", required: false}]}));
        const batch = await fixture.cli(["ask", "w00001", "t01", "--from", fromFile, "--as", "bob", "--json"]);
        expect([batch.exitCode, data<{affected: string[]}>(batch.json).affected]).toEqual([0, ["pick", "ok"]]);
        expect((await fixture.cli(["ask", "w00001", "t01", "--from", fromFile, "--id", "x", "--json"])).exitCode).toBe(2);
    });

    test("场景 4：挂着的 --wait 在答复写入并提交后几秒内退出并带回答复；超时、被打断都是退出码 4；--since 只等新的", async () => {
        const fixture = await published("cli-wait");
        const context = await locateRepository(fixture.main);
        const waiter = await startWaiter(fixture, ["w00001", "t01", "review", "--timeout", "60"]);
        const written = Date.now();
        const answered = await submitAnswer(context, {...REF, workRef: "w00001", taskRef: "t01", values: {layout: "cards"}, submittedBy: {kind: "developer", device: "test"}});
        expect(answered.commit.committed).toBe(true);
        const result = await waiter.result;
        expect(Date.now() - written).toBeLessThan(5_000);
        const envelope = JSON.parse(result.stdout) as CliEnvelope;
        expect([result.exitCode, data<{artifacts: Array<{unacked: string[]}>}>(envelope).artifacts[0]?.unacked]).toEqual([0, [answered.data.answer.answerId]]);

        // 已有未确认的答复：立即返回，不等。
        const immediate = await fixture.cli(["answers", "w00001", "t01", "review", "--wait", "--timeout", "60", "--json"]);
        expect([immediate.exitCode, data<{cursor: string}>(immediate.json).cursor]).toEqual([0, answered.data.answer.answerId]);
        const timedOut = await fixture.cli(["answers", "w00001", "t01", "review", "--wait", "--since", answered.data.answer.answerId, "--timeout", "1", "--json"]);
        expect([timedOut.exitCode, timedOut.json?.errors[0]?.code]).toEqual([4, "wait_timeout"]);
        const interrupted = await startWaiter(fixture, ["w00001", "t01", "review", "--since", answered.data.answer.answerId, "--timeout", "60"]);
        interrupted.child.kill("SIGTERM");
        const stopped = await interrupted.result;
        expect([stopped.exitCode, (JSON.parse(stopped.stdout) as CliEnvelope).errors[0]?.code]).toEqual([4, "wait_interrupted"]);
        expect((await fixture.cli(["answers", "--wait", "--pending", "--json"])).exitCode).toBe(2);
        expect((await fixture.cli(["answers", "w00099", "--json"])).json?.errors[0]?.code).toBe("work_not_found");
    }, 60_000);

    test("先 --wait 后 ask：范围为空照常等并给警告，等待期间建出的 Task 提问集有了答复也能叫醒它", async () => {
        const fixture = await createFixture("cli-wait-empty");
        const context = await locateRepository(fixture.main);
        const waiter = await startWaiter(fixture, ["w00001", "t01", "--timeout", "60", "--as", "bob"]);
        const asked = await fixture.cli(["ask", "w00001", "t01", "--id", "migrate-order", "--type", "text", "--label", "迁移顺序怎么排", "--as", "bob", "--json"]);
        expect(asked.exitCode).toBe(0);
        const answered = await submitAnswer(context, {workRef: "w00001", taskRef: "t01", artifactId: "questions", values: {"migrate-order": "先迁记录"}, submittedBy: {kind: "developer", device: "test"}});
        expect(answered.commit.committed).toBe(true);
        const result = await waiter.result;
        const envelope = JSON.parse(result.stdout) as CliEnvelope;
        expect(result.stderr).toContain("范围里还没有产物");
        expect([result.exitCode, data<{artifacts: Array<{artifactId: string; unacked: string[]}>}>(envelope).artifacts.map((view) => [view.artifactId, view.unacked]), envelope.warnings.map((warning) => warning.code)])
            .toEqual([0, [["questions", [answered.data.answer.answerId]]], ["wait_scope_empty"]]);
    }, 60_000);

    test("场景 5：answers ack --through <cursor> --include README：确认与 README 同一个提交；之后 --unacked 不再返回它", async () => {
        const fixture = await published("cli-ack");
        expect((await fixture.cli(["answers", "record", "w00001", "t01", "review", "--set", "layout=table", "--comment", "layout=表更紧凑", "--as", "bob", "--json"])).exitCode).toBe(0);
        const cursor = data<{cursor: string}>((await fixture.cli(["answers", "w00001", "t01", "review", "--json"])).json).cursor;
        await fixture.write(`${TASK_DIR}/README.md`, `${taskReadme("t01-seed")}\n## 决定\n\n1. 用表。\n`);
        const acked = await fixture.cli(["answers", "ack", "w00001", "t01", "review", "--through", cursor, "--include", `${TASK_DIR}/README.md`, "--as", "bob", "--json"]);
        expect([acked.exitCode, acked.json?.warnings]).toEqual([0, []]);
        const sha = data<{commit: {sha: string}}>(acked.json).commit.sha;
        const paths = (await git(fixture.main, "diff-tree", "--no-commit-id", "--name-only", "-r", sha)).split("\n").sort();
        expect(paths).toEqual([data<{path: string}>(acked.json).path, `${TASK_DIR}/README.md`].sort());
        expect(data<{artifacts: unknown[]}>((await fixture.cli(["answers", "--unacked", "--json"])).json).artifacts).toEqual([]);
    });

    test("关闭与重新打开：关闭撤回未答的题、收件箱清空；关闭后 ask 报 artifact_closed；重新发布只恢复因关闭而撤回的题", async () => {
        const fixture = await published("cli-close-reopen");
        expect((await fixture.cli(["answers", "record", "w00001", "t01", "review", "--set", "layout=cards", "--as", "bob", "--json"])).exitCode).toBe(0);
        const closed = await fixture.cli(["artifact", "close", "w00001", "t01", "review", "--as", "bob", "--json"]);
        expect([closed.exitCode, data<{version: number; affected: string[]}>(closed.json)]).toEqual([0, expect.objectContaining({version: 2, affected: ["approve"]})]);
        expect(await inbox(fixture)).toEqual([]);
        const late = await fixture.cli(["ask", "w00001", "t01", "--artifact", "review", "--id", "late", "--type", "text", "--label", "晚到", "--as", "bob", "--json"]);
        expect([late.exitCode, late.json?.errors[0]?.code]).toEqual([3, "artifact_closed"]);
        const reopened = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--as", "bob", "--json"]);
        expect([reopened.exitCode, data<{restored: string[]}>(reopened.json).restored, reopened.json?.warnings.map((warning) => warning.code)]).toEqual([0, ["approve"], ["artifact_reopened"]]);
        expect((await inbox(fixture)).map((item) => item.questionId)).toEqual(["approve"]);
    });

    test("场景 6：引用 800 KB 的 PNG：发布成功，带体积警告", async () => {
        const fixture = await createFixture("cli-image");
        await fixture.write(`${DIR}/index.html`, `${page()}\n<img src="shot.png">`);
        await writeFile(join(fixture.main, DIR, "shot.png"), randomBytes(800 * 1024));
        const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
        expect([result.exitCode, result.json?.warnings.map((warning) => warning.code)]).toEqual([0, ["image_too_large"]]);
    });

    test("场景 7：两个进程同时发布同一个产物：版本号不重复，两次都提交了", async () => {
        const fixture = await createFixture("cli-concurrent-publish");
        await fixture.write(`${DIR}/index.html`, page());
        const [first, second] = await Promise.all(["甲", "乙"].map((title) => fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--title", title, "--as", "bob", "--json"])));
        expect([first!.exitCode, second!.exitCode]).toEqual([0, 0]);
        expect([data<{version: number}>(first!.json).version, data<{version: number}>(second!.json).version].sort()).toEqual([1, 2]);
        expect((await readdir(join(fixture.main, DIR, "versions"))).sort()).toEqual(["v1.json", "v2.json"]);
        expect(await git(fixture.main, "status", "--porcelain", "--", DIR)).toBe("");
    });

    test("场景 8 与最近更新：status 列出 Task 与 Work 目录里的 Markdown；Task 的最近更新取 updated 与产物提交日期中较晚的", async () => {
        const fixture = await createFixture("cli-documents");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "updated: 2026-01-01\n"));
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/requirements.md", "# 需求分析\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t03-design/README.md", taskReadme("t03-design"));
        await fixture.write(".agents/works/w00001-seed/tasks/t03-design/domain-model.md", "# 领域模型\n");
        await fixture.write(".agents/works/w00001-seed/pending.md", "# 待确认清单\n");
        await fixture.write(`${DIR}/index.html`, page());
        await fixture.commit("docs and board");
        const before = await fixture.cli(["status", "--json"]);
        type Works = Array<{documents: Array<{path: string; title: string}>; tasks: Array<{taskId: string; updated: {value: string; origin: string}; documents: Array<{title: string}>; artifacts: Array<{artifactId: string; state: string}>}>}>;
        const work = data<{works: Works}>(before.json).works[0]!;
        expect(work.documents.map((document) => document.title)).toEqual(["待确认清单"]);
        expect(work.tasks.map((task) => [task.taskId, task.documents.map((document) => document.title), task.artifacts.map((artifact) => [artifact.artifactId, artifact.state])])).toEqual([
            ["t01-seed", ["需求分析"], [["review", "unpublished"]]],
            ["t03-design", ["领域模型"], []],
        ]);
        expect((await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"])).exitCode).toBe(0);
        const after = data<{works: Works}>((await fixture.cli(["status", "--json"])).json).works[0]!.tasks[0]!;
        const today = (await git(fixture.main, "log", "-1", "--format=%cI")).slice(0, 10);
        expect(after.updated).toEqual({value: today, origin: "commit"});
    });

    test("status 不加载 parse5、不写任何文件；发布路径才加载；Task 改成 done 时提醒还有没答的必答题", async () => {
        const fixture = await published("cli-status-light");
        const before = (await git(fixture.main, "status", "--porcelain", "--untracked-files=all", "--ignored")).split("\n").sort().join("\n");
        const light = await run(process.execPath, ["--preload", NO_PARSE5, CLI_PATH, "status", "--json"], fixture.main);
        expect([light.exitCode, light.stderr]).toEqual([0, ""]);
        expect((await git(fixture.main, "status", "--porcelain", "--untracked-files=all", "--ignored")).split("\n").sort().join("\n")).toBe(before);
        const heavy = await run(process.execPath, ["--preload", NO_PARSE5, CLI_PATH, "artifact", "publish", "w00001", "t01", "review", "--force-version", "--as", "bob", "--json"], fixture.main);
        expect(heavy.exitCode).not.toBe(0);
        const done = await fixture.cli(["task", "status", "w00001", "t01", "done", "--as", "bob", "--json"]);
        expect([done.exitCode, done.json?.warnings.map((warning) => warning.code)]).toEqual([0, ["open_questions"]]);
        expect((await readArtifact(fixture.main, REF)).latest?.questions.every((question) => question.outcome === null)).toBe(true);
    });
});
