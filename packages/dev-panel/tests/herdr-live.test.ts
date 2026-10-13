import {afterEach, describe, expect, test} from "bun:test";
import {spawn, spawnSync, type ChildProcess} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {once} from "node:events";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {chmod, copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {createConnection} from "node:net";
import {dirname, join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {resolveTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {auditPaths, initAudit} from "../src/core/audit.js";
import {locateRepository} from "../src/core/repo.js";
import {createHerdrClient, HERDR_PANEL_METHODS, HERDR_PANEL_READ_METHODS, type HerdrClient} from "../src/herdr/client.js";
import {createLoginTicket} from "../src/server/auth.js";
import {checkDeliverable, deliverKeys, deliverText, type DeliveryContext} from "../src/server/delivery.js";
import {HerdrMonitor} from "../src/server/herdr-monitor.js";
import {startPanelServer} from "../src/server/serve.js";
import {readPtySize, type TerminalSize} from "../src/server/terminal-size.js";
import {resolveTerminalTools, startTerminalStream, type StreamKind, type StreamLine, type TerminalStream, type TerminalTools} from "../src/server/terminal-stream.js";
import {cleanupFixtures, CLI_PATH, createFixture, panelEnv, type CliEnvelope} from "./git-fixture.js";

/**
 * L4：在本机 herdr 的命名会话 `nbdev-test` 里跑，绝不碰默认会话。
 * herdr 子进程只拿 HOME、PATH、TERM（不继承测试进程或 Claude 会话的 HERDR_* 变量），所有命令都显式带 `--session`。
 * 本机没有 herdr 时跳过，测试记录里记为未验证。
 */
const SESSION = "nbdev-test";
const herdrInstalled = spawnSync("herdr", ["--version"], {stdio: "ignore"}).status === 0;
const cleanEnv = {HOME: homedir(), PATH: process.env.PATH ?? "", TERM: "xterm-256color"};
const socketPath = join(homedir(), ".config", "herdr", "sessions", SESSION, "herdr.sock");
const PANE_SCRIPT = resolve(import.meta.dirname, "l4-claude-pane.ts");

function herdr(args: string[]): Record<string, unknown> {
    const result = spawnSync("herdr", ["--session", SESSION, ...args], {env: cleanEnv, encoding: "utf8", timeout: 10_000});
    if (result.status !== 0) throw new Error(`herdr ${args.join(" ")} 失败：${result.stdout}${result.stderr}`);
    return result.stdout.trim() === "" ? {} : JSON.parse(result.stdout) as Record<string, unknown>;
}

let server: ChildProcess | null = null;

/** 停掉命名会话的 server 并删除会话；两步都检查退出码，失败就让测试失败并提示手动清理。测试超时也会走到这里。 */
async function teardownSession(): Promise<void> {
    if (!server) return;
    const current = server;
    server = null;
    const stop = spawnSync("herdr", ["--session", SESSION, "server", "stop"], {env: cleanEnv, encoding: "utf8", timeout: 10_000});
    if (current.exitCode === null && current.signalCode === null) {
        const exited = once(current, "exit");
        current.kill("SIGKILL");
        await exited;
    }
    const removed = spawnSync("herdr", ["session", "delete", SESSION], {env: cleanEnv, encoding: "utf8", timeout: 10_000});
    if (removed.status !== 0) throw new Error(`删除命名会话 ${SESSION} 失败（退出码 ${removed.status}），请手动 herdr session delete ${SESSION}：${removed.stderr}`);
    if (stop.status !== 0) throw new Error(`herdr --session ${SESSION} server stop 退出码 ${stop.status}：${stop.stderr}`);
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    try {
        for (const close of closers.splice(0).reverse()) await close();
        await teardownSession();
    } finally {
        await cleanupFixtures();
    }
});

/** 起命名会话的 server（`bin` 给另一个版本的 herdr 时用它当 server，客户端命令照旧用 PATH 里的）；本机已有同名会话时不覆盖。 */
async function startSessionServer(bin = "herdr"): Promise<void> {
    const existing = JSON.parse(spawnSync("herdr", ["session", "list", "--json"], {env: cleanEnv, encoding: "utf8"}).stdout) as {sessions: Array<{name: string}>};
    if (existing.sessions.some((session) => session.name === SESSION)) throw new Error(`本机已有 herdr 会话 ${SESSION}，不覆盖；先确认它没人用再删掉`);
    server = spawn(bin, ["--session", SESSION, "server"], {env: cleanEnv, stdio: "ignore"});
    for (let waited = 0; !existsSync(socketPath); waited += 100) {
        if (waited > 10_000) throw new Error("命名会话的 herdr server 10 秒内没有起来");
        await sleep(100);
    }
}

// 主工作区里不入库的 0.9.1 二进制（开发者的默认 server 是 0.9.1）：只拿来当命名会话的 server，客户端命令照旧用 PATH 里的；不在时跳过这一版本。
const MAIN = dirname(spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {cwd: import.meta.dirname, encoding: "utf8"}).stdout.trim());
const HERDR_091 = join(MAIN, ".local", "agent", "works", "w00022-dev-panel", "tasks", "t12-web-terminal", "herdr-0.9.1", "herdr");
const SERVER_VARIANTS = [
    {name: "0.9.3", bin: "herdr", present: herdrInstalled, note: "本机的 herdr"},
    {name: "0.9.1", bin: HERDR_091, present: herdrInstalled && existsSync(HERDR_091), note: `${HERDR_091} 不在时跳过`},
];

type StepResult = {args: string[]; exitCode: number | null; stdout: string; stderr: string; tokens: Record<string, string> | null; paneGetError: string | null};

describe("真实 herdr（命名会话）", () => {
    test.skipIf(!herdrInstalled)("场景 1：pane 里的 Claude 会话 task new 后，pane get 读回 work、task 标签；改成 done 后标签清掉", async () => {
        await startSessionServer();
        const fixture = await createFixture("herdr-live");
        const created = herdr(["workspace", "create", "--cwd", fixture.main, "--no-focus"]) as {result: {root_pane: {pane_id: string}}};
        const paneId = created.result.root_pane.pane_id;
        const sessionId = randomUUID();
        // `pane.report_agent_session` 单独用不会让一格 bash pane 成为 Agent；用集成同样的 source 报 `report_agent` 才行（2026-10-12 实测）。
        herdr(["pane", "report-agent", paneId, "--source", "herdr:claude", "--agent", "claude", "--state", "idle", "--agent-session-id", sessionId]);

        // 扮成 Claude 的进程要在这格 pane 的前台运行：nbdev 只给前台进程里有调用者的 pane 写标签。
        const output = join(fixture.root, "l4-result.json");
        const planPath = join(fixture.root, "l4-plan.json");
        await writeFile(planPath, JSON.stringify({
            sessionId,
            herdrSession: SESSION,
            paneId,
            cwd: fixture.main,
            cliPath: CLI_PATH,
            env: {HERDR_PANE_ID: paneId, HERDR_SOCKET_PATH: socketPath, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CEILING_DIRECTORIES: resolveTmpRoot()},
            steps: [
                ["task", "new", "w00001", "live", "--title", "真实 herdr", "--json"],
                ["status", "--json"],
                ["task", "status", "w00001", "t02", "done", "--json"],
            ],
            output,
        }));
        herdr(["pane", "run", paneId, process.execPath, PANE_SCRIPT, planPath]);
        for (let waited = 0; !existsSync(output); waited += 100) {
            if (waited > 45_000) throw new Error(`pane 里的脚本 45 秒内没有写出结果；pane 内容：${JSON.stringify(herdr(["pane", "read", paneId]))}`);
            await sleep(100);
        }
        const {pid, results} = JSON.parse(await readFile(output, "utf8")) as {pid: number; results: StepResult[]};
        const [createdTask, status, done] = results.map((step) => ({...step, json: JSON.parse(step.stdout) as CliEnvelope}));

        // 新仓库第一次领号会初始化登记表；除此之外不应有身份或标签的警告。
        expect([createdTask!.exitCode, createdTask!.json.warnings.map((warning) => warning.code)]).toEqual([0, ["registry_initialized"]]);
        expect(createdTask!.json.data).toMatchObject({lease: {session: {key: `claude:${sessionId}`, process: {pid}, herdr: {socketPath, paneId}}}});
        expect(createdTask!.tokens).toEqual({work: "w00001", task: "t02"});

        expect(status!.json.data).toMatchObject({caller: {kind: "session", herdr: {paneId, managed: true}}, herdr: {available: true, socketPath}});

        expect(done!.exitCode).toBe(0);
        expect(done!.tokens).toEqual({});
    }, 90_000);

    test.skipIf(!herdrInstalled)("t10 场景 1：pane 里挂着的 answers --wait，面板提交答复之后 5 秒内以 0 退出并拿到它", async () => {
        await startSessionServer();
        const fixture = await createFixture("herdr-live-answer");
        const dir = ".agents/works/w00001-seed/tasks/t01-seed/artifacts/review";
        await fixture.write(`${dir}/index.html`, '<!doctype html><title>评审板</title><section data-nbdev-question="layout" data-nbdev-type="single"><h2>版式</h2><div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>');
        expect((await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"])).exitCode).toBe(0);
        const created = herdr(["workspace", "create", "--cwd", fixture.main, "--no-focus"]) as {result: {root_pane: {pane_id: string}}};
        const paneId = created.result.root_pane.pane_id;
        const [out, err, exit] = ["out", "err", "exit"].map((name) => join(fixture.root, `wait.${name}`));
        const command = `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 '${process.execPath}' '${CLI_PATH}' answers w00001 t01 review --wait --timeout 60 --json >'${out}' 2>'${err}'; echo $? >'${exit}'`;
        // `pane run` 把参数拼成一行敲进 pane 里的 shell，所以整条命令作为一个参数传，引号由那边的 shell 解释。
        herdr(["pane", "run", paneId, command]);
        // 等 pane 里的命令真的挂上（stderr 报“等待中”）才提交：先提交的话它一启动就看到这份答复、立即返回，证明不了被唤醒。
        for (let waited = 0; !(existsSync(err) && (await readFile(err, "utf8")).includes("等待中")); waited += 100) {
            if (waited > 30_000) throw new Error(`pane 里的 answers --wait 30 秒内没有挂上；pane 内容：${spawnSync("herdr", ["--session", SESSION, "pane", "read", paneId], {env: cleanEnv, encoding: "utf8"}).stdout}`);
            await sleep(100);
        }
        expect(existsSync(exit)).toBe(false);
        const token = randomBytes(32).toString("hex");
        const panel = await startPanelServer({context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0, herdr: null, token, log: () => undefined, env: panelEnv(fixture)});
        closers.push(() => panel.stop());
        const staticDir = join(fixture.root, "web");
        await mkdir(staticDir, {recursive: true});
        await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head></head><body>panel</body></html>\n");
        await panel.setStatic(staticDir, {failed: null});
        await panel.warm();
        const index = await (await fetch(`${panel.url}/`)).text();
        const csrf = /name="nbdev-csrf" content="([^"]+)"/u.exec(index)?.[1] ?? "";
        const cookie = `nbdev_panel_${panel.port}=${panel.auth.redeem(createLoginTicket(token))}`;
        const posted = await fetch(`${panel.url}/api/answers`, {
            method: "POST",
            headers: {Cookie: cookie, Origin: panel.url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json"},
            body: JSON.stringify({workId: "w00001-seed", taskId: "t01-seed", artifactId: "review", version: 1, values: {layout: "cards"}}),
        });
        const body = await posted.json() as {data: {answer: {answerId: string}}};
        expect(posted.status).toBe(200);
        const postedAt = Date.now();
        while (!existsSync(exit) && Date.now() - postedAt < 5_000) await sleep(50);
        expect((await readFile(exit, "utf8")).trim()).toBe("0");
        const waited = JSON.parse(await readFile(out, "utf8")) as {data: {artifacts: Array<{unacked: string[]}>}};
        expect(waited.data.artifacts[0]!.unacked).toEqual([body.data.answer.answerId]);
    }, 90_000);
});

describe("真实 herdr 的状态序号与投递窗口（t11 的通知误报）", () => {
    /** 起面板的 herdr 监视，等它的订阅订上这几格。 */
    async function subscribedMonitor(paneIds: string[]): Promise<HerdrMonitor> {
        const monitor = new HerdrMonitor(createHerdrClient({socketPath, allow: HERDR_PANEL_READ_METHODS}), () => undefined, () => undefined);
        closers.push(async () => monitor.stop());
        monitor.start();
        for (let waited = 0; ; waited += 50) {
            const probes = paneIds.map((paneId) => monitor.watchStatus(paneId));
            probes.forEach((probe) => probe?.close());
            if (probes.every((probe) => probe !== null)) return monitor;
            if (waited > 10_000) throw new Error(`10 秒内面板的订阅没有订上 ${paneIds.join("、")}：${JSON.stringify(monitor.current())}`);
            await sleep(50);
        }
    }

    for (const variant of SERVER_VARIANTS) {
        test.skipIf(!variant.present)(`server ${variant.name}（${variant.note}）：state_change_seq 是全服务器共用的计数，后变状态的那一格序号更大、与各自变了几次无关；面板的订阅按格收到状态事件，B 经过的 blocked 只出现在 B 上`, async () => {
            await startSessionServer(variant.bin);
            const fixture = await createFixture(`herdr-live-seq-${variant.name}`);
            const a = await fakeClaude(join(fixture.root, "a"), fixture.main);
            const b = await fakeClaude(join(fixture.root, "b"), fixture.main);
            const monitor = await subscribedMonitor([a.paneId, b.paneId]);
            const client = createHerdrClient({socketPath, allow: HERDR_PANEL_METHODS});
            const watchA = monitor.watchStatus(a.paneId)!;
            const watchB = monitor.watchStatus(b.paneId)!;
            for (const text of [TRUST_SCREEN, SCREENS["idle-empty"]!, TRUST_SCREEN, SCREENS["idle-empty"]!]) await b.show(text);
            await a.show(TRUST_SCREEN);
            const [infoA, infoB] = await Promise.all([client.agentGet(a.paneId), client.agentGet(b.paneId)]);
            console.log(`L4 t11 server ${variant.name} 状态序号：A ${infoA!.stateChangeSeq} ${JSON.stringify(watchA.statuses())}，B ${infoB!.stateChangeSeq} ${JSON.stringify(watchB.statuses())}`);
            expect([infoA!.status, watchA.statuses(), watchA.intact()]).toEqual(["blocked", ["blocked"], true]);
            // B 换了四次屏幕；机器忙时 herdr 读屏可能合并掉其中的变化，只要求看到过 blocked。
            expect([watchB.statuses().includes("blocked"), watchB.intact()]).toEqual([true, true]);
            // 每格一份计数的话，A 只变了两次（起来时一次）、B 至少两次，A 的序号不会更大。
            expect(infoA!.stateChangeSeq!).toBeGreaterThan(infoB!.stateChangeSeq!);
            watchA.close();
            watchB.close();
        }, 90_000);

        test.skipIf(!variant.present)(`server ${variant.name}（${variant.note}）：带观察的投递：进入工作记 delivered；投递窗口里别的会话变两次状态（序号差不小于 2）仍记 delivered；粘贴时弹出确认、回车确认了它记 passed_blocked`, async () => {
            await startSessionServer(variant.bin);
            const fixture = await createFixture(`herdr-live-window-${variant.name}`);
            const a = await fakeClaude(join(fixture.root, "a"), fixture.main);
            const b = await fakeClaude(join(fixture.root, "b"), fixture.main);
            const monitor = await subscribedMonitor([a.paneId, b.paneId]);
            const full = createHerdrClient({socketPath, allow: HERDR_PANEL_METHODS});
            const target = {paneId: a.paneId, sessionKey: `claude:${a.sessionId}`};
            /** 投一次：A 先回到空输入框；`duringWindow` 在观察开始之后、`agent.prompt` 之前跑（投递窗口里的别的事）。 */
            const deliver = async (label: string, duringWindow: (() => Promise<void>) | null = null) => {
                await a.screen("idle-empty");
                const client: HerdrClient = {...full, async agentPrompt(paneId, text, wait) {
                    if (duringWindow) await duringWindow();
                    return full.agentPrompt(paneId, text, wait);
                }};
                const context: DeliveryContext = {client, repoRoots: [fixture.main], watchStatus: (paneId) => monitor.watchStatus(paneId)};
                const checked = await checkDeliverable(context, target);
                if (!checked.ok) throw new Error(`${label}：判定不可投（${checked.code}：${checked.detail}）`);
                const outcome = await deliverText(context, target, `[nbdev] L4 ${label}`, checked.agent);
                const jump = (outcome.agent?.stateChangeSeq ?? 0) - (checked.agent.stateChangeSeq ?? 0);
                console.log(`L4 t11 server ${variant.name} 投递 ${label}：${outcome.result} ${outcome.code} 序号差 ${jump}`);
                return {result: outcome.result, code: outcome.code, jump};
            };
            await a.react("work");
            expect(await deliver("正常")).toMatchObject({result: "delivered", code: null});
            const busy = await deliver("别的会话变两次", async () => {
                await b.screen("working");
                await b.screen("idle-empty");
            });
            expect([busy.result, busy.code, busy.jump >= 2]).toEqual(["delivered", null, true]);
            await a.react("blocked_in_paste");
            expect(await deliver("粘贴时弹出确认")).toMatchObject({result: "delivered_into_blocked", code: "passed_blocked"});
        }, 120_000);
    }
});

const SCREENS = (JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", "fake-claude-screens.json"), "utf8")) as {screens: Record<string, string>}).screens;
/** 真实 claude 第一次进目录的信任确认，herdr 判 blocked（tests/fixtures/screens.json）。 */
const TRUST_SCREEN = (JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", "screens.json"), "utf8")) as {samples: Array<{name: string; visibleAnsi: string}>}).samples.find((sample) => sample.name === "claude-trust")!.visibleAnsi;

/**
 * 在命名会话里起一格假 Claude：可执行文件名是 claude（herdr 按进程名认），再报一个会话 id。
 * `react`：对输入作出反应的方式（见 `fake-claude-tui.py`：`work` 回车后画“工作中”，`blocked_in_paste` 粘贴时先画信任确认）。
 */
async function fakeClaude(root: string, cwd: string): Promise<{paneId: string; sessionId: string; screen: (name: string) => Promise<void>; show: (text: string) => Promise<void>; react: (mode: "none" | "work" | "blocked_in_paste") => Promise<void>; bytes: () => Promise<string[]>; clearLog: () => Promise<void>}> {
    const bin = join(root, "bin");
    await mkdir(bin, {recursive: true});
    await copyFile(resolve(import.meta.dirname, "fixtures", "fake-claude-tui.py"), join(bin, "claude"));
    await chmod(join(bin, "claude"), 0o755);
    const screenFile = join(root, "screen.txt");
    const log = join(root, "tui.log");
    const reactFile = join(root, "react.json");
    const reactScreens = join(root, "react-screens.json");
    await writeFile(screenFile, SCREENS["idle-empty"]!);
    await writeFile(log, "");
    await writeFile(reactFile, JSON.stringify({mode: "none"}));
    await writeFile(reactScreens, JSON.stringify({working: SCREENS.working, trust: TRUST_SCREEN}));
    const created = herdr(["workspace", "create", "--cwd", cwd, "--no-focus"]) as {result: {root_pane: {pane_id: string}}};
    const paneId = created.result.root_pane.pane_id;
    herdr(["pane", "run", paneId, `SCREEN='${screenFile}' FAKE_LOG='${log}' REACT='${reactFile}' REACT_SCREENS='${reactScreens}' '${join(bin, "claude")}'`]);
    const detected = () => {
        // 认出来之前 `agent get` 以非零退出（agent_not_found），这里只看有没有认成 claude。
        const result = spawnSync("herdr", ["--session", SESSION, "agent", "get", paneId], {env: cleanEnv, encoding: "utf8", timeout: 10_000});
        return result.status === 0 && result.stdout.includes('"agent":"claude"');
    };
    for (let waited = 0; !detected(); waited += 200) {
        if (waited > 15_000) throw new Error(`15 秒内 herdr 没有把假界面认成 claude：${JSON.stringify(herdr(["pane", "get", paneId]))}`);
        await sleep(200);
    }
    const sessionId = randomUUID();
    herdr(["pane", "report-agent-session", paneId, "--source", "herdr:claude", "--agent", "claude", "--agent-session-id", sessionId]);
    await sleep(1_500);
    // herdr 按清单读屏要一点时间（S0 实测 1.5 秒够）。
    const show = async (text: string) => {
        await writeFile(screenFile, text);
        await sleep(1_500);
    };
    return {
        paneId,
        sessionId,
        screen: (name) => show(SCREENS[name]!),
        show,
        async react(mode) {
            await writeFile(reactFile, JSON.stringify({mode}));
        },
        async bytes() {
            return (await readFile(log, "utf8")).split("\n").filter((line) => line !== "");
        },
        async clearLog() {
            await writeFile(log, "");
        },
    };
}

describe("真实 herdr 的投递（t11，命名会话里名为 claude 的假界面）", () => {
    test.skipIf(!herdrInstalled)("认不出的确认界面、详细记录、模型选择、命令表、输入框有字（含 RGB 颜色的字）都判不可投、不写一个字节；空输入框（含暗色占位）可投、投进去；按键的字节；换了会话 id 就拒绝", async () => {
        await startSessionServer();
        const fixture = await createFixture("herdr-live-deliver");
        const tui = await fakeClaude(fixture.root, fixture.main);
        const context: DeliveryContext = {client: createHerdrClient({socketPath, allow: HERDR_PANEL_METHODS}), repoRoots: [fixture.main]};
        const target = {paneId: tui.paneId, sessionKey: `claude:${tui.sessionId}`};

        for (const name of ["unknown-confirm", "transcript", "model-picker", "slash-menu", "idle-typed", "idle-colored"]) {
            await tui.screen(name);
            await tui.clearLog();
            const checked = await checkDeliverable(context, target);
            expect([name, checked.ok]).toEqual([name, false]);
            await sleep(300);
            expect([name, await tui.bytes()]).toEqual([name, []]);
        }

        for (const name of ["idle-empty", "idle-placeholder"]) {
            await tui.screen(name);
            await tui.clearLog();
            const checked = await checkDeliverable(context, target);
            expect([name, checked.ok ? "ok" : `${checked.code}：${checked.detail}`]).toEqual([name, "ok"]);
            const outcome = await deliverText(context, target, `[nbdev] L4 ${name}`, checked.ok ? checked.agent : (null as never));
            // 假界面不会进入工作，herdr 等到点：已写入、不重发。
            expect([name, outcome.result]).toEqual([name, "uncertain"]);
            const written = (await tui.bytes()).join("\n");
            expect([name, written.includes(`[nbdev] L4 ${name}`), written.includes("\\r")]).toEqual([name, true, true]);
        }

        await tui.screen("idle-empty");
        const KEY_BYTES: Record<string, string> = {up: "'\\x1b[A'", down: "'\\x1b[B'", "shift+tab": "'\\x1b[Z'", enter: "'\\r'", esc: "'\\x1b'", "ctrl+c": "'\\x03'", y: "'y'", n: "'n'"};
        for (const [key, bytes] of Object.entries(KEY_BYTES)) {
            await tui.clearLog();
            expect((await deliverKeys(context, target, [key])).ok).toBe(true);
            await sleep(300);
            expect([key, (await tui.bytes()).map((line) => line.slice(line.indexOf(" ") + 1)).join("")]).toEqual([key, `b${bytes}`]);
        }

        // `/clear` 之后会话 id 变了，herdr 不推事件；按旧会话键投递在紧贴投递的核对上被拒绝，不写字节。
        herdr(["pane", "report-agent-session", tui.paneId, "--source", "herdr:claude", "--agent", "claude", "--agent-session-id", randomUUID(), "--session-start-source", "clear"]);
        await sleep(500);
        await tui.clearLog();
        expect(await checkDeliverable(context, target)).toMatchObject({ok: false, code: "session_changed"});
        expect(await deliverKeys(context, target, ["enter"])).toMatchObject({ok: false, code: "session_changed"});
        await sleep(300);
        expect(await tui.bytes()).toEqual([]);
    }, 120_000);
});

describe("真实 herdr 的终端流（t12，命名会话）", () => {
    const PARENT_SCRIPT = resolve(import.meta.dirname, "l4-terminal-parent.ts");
    const same = (a: TerminalSize | null, b: TerminalSize | null) => a !== null && b !== null && a.cols === b.cols && a.rows === b.rows;

    async function until<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, ms: number, what: string): Promise<T> {
        const started = Date.now();
        for (;;) {
            const value = await read();
            if (ok(value)) return value;
            if (Date.now() - started > ms) throw new Error(`${ms} 毫秒内没等到：${what}（最后是 ${JSON.stringify(value)}）`);
            await sleep(50);
        }
    }

    /** 一次 socket 调用（白名单外的 `pane.send_text` 只在测试里用来往 pane 里打字；`herdr` 命令行是同步起的，会挡住收帧的计时）。 */
    function rawCall(method: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolveCall, reject) => {
            const socket = createConnection(socketPath);
            let buffer = "";
            socket.on("connect", () => socket.write(`${JSON.stringify({id: "l4", method, params})}\n`));
            socket.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
                const newline = buffer.indexOf("\n");
                if (newline < 0) return;
                socket.end();
                const response = JSON.parse(buffer.slice(0, newline)) as {result?: unknown; error?: unknown};
                if (response.error) reject(new Error(`${method}：${JSON.stringify(response.error)}`));
                else resolveCall(response.result);
            });
            socket.on("error", reject);
        });
    }

    type Collected = {stream: TerminalStream; lines: StreamLine[]; first: Promise<StreamLine | null>; seenAt(text: string): number | null};
    /** 起一条流并记下每一行与它到达的时刻；收口登记在 closers 里。 */
    function collect(tools: TerminalTools, kind: StreamKind, terminalId: string, size: TerminalSize, takeover = false): Collected {
        const lines: StreamLine[] = [];
        const arrivals: Array<{at: number; text: string}> = [];
        let resolveFirst: (line: StreamLine | null) => void = () => undefined;
        const first = new Promise<StreamLine | null>((done) => (resolveFirst = done));
        const stream = startTerminalStream(tools, kind, terminalId, size, takeover, {
            onLine: (line) => {
                lines.push(line);
                if (line.type === "frame") arrivals.push({at: performance.now(), text: Buffer.from(line.bytes, "base64").toString("utf8")});
                resolveFirst(line);
            },
            onBadLine: (line) => lines.push({type: "closed", reason: `读不懂的行：${line}`}),
            onStderr: () => undefined,
        });
        void stream.exited.then(() => resolveFirst(null));
        closers.push(() => stream.stop());
        return {
            stream, lines, first,
            seenAt(text) {
                let joined = "";
                for (const arrival of arrivals) {
                    joined += arrival.text;
                    if (joined.includes(text)) return arrival.at;
                }
                return null;
            },
        };
    }

    /** 在一个 pty（cols×rows）里挂 herdr 的 TUI；往它的 stdin 写“列 行”改窗口尺寸。 */
    async function attachTui(cols: number, rows: number): Promise<{resize(cols: number, rows: number): void}> {
        const script = `import os, pty, sys, fcntl, termios, struct, select, signal
def size(fd, c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
c, r = int(sys.argv[1]), int(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    size(0, c, r)
    os.execvp(sys.argv[3], sys.argv[3:])
size(fd, c, r)
print(pid, flush=True)
inp = sys.stdin.fileno()
while True:
    ready, _, _ = select.select([fd, inp], [], [], 0.5)
    if fd in ready:
        try:
            if not os.read(fd, 65536):
                break
        except OSError:
            break
    if inp in ready:
        line = os.read(inp, 1024).decode()
        if not line:
            break
        for item in line.strip().splitlines():
            c, r = map(int, item.split())
            size(fd, c, r)
try:
    os.kill(pid, signal.SIGTERM)
except ProcessLookupError:
    pass
os.waitpid(pid, 0)`;
        const wrapper = spawn("python3", ["-I", "-c", script, String(cols), String(rows), "herdr", "--session", SESSION], {env: cleanEnv, stdio: ["pipe", "pipe", "inherit"]});
        const [line] = await once(wrapper.stdout!, "data") as [Buffer];
        const tuiPid = Number(line.toString("utf8").trim());
        closers.push(async () => {
            if (wrapper.exitCode === null && wrapper.signalCode === null) {
                const exited = once(wrapper, "exit");
                wrapper.stdin!.end();
                await Promise.race([exited, sleep(5_000)]);
                if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill("SIGKILL");
            }
            if (existsSync(`/proc/${tuiPid}`)) process.kill(tuiPid, "SIGKILL");
        });
        return {resize: (nextCols, nextRows) => void wrapper.stdin!.write(`${nextCols} ${nextRows}\n`)};
    }

    for (const variant of SERVER_VARIANTS) {
        test.skipIf(!variant.present)(`server ${variant.name}（${variant.note}）：pty 尺寸；两个 observe 同时看、不改尺寸；control 改尺寸、已有控制者时不带 takeover 被拒、带 takeover 抢走、resize、release 后能再连；TUI 在接管中改不动尺寸、释放后能；父进程被 SIGKILL 后子进程退出、控制权释放`, async () => {
            await startSessionServer(variant.bin);
            const fixture = await createFixture(`herdr-live-term-${variant.name}`);
            const created = herdr(["workspace", "create", "--cwd", fixture.main, "--no-focus"]) as {result: {root_pane: {pane_id: string}}};
            const paneId = created.result.root_pane.pane_id;
            const client = createHerdrClient({socketPath, allow: HERDR_PANEL_METHODS});
            const terminalId = (await client.listPanes()).find((pane) => pane.paneId === paneId)!.terminalId;
            expect(terminalId).not.toBe("");

            // 终端流连的是 socket 旁边的 `-client.sock`（TUI 的私有协议），sun_path 108 字节，推出来的路径要放得下。
            const clientSocket = socketPath.replace(/\.sock$/u, "-client.sock");
            expect(existsSync(clientSocket)).toBe(true);
            expect(Buffer.byteLength(clientSocket)).toBeLessThanOrEqual(107);
            const resolved = resolveTerminalTools({PATH: process.env.PATH ?? ""}, socketPath, (name) => Bun.which(name));
            if (!resolved.available) throw new Error(resolved.reason);
            const tools = resolved.tools;

            // pty：`/proc/<shell pid>/fd/0` 是 pty，`stty -F` 读到的与 pane 里 `stty size` 一致。
            const sizeFile = join(fixture.root, "size.txt");
            herdr(["pane", "run", paneId, `stty size > '${sizeFile}'`]);
            const inPane = await until(() => (existsSync(sizeFile) ? readFileSync(sizeFile, "utf8").trim() : ""), (text) => /^\d+ \d+$/u.test(text), 10_000, "pane 里的 stty size");
            const before = await readPtySize(client, paneId);
            expect(before === null ? null : `${before.rows} ${before.cols}`).toBe(inPane);

            // 场景 1：两个 observe 同时看；pane 里有输出后两边都收到；观看不改尺寸。
            const a = collect(tools, "observe", terminalId, before!);
            const b = collect(tools, "observe", terminalId, before!);
            expect([(await a.first)?.type, (await b.first)?.type]).toEqual(["frame", "frame"]);
            expect(a.lines[0]).toMatchObject({full: true});
            // 时延：经同尺寸的 control 打字（pane 里的 shell 回显），量到两个 observe 都收到帧，即 herdr 到面板子进程这一段（照实记，超过 50 毫秒算失败）。
            // 经 socket 的 `pane.send_text` 另记一个数：Bun 的 socket 客户端有时多等约 100 毫秒（herdr.md 的“时延”），不拿它判。
            const writer = collect(tools, "control", terminalId, before!);
            expect((await writer.first)?.type).toBe("frame");
            const latencies: number[] = [];
            for (let round = 0; round < 5; round += 1) {
                const marker = `MARK${randomBytes(4).toString("hex")}`;
                const started = performance.now();
                writer.stream.send({type: "input", text: marker});
                await until(() => [a.seenAt(marker), b.seenAt(marker)], (seen) => seen.every((at) => at !== null), 5_000, "两个 observe 都收到");
                latencies.push(Math.max(a.seenAt(marker)!, b.seenAt(marker)!) - started);
            }
            await writer.stream.stop();
            const viaSocket = `MARK${randomBytes(4).toString("hex")}`;
            const socketStarted = performance.now();
            await rawCall("pane.send_text", {pane_id: paneId, text: viaSocket});
            await until(() => [a.seenAt(viaSocket), b.seenAt(viaSocket)], (seen) => seen.every((at) => at !== null), 5_000, "send_text 之后两个 observe 都收到");
            const socketLatency = Math.max(a.seenAt(viaSocket)!, b.seenAt(viaSocket)!) - socketStarted;
            console.log(`L4 t12 server ${variant.name}：control 打字到两个 observe 都收到帧 ${latencies.map((value) => value.toFixed(1)).join("、")} 毫秒；经 socket 的 pane.send_text ${socketLatency.toFixed(1)} 毫秒`);
            expect(Math.max(...latencies)).toBeLessThan(50);
            expect(await readPtySize(client, paneId)).toEqual(before);
            await a.stream.stop();
            const marker2 = `MARK${randomBytes(4).toString("hex")}`;
            await rawCall("pane.send_text", {pane_id: paneId, text: marker2});
            await until(() => b.seenAt(marker2), (at) => at !== null, 5_000, "关掉一个之后另一个照常收到");
            await b.stream.stop();

            // 场景 2：control 一连上就改尺寸；已有控制者时不带 takeover 第一行就是结束；带 takeover 抢走，前一个收到结束。
            const first = collect(tools, "control", terminalId, {cols: 90, rows: 25});
            expect((await first.first)?.type).toBe("frame");
            await until(() => readPtySize(client, paneId), (size) => same(size, {cols: 90, rows: 25}), 3_000, "control 改成 90×25");
            const refused = collect(tools, "control", terminalId, {cols: 80, rows: 24});
            expect((await refused.first)?.type).toBe("closed");
            expect(await refused.stream.exited).toBe(0);
            const taker = collect(tools, "control", terminalId, {cols: 100, rows: 28}, true);
            expect((await taker.first)?.type).toBe("frame");
            await first.stream.exited;
            expect(first.lines.at(-1)?.type).toBe("closed");
            expect(first.stream.released).toBe(false);
            await until(() => readPtySize(client, paneId), (size) => same(size, {cols: 100, rows: 28}), 3_000, "takeover 改成 100×28");
            taker.stream.send({type: "resize", cols: 95, rows: 26});
            await until(() => readPtySize(client, paneId), (size) => same(size, {cols: 95, rows: 26}), 3_000, "resize 立刻生效");
            // 释放：先改回接管前的尺寸，再 release；之后不带 takeover 的 control 能连上。
            taker.stream.send({type: "resize", cols: before!.cols, rows: before!.rows});
            await taker.stream.stop();
            expect(await readPtySize(client, paneId)).toEqual(before);
            const again = collect(tools, "control", terminalId, before!);
            expect((await again.first)?.type).toBe("frame");
            await again.stream.stop();

            // 场景 3：挂一个 TUI（0.9.3 客户端，开发者现在的组合）。接管中 TUI 改窗口，pane 的尺寸不变；释放后 TUI 改回它的布局，再改窗口 pane 跟着变。
            const tui = await attachTui(100, 30);
            const laidOut = await until(() => readPtySize(client, paneId), (size) => size !== null && size.cols <= 100 && size.rows <= 30, 10_000, "TUI 挂上之后按它的布局");
            const held = collect(tools, "control", terminalId, {cols: 90, rows: 25});
            expect((await held.first)?.type).toBe("frame");
            await until(() => readPtySize(client, paneId), (size) => same(size, {cols: 90, rows: 25}), 3_000, "接管改成 90×25");
            tui.resize(120, 36);
            await sleep(1_500);
            expect(await readPtySize(client, paneId)).toEqual({cols: 90, rows: 25});
            await held.stream.stop();
            const relaid = await until(() => readPtySize(client, paneId), (size) => size !== null && !same(size, {cols: 90, rows: 25}), 5_000, "释放之后 TUI 改回它的布局");
            tui.resize(100, 30);
            await until(() => readPtySize(client, paneId), (size) => same(size, laidOut), 5_000, "TUI 改窗口之后 pane 跟着变");
            console.log(`L4 t12 server ${variant.name}：TUI 布局 ${JSON.stringify(laidOut)}，TUI 放大后释放得到 ${JSON.stringify(relaid)}`);

            // 收口：父进程被 SIGKILL 之后 observe 与 control 子进程都退出（pdeathsig），控制权释放。
            const parent = spawn(process.execPath, [PARENT_SCRIPT, socketPath, terminalId], {env: {HOME: homedir(), PATH: process.env.PATH ?? ""}, stdio: ["ignore", "pipe", "inherit"]});
            closers.push(async () => {
                if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
            });
            const [ready] = await once(parent.stdout!, "data") as [Buffer];
            const pids = JSON.parse(ready.toString("utf8").trim()) as {observe: number; control: number};
            parent.kill("SIGKILL");
            await until(() => [pids.observe, pids.control].filter((pid) => existsSync(`/proc/${pid}`)), (alive) => alive.length === 0, 3_000, "父进程被 SIGKILL 之后子进程退出");
            const after = collect(tools, "control", terminalId, {cols: 80, rows: 24});
            expect((await after.first)?.type).toBe("frame");
            await after.stream.stop();
        }, 120_000);

        test.skipIf(!variant.present)(`server ${variant.name}（${variant.note}）面板层：经 WebSocket 接管后 pty 是请求的尺寸；关连接之后 2 秒内 control 退出、尺寸改回、审计有 disconnect 的释放行`, async () => {
            await startSessionServer(variant.bin);
            const fixture = await createFixture(`herdr-live-panel-term-${variant.name}`);
            const tui = await fakeClaude(fixture.root, fixture.main);
            await initAudit(auditPaths(panelEnv(fixture)));
            const token = randomBytes(32).toString("hex");
            const herdrBin = Bun.which("herdr")!;
            const server = await startPanelServer({
                context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0,
                herdr: createHerdrClient({socketPath, allow: HERDR_PANEL_METHODS}), token, log: () => undefined,
                env: {...panelEnv(fixture), NBDEV_HERDR_BIN: herdrBin},
            });
            closers.push(() => server.stop());
            await mkdir(join(fixture.root, "web"), {recursive: true});
            await writeFile(join(fixture.root, "web", "index.html"), "<!doctype html><html><head></head><body>panel</body></html>\n");
            await server.setStatic(join(fixture.root, "web"), {failed: null});
            await server.warm();
            const pane = await until(() => server.state.herdr.current().panes.find((entry) => entry.paneId === tui.paneId) ?? null, (entry) => entry?.session?.value === tui.sessionId, 10_000, "面板认出假 claude 的会话");
            const terminalId = pane!.terminalId;
            const client = createHerdrClient({socketPath, allow: HERDR_PANEL_METHODS});
            const before = await readPtySize(client, tui.paneId);
            expect(before).not.toBeNull();
            const cookie = `nbdev_panel_${server.port}=${server.auth.redeem(createLoginTicket(token))}`;
            const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws/terminal?pane=${encodeURIComponent(tui.paneId)}&terminal=${encodeURIComponent(terminalId)}`, {headers: {Cookie: cookie, Origin: server.url}} as never);
            const messages: Array<Record<string, unknown>> = [];
            ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data)) as Record<string, unknown>));
            const closed = new Promise<void>((done) => ws.addEventListener("close", () => done()));
            await new Promise((done) => ws.addEventListener("open", done));
            await until(() => messages.some((message) => message.t === "frame"), (seen) => seen, 5_000, "第一帧");
            ws.send(JSON.stringify({t: "takeover", cols: 90, rows: 25, expectedSession: `claude:${tui.sessionId}`, force: false}));
            await until(() => messages.some((message) => message.t === "state" && message.mode === "control"), (seen) => seen, 5_000, "接管");
            expect(await readPtySize(client, tui.paneId)).toEqual({cols: 90, rows: 25});
            // 这个终端的流子进程（按命令行认：herdr terminal session … <terminal id>）。
            const streams = () => readdirSync("/proc").filter((name) => /^\d+$/u.test(name)).filter((name) => {
                try {
                    const cmdline = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0");
                    return cmdline.includes("terminal") && cmdline.includes("session") && cmdline.includes(terminalId);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ESRCH") return false;
                    throw error;
                }
            });
            expect(streams().length).toBe(1);
            const closedAt = Date.now();
            ws.close();
            await closed;
            await until(() => streams().length, (count) => count === 0, 2_000, "关连接之后 control 退出");
            console.log(`L4 t12 server ${variant.name} 面板层：关连接到 control 退出 ${Date.now() - closedAt} 毫秒`);
            expect(await readPtySize(client, tui.paneId)).toEqual(before);
            const audit = readFileSync(auditPaths(panelEnv(fixture)).file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as {action: string; phase: string; detail: Record<string, unknown>});
            expect(audit.map((line) => [line.action, line.phase, line.detail.result ?? line.detail.reason ?? null])).toEqual([["takeover", "intent", null], ["takeover", "result", "attached"], ["release", "result", "disconnect"]]);
            expect(audit[2]!.detail).toMatchObject({restored: true});
        }, 90_000);
    }
});
