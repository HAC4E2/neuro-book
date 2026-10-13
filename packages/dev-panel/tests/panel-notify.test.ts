import {afterEach, describe, expect, test} from "bun:test";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {chmod, mkdir, readdir, readFile, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {auditPaths, initAudit} from "../src/core/audit.js";
import {NOTIFY_ROOT} from "../src/core/notify.js";
import {LEASES_DIR} from "../src/core/leases.js";
import {PROVENANCE_ROOT} from "../src/core/provenance.js";
import {locateRepository} from "../src/core/repo.js";
import {createHerdrClient, HERDR_PANEL_METHODS} from "../src/herdr/client.js";
import {createLoginTicket} from "../src/server/auth.js";
import {startPanelServer, type PanelServer} from "../src/server/serve.js";
import {claudePane, startFakeHerdr, type FakeHerdr, type FakePane} from "./fake-herdr.js";
import {cleanupFixtures, createFixture, panelEnv, taskReadme, type Fixture} from "./git-fixture.js";

/**
 * t11 通知与会话页（L3）：面板在进程内起，herdr 是假的（版本报 0.9.3）。提问者的会话由改写 provenance 扮成 Claude 会话
 * （`--as bob` 发布之后把 provenance 里的会话换掉；入库文件的 sha256 不变，核对照样通过）。场景 1、3、4、5、7、8 的接口部分。
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    await cleanupFixtures();
});

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY_A = `claude:${SESSION_A}`;
const KEY_B = `claude:${SESSION_B}`;
const KEY_C = `claude:${SESSION_C}`;
const TASK = {workId: "w00001-seed", taskId: "t01-seed"};
const DEVELOPER_MESSAGE = "开发者在面板上答复了 w00001/t01 的提问（产物 review，共 2 题）。请对括号里列出的每个产物，运行 nbdev answers w00001 t01 <产物> --json 读答复并把决定写进 Task 记录；再运行 nbdev answers ack w00001 t01 <产物> --through <该次输出里的 cursor>。";
const MESSAGE = "[nbdev] w00001/t01 有 2 题新的开发者答复（产物 review）。对括号里列出的每个产物，运行 nbdev answers w00001 t01 <产物> --json 读答复并把决定写进 Task 记录；再运行 nbdev answers ack w00001 t01 <产物> --through <该次输出里的 cursor>。";

type Body = {ok: boolean; data: Record<string, unknown>; errors: Array<{code: string; message: string; details?: Record<string, unknown>}>; warnings: Array<{code: string}>};
type Job = {sessionKey: string; state: string; paneId: string | null; replacedBy: {sessionKey: string; paneId: string} | null; alternatives: Array<{sessionKey: string; paneId: string}>; answers: Array<{answerId: string}>; legacy: unknown[]; message: string; manualMessage: string; developerMessage: string};
type Panel = {
    server: PanelServer;
    send(method: string, path: string, body: unknown): Promise<{status: number; body: Body}>;
    get(path: string): Promise<{status: number; body: Body}>;
    jobs(): Promise<Job[]>;
};

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs: number, what: string): Promise<T> {
    const started = Date.now();
    for (;;) {
        const value = await read();
        if (accept(value)) return value;
        if (Date.now() - started > timeoutMs) throw new Error(`${timeoutMs} 毫秒内没等到：${what}（最后一次：${JSON.stringify(value)}）`);
        await Bun.sleep(100);
    }
}

function page(): string {
    return [
        "<!doctype html><title>评审板</title>",
        '<section data-nbdev-question="layout" data-nbdev-type="single"><h2>版式</h2>',
        '<div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>',
        '<section data-nbdev-question="approve" data-nbdev-type="confirm"><h2>批准</h2></section>',
    ].join("\n");
}

async function filesUnder(dir: string): Promise<string[]> {
    const entries = await readdir(dir, {withFileTypes: true, recursive: true});
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/** 发布一份两道题的评审板（`--as bob`）；`asker` 给了就把提问者改成这个 Claude 会话（provenance 记着它当时在 `w9:p1`）。 */
async function published(name: string, asker: string | null, socketPath = "/fake/herdr.sock", tasks: readonly string[] = ["t01-seed"]): Promise<Fixture> {
    const fixture = await createFixture(name);
    for (const taskId of tasks.filter((entry) => entry !== "t01-seed")) {
        await fixture.write(`.agents/works/w00001-seed/tasks/${taskId}/README.md`, taskReadme(taskId));
        await fixture.commit(`add ${taskId}`);
    }
    for (const taskId of tasks) {
        await fixture.write(`.agents/works/w00001-seed/tasks/${taskId}/artifacts/review/index.html`, page());
        const result = await fixture.cli(["artifact", "publish", "w00001", taskId.slice(0, 3), "review", "--kind", "design", "--as", "bob", "--json"]);
        expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
    }
    if (asker !== null) {
        for (const file of await filesUnder(join(fixture.main, PROVENANCE_ROOT))) {
            const record = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
            record.session = {key: `claude:${asker}`, agent: "claude", sessionId: asker, label: null, parentSessionId: null, nestedSessionId: null, process: null, herdr: {socketPath, paneId: "w9:p1", terminalId: "term_w9:p1"}};
            await writeFile(file, `${JSON.stringify(record, null, 4)}\n`);
        }
    }
    return fixture;
}

/** 一份持有 t01 有效租约的会话（没有进程信息，按最近活动算有效）。 */
async function writeLease(fixture: Fixture, sessionId: string, paneId: string): Promise<void> {
    const leaseId = randomBytes(12).toString("hex");
    const now = new Date().toISOString();
    await mkdir(join(fixture.main, LEASES_DIR), {recursive: true});
    await writeFile(join(fixture.main, LEASES_DIR, `${leaseId}.json`), JSON.stringify({
        schema: "nbdev.lease/v1", leaseId, ...TASK, acquiredAt: now, lastActivityAt: now, lastAction: "claim", releasedAt: null, releaseReason: null,
        session: {key: `claude:${sessionId}`, agent: "claude", sessionId, label: null, parentSessionId: null, nestedSessionId: null, process: null, herdr: {socketPath: "/fake/herdr.sock", paneId, terminalId: `term_${paneId}`}},
    }));
}

async function startPanel(fixture: Fixture, fake: FakeHerdr | null, env: NodeJS.ProcessEnv = panelEnv(fixture)): Promise<Panel> {
    const staticDir = join(fixture.root, "web");
    await mkdir(staticDir, {recursive: true});
    await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head><title>面板</title></head><body>panel-index</body></html>\n");
    const token = randomBytes(32).toString("hex");
    const server = await startPanelServer({
        context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0,
        herdr: fake ? createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_METHODS}) : null,
        token, log: () => undefined, env,
    });
    let stopped = false;
    const stop = async () => {
        if (stopped) return;
        stopped = true;
        await server.stop();
    };
    closers.push(stop);
    await server.setStatic(staticDir, {failed: null});
    await server.warm();
    const cookie = `nbdev_panel_${server.port}=${server.auth.redeem(createLoginTicket(token))}`;
    const csrf = /name="nbdev-csrf" content="([^"]+)"/u.exec(await (await fetch(`${server.url}/`)).text())![1]!;
    const parse = async (response: Response) => ({status: response.status, body: await response.json() as Body});
    const panel: Panel = {
        server,
        async send(method, path, body) {
            return parse(await fetch(`${server.url}${path}`, {method, headers: {Cookie: cookie, Origin: server.url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json"}, body: JSON.stringify(body)}));
        },
        async get(path) {
            return parse(await fetch(`${server.url}${path}`, {headers: {Cookie: cookie}}));
        },
        async jobs() {
            return (await panel.get("/api/notify")).body.data.jobs as Job[];
        },
    };
    Object.assign(panel, {stop});
    return panel;
}

async function stopPanel(panel: Panel): Promise<void> {
    await (panel as Panel & {stop: () => Promise<void>}).stop();
}

/** 改一格 pane 的状态：序号加一、推一条状态事件，再对账一次（不依赖订阅何时连上）。 */
async function setStatus(fake: FakeHerdr, panel: Panel, pane: FakePane, status: string): Promise<void> {
    pane.agent_status = status;
    pane.state_change_seq = (pane.state_change_seq ?? 0) + 1;
    fake.emit("pane.agent_status_changed", {pane_id: pane.pane_id, agent_status: status});
    await panel.server.state.herdr.refresh();
}

async function answer(panel: Panel): Promise<string> {
    const posted = await panel.send("POST", "/api/answers", {...TASK, artifactId: "review", version: 1, values: {layout: "cards", approve: true}, note: null});
    expect([posted.status, posted.body.errors]).toEqual([200, []]);
    return (posted.body.data.answer as {answerId: string}).answerId;
}

async function setup(name: string, options: {asker?: string | null; audit?: boolean; panes: (main: string) => FakePane[]; version?: string}) {
    const fixture = await published(name, options.asker === undefined ? SESSION_A : options.asker);
    if (options.audit !== false) await initAudit(auditPaths(panelEnv(fixture)));
    const panes = options.panes(fixture.main);
    const fake = await startFakeHerdr(fixture.root, panes);
    closers.push(() => fake.close());
    fake.version = options.version ?? "0.9.3";
    const panel = await startPanel(fixture, fake);
    return {fixture, fake, panes, panel};
}

type AuditLine = {schema: string; actionId: string; phase: string; action: string; device: string; target: Record<string, unknown>; detail: Record<string, unknown>};
async function auditLines(fixture: Fixture): Promise<AuditLine[]> {
    const file = auditPaths(panelEnv(fixture)).file;
    if (!existsSync(file)) return [];
    return (await readFile(file, "utf8")).split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as AuditLine);
}

async function notifyRecords(fixture: Fixture): Promise<Array<{result: string; sessionKey: string; askerKey: string; manual: boolean; attemptId: string}>> {
    const dir = join(fixture.main, NOTIFY_ROOT);
    if (!existsSync(dir)) return [];
    const names = (await readdir(dir)).sort();
    return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8"))));
}

describe("自动通知", () => {
    test("场景 1：会话在工作时不发；变为空闲、稳定 3 秒后恰好发一次指针消息；提问者没有租约照样找得到（I4）；尝试记录与审计各两条", async () => {
        const {fixture, fake, panes, panel} = await setup("notify-auto", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, agent_status: "working", state_change_seq: 1})]});
        const answerId = await answer(panel);
        const waiting = await until(() => panel.jobs(), (jobs) => jobs[0]?.state === "waiting_idle", 5_000, "任务进入 waiting_idle");
        expect(waiting.map((job) => [job.sessionKey, job.paneId, job.answers.map((entry) => entry.answerId), job.message])).toEqual([[KEY_A, "w9:p1", [answerId], MESSAGE]]);
        await Bun.sleep(500);
        expect(fake.prompts).toEqual([]);
        const idleAt = Date.now();
        await setStatus(fake, panel, panes[0]!, "idle");
        await until(async () => fake.prompts.length, (count) => count > 0, 8_000, "投递");
        expect(Date.now() - idleAt).toBeGreaterThanOrEqual(3_000);
        await Bun.sleep(1_000);
        expect(fake.prompts).toEqual([{target: "w9:p1", text: MESSAGE}]);
        expect(await panel.jobs()).toEqual([]);
        const records = await notifyRecords(fixture);
        expect(records.map((record) => [record.result, record.sessionKey, record.manual])).toEqual([["pending", KEY_A, false], ["delivered", KEY_A, false]]);
        expect(records[0]!.attemptId).toBe(records[1]!.attemptId);
        const recent = (await panel.get("/api/notify")).body.data.recent as Array<{result: string; intentOnly: boolean}>;
        expect(recent.map((entry) => [entry.result, entry.intentOnly])).toEqual([["delivered", false]]);
        const lines = await auditLines(fixture);
        expect(lines.map((line) => [line.action, line.phase])).toEqual([["answer", "result"], ["notify", "intent"], ["notify", "result"]]);
        expect(lines[1]!.actionId).toBe(lines[2]!.actionId);
        expect([lines[1]!.detail.text, lines[2]!.detail.result, lines[1]!.device]).toEqual([MESSAGE, "delivered", "local"]);
        expect((await stat(auditPaths(panelEnv(fixture)).file)).mode & 0o777).toBe(0o600);
    }, 30_000);

    test("同一个会话在两个 Task 上都有待发的通知：两条都在合理的时间里发出（t11 实现审查第 9 条）", async () => {
        const fixture = await published("notify-two-tasks", SESSION_A, "/fake/herdr.sock", ["t01-seed", "t02-more"]);
        await initAudit(auditPaths(panelEnv(fixture)));
        const pane = claudePane("w9:p1", SESSION_A, {cwd: fixture.main, foreground_cwd: fixture.main, state_change_seq: 1});
        const fake = await startFakeHerdr(fixture.root, [pane]);
        closers.push(() => fake.close());
        fake.version = "0.9.3";
        const panel = await startPanel(fixture, fake);
        for (const taskId of ["t01-seed", "t02-more"]) {
            const posted = await panel.send("POST", "/api/answers", {workId: "w00001-seed", taskId, artifactId: "review", version: 1, values: {layout: "cards"}, note: null});
            expect([taskId, posted.status]).toEqual([taskId, 200]);
        }
        await until(async () => fake.prompts.length, (count) => count >= 1, 10_000, "第一条投递");
        // 投递之后假会话进入工作；回到空闲后，第二条在下一次稳定之后发出。
        await setStatus(fake, panel, pane, "idle");
        await until(async () => fake.prompts.length, (count) => count >= 2, 10_000, "第二条投递");
        expect(fake.prompts.map((prompt) => prompt.text.slice(0, 18)).sort()).toEqual(["[nbdev] w00001/t01", "[nbdev] w00001/t02"]);
        await until(() => panel.jobs(), (jobs) => jobs.length === 0, 5_000, "两条任务都办完");
    }, 40_000);

    test("场景 7：在等确认不发（waiting_blocked）；空闲但屏幕认不出（waiting_input）也不发；状态变化之后重读、认出空输入框才发", async () => {
        const {fake, panes, panel} = await setup("notify-blocked", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, agent_status: "blocked", state_change_seq: 1})]});
        await answer(panel);
        await until(() => panel.jobs(), (jobs) => jobs[0]?.state === "waiting_blocked", 5_000, "waiting_blocked");
        panes[0]!.explain = {matched: null, fallback: "default_known_agent_idle_fallback", preview: ""};
        await setStatus(fake, panel, panes[0]!, "idle");
        const input = await until(() => panel.jobs(), (jobs) => jobs[0]?.state === "waiting_input", 8_000, "waiting_input");
        expect(input[0]).toMatchObject({paneId: "w9:p1"});
        expect(fake.prompts).toEqual([]);
        delete panes[0]!.explain;
        await setStatus(fake, panel, panes[0]!, "working");
        await setStatus(fake, panel, panes[0]!, "idle");
        await until(async () => fake.prompts.length, (count) => count > 0, 8_000, "投递");
        expect(fake.prompts.map((prompt) => prompt.text)).toEqual([MESSAGE]);
    }, 30_000);

    test("场景 5：工作中停掉面板再起，任务仍在、空闲后发出一次；再起一次不重发", async () => {
        const fixture = await published("notify-restart", SESSION_A);
        await initAudit(auditPaths(panelEnv(fixture)));
        const pane = claudePane("w9:p1", SESSION_A, {cwd: fixture.main, foreground_cwd: fixture.main, agent_status: "working", state_change_seq: 1});
        const fake = await startFakeHerdr(fixture.root, [pane]);
        closers.push(() => fake.close());
        fake.version = "0.9.3";
        const first = await startPanel(fixture, fake);
        await answer(first);
        await until(() => first.jobs(), (jobs) => jobs[0]?.state === "waiting_idle", 5_000, "第一次起：waiting_idle");
        await stopPanel(first);
        const second = await startPanel(fixture, fake);
        await until(() => second.jobs(), (jobs) => jobs[0]?.state === "waiting_idle", 5_000, "重起之后任务仍在");
        await setStatus(fake, second, pane, "idle");
        await until(async () => fake.prompts.length, (count) => count > 0, 8_000, "重起之后投递");
        await stopPanel(second);
        pane.agent_status = "idle";
        pane.state_change_seq = (pane.state_change_seq ?? 0) + 1;
        const third = await startPanel(fixture, fake);
        await Bun.sleep(4_500);
        expect(await third.jobs()).toEqual([]);
        expect(fake.prompts.length).toBe(1);
    }, 40_000);

    test("这个 herdr 版本不自动投（manual_only）；手动发给提问者照样过判据", async () => {
        const {fake, panel} = await setup("notify-version", {version: "0.9.2", panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main})]});
        await answer(panel);
        await until(() => panel.jobs(), (jobs) => jobs[0]?.state === "manual_only", 5_000, "manual_only");
        await Bun.sleep(3_500);
        expect(fake.prompts).toEqual([]);
        const withText = await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target: {paneId: "w9:p1", sessionKey: KEY_A}, text: "随便写的"});
        expect([withText.status, withText.body.errors[0]?.details?.reason]).toEqual([400, "asker"]);
        const sent = await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target: {paneId: "w9:p1", sessionKey: KEY_A}});
        expect([sent.status, sent.body.data.result]).toEqual([200, "delivered"]);
        expect(fake.prompts.map((prompt) => prompt.text)).toEqual([MESSAGE]);
        expect(await panel.jobs()).toEqual([]);
    }, 30_000);
});

