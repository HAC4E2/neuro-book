import {afterEach, describe, expect, test} from "bun:test";
import {spawn, type ChildProcess} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {once} from "node:events";
import {auditPaths, createAuditWriter, initAudit} from "../src/core/audit.js";
import {PROVENANCE_ROOT} from "../src/core/provenance.js";
import {locateRepository} from "../src/core/repo.js";
import {createHerdrClient, HERDR_PANEL_METHODS} from "../src/herdr/client.js";
import {createLoginTicket} from "../src/server/auth.js";
import {startPanelServer, type PanelServer} from "../src/server/serve.js";
import {startTerminalStream, type TerminalTools} from "../src/server/terminal-stream.js";
import {TerminalHub, type TerminalTimings} from "../src/server/terminal-hub.js";
import {ControlRegistry} from "../src/server/control-registry.js";
import {PaneLocks, type Notifier} from "../src/server/notifier.js";
import {claudePane, shellPane, startFakeHerdr, type FakeHerdr, type FakePane} from "./fake-herdr.js";
import {cleanupFakeTerminals, fakeTerminalTools, type FakeTerminalSettings} from "./fake-terminal.js";
import {cleanupFixtures, createFixture, panelEnv, type Fixture} from "./git-fixture.js";

/**
 * t12 网页终端（L3）：面板在进程内起，herdr 的 socket 是假的（`tests/fake-herdr.ts`），终端流是假的命令行（`tests/fake-herdr-cli.ts`，
 * 经 `NBDEV_HERDR_BIN` 交给面板），WebSocket 用 Bun 的客户端连 `/ws/terminal`。真实尺寸由一个 pty 里的进程扮（shell pid）。
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    await cleanupFakeTerminals();
    await cleanupFixtures();
});

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY_A = `claude:${SESSION_A}`;
const TERMINAL = "term_w9:p1";

type Message = Record<string, unknown> & {t: string};
type Client = {ws: WebSocket; messages: Message[]; closed: Promise<{code: number; reason: string}>; send(message: Record<string, unknown>): void; next(t: string, from?: number, ms?: number): Promise<Message>};

async function until(check: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> {
    const started = Date.now();
    while (!(await check())) {
        if (Date.now() - started > ms) throw new Error(`${ms} 毫秒内没等到：${what}`);
        await Bun.sleep(30);
    }
}

/** 一个 pty 里的进程，尺寸 cols×rows：扮 pane 的 shell（面板从 `/proc/<pid>/fd/0` 读真实尺寸）。 */
async function ptyShell(cols: number, rows: number): Promise<number> {
    const script = `import os, pty, sys, time, fcntl, termios, struct
pid, fd = pty.fork()
if pid == 0:
    os.execvp("sleep", ["sleep", "120"])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ${rows}, ${cols}, 0, 0))
print(pid, flush=True)
time.sleep(120)`;
    const child: ChildProcess = spawn("python3", ["-I", "-c", script], {stdio: ["ignore", "pipe", "inherit"]});
    closers.push(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await once(child, "exit");
        }
    });
    const [line] = await once(child.stdout!, "data") as [Buffer];
    const pid = Number(line.toString().trim());
    closers.push(async () => {
        try {
            process.kill(pid, "SIGKILL");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
    });
    return pid;
}

/** 这个测试的假 herdr socket 上还活着的子进程（按 `HERDR_SOCKET_PATH` 认）。 */
function streamProcesses(socketPath: string): number[] {
    const pids: number[] = [];
    for (const name of readdirSync("/proc")) {
        if (!/^\d+$/u.test(name)) continue;
        try {
            const stat = readFileSync(`/proc/${name}/stat`, "utf8");
            if (stat.includes(") Z ")) continue;
            if (readFileSync(`/proc/${name}/environ`, "utf8").split("\0").includes(`HERDR_SOCKET_PATH=${socketPath}`)) pids.push(Number(name));
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT" && code !== "EACCES" && code !== "ESRCH") throw error;
        }
    }
    return pids;
}

type Setup = {fixture: Fixture; fake: FakeHerdr; panes: FakePane[]; server: PanelServer; state: string; tools: TerminalTools; cookie: string; csrf: string; logs: string[]; connect(paneId?: string, terminalId?: string): Promise<Client>; audit(): Promise<Array<Record<string, unknown> & {action: string; phase: string; actionId: string; detail: Record<string, unknown>}>>};

