import {afterEach, describe, expect, test} from "bun:test";
import {spawn, type ChildProcess} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {once} from "node:events";
import {auditPaths, createAuditWriter, initAudit} from "../src/core/audit.js";
import {locateRepository} from "../src/core/repo.js";
import {createHerdrClient, HERDR_PANEL_METHODS} from "../src/herdr/client.js";
import {createLoginTicket} from "../src/server/auth.js";
import {startPanelServer, type PanelServer} from "../src/server/serve.js";
import {startTerminalStream, type TerminalTools} from "../src/server/terminal-stream.js";
import {TerminalHub} from "../src/server/terminal-hub.js";
import {ControlRegistry} from "../src/server/control-registry.js";
import {PaneLocks, type Notifier} from "../src/server/notifier.js";
import {claudePane, shellPane, startFakeHerdr, type FakeHerdr, type FakePane} from "./fake-herdr.js";
import {cleanupFakeTerminals, fakeTerminalTools} from "./fake-terminal.js";
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

type Setup = {fixture: Fixture; fake: FakeHerdr; panes: FakePane[]; server: PanelServer; state: string; tools: TerminalTools; cookie: string; csrf: string; connect(paneId?: string, terminalId?: string): Promise<Client>; audit(): Promise<Array<Record<string, unknown> & {action: string; phase: string; actionId: string; detail: Record<string, unknown>}>>};

async function setup(name: string, options: {panes?: (main: string) => FakePane[]; terminals?: Record<string, {mode?: string; reasons?: string}>; audit?: boolean} = {}): Promise<Setup> {
    const fixture = await createFixture(name);
    if (options.audit !== false) await initAudit(auditPaths(panelEnv(fixture)));
    const panes = options.panes?.(fixture.main) ?? [claudePane("w9:p1", SESSION_A, {cwd: fixture.main, foreground_cwd: fixture.main})];
    const fake = await startFakeHerdr(fixture.root, panes);
    closers.push(() => fake.close());
    fake.version = "0.9.3";
    const {tools, state} = await fakeTerminalTools(name, options.terminals ?? {[TERMINAL]: {}}, dirname(fake.socketPath));
    const token = randomBytes(32).toString("hex");
    const server = await startPanelServer({
        context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0,
        herdr: createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_METHODS}), token, log: () => undefined,
        env: {...panelEnv(fixture), NBDEV_HERDR_BIN: tools.herdrBin},
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
        fixture, fake, panes, server, state, tools, cookie, csrf, connect,
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
        const {connect, state, fake} = await setup("term-watch");
        const client = await connect();
        const status = await client.next("state");
        expect(status).toMatchObject({mode: "watch", cols: 120, rows: 40, sizeKnown: false, controller: null, terminalId: TERMINAL});
        const first = await client.next("frame");
        expect([first.full, first.w, first.h]).toEqual([true, 120, 40]);
        await writeFile(join(state, `screen-${TERMINAL}.txt`), "新的一行");
        await until(() => client.messages.filter((message) => message.t === "frame").length >= 2, 5_000, "增量帧");
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

    test("升级之后用关闭码回原因：不是 Agent 的 pane 4403、terminal 对不上 4404、超过上限 4409", async () => {
        const {connect} = await setup("term-reject", {panes: (main) => [claudePane("w9:p1", SESSION_A, {cwd: main, foreground_cwd: main}), shellPane("w9:p2", {cwd: main, foreground_cwd: main})], terminals: {[TERMINAL]: {}, "term_w9:p2": {}}});
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

    test("握手 5 秒没有回应：error takeover_timeout，锁放开，之后同一格的文字照常发", async () => {
        const {connect, server, cookie, csrf, fake} = await setup("term-timeout", {terminals: {[TERMINAL]: {mode: "silent"}}});
        const client = await connect();
        await client.next("state");
        const started = Date.now();
        client.send({t: "takeover", cols: 100, rows: 30, expectedSession: KEY_A, force: false});
        expect(await client.next("error", 0, 10_000)).toMatchObject({code: "takeover_timeout"});
        expect(Date.now() - started).toBeLessThan(9_000);
        const prompt = await fetch(`${server.url}/api/sessions/w9:p1/prompt`, {method: "POST", headers: {Cookie: cookie, Origin: server.url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json"}, body: JSON.stringify({text: "你好", expectedSession: KEY_A})});
        expect(prompt.status).toBe(200);
        expect(fake.prompts.length).toBe(1);
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
            await until(() => streamProcesses(fake.socketPath).length === 0, 1_500, `${how} 之后子进程退出`);
        }
    }, 60_000);
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