describe("收口（t11 实现审查第 4 条）", () => {
    test("收口时正好有一个会失败的手动发送：stop 照常返回，端口不再回应", async () => {
        const {fake, panel} = await setup("notify-stop-reject", {version: "0.9.2", panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main})]});
        await answer(panel);
        await until(() => panel.jobs(), (jobs) => jobs[0]?.state === "manual_only", 5_000, "manual_only");
        // 读屏不回应：手动发送在 2 秒后以本地超时失败（503 herdr_unavailable）。
        fake.overrides["agent.read"] = "hang";
        const sending = panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target: {paneId: "w9:p1", sessionKey: KEY_A}}).catch((error: unknown) => error);
        await until(async () => fake.requests.some((request) => request.method === "agent.read"), (seen) => seen, 5_000, "手动发送进行到读屏");
        const url = panel.server.url;
        await stopPanel(panel);
        await sending;
        const after = await fetch(`${url}/api/meta`).then(() => "回应了", () => "连不上");
        expect(after).toBe("连不上");
        expect(fake.prompts).toEqual([]);
    }, 30_000);
});

describe("找不到提问者", () => {
    test("场景 3：提问者原来的 pane 上换了会话：replaced，不发；发给现在的会话的是开发者确认过的普通消息（不带 [nbdev]），恰好一次", async () => {
        const {fixture, fake, panel} = await setup("notify-replaced", {panes: (main) => [claudePane("w9:p1", SESSION_B, {cwd: main, foreground_cwd: main})]});
        await answer(panel);
        const jobs = await until(() => panel.jobs(), (list) => list[0]?.state === "replaced", 5_000, "replaced");
        expect([jobs[0]!.sessionKey, jobs[0]!.replacedBy?.sessionKey, jobs[0]!.replacedBy?.paneId]).toEqual([KEY_A, KEY_B, "w9:p1"]);
        await Bun.sleep(3_500);
        expect(fake.prompts).toEqual([]);
        const wrong = await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target: {paneId: "w9:p1", sessionKey: KEY_C}});
        expect([wrong.status, wrong.body.errors[0]?.code]).toEqual([409, "session_changed"]);
        expect(jobs[0]!.developerMessage).toBe(DEVELOPER_MESSAGE);
        const target = {paneId: "w9:p1", sessionKey: KEY_B};
        const refused = [
            await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target}),
            await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target, text: "  "}),
            await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target, text: MESSAGE}),
        ];
        expect(refused.map((call) => [call.status, call.body.errors[0]?.details?.reason])).toEqual([[400, "missing"], [400, "missing"], [400, "nbdev_prefix"]]);
        const edited = `${DEVELOPER_MESSAGE}（改过）`;
        const sent = await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target, text: edited});
        expect([sent.status, sent.body.data.result]).toEqual([200, "delivered"]);
        expect(fake.prompts).toEqual([{target: "w9:p1", text: edited}]);
        const notifyAudit = (await auditLines(fixture)).find((line) => line.action === "notify" && line.phase === "intent");
        expect([notifyAudit?.detail.kind, notifyAudit?.detail.text]).toEqual(["developer_message", edited]);
        expect(await panel.jobs()).toEqual([]);
        const records = await notifyRecords(fixture);
        expect(records.map((record) => [record.result, record.sessionKey, record.askerKey, record.manual])).toEqual([["pending", KEY_B, KEY_A, true], ["delivered", KEY_B, KEY_A, true]]);
    }, 30_000);

    test("场景 4：外部会话提问：no_target，列出持有这个 Task 租约、在 herdr 里、在本仓库的会话；发给它，或选“不通知”", async () => {
        const {fixture, fake, panel} = await setup("notify-no-target", {asker: null, panes: (main) => [claudePane("w9:p3", SESSION_C, {cwd: main, foreground_cwd: main}), claudePane("w9:p4", SESSION_B, {cwd: "/elsewhere", foreground_cwd: "/elsewhere"})]});
        await writeLease(fixture, SESSION_C, "w9:p3");
        await writeLease(fixture, SESSION_B, "w9:p4");
        await panel.server.state.activity.run();
        await answer(panel);
        const jobs = await until(() => panel.jobs(), (list) => list[0]?.state === "no_target" && list[0].alternatives.length > 0, 5_000, "no_target 带候选");
        expect([jobs[0]!.sessionKey, jobs[0]!.alternatives.map((entry) => [entry.sessionKey, entry.paneId])]).toEqual(["external:bob", [[KEY_C, "w9:p3"]]]);
        const sent = await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: "external:bob", target: {paneId: "w9:p3", sessionKey: KEY_C}, text: DEVELOPER_MESSAGE});
        expect([sent.status, sent.body.data.result]).toEqual([200, "delivered"]);
        expect(fake.prompts).toEqual([{target: "w9:p3", text: DEVELOPER_MESSAGE}]);
        expect(await panel.jobs()).toEqual([]);

        // 第二份答复：选“不通知”，记 skipped，任务消失、不发。
        const posted = await panel.send("POST", "/api/answers", {...TASK, artifactId: "review", version: 1, values: {layout: "table"}, note: null});
        expect(posted.status).toBe(200);
        await until(() => panel.jobs(), (list) => list.length === 1, 5_000, "第二份答复的任务");
        const skipped = await panel.send("POST", "/api/notify/skip", {...TASK, sessionKey: "external:bob"});
        expect([skipped.status, skipped.body.errors]).toEqual([200, []]);
        expect(await panel.jobs()).toEqual([]);
        expect((await notifyRecords(fixture)).at(-1)).toMatchObject({result: "skipped", sessionKey: "external:bob"});
        expect(fake.prompts.length).toBe(1);
    }, 30_000);
});

