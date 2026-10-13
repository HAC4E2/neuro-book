import {afterEach, describe, expect, test} from "bun:test";
import {randomBytes, randomUUID} from "node:crypto";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {once} from "node:events";
import {connect} from "node:net";
import {join} from "node:path";
import {locateRepository} from "../src/core/repo.js";
import {createHerdrClient, HERDR_PANEL_READ_METHODS} from "../src/herdr/client.js";
import {createLoginTicket} from "../src/server/auth.js";
import {computeBuildHash, ensureWebBuild} from "../src/server/build.js";
import {backoffDelay, HerdrMonitor} from "../src/server/herdr-monitor.js";
import {startPanelServer, type PanelServer} from "../src/server/serve.js";
import {claudePane, shellPane, startFakeHerdr, type FakeHerdr} from "./fake-herdr.js";
import {cleanupFixtures, createFixture, git, run, taskReadme, workReadme, type Fixture} from "./git-fixture.js";
import {startFakeClaude, spawnMarked, stopProcess, type MarkedChild} from "./processes.js";

/** L3：面板服务在进程内起（端口取 0），前端产物用桩页面注入，不依赖 dist/web。 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    await cleanupFixtures();
});

type Panel = {
    server: PanelServer;
    token: string;
    fake: FakeHerdr | null;
    cookie: string;
    logs: string[];
    get(path: string, headers?: Record<string, string>): Promise<Response>;
    json<T = Record<string, unknown>>(path: string): Promise<{status: number; body: {ok: boolean; data: T; errors: Array<{code: string}>; revisions: Record<string, number>; instance: string}}>;
};

async function startPanel(fixture: Fixture, panes: Parameters<typeof startFakeHerdr>[1] | null = []): Promise<Panel> {
    const staticDir = join(fixture.root, "web");
    await mkdir(join(staticDir, "assets"), {recursive: true});
    await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head><title>面板</title></head><body>panel-index</body></html>\n");
    await writeFile(join(staticDir, "assets", "app.js"), "console.log('panel');\n");
    const fake = panes === null ? null : await startFakeHerdr(fixture.root, panes);
    if (fake) closers.push(() => fake.close());
    const token = randomBytes(32).toString("hex");
    const logs: string[] = [];
    const server = await startPanelServer({
        context: await locateRepository(fixture.main),
        host: "127.0.0.1",
        port: 0,
        artifactPort: 0,
        herdr: fake ? createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS}) : null,
        token,
        log: (message) => logs.push(message),
    });
    closers.push(() => server.stop());
    await server.setStatic(staticDir, {failed: null});
    await server.warm();
    const sessionId = server.auth.redeem(createLoginTicket(token))!;
    const cookie = `nbdev_panel=${sessionId}`;
    const get = (path: string, headers: Record<string, string> = {}) => fetch(`${server.url}${path}`, {headers: {Cookie: cookie, ...headers}, redirect: "manual"});
    return {
        server, token, fake, cookie, logs, get,
        async json(path) {
            const response = await get(path);
            return {status: response.status, body: await response.json()};
        },
    } as Panel;
}

/** 原始 HTTP 请求：fetch 会先把 `..`、`%2e%2e` 规范化掉，测到的是 URL 解析器而不是守卫。 */
function rawGet(port: number, path: string, headers: Record<string, string> = {}): Promise<{status: number; text: string}> {
    return new Promise((resolvePromise, rejectPromise) => {
        const socket = connect(port, "127.0.0.1");
        let data = "";
        socket.setEncoding("utf8");
        socket.on("connect", () => {
            const lines = [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`, "Connection: close", ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), "", ""];
            socket.write(lines.join("\r\n"));
        });
        socket.on("data", (chunk: string) => {
            data += chunk;
        });
        socket.on("end", () => resolvePromise({status: Number(data.slice(9, 12)), text: data}));
        socket.on("error", rejectPromise);
    });
}

async function publishedFixture(name: string): Promise<Fixture> {
    const fixture = await createFixture(name);
    await fixture.write(".agents/works/w00002-alpha/README.md", workReadme("w00002-alpha", "status: active\n").replace("w00002-alpha 的目标。", "做一个面板。"));
    await fixture.write(".agents/works/w00002-alpha/tasks/t01-board/README.md", `${taskReadme("t01-board", "status: active\n")}\n## 当前状态\n\n第二轮评审中。\n`);
    await fixture.write(".agents/works/w00003-branchy/README.md", workReadme("w00003-branchy"));
    await fixture.write(".agents/works/w00003-branchy/tasks/t01-old/README.md", taskReadme("t01-old"));
    await fixture.commit("works");
    const worktree = await fixture.addWorktree("w00003-branchy", "feat/w00003");
    await fixture.write(".agents/works/w00003-branchy/tasks/t01-old/README.md", taskReadme("t01-old", "status: active\n"), worktree);
    await fixture.commit("branch records", worktree);
    await fixture.write(".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/index.html", [
        "<!doctype html><title>评审板</title>",
        '<section data-nbdev-question="layout" data-nbdev-type="single"><h2>版式</h2><div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>',
        '<section data-nbdev-question="approve" data-nbdev-type="confirm"><h2>批准</h2></section>',
        '<img src="shot.png">',
    ].join("\n"));
    await writeFile(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/shot.png"), randomBytes(64));
    expect((await fixture.cli(["artifact", "publish", "w00002", "t01", "review", "--kind", "design", "--as", "bob", "--json"])).exitCode).toBe(0);
    return fixture;
}

describe("面板服务（场景）", () => {
    test("场景 1：概览列出全部 Work（状态与目标、来自分支、未标）、收件箱的提问与提问者是否还在；herdr 的状态变化 1 秒内推到 /ws", async () => {
        const fixture = await publishedFixture("panel-s1");
        const sessionId = randomUUID();
        const panel = await startPanel(fixture, [claudePane("w9:p1", sessionId, {cwd: fixture.main})]);
        const {status, body} = await panel.json<{works: Array<{workId: string; status: {value: string | null}; goal: {value: string | null}; source: string; tasks: Array<{taskId: string; currentState: string | null}>}>; inbox: Array<{kind: string; questionId?: string; askedBy?: string; askerActive?: boolean}>}>("/api/overview");
        expect(status).toBe(200);
        expect(body.data.works.map((work) => [work.workId, work.status.value, work.goal.value, work.source])).toEqual([
            ["w00001-seed", null, "w00001-seed 的目标。", "master"],
            ["w00002-alpha", "active", "做一个面板。", "master"],
            ["w00003-branchy", null, "w00003-branchy 的目标。", "branch"],
        ]);
        expect(body.data.works[1]!.tasks[0]).toMatchObject({taskId: "t01-board", currentState: "第二轮评审中。"});
        expect(body.data.inbox.map((item) => [item.questionId, item.askedBy, item.askerActive])).toEqual([["approve", "external:bob", true], ["layout", "external:bob", true]]);

        while (panel.fake!.subscriberCount() === 0) await Bun.sleep(20);
        const socket = new WebSocket(`${panel.server.url.replace("http", "ws")}/ws`, {headers: {Cookie: panel.cookie, Origin: panel.server.url}} as unknown as string[]);
        closers.push(async () => socket.close());
        const messages: Array<{type: string; parts?: string[]}> = [];
        socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
        while (!messages.some((message) => message.type === "hello")) await Bun.sleep(10);
        const started = Date.now();
        panel.fake!.panes[0]!.agent_status = "working";
        panel.fake!.emit("pane.agent_status_changed", {pane_id: "w9:p1", workspace_id: "w9", agent_status: "working"});
        while (!messages.some((message) => message.type === "changed" && message.parts?.includes("sessions"))) await Bun.sleep(10);
        expect(Date.now() - started).toBeLessThan(1_000);
        const sessions = await panel.json<{panes: Array<{paneId: string; status: string; inRepository: boolean}>}>("/api/sessions");
        expect(sessions.body.data.panes).toEqual([expect.objectContaining({paneId: "w9:p1", status: "working", inRepository: true})]);
    }, 30_000);

    test("场景 2：产物页的题与状态、答复；iframe 地址在产物来源上、带随机前缀；改了页面没发布时标出来；产物来源只给 .agents/works/ 下的文件", async () => {
        const fixture = await publishedFixture("panel-s2");
        expect((await fixture.cli(["answers", "record", "w00002", "t01", "review", "--set", "approve=yes", "--as", "bob", "--json"])).exitCode).toBe(0);
        await fixture.write(".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/index.html", (await Bun.file(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/index.html")).text()).replace('data-nbdev-question="layout"', 'data-nbdev-question="layout-v2"'));
        expect((await fixture.cli(["artifact", "publish", "w00002", "t01", "review", "--as", "bob", "--json"])).exitCode).toBe(0);
        await fixture.write(".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/notes.txt", "没发布的改动\n");
        const panel = await startPanel(fixture, null);
        type ArtifactData = {versions: number[]; version: number; questions: Array<{question: {id: string}; state: string}>; answers: unknown[]; pageUrl: string; unpublishedChanges: boolean};
        const {body} = await panel.json<ArtifactData>("/api/artifact/w00002-alpha/t01-board/review");
        expect([body.data.versions, body.data.version, body.data.questions.map((state) => [state.question.id, state.state]), body.data.answers.length, body.data.unpublishedChanges]).toEqual([
            [1, 2], 2, [["layout", "superseded"], ["approve", "answered"], ["layout-v2", "open"]], 1, true,
        ]);
        const v1 = await panel.json<ArtifactData>("/api/artifact/w00002-alpha/t01-board/review?version=1");
        expect(v1.body.data.questions.map((state) => state.question.id)).toEqual(["layout", "approve"]);
        expect((await panel.get("/api/artifact/w00002-alpha/t01-board/review?version=9")).status).toBe(404);
        expect((await panel.get("/api/artifact/w00002-alpha/t01-board/nope")).status).toBe(404);

        const page = new URL(body.data.pageUrl);
        expect(`${page.protocol}//${page.host}`).toBe(panel.server.artifactUrl);
        const html = await fetch(page);
        expect([html.status, html.headers.get("access-control-allow-origin"), html.headers.get("content-security-policy")?.startsWith("sandbox allow-scripts allow-forms allow-popups")]).toEqual([200, "*", true]);
        expect(await html.text()).toContain("data-nbdev-question");
        const prefix = page.pathname.split("/")[2]!;
        const origin = panel.server.artifactUrl;
        expect((await fetch(`${origin}/a/${prefix}/main/.agents/works/w00002-alpha/tasks/t01-board/artifacts/review/shot.png`)).status).toBe(200);
        for (const path of [`/a/${prefix}/main/package.json`, `/a/${prefix}/main/.gitignore`, `/a/wrong-prefix/main/.agents/works/w00002-alpha/README.md`, `/a/${prefix}/_nbdev/x.js`, `/a/${prefix}/nope/.agents/works/w00002-alpha/README.md`]) {
            expect([path, (await fetch(`${origin}${path}`)).status]).toEqual([path, 404]);
        }
        expect((await fetch(`${origin}/a/${prefix}/main/.agents/works/w00002-alpha/README.md`, {method: "POST"})).status).toBe(405);
    }, 30_000);

    test("场景 3：记录在 master、代码在 worktree 的 Task：执行 checkout 是那个 worktree；文档树切到它时标出与 master 的差异；文档只给白名单里的路径", async () => {
        const fixture = await createFixture("panel-s3");
        await fixture.write("docs/specs/ui/shell.md", "# 外壳\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t02-impl/README.md", `${taskReadme("t02-impl", "status: active\n")}\n## 执行位置\n\nworktree \`.worktree/w00001-t02-impl\`。\n\n见 [Spec](../../../../../docs/specs/ui/shell.md)。\n`);
        await fixture.write(".agents/works/w00001-seed/tasks/t02-impl/requirements.md", "# 需求\n");
        await fixture.commit("t02 on master");
        const worktree = await fixture.addWorktree("w00001-t02-impl", "t02/impl");
        await fixture.write("docs/specs/ui/shell.md", "# 外壳 v2\n", worktree);
        await fixture.write("docs/specs/ui/new.md", "# 新\n", worktree);
        await fixture.commit("spec draft", worktree);
        const panel = await startPanel(fixture, null);
        const task = await panel.json<{task: {checkoutKey: string}; detail: {execution: {chosen: {key: string; rule: string}; candidates: Array<{key: string}>}; specs: string[]; commits: {entries: Array<{subject: string}>}}}>("/api/task/w00001-seed/t02-impl");
        expect([task.body.data.task.checkoutKey, task.body.data.detail.execution.chosen, task.body.data.detail.execution.candidates.map((candidate) => candidate.key), task.body.data.detail.specs, task.body.data.detail.commits.entries.map((entry) => entry.subject)]).toEqual([
            "main", expect.objectContaining({key: "w00001-t02-impl", rule: "readme"}), ["w00001-t02-impl", "main"], ["docs/specs/ui/shell.md"], ["spec draft"],
        ]);
        const tree = await panel.json<{checkout: {key: string; branch: string | null; isMain: boolean}; docs: Array<{path: string}>; changes: Array<{path: string; change: string}>}>("/api/docs/tree?checkout=w00001-t02-impl");
        expect([tree.body.data.checkout, tree.body.data.changes]).toEqual([{key: "w00001-t02-impl", branch: "t02/impl", isMain: false}, [{path: "docs/specs/ui/new.md", change: "added"}, {path: "docs/specs/ui/shell.md", change: "modified"}]]);
        expect((await panel.json("/api/docs/tree?checkout=main")).body.data).toMatchObject({changes: []});
        const file = await panel.json<{title: string; changedIn: string[]}>("/api/docs/file?checkout=main&path=docs/specs/ui/shell.md");
        expect([file.body.data.title, file.body.data.changedIn]).toEqual(["外壳", ["w00001-t02-impl"]]);
        expect((await panel.json<{title: string}>("/api/docs/file?checkout=w00001-t02-impl&path=docs/specs/ui/shell.md")).body.data.title).toBe("外壳 v2");
        expect((await panel.json<{title: string}>("/api/docs/file?checkout=main&path=.agents/works/w00001-seed/tasks/t02-impl/requirements.md")).body.data.title).toBe("需求");
        for (const path of [".gitignore", "package.json", ".agents/works/w00001-seed/tasks/t02-impl/requirements.md"]) {
            const checkout = path.endsWith("requirements.md") ? "w00001-t02-impl" : "main";
            expect([path, checkout, (await panel.get(`/api/docs/file?checkout=${checkout}&path=${encodeURIComponent(path)}`)).status]).toEqual([path, checkout, 404]);
        }
        expect((await panel.get("/api/docs/tree?checkout=nope")).status).toBe(404);
    }, 30_000);

    test("文档接口走路径守卫：指向 .env 与仓库外的 .md 符号链接不进树、读不到；worktree 里没暂存的删除记成 deleted、不在树里", async () => {
        const fixture = await createFixture("panel-doc-guard");
        await fixture.write("docs/specs/ui/shell.md", "# 外壳\n");
        await fixture.write(".env", "SECRET_TOKEN=hunter2\n");
        await mkdir(join(fixture.main, "docs/specs/ui"), {recursive: true});
        await symlink("../../../.env", join(fixture.main, "docs/specs/ui/leak.md"));
        await symlink("/etc/hostname", join(fixture.main, "docs/specs/ui/host.md"));
        await git(fixture.main, "add", "-f", "--", "docs/specs/ui/leak.md", "docs/specs/ui/host.md", "docs/specs/ui/shell.md");
        await git(fixture.main, "commit", "--quiet", "-m", "docs with links", "--", "docs/specs/ui/leak.md", "docs/specs/ui/host.md", "docs/specs/ui/shell.md");
        const worktree = await fixture.addWorktree("w00001-line", "feat/w00001");
        await rm(join(worktree, "docs/specs/ui/shell.md"));
        const panel = await startPanel(fixture, null);
        const tree = await panel.json<{docs: Array<{path: string}>}>("/api/docs/tree?checkout=main");
        expect(tree.body.data.docs.map((doc) => doc.path)).toEqual(["docs/specs/ui/shell.md"]);
        for (const path of ["docs/specs/ui/leak.md", "docs/specs/ui/host.md"]) {
            const response = await panel.get(`/api/docs/file?checkout=main&path=${encodeURIComponent(path)}`);
            expect([path, response.status, (await response.text()).includes("hunter2")]).toEqual([path, 404, false]);
        }
        const branch = await panel.json<{docs: Array<{path: string}>; changes: Array<{path: string; change: string}>}>("/api/docs/tree?checkout=w00001-line");
        expect([branch.body.data.docs.map((doc) => doc.path), branch.body.data.changes]).toEqual([[], [{path: "docs/specs/ui/shell.md", change: "deleted"}]]);
    }, 30_000);

    test("场景 4：会话 idle、它派出的进程还在跑：会话页里会话是 idle，运行列在它下面；普通 shell 里的进程归无主", async () => {
        const fixture = await createFixture("panel-s4");
        const claude = await startFakeClaude(randomUUID());
        closers.push(() => claude.stop());
        const tool = await claude.spawn("sleep", ["61"], {cwd: fixture.main});
        const shell = await spawnMarked("sh", ["-c", "sleep 62; true"], {cwd: fixture.main, env: {HERDR_PANE_ID: "w9:pJ"}});
        closers.push(() => stopProcess(shell));
        const panel = await startPanel(fixture, [claudePane("w9:p1", claude.sessionId, {foreground_pids: [claude.pid], cwd: fixture.main}), shellPane("w9:pJ", {shell_pid: shell.pid, cwd: fixture.main})]);
        type SessionsData = {sessions: Array<{key: string; herdr: {status: string} | null; runs: Array<{pid: number}>}>; unownedRuns: Array<{paneId: string | null; command: string}>};
        let data = (await panel.json<SessionsData>("/api/sessions")).body.data;
        // herdr 的状态随后补上（不阻塞启动），活动在它变了以后重算。
        for (let attempt = 0; attempt < 100 && !(data.sessions.length > 0 && data.unownedRuns.length > 0); attempt += 1) {
            await Bun.sleep(50);
            data = (await panel.json<SessionsData>("/api/sessions")).body.data;
        }
        expect(data.sessions).toEqual([expect.objectContaining({key: `claude:${claude.sessionId}`, herdr: {paneId: "w9:p1", status: "idle"}, runs: [expect.objectContaining({pid: tool})]})]);
        expect(data.unownedRuns).toEqual([expect.objectContaining({paneId: "w9:pJ", command: "sleep 62"})]);
        expect(panel.fake!.requests.every((request) => HERDR_PANEL_READ_METHODS.includes(request.method))).toBe(true);
    }, 30_000);
});

describe("面板服务的安全", () => {
    test("场景 5：Host 不对、带转发头、跨站请求、没登录、跨来源的写请求与 WebSocket 都被拒；登录票据用一次作废", async () => {
        const fixture = await publishedFixture("panel-s5");
        const panel = await startPanel(fixture, null);
        const port = panel.server.port;
        expect(port).toBeGreaterThan(0);
        expect((await fetch(`${panel.server.url}/api/meta`, {headers: {Cookie: panel.cookie, Host: "evil.example"}})).status).toBe(421);
        expect((await panel.get("/api/overview", {"X-Forwarded-For": "1.2.3.4"})).status).toBe(403);
        expect((await panel.get("/api/overview", {"Sec-Fetch-Site": "cross-site"})).status).toBe(403);
        expect((await panel.get("/api/overview", {"Sec-Fetch-Site": "same-origin"})).status).toBe(200);
        expect((await fetch(`${panel.server.url}/api/overview`)).status).toBe(401);
        expect((await fetch(`${panel.server.url}/api/overview`, {method: "POST", headers: {Cookie: panel.cookie, Origin: "http://evil.example"}})).status).toBe(403);
        expect((await fetch(`${panel.server.url}/api/overview`, {method: "POST", headers: {Cookie: panel.cookie, Origin: panel.server.url}})).status).toBe(403);
        const index = await (await panel.get("/")).text();
        const csrf = /name="nbdev-csrf" content="([^"]+)"/u.exec(index)![1]!;
        expect((await fetch(`${panel.server.url}/api/overview`, {method: "POST", headers: {Cookie: panel.cookie, Origin: panel.server.url, "X-Nbdev-Csrf": csrf}})).status).toBe(405);
        const upgrade = await fetch(`${panel.server.url}/ws`, {headers: {Cookie: panel.cookie, Origin: "http://evil.example", Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64")}});
        expect(upgrade.status).toBe(403);

        const login = (ticket: string) => fetch(`${panel.server.url}/login?ticket=${encodeURIComponent(ticket)}`, {redirect: "manual"});
        const ticket = createLoginTicket(panel.token);
        const first = await login(ticket);
        expect([first.status, first.headers.get("location")]).toEqual([302, "/"]);
        expect((await login(ticket)).status).toBe(403);
        expect((await login(createLoginTicket("token-of-another-instance"))).status).toBe(403);
        expect((await login(createLoginTicket(panel.token, Date.now() - 10 * 60_000))).status).toBe(403);
        expect((await login("garbage")).status).toBe(403);
    }, 30_000);

    test("场景 5：原始请求里的 ..、编码过的 ..、..%2f、%00、不合法的百分号编码都回 4xx，不回 500，也不回 index.html；符号链接与 .env、node_modules 拿不到", async () => {
        const fixture = await publishedFixture("panel-s5-paths");
        await mkdir(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/node_modules"), {recursive: true});
        await writeFile(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/node_modules/x.js"), "secret\n");
        await writeFile(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/.env"), "SECRET=1\n");
        await symlink(join(fixture.main, ".git/config"), join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/config-link"));
        await symlink("/etc/passwd", join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/outside-link"));
        const panel = await startPanel(fixture, null);
        const panelPaths = ["/../.git/config", "/%2e%2e/.git/config", "/..%2f.git/config", "/%00", "/a%00b", "/%zz", "/.git/config", "/assets/../../.git/config", "/assets/%2e%2e%2f%2e%2e%2f.git%2fconfig"];
        for (const path of panelPaths) {
            const response = await rawGet(panel.server.port, path, {Cookie: panel.cookie});
            expect([path, response.status >= 400 && response.status < 500, response.text.includes("panel-index")]).toEqual([path, true, false]);
        }
        const {body} = await panel.json<{pageUrl: string}>("/api/artifact/w00002-alpha/t01-board/review");
        const base = new URL(body.data.pageUrl).pathname.replace(/index\.html$/u, "");
        const artifactPaths = [`${base}../../../../../../.git/config`, `${base}${"%2e%2e/".repeat(7)}.gitignore`, `${base}..%2f..%2fREADME.md`, `${base}%00`, `${base}%zz`, `${base}config-link`, `${base}outside-link`, `${base}.env`, `${base}node_modules/x.js`];
        for (const path of artifactPaths) {
            const response = await rawGet(panel.server.artifactPort, path);
            expect([path, response.status >= 400 && response.status < 500]).toEqual([path, true]);
        }
        expect((await rawGet(panel.server.artifactPort, `${base}index.html`)).status).toBe(200);
        expect(panel.logs.filter((line) => line.includes("失败"))).toEqual([]);
    }, 30_000);

    test("场景 6：依次请求全部接口、产物来源与一次搜索之后，主工作区、worktree 与 Git 公共目录里没有任何文件被改过", async () => {
        const fixture = await publishedFixture("panel-s6");
        const worktree = `${fixture.main}/.worktree/w00003-branchy`;
        const panel = await startPanel(fixture, [claudePane("w9:p1", randomUUID(), {cwd: fixture.main})]);
        const marker = join(fixture.root, "marker");
        await writeFile(marker, "");
        await Bun.sleep(1_100);
        for (const path of ["/api/meta", "/api/overview", "/api/work/w00002-alpha", "/api/task/w00002-alpha/t01-board", "/api/artifacts", "/api/artifact/w00002-alpha/t01-board/review", "/api/docs/tree?checkout=main", "/api/docs/tree?checkout=w00003-branchy", "/api/sessions", "/"]) {
            expect([path, (await panel.get(path)).status]).toEqual([path, 200]);
        }
        const search = await panel.get("/api/search?q=README");
        const lines = (await search.text()).trim().split("\n").map((line) => JSON.parse(line) as {type: string});
        expect([search.status, lines.some((line) => line.type === "hit"), lines.at(-1)?.type]).toEqual([200, true, "end"]);
        const {body} = await panel.json<{pageUrl: string}>("/api/artifact/w00002-alpha/t01-board/review");
        expect((await fetch(body.data.pageUrl)).status).toBe(200);
        const gitCommon = (await git(fixture.main, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
        const changed = await run("find", [fixture.main, worktree, gitCommon, "-newer", marker, "-not", "-path", "*/.local/agent/panel.json", "-not", "-path", "*/.local/agent/run/panel.lock"], fixture.root);
        expect(changed.stdout.trim()).toBe("");
    }, 30_000);
});

describe("面板服务的启动与搜索", () => {
    test("预热完成之前 /api/* 回 503、/api/meta 照常；搜索词不合格回 400；新的搜索结束旧的", async () => {
        const fixture = await createFixture("panel-warm");
        await fixture.write("docs/a.md", "needle\n".repeat(50));
        await fixture.commit("docs");
        const token = randomBytes(32).toString("hex");
        const server = await startPanelServer({context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0, herdr: null, token, log: () => undefined});
        closers.push(() => server.stop());
        const cookie = `nbdev_panel=${server.auth.redeem(createLoginTicket(token))}`;
        expect((await fetch(`${server.url}/api/overview`, {headers: {Cookie: cookie}})).status).toBe(503);
        expect((await fetch(`${server.url}/api/meta`, {headers: {Cookie: cookie}})).status).toBe(200);
        expect((await fetch(`${server.url}/`)).status).toBe(503);
        await server.warm();
        for (const q of ["", "a", "a%0Ab", "x".repeat(201)]) expect([q.slice(0, 5), (await fetch(`${server.url}/api/search?q=${q}`, {headers: {Cookie: cookie}})).status]).toEqual([q.slice(0, 5), 400]);
        const [first, second] = await Promise.all(["needle", "needle"].map((q) => fetch(`${server.url}/api/search?q=${q}`, {headers: {Cookie: cookie}}).then((response) => response.text())));
        const ends = [first!, second!].map((text) => text.trim().split("\n").map((line) => JSON.parse(line) as {type: string; aborted?: boolean}).at(-1));
        expect(ends.map((end) => end?.type)).toEqual(["end", "end"]);
        expect(ends.filter((end) => end?.aborted).length).toBeLessThanOrEqual(1);
    }, 30_000);
});

describe("herdr 的常驻状态", () => {
    test("退避：初值 500 毫秒、乘 2、上限 30 秒、加 0 到 20% 的抖动", () => {
        expect([0, 1, 2, 10].map((attempt) => backoffDelay(attempt, () => 0))).toEqual([500, 1_000, 2_000, 30_000]);
        expect(backoffDelay(0, () => 1)).toBe(600);
    });

    test("订阅断开后重连并对账；对账发现状态序号变了而没收到事件，计一次漏事件；pane 增减时换订阅连接", async () => {
        const fixture = await createFixture("panel-monitor");
        const fake = await startFakeHerdr(fixture.root, [claudePane("w9:p1", randomUUID(), {state_change_seq: 1})]);
        closers.push(() => fake.close());
        let changes = 0;
        const monitor = new HerdrMonitor(createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS}), () => changes++, () => undefined);
        closers.push(async () => monitor.stop());
        monitor.start();
        while (monitor.current().mode !== "subscribed") await Bun.sleep(10);
        const subscribeCount = () => fake.requests.filter((request) => request.method === "events.subscribe").length;
        expect(fake.requests.find((request) => request.method === "events.subscribe")?.params.subscriptions).toContainEqual({type: "pane.agent_status_changed", pane_id: "w9:p1"});
        fake.panes[0]!.state_change_seq = 2;
        fake.panes[0]!.agent_status = "working";
        fake.dropSubscribers();
        while (monitor.current().reconnects === 0 || monitor.current().mode !== "subscribed") await Bun.sleep(20);
        expect(monitor.current()).toMatchObject({missedEvents: 1, panes: [expect.objectContaining({status: "working"})]});
        const before = subscribeCount();
        fake.panes.push(claudePane("w9:p2", randomUUID()));
        fake.emit("pane.created", {pane_id: "w9:p2"});
        while (subscribeCount() === before || fake.subscriberCount() !== 1) await Bun.sleep(20);
        expect(fake.requests.filter((request) => request.method === "events.subscribe").at(-1)?.params.subscriptions).toContainEqual({type: "pane.agent_status_changed", pane_id: "w9:p2"});
        expect(changes).toBeGreaterThan(0);
    }, 30_000);
});

describe("前端构建", () => {
    test("构建失败时有旧产物就用旧的、给出原因；没有旧产物报 build_failed；输入没变不构建", async () => {
        const fixture = await createFixture("panel-build");
        const packageRoot = join(fixture.root, "pkg");
        await mkdir(join(packageRoot, "src", "web"), {recursive: true});
        await writeFile(join(packageRoot, "package.json"), "{}\n");
        const distDir = join(packageRoot, "dist", "web");
        const options = {packageRoot, repoRoot: fixture.root, distDir, log: () => undefined};
        await expect(ensureWebBuild(options)).rejects.toMatchObject({code: "build_failed"});
        await mkdir(distDir, {recursive: true});
        await writeFile(join(distDir, "index.html"), "<html></html>\n");
        const fallback = await ensureWebBuild(options);
        expect([fallback.built, fallback.failed?.includes("vite")]).toEqual([false, true]);
        expect(await Bun.file(join(distDir, "index.html")).text()).toBe("<html></html>\n");
        await writeFile(join(distDir, ".build-hash"), `${await computeBuildHash(packageRoot, fixture.root)}\n`);
        expect(await ensureWebBuild(options)).toEqual({built: false, failed: null});
    });
});

describe("端口", () => {
    test("端口被占时报 port_in_use，已绑定的另一个端口也放掉", async () => {
        const fixture = await createFixture("panel-port");
        const holder = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy")});
        closers.push(async () => {
            await holder.stop(true);
        });
        const context = await locateRepository(fixture.main);
        const attempt = (port: number, artifactPort: number) => startPanelServer({context, host: "127.0.0.1", port, artifactPort, herdr: null, token: "t", log: () => undefined});
        await expect(attempt(holder.port!, 0)).rejects.toMatchObject({code: "port_in_use"});
        await expect(attempt(0, holder.port!)).rejects.toMatchObject({code: "port_in_use"});
        const ok = await attempt(0, 0);
        await ok.stop();
    });
});

describe("nbdev panel serve 与 panel open", () => {
    test("panel serve 写权限 600 的 panel.json、同一个主工作区只能起一个；panel open --print 给出能登录的一次性链接；SIGTERM 收口", async () => {
        const fixture = await createFixture("panel-cli");
        const staticDir = join(fixture.root, "web");
        await mkdir(staticDir, {recursive: true});
        await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head></head><body>panel-index</body></html>\n");
        expect((await fixture.cli(["panel", "serve", "--host", "0.0.0.0", "--json"])).json?.errors[0]?.code).toBe("unsafe_host");
        expect((await fixture.cli(["panel", "open", "--print", "--json"])).json?.errors[0]?.code).toBe("panel_not_running");
        const { CLI_PATH } = await import("./git-fixture.js");
        const serve: MarkedChild = await spawnMarked(process.execPath, [CLI_PATH, "panel", "serve", "--port", "0", "--artifact-port", "0", "--static-dir", staticDir], {cwd: fixture.main});
        closers.push(() => stopProcess(serve));
        const panelFile = join(fixture.main, ".local/agent/panel.json");
        while (!(await Bun.file(panelFile).exists())) await Bun.sleep(20);
        const info = await Bun.file(panelFile).json() as {url: string; pid: number};
        expect(((await Bun.file(panelFile).stat()).mode & 0o777).toString(8)).toBe("600");
        expect(info.pid).toBe(serve.pid);
        const second = await fixture.cli(["panel", "serve", "--port", "0", "--artifact-port", "0", "--static-dir", staticDir, "--json"]);
        expect([second.exitCode, second.json?.errors[0]?.code]).toEqual([3, "panel_running"]);
        const opened = await fixture.cli(["panel", "open", "--print", "--json"]);
        const loginUrl = (opened.json?.data as {loginUrl: string}).loginUrl;
        let login = await fetch(loginUrl, {redirect: "manual"});
        for (let attempt = 0; attempt < 100 && login.status === 503; attempt += 1) {
            await Bun.sleep(50);
            login = await fetch(loginUrl, {redirect: "manual"});
        }
        expect([login.status, login.headers.get("location"), login.headers.get("set-cookie")?.includes("HttpOnly; SameSite=Strict")]).toEqual([302, "/", true]);
        expect((await fetch(loginUrl, {redirect: "manual"})).status).toBe(403);
        const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        let meta = await fetch(`${info.url}/api/overview`, {headers: {Cookie: cookie}});
        for (let attempt = 0; attempt < 200 && meta.status === 503; attempt += 1) {
            await Bun.sleep(50);
            meta = await fetch(`${info.url}/api/overview`, {headers: {Cookie: cookie}});
        }
        expect(meta.status).toBe(200);
        const exited = once(serve, "exit");
        serve.kill("SIGTERM");
        expect((await exited)[0]).toBe(0);
        expect(await Bun.file(panelFile).exists()).toBe(false);
        expect(await Bun.file(join(fixture.main, ".local/agent/run/panel.lock")).exists()).toBe(false);
    }, 60_000);
});