/** 发布一份一道题的评审板，提问者改成 pane `w9:p1` 上的会话 A：答复之后面板要通知它。 */
async function publishQuestion(fixture: Fixture): Promise<void> {
    await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/artifacts/review/index.html", "<!doctype html><title>评审板</title><section data-nbdev-question=\"layout\" data-nbdev-type=\"single\"><h2>版式</h2><div data-nbdev-option=\"cards\"><h3>卡片</h3></div><div data-nbdev-option=\"table\"><h3>表</h3></div></section>");
    const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
    expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
    for (const entry of await readdir(join(fixture.main, PROVENANCE_ROOT), {withFileTypes: true, recursive: true})) {
        if (!entry.isFile()) continue;
        const file = join(entry.parentPath, entry.name);
        const record = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
        record.session = {key: KEY_A, agent: "claude", sessionId: SESSION_A, label: null, parentSessionId: null, nestedSessionId: null, process: null, herdr: {socketPath: "/fake/herdr.sock", paneId: "w9:p1", terminalId: TERMINAL}};
        await writeFile(file, `${JSON.stringify(record, null, 4)}\n`);
    }
}

/** 以开发者身份答复上面那道题（经面板的写接口）。 */
async function answer(url: string, cookie: string, csrf: string): Promise<void> {
    const posted = await fetch(`${url}/api/answers`, {method: "POST", headers: {Cookie: cookie, Origin: url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json"}, body: JSON.stringify({workId: "w00001-seed", taskId: "t01-seed", artifactId: "review", version: 1, values: {layout: "cards"}, note: null})});
    expect(posted.status).toBe(200);
}

async function setup(name: string, options: {panes?: (main: string) => FakePane[]; terminals?: Record<string, FakeTerminalSettings>; audit?: boolean; prepare?: (fixture: Fixture) => Promise<void>; timings?: Partial<TerminalTimings>} = {}): Promise<Setup> {
    const fixture = await createFixture(name);
    await options.prepare?.(fixture);
    if (options.audit !== false) await initAudit(auditPaths(panelEnv(fixture)));
    const panes = options.panes?.(fixture.main) ?? [claudePane("w9:p1", SESSION_A, {cwd: fixture.main, foreground_cwd: fixture.main})];
    const fake = await startFakeHerdr(fixture.root, panes);
    closers.push(() => fake.close());
    fake.version = "0.9.3";
    const {tools, state} = await fakeTerminalTools(name, options.terminals ?? {[TERMINAL]: {}}, dirname(fake.socketPath));
    const token = randomBytes(32).toString("hex");
    const logs: string[] = [];
    const server = await startPanelServer({
        context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0,
        herdr: createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_METHODS}), token, log: (line) => void logs.push(line),
        env: {...panelEnv(fixture), NBDEV_HERDR_BIN: tools.herdrBin}, terminalTimings: options.timings,
    });
    let stopped = false;
    closers.push(async () => {
        if (!stopped) await server.stop();
        stopped = true;
    });
    const staticDir = join(fixture.root, "web");
    await mkdir(staticDir, {recursive: true});
    await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head></head><body>panel</body></html>\n");
    await server.setStatic(staticDir, {failed: null});
    await server.warm();
    await until(() => server.state.herdr.current().panes.length === panes.length, 5_000, "监视器读到假 herdr 的 pane");
    const cookie = `nbdev_panel_${server.port}=${server.auth.redeem(createLoginTicket(token))}`;
    const csrf = /name="nbdev-csrf" content="([^"]+)"/u.exec(await (await fetch(`${server.url}/`)).text())![1]!;
    const connect = async (paneId = "w9:p1", terminalId = TERMINAL): Promise<Client> => {
        const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws/terminal?pane=${encodeURIComponent(paneId)}&terminal=${encodeURIComponent(terminalId)}`, {headers: {Cookie: cookie, Origin: server.url}} as never);
        const messages: Message[] = [];
        ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data)) as Message));
        const closed = new Promise<{code: number; reason: string}>((resolve) => ws.addEventListener("close", (event) => resolve({code: event.code, reason: event.reason})));
        closers.push(async () => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
                await closed;
            }
        });
        await Promise.race([new Promise((resolve) => ws.addEventListener("open", resolve)), closed]);
        return {
            ws, messages, closed,
            send: (message) => ws.send(JSON.stringify(message)),
            async next(t, from = 0, ms = 8_000) {
                await until(() => messages.slice(from).some((message) => message.t === t), ms, `消息 ${t}`);
                return messages.slice(from).find((message) => message.t === t)!;
            },
        };
    };
    return {
        fixture, fake, panes, server, state, tools, cookie, csrf, logs, connect,
        async audit() {
            const file = auditPaths(panelEnv(fixture)).file;
            if (!existsSync(file)) return [];
            return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
        },
    };
}

const inputsOf = async (state: string, terminal = TERMINAL) => existsSync(join(state, `inputs-${terminal}.jsonl`)) ? (await readFile(join(state, `inputs-${terminal}.jsonl`), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>) : [];

describe("观看", () => {
    test("第一帧整屏、屏幕变了出增量；读不到 pty 尺寸时按 120×40 并标“尺寸不确定”；连接关掉之后子进程不在", async () => {
        const {connect, state, fake, logs} = await setup("term-watch");
        const client = await connect();
        const status = await client.next("state");
        expect(status).toMatchObject({mode: "watch", cols: 120, rows: 40, sizeKnown: false, controller: null, terminalId: TERMINAL});
        // 读不到的原因进面板日志，同一个终端只记一次（实现审查 F8）。
        expect(logs.filter((line) => line.startsWith(`读不到终端 ${TERMINAL}`))).toEqual([`读不到终端 ${TERMINAL}（w9:p1）的 pty 尺寸，观看按 120×40、释放时不改回：herdr 没有给出 pane 的 shell pid`]);
        const first = await client.next("frame");
        expect([first.full, first.w, first.h]).toEqual([true, 120, 40]);
        await writeFile(join(state, `screen-${TERMINAL}.txt`), "新的一行");
        await until(() => client.messages.filter((message) => message.t === "frame").length >= 2, 5_000, "增量帧");
        expect(streamProcesses(fake.socketPath).length).toBe(1);
        // 页面上新挂的视图要整屏：resync 重起 observe；连着发几次也只留一个子进程。
        const from = client.messages.length;
        for (let count = 0; count < 3; count += 1) client.send({t: "resync"});
        expect(await client.next("frame", from)).toMatchObject({full: true});
        await Bun.sleep(1_500);
        expect(streamProcesses(fake.socketPath).length).toBe(1);
        client.ws.close();
        await client.closed;
        await until(() => streamProcesses(fake.socketPath).length === 0, 3_000, "关连接之后子进程退出");
    }, 30_000);

    test("读得到 pty 尺寸时按真实尺寸看", async () => {
        const shell = await ptyShell(77, 23);
        const {connect} = await setup("term-watch-size", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, shell_pid: shell})]});
        const client = await connect();
        expect(await client.next("state")).toMatchObject({cols: 77, rows: 23, sizeKnown: true});
        expect(await client.next("frame")).toMatchObject({w: 77, h: 23});
    }, 30_000);

    test("升级之后用关闭码回原因：不在本仓库的 pane 4403、terminal 对不上 4404、超过上限 4409", async () => {
        const {connect} = await setup("term-reject", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main}), shellPane("w9:p2", {cwd: "/tmp", foreground_cwd: "/tmp"})], terminals: {[TERMINAL]: {}, "term_w9:p2": {}}});
        expect((await (await connect("w9:p2", "term_w9:p2")).closed).code).toBe(4403);
        expect((await (await connect("w9:p1", "term_other")).closed).code).toBe(4404);
        const open = [];
        for (let index = 0; index < 4; index += 1) {
            const client = await connect();
            await client.next("state");
            open.push(client);
        }
        expect((await (await connect()).closed).code).toBe(4409);
    }, 30_000);

    test("本仓库里没有 Agent 会话的 pane 能只读观看（D2）；接管不论带什么会话都回 not_allowed、连接照常；审计里没有任何一行", async () => {
        const {connect, audit} = await setup("term-shell-watch", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main}), shellPane("w9:p2", {cwd: main, foreground_cwd: main})], terminals: {[TERMINAL]: {}, "term_w9:p2": {}}});
        const client = await connect("w9:p2", "term_w9:p2");
        expect(await client.next("state")).toMatchObject({mode: "watch", paneId: "w9:p2", terminalId: "term_w9:p2", agent: null});
        await client.next("frame");
        for (const expectedSession of [null, "", KEY_A, "shell:forged"]) {
            const from = client.messages.length;
            client.send({t: "takeover", cols: 100, rows: 30, expectedSession, force: false});
            expect(await client.next("error", from)).toMatchObject({code: "not_allowed"});
        }
        client.send({t: "resync"});
        expect(await client.next("frame", client.messages.length)).toMatchObject({full: true});
        expect(client.ws.readyState).toBe(WebSocket.OPEN);
        expect(await audit()).toEqual([]);
    }, 30_000);

    test("升级前只做安全校验：没登录、跨来源都拒绝升级", async () => {
        const {server, cookie} = await setup("term-guard");
        const url = `${server.url.replace("http", "ws")}/ws/terminal?pane=w9:p1&terminal=${encodeURIComponent(TERMINAL)}`;
        for (const headers of [{Origin: server.url}, {Cookie: cookie, Origin: "http://evil.example"}]) {
            const ws = new WebSocket(url, {headers} as never);
            const result = await new Promise<string>((resolve) => {
                ws.addEventListener("open", () => resolve("open"));
                ws.addEventListener("error", () => resolve("error"));
                ws.addEventListener("close", () => resolve("closed"));
            });
            expect(result).not.toBe("open");
        }
    }, 30_000);

    test("终端还在、observe 第一行就是 terminal.closed：重起到第 3 次就以 4404 关，不无限重起；结束原因进日志（实现审查 F5）", async () => {
        const {connect, logs} = await setup("term-closed-first", {terminals: {[TERMINAL]: {mode: "gone"}}});
        const client = await connect();
        const closed = await Promise.race([client.closed, Bun.sleep(6_000).then(() => null)]);
        expect(closed).toMatchObject({code: 4404});
        expect(client.messages.filter((message) => message.t === "state").length).toBeLessThanOrEqual(3);
        expect(logs.some((line) => line.includes("observe）结束：terminal attach ended"))).toBe(true);
    }, 30_000);

    test("观看中流结束、终端也不在了：4404", async () => {
        const {connect, fake, panes} = await setup("term-gone");
        const client = await connect();
        await client.next("frame");
        panes.splice(0);
        for (const pid of streamProcesses(fake.socketPath)) process.kill(pid, "SIGTERM");
        expect((await client.closed).code).toBe(4404);
    }, 30_000);
});

describe("接管", () => {
    test("接管、输入、按钮、释放：尺寸按网页、释放前改回 pty 的原尺寸；审计一行意图、一行结果、一行释放，没有输入内容；接管期间文字与通知停发", async () => {
        const shell = await ptyShell(77, 23);
        const {connect, state, fake, server, cookie, csrf, audit} = await setup("term-takeover", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, shell_pid: shell})]});
        const client = await connect();
        await client.next("frame");
        const from = client.messages.length;
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        expect(await client.next("state", from)).toMatchObject({mode: "control", cols: 100, rows: 30, controller: {by: "this"}});
        expect(JSON.parse(await readFile(join(state, `size-${TERMINAL}.json`), "utf8"))).toEqual({cols: 100, rows: 30});
        client.send({t: "input", data: "密码123\r"});
        client.send({t: "input", data: "粘贴的\n两行", paste: true});
        client.send({t: "key", key: "esc"});
        client.send({t: "alive"});
        await until(async () => (await inputsOf(state)).length >= 2 && fake.keys.length >= 1, 5_000, "输入与按钮");
        expect(fake.keys).toEqual([{target: "w9:p1", keys: ["esc"]}]);
        // 接管期间会话页的文字回 409 pane_controlled，不调 agent.prompt。
        const refused = await fetch(`${server.url}/api/sessions/w9:p1/prompt`, {method: "POST", headers: {Cookie: cookie, Origin: server.url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json"}, body: JSON.stringify({text: "你好", expectedSession: KEY_A})});
        expect([refused.status, (await refused.json() as {errors: Array<{code: string}>}).errors[0]?.code]).toEqual([409, "pane_controlled"]);
        expect(fake.prompts).toEqual([]);
        const keysRefused = await fetch(`${server.url}/api/sessions/w9:p1/keys`, {method: "POST", headers: {Cookie: cookie, Origin: server.url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json"}, body: JSON.stringify({keys: ["up"], expectedSession: KEY_A})});
        expect(keysRefused.status).toBe(409);
        // 读屏不往会话里写，接管期间照样能读（另一个浏览器这时打开会话页要看屏幕）。
        expect((await fetch(`${server.url}/api/sessions/w9:p1/screen?session=${encodeURIComponent(KEY_A)}`, {headers: {Cookie: cookie}})).status).toBe(200);
        const releaseFrom = client.messages.length;
        client.send({t: "release"});
        expect(await client.next("released", releaseFrom)).toMatchObject({reason: "user", restored: true});
        expect(await client.next("state", releaseFrom)).toMatchObject({mode: "watch", cols: 77, rows: 23});
        const inputs = await inputsOf(state);
        expect(inputs.map((input) => input.type)).toEqual(["terminal.input", "terminal.input", "terminal.resize", "terminal.release"]);
        expect(inputs[2]).toEqual({type: "terminal.resize", cols: 77, rows: 23});
        const lines = await audit();
        expect(lines.map((line) => [line.action, line.phase])).toEqual([["takeover", "intent"], ["takeover", "result"], ["release", "result"]]);
        expect(new Set(lines.map((line) => line.actionId)).size).toBe(1);
        // 结果行与释放行的设备与意图行一样取自连接（实现审查 F6）。
        expect(lines.map((line) => line.device)).toEqual(["local", "local", "local"]);
        expect(lines[2]!.detail).toMatchObject({reason: "user", inputs: 2, enters: 1, pastes: 1, buttons: 1, restored: true});
        expect(JSON.stringify(lines)).not.toContain("密码123");
        // 释放之后文字照常。
        const after = await fetch(`${server.url}/api/sessions/w9:p1/prompt`, {method: "POST", headers: {Cookie: cookie, Origin: server.url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json"}, body: JSON.stringify({text: "你好", expectedSession: KEY_A})});
        expect(after.status).toBe(200);
    }, 40_000);

    test("别处已经在控制：不带 takeover 先回 need_confirm（原因文案换一种也一样），确认之后才抢；被抢的一边收到结束", async () => {
        for (const reasons of ["a", "b"]) {
            const {connect, tools} = await setup(`term-elsewhere-${reasons}`, {terminals: {[TERMINAL]: {reasons}}});
            const external: string[] = [];
            const outside = startTerminalStream(tools, "control", TERMINAL, {cols: 80, rows: 24}, false, {onLine: (line) => external.push(line.type), onBadLine: () => undefined, onStderr: () => undefined});
            closers.push(() => outside.stop());
            await until(() => external.includes("frame"), 5_000, "外面的 control 连上");
            const client = await connect();
            await client.next("frame");
            let from = client.messages.length;
            client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
            expect(await client.next("need_confirm", from)).toMatchObject({reason: "controlled_elsewhere"});
            from = client.messages.length;
            client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: true});
            expect(await client.next("state", from)).toMatchObject({mode: "control"});
            await until(() => external.includes("closed"), 5_000, "外面的 control 被抢走");
        }
    }, 60_000);

    test("同一面板的两个浏览器：后来的要确认；抢过去以后前一个回到观看（taken_over），释放时改回最初的尺寸", async () => {
        const shell = await ptyShell(70, 20);
        const {connect, state, audit} = await setup("term-two-browsers", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, shell_pid: shell})]});
        const first = await connect();
        const second = await connect();
        await first.next("frame");
        await second.next("frame");
        first.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        await until(() => first.messages.some((message) => message.t === "state" && message.mode === "control"), 5_000, "第一个接管");
        let from = second.messages.length;
        second.send({t: "takeover", cols: 90, rows: 25, expectedSession: KEY_A, force: false});
        expect(await second.next("need_confirm", from)).toMatchObject({reason: "other_browser"});
        from = second.messages.length;
        const firstFrom = first.messages.length;
        second.send({t: "takeover", cols: 90, rows: 25, expectedSession: KEY_A, force: true});
        expect(await second.next("state", from)).toMatchObject({mode: "control", cols: 90, rows: 25});
        expect(await first.next("released", firstFrom)).toMatchObject({reason: "taken_over", restored: false});
        await until(() => first.messages.slice(firstFrom).some((message) => message.t === "state" && message.mode === "watch"), 5_000, "第一个回到观看");
        second.send({t: "release"});
        await second.next("released", from);
        const resizes = (await inputsOf(state)).filter((input) => input.type === "terminal.resize");
        expect(resizes.at(-1)).toEqual({type: "terminal.resize", cols: 70, rows: 20});
        const releases = (await audit()).filter((line) => line.action === "release");
        expect(releases.map((line) => [line.detail.reason, line.detail.restored])).toEqual([["taken_over", false], ["user", true]]);
    }, 40_000);

    test("握手期间连接关了、control 还没起（在收 observe）：不起 control、什么都不改；审计结果 failed（disconnect），没有释放行（实现审查 F4）", async () => {
        const shell = await ptyShell(77, 23);
        const {connect, state, fake, audit} = await setup("term-close-early", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, shell_pid: shell})], terminals: {[TERMINAL]: {observeExitDelayMs: 800}}});
        const client = await connect();
        await client.next("frame");
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        await Bun.sleep(200);
        client.ws.close();
        await client.closed;
        await until(() => streamProcesses(fake.socketPath).length === 0, 5_000, "子进程都退出");
        await until(async () => (await audit()).some((line) => line.phase === "result"), 3_000, "审计结果");
        expect(existsSync(join(state, `size-${TERMINAL}.json`))).toBe(false);
        expect(await inputsOf(state)).toEqual([]);
        expect((await audit()).map((line) => [line.action, line.phase, line.detail.result ?? null, line.detail.why ?? null])).toEqual([["takeover", "intent", null, null], ["takeover", "result", "failed", "disconnect"]]);
    }, 30_000);

    test("握手期间连接关了、control 已经接上（尺寸已改）但第一帧还没到：照常释放，改回尺寸；审计 attached 加 disconnect 的释放行（实现审查 F4）", async () => {
        const shell = await ptyShell(77, 23);
        const {connect, state, fake, audit} = await setup("term-close-late", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, shell_pid: shell})], terminals: {[TERMINAL]: {controlDelayMs: 1_000}}});
        const client = await connect();
        await client.next("frame");
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        await until(() => existsSync(join(state, `size-${TERMINAL}.json`)), 3_000, "control 改了尺寸");
        client.ws.close();
        await client.closed;
        await until(() => streamProcesses(fake.socketPath).length === 0, 6_000, "子进程都退出");
        await until(async () => (await audit()).some((line) => line.action === "release"), 3_000, "释放行");
        expect(JSON.parse(await readFile(join(state, `size-${TERMINAL}.json`), "utf8"))).toEqual({cols: 77, rows: 23});
        expect((await inputsOf(state)).map((input) => input.type)).toEqual(["terminal.resize", "terminal.release"]);
        const lines = await audit();
        expect(lines.map((line) => [line.action, line.phase, line.detail.result ?? line.detail.reason ?? null])).toEqual([["takeover", "intent", null], ["takeover", "result", "attached"], ["release", "result", "disconnect"]]);
        expect(lines[2]!.detail).toMatchObject({restored: true});
    }, 30_000);

    test("握手 5 秒没有回应：error takeover_timeout，锁放开，之后同一格的自动通知照常发出", async () => {
        const {connect, server, cookie, csrf, fake} = await setup("term-timeout", {terminals: {[TERMINAL]: {mode: "silent"}}, prepare: publishQuestion});
        const client = await connect();
        await client.next("state");
        const started = Date.now();
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        expect(await client.next("error", 0, 10_000)).toMatchObject({code: "takeover_timeout"});
        expect(Date.now() - started).toBeLessThan(9_000);
        // 自动通知与握手同一把锁：锁放开了，答复之后空闲稳定 3 秒就投出去（设计审查 S7）。
        await answer(server.url, cookie, csrf);
        await until(() => fake.prompts.length > 0, 12_000, "自动通知");
        expect(fake.prompts[0]).toMatchObject({target: "w9:p1"});
        expect(fake.prompts[0]!.text.startsWith("[nbdev] ")).toBe(true);
    }, 40_000);

    test("审计不可用：观看照常，接管回 audit_unavailable", async () => {
        const {connect} = await setup("term-no-audit", {audit: false});
        const client = await connect();
        await client.next("frame");
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        expect(await client.next("error")).toMatchObject({code: "audit_unavailable"});
    }, 30_000);

    test("页面切后台（release hidden 再关连接）、断线、面板退出：都释放并写释放行，子进程 1 秒内不在", async () => {
        for (const how of ["hidden", "disconnect", "panel_exit"] as const) {
            const shell = await ptyShell(80, 24);
            const {connect, server, fake, audit} = await setup(`term-leave-${how}`, {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, shell_pid: shell})]});
            const client = await connect();
            await client.next("frame");
            client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
            await until(() => client.messages.some((message) => message.t === "state" && message.mode === "control"), 5_000, "接管");
            if (how === "hidden") {
                client.send({t: "release", reason: "hidden"});
                await client.next("released");
                client.ws.close();
            } else if (how === "disconnect") client.ws.close();
            else await server.stop();
            await until(async () => (await audit()).some((line) => line.action === "release"), 5_000, `${how} 的释放行`);
            const release = (await audit()).find((line) => line.action === "release")!;
            expect([how, release.detail.reason, release.detail.restored]).toEqual([how, how, true]);
            await until(() => streamProcesses(fake.socketPath).length === 0, 1_000, `${how} 之后子进程退出`);
        }
    }, 60_000);
});

describe("更早的输出（手机的文字视图）", () => {
    test("omp 读 recent_unwrapped 加行数；Claude 回 409 history_unavailable、不调 agent.read", async () => {
        const omp: FakePane = {...claudePane("w9:p3", SESSION_A), terminal_id: "term_w9:p3", agent: "omp", agent_session: {agent: "omp", kind: "path", source: "herdr:omp", value: "/s/o.jsonl"}, history: "第一行\n第二行\n\n"};
        const {server, cookie, fake} = await setup("term-history", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main}), {...omp, cwd: main, foreground_cwd: main}]});
        const read = await fetch(`${server.url}/api/sessions/w9:p3/history?session=${encodeURIComponent("omp:/s/o.jsonl")}`, {headers: {Cookie: cookie}});
        expect(read.status).toBe(200);
        expect((await read.json() as {data: {text: string; lines: number}}).data).toMatchObject({text: "第一行\n第二行", lines: 1000});
        expect(fake.requests.filter((request) => request.method === "agent.read").map((request) => request.params)).toEqual([{target: "w9:p3", source: "recent_unwrapped", format: "text", strip_ansi: true, lines: 1000}]);
        const refused = await fetch(`${server.url}/api/sessions/w9:p1/history?session=${encodeURIComponent(KEY_A)}`, {headers: {Cookie: cookie}});
        expect([refused.status, (await refused.json() as {errors: Array<{code: string}>}).errors[0]?.code]).toEqual([409, "history_unavailable"]);
        expect(fake.requests.filter((request) => request.method === "agent.read")).toHaveLength(1);
    }, 30_000);

    test("非 Agent 的 pane（D2）：有回滚时按 pane 读 recent_unwrapped；全屏程序（没有回滚）、Agent 的 pane、不在本仓库的回 409；都不写审计", async () => {
        const scroll = (rows: number) => ({max_offset_from_bottom: rows, offset_from_bottom: 0, viewport_rows: 40});
        const {server, cookie, fake, audit} = await setup("term-pane-history", {panes: (main) => [
            claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main}),
            shellPane("w9:p2", {cwd: main, foreground_cwd: main, history: "构建第 1 行\n构建第 2 行\n", scroll: scroll(361)}),
            shellPane("w9:p3", {cwd: main, foreground_cwd: main, history: "less 的当前屏", scroll: scroll(0)}),
            shellPane("w9:p4", {cwd: "/tmp", foreground_cwd: "/tmp", history: "别处", scroll: scroll(10)}),
        ]});
        const get = async (pane: string) => {
            const reply = await fetch(`${server.url}/api/panes/${pane}/history`, {headers: {Cookie: cookie}});
            const body = await reply.json() as {data: {paneId: string; text: string; lines: number} | null; errors: Array<{code: string; details?: {reason?: string}}>};
            return {status: reply.status, body};
        };
        const read = await get("w9:p2");
        expect([read.status, read.body.data]).toEqual([200, {paneId: "w9:p2", lines: 1000, text: "构建第 1 行\n构建第 2 行"}]);
        expect(fake.requests.filter((request) => request.method === "pane.read").map((request) => request.params)).toEqual([{pane_id: "w9:p2", source: "recent_unwrapped", format: "text", strip_ansi: true, lines: 1000}]);
        for (const [pane, code] of [["w9:p3", "history_unavailable"], ["w9:p1", "history_unavailable"], ["w9:p4", "not_in_repository"]] as const) {
            const refused = await get(pane);
            expect([pane, refused.status, refused.body.errors[0]?.code]).toEqual([pane, 409, code]);
        }
        expect(fake.requests.filter((request) => request.method === "pane.read")).toHaveLength(1);
        expect(await audit()).toEqual([]);
    }, 30_000);

    test("非 Agent 的 pane 发文字、按键都被拒（没有会话可核对），不调 herdr 的写方法、不写审计的结果行", async () => {
        const {server, cookie, csrf, fake, audit} = await setup("term-pane-write", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main}), shellPane("w9:p2", {cwd: main, foreground_cwd: main})]});
        const post = async (path: string, body: unknown) => {
            const reply = await fetch(`${server.url}${path}`, {method: "POST", headers: {Cookie: cookie, Origin: server.url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json"}, body: JSON.stringify(body)});
            return {status: reply.status, body: await reply.json() as {errors: Array<{code: string; details?: {reason?: string}}>}};
        };
        for (const expectedSession of [KEY_A, "shell:forged"]) {
            const prompt = await post("/api/sessions/w9:p2/prompt", {text: "ls", expectedSession, confirmScreen: null});
            const keys = await post("/api/sessions/w9:p2/keys", {keys: ["enter"], expectedSession, confirmed: true});
            expect([prompt.status, prompt.body.errors[0]?.details?.reason, keys.status, keys.body.errors[0]?.details?.reason]).toEqual([409, "not_found", 409, "not_found"]);
        }
        expect(fake.requests.filter((request) => request.method === "agent.prompt" || request.method === "agent.send_keys")).toEqual([]);
        expect((await audit()).filter((line: {phase?: string}) => line.phase === "result")).toEqual([]);
    }, 30_000);
});

describe("接管的失败路径与互斥（实现审查 F7）", () => {
    test("接管期间通知任务是 waiting_takeover、不调 agent.prompt；释放后空闲稳定 3 秒照常投递", async () => {
        const {connect, server, cookie, csrf, fake} = await setup("term-notify", {prepare: publishQuestion});
        const client = await connect();
        await client.next("frame");
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        await until(() => client.messages.some((message) => message.t === "state" && message.mode === "control"), 5_000, "接管");
        await answer(server.url, cookie, csrf);
        const jobs = async () => ((await (await fetch(`${server.url}/api/notify`, {headers: {Cookie: cookie}})).json()) as {data: {jobs: Array<{state: string}>}}).data.jobs;
        await until(async () => (await jobs())[0]?.state === "waiting_takeover", 8_000, "waiting_takeover");
        await Bun.sleep(4_000);
        expect(fake.prompts).toEqual([]);
        expect((await jobs())[0]?.state).toBe("waiting_takeover");
        const from = client.messages.length;
        client.send({t: "release"});
        await client.next("released", from);
        const released = Date.now();
        await until(() => fake.prompts.length > 0, 12_000, "释放后投递");
        expect(Date.now() - released).toBeGreaterThanOrEqual(2_500);
        expect(fake.prompts[0]).toMatchObject({target: "w9:p1"});
    }, 40_000);

    test("读不到 pty 尺寸：接管照常，释放时不改回（只发 release、没有 resize），释放行 restored: false、notRestored: size_unknown", async () => {
        const {connect, state, audit} = await setup("term-size-unknown");
        const client = await connect();
        expect(await client.next("state")).toMatchObject({sizeKnown: false});
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        await until(() => client.messages.some((message) => message.t === "state" && message.mode === "control"), 5_000, "接管");
        const from = client.messages.length;
        client.send({t: "release"});
        expect(await client.next("released", from)).toMatchObject({reason: "user", restored: false, notRestored: "size_unknown"});
        expect((await inputsOf(state)).map((input) => input.type)).toEqual(["terminal.release"]);
        expect(JSON.parse(await readFile(join(state, `size-${TERMINAL}.json`), "utf8"))).toEqual({cols: 100, rows: 30});
        const release = (await audit()).find((line) => line.action === "release")!;
        expect(release.detail).toMatchObject({restored: false, notRestored: "size_unknown"});
        expect((await audit()).find((line) => line.action === "takeover" && line.phase === "intent")!.detail).toMatchObject({before: null});
    }, 30_000);

    test("心跳超时与空闲都会释放（时限改小），尺寸改回", async () => {
        for (const [how, timings] of [["heartbeat", {heartbeatMs: 900}], ["idle", {idleMs: 1_200}]] as const) {
            const shell = await ptyShell(70, 20);
            const {connect, state} = await setup(`term-${how}`, {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, shell_pid: shell})], timings});
            const client = await connect();
            await client.next("frame");
            client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
            await until(() => client.messages.some((message) => message.t === "state" && message.mode === "control"), 5_000, "接管");
            const from = client.messages.length;
            // 空闲：心跳照发、不输入；心跳超时：什么都不发。
            const alive = how === "idle" ? setInterval(() => client.send({t: "alive"}), 200) : null;
            try {
                expect(await client.next("released", from, 5_000)).toMatchObject({reason: how, restored: true});
            } finally {
                if (alive) clearInterval(alive);
            }
            expect(JSON.parse(await readFile(join(state, `size-${TERMINAL}.json`), "utf8"))).toEqual({cols: 70, rows: 20});
            expect(await client.next("state", from)).toMatchObject({mode: "watch"});
        }
    }, 40_000);
});

describe("背压与退出（设计审查 S2、S3）", () => {
    test("浏览器读得慢：暂停读子进程，面板内存有上限；放开之后帧序号连续", async () => {
        const {server, tools, fixture} = await setup("term-backpressure", {terminals: {[TERMINAL]: {mode: "flood"}}});
        const hub = new TerminalHub({
            state: server.state, client: createHerdrClient({socketPath: tools.socketPath, allow: HERDR_PANEL_METHODS}), tools: {available: true, tools},
            audit: createAuditWriter(auditPaths(panelEnv(fixture)), "test"), notifier: {tick: () => Promise.resolve()} as unknown as Notifier,
            locks: new PaneLocks(), controls: new ControlRegistry(), log: () => undefined,
        });
        closers.push(() => hub.stop());
        let buffered = 0;
        const seqs: number[] = [];
        const ws = {
            data: {kind: "terminal", instance: "x", connectionId: "c1", loginSession: "s", paneId: "w9:p1", terminalId: TERMINAL},
            send(text: string) {
                const message = JSON.parse(text) as {t: string; seq?: number};
                if (message.t === "frame") seqs.push(message.seq!);
                return text.length;
            },
            getBufferedAmount: () => buffered,
            close() {},
        };
        hub.open(ws as never);
        await until(() => seqs.length > 50, 5_000, "刷屏的帧");
        buffered = 2 * 1024 * 1024;
        await Bun.sleep(500);
        const pausedAt = seqs.length;
        const rss = process.memoryUsage().rss;
        await Bun.sleep(1_500);
        // 停读之前 Bun 已经读进来的那一批还会交完（几百 KB），之后不再增长；面板内存也不跟着子进程的刷屏涨。
        expect(seqs.length - pausedAt).toBeLessThan(150);
        expect(process.memoryUsage().rss - rss).toBeLessThan(16 * 1024 * 1024);
        const settled = seqs.length;
        await Bun.sleep(300);
        expect(seqs.length).toBe(settled);
        buffered = 0;
        hub.drain(ws as never);
        await until(() => seqs.length > settled + 50, 5_000, "放开之后继续出帧");
        expect(seqs.every((seq, index) => index === 0 || seq === seqs[index - 1]! + 1)).toBe(true);
    }, 30_000);

    test("面板退出时控制的子进程先没了：释放行记 panel_exit、没有改回尺寸", async () => {
        const shell = await ptyShell(80, 24);
        const {connect, server, fake, audit} = await setup("term-exit-race", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main, shell_pid: shell})]});
        const client = await connect();
        await client.next("frame");
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        await until(() => client.messages.some((message) => message.t === "state" && message.mode === "control"), 5_000, "接管");
        for (const pid of streamProcesses(fake.socketPath)) process.kill(pid, "SIGKILL");
        await until(() => streamProcesses(fake.socketPath).length === 0, 2_000, "子进程被杀");
        await server.stop();
        const release = (await audit()).find((line) => line.action === "release")!;
        expect([release.detail.reason, release.detail.restored]).toEqual(["panel_exit", false]);
    }, 30_000);
});