describe("审计（场景 8）与会话页", () => {
    test("审计没初始化：通知不排队，文字、按键、手动发送都回 audit_unavailable 且不调 herdr；写仓库照常、不建审计目录", async () => {
        const {fixture, fake, panel} = await setup("notify-no-audit", {audit: false, panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main})]});
        await answer(panel);
        await until(() => panel.jobs(), (jobs) => jobs[0]?.state === "audit_unavailable", 5_000, "audit_unavailable");
        const meta = await panel.get("/api/meta");
        expect(meta.body.data.audit).toMatchObject({enabled: false, reason: "not_initialized"});
        const calls = [
            await panel.send("POST", "/api/sessions/w9:p1/prompt", {text: "你好", expectedSession: KEY_A}),
            await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["up"], expectedSession: KEY_A}),
            await panel.send("POST", "/api/notify/send", {...TASK, sessionKey: KEY_A, target: {paneId: "w9:p1", sessionKey: KEY_A}}),
        ];
        expect(calls.map((call) => [call.status, call.body.errors[0]?.code])).toEqual([[409, "audit_unavailable"], [409, "audit_unavailable"], [409, "audit_unavailable"]]);
        await Bun.sleep(3_500);
        expect(fake.requests.filter((request) => request.method === "agent.prompt" || request.method === "agent.send_keys")).toEqual([]);
        expect(existsSync(auditPaths(panelEnv(fixture)).dir)).toBe(false);
    }, 30_000);

    test("输入框与按键：校验顺序、会话核对、不可投时先给屏幕再两步确认、Ctrl+C 限速；每个动作一行意图加一行结果", async () => {
        const {fixture, fake, panes, panel} = await setup("notify-session-io", {asker: null, panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main})]});
        const pane = panes[0]!;
        const screen = await panel.get(`/api/sessions/w9:p1/screen?session=${encodeURIComponent(KEY_A)}`);
        expect([screen.status, screen.body.data.status, (screen.body.data.screen as string).includes("❯")]).toEqual([200, "idle", true]);
        const cases = [
            [await panel.send("POST", "/api/sessions/w9:p1/prompt", {text: "x\u001b[A", expectedSession: KEY_A}), 400, "invalid_text"],
            [await panel.send("POST", "/api/sessions/w9:p1/prompt", {text: "x".repeat(4001), expectedSession: KEY_A}), 400, "usage"],
            [await panel.send("POST", "/api/sessions/w9:p1/prompt", {text: "你好", expectedSession: KEY_B}), 409, "session_changed"],
            [await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["f1"], expectedSession: KEY_A}), 400, "key_not_allowed"],
            [await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["enter"], expectedSession: KEY_A}), 400, "usage"],
            [await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["shift+tab"], expectedSession: KEY_A}), 400, "usage"],
            [await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["up"]}), 400, "usage"],
        ] as const;
        expect(cases.map(([call, status, code]) => [call.status, call.body.errors[0]?.code, status, code])).toEqual(cases.map(([, status, code]) => [status, code, status, code]));
        expect([fake.prompts, fake.keys]).toEqual([[], []]);

        const ok = await panel.send("POST", "/api/sessions/w9:p1/prompt", {text: "继续\n第二行", expectedSession: KEY_A});
        expect([ok.status, ok.body.data.result]).toEqual([200, "delivered"]);
        pane.agent_status = "idle";
        pane.explain = {matched: "live_prompt_box", fallback: null, preview: "❯ 半截\n"};
        pane.visible = "──────────────────────────────\n❯ 半截\n──────────────────────────────\n";
        const refused = await panel.send("POST", "/api/sessions/w9:p1/prompt", {text: "再来", expectedSession: KEY_A});
        expect([refused.status, refused.body.errors[0]?.code, String(refused.body.errors[0]?.details?.screen).includes("半截")]).toEqual([409, "not_deliverable", true]);
        const confirmed = await panel.send("POST", "/api/sessions/w9:p1/prompt", {text: "再来", expectedSession: KEY_A, confirmScreen: true});
        expect([confirmed.status, confirmed.body.data.result]).toEqual([200, "delivered"]);
        expect(fake.prompts.map((prompt) => prompt.text)).toEqual(["继续\n第二行", "再来"]);

        pane.agent_status = "blocked";
        expect((await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["up"], expectedSession: KEY_A})).status).toBe(200);
        expect((await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["enter"], expectedSession: KEY_A, confirmed: true})).status).toBe(200);
        expect((await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["ctrl+c"], expectedSession: KEY_A, confirmed: true})).status).toBe(200);
        const again = await panel.send("POST", "/api/sessions/w9:p1/keys", {keys: ["ctrl+c"], expectedSession: KEY_A, confirmed: true});
        expect([again.status, again.body.errors[0]?.code]).toEqual([409, "key_rate_limited"]);
        expect(fake.keys.map((entry) => entry.keys)).toEqual([["up"], ["enter"], ["ctrl+c"]]);

        const lines = await auditLines(fixture);
        const byAction = (action: string) => lines.filter((line) => line.action === action).map((line) => line.phase);
        expect([byAction("prompt"), byAction("keys")]).toEqual([["intent", "result", "intent", "result"], ["intent", "result", "intent", "result", "intent", "result"]]);
        for (let index = 0; index < lines.length; index += 2) expect([lines[index]!.actionId, lines[index]!.phase]).toEqual([lines[index + 1]!.actionId, "intent"]);
        expect(lines.find((line) => line.action === "prompt")?.detail.text).toBe("继续\n第二行");
        // 白名单（场景 6）：面板发给 herdr 的方法都在名单里。
        expect(fake.requests.every((request) => HERDR_PANEL_METHODS.includes(request.method))).toBe(true);
    }, 30_000);
});

describe("写仓库的审计（场景 8）", () => {
    test("t10 的五个写接口各补一行结果（同一个动作只有结果行）；审计初始化过却写不进去时照常写入、给 audit_write_failed，herdr 输入类动作回 audit_unavailable", async () => {
        const {fixture, fake, panel} = await setup("notify-write-audit", {asker: null, panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main})]});
        const work = await panel.send("POST", "/api/works", {slug: "panel", title: "面板建的", goal: "面板。", taskSlug: "first"});
        expect(work.status).toBe(200);
        const workId = work.body.data.workId as string;
        expect((await panel.send("POST", `/api/works/${workId}/tasks`, {slug: "second", title: "第二个", goal: null, status: "active"})).status).toBe(200);
        const readme = ".agents/works/w00001-seed/tasks/t01-seed/README.md";
        const opened = (await panel.get(`/api/files?path=${encodeURIComponent(readme)}`)).body.data as {text: string; hash: string};
        expect((await panel.send("PUT", `/api/files?path=${encodeURIComponent(readme)}`, {content: `${opened.text}面板加的一行。\n`, baseHash: opened.hash})).status).toBe(200);
        const task = (await panel.get("/api/task/w00001-seed/t01-seed")).body.data as {task: {readmeHash: string}};
        expect((await panel.send("POST", "/api/works/w00001-seed/tasks/t01-seed/status", {status: "active", expectedHash: task.task.readmeHash})).status).toBe(200);
        await answer(panel);
        const lines = await auditLines(fixture);
        expect(lines.map((line) => [line.action, line.phase, line.detail.committed])).toEqual([
            ["create_work", "result", true], ["create_task", "result", true], ["edit", "result", true], ["status", "result", true], ["answer", "result", true],
        ]);
        expect(new Set(lines.map((line) => line.actionId)).size).toBe(5);

        const {file} = auditPaths(panelEnv(fixture));
        await chmod(file, 0o644);
        const posted = await panel.send("POST", "/api/answers", {...TASK, artifactId: "review", version: 1, values: {layout: "table"}, note: null});
        expect([posted.status, posted.body.warnings.map((warning) => warning.code)]).toEqual([200, ["audit_write_failed"]]);
        const refused = await panel.send("POST", "/api/sessions/w9:p1/prompt", {text: "你好", expectedSession: KEY_A});
        expect([refused.status, refused.body.errors[0]?.code, refused.body.errors[0]?.details?.reason]).toEqual([409, "audit_unavailable", "bad_mode"]);
        expect(fake.requests.filter((request) => request.method.startsWith("agent."))).toEqual([]);
        expect((await auditLines(fixture)).length).toBe(5);
    }, 30_000);
});

describe("常驻（S5）", () => {
    test("单元文件给的 NBDEV_PANEL_UNIT：/api/meta 写出单元名与重启命令；没有或写法不对时为 null", async () => {
        const fixture = await createFixture("notify-service-meta");
        const cases: Array<[string | undefined, string | null]> = [["nbdev-panel-main.service", "systemctl --user restart nbdev-panel-main.service"], [undefined, null], ["bad unit; rm -rf", null]];
        for (const [unit, command] of cases) {
            const panel = await startPanel(fixture, null, {...panelEnv(fixture), ...(unit === undefined ? {} : {NBDEV_PANEL_UNIT: unit})});
            const meta = await panel.get("/api/meta");
            expect([unit, meta.body.data.service]).toEqual([unit, {unit: command === null ? null : unit, restartCommand: command}]);
            await stopPanel(panel);
        }
    }, 30_000);
});
