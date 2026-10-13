import {afterEach, describe, expect, test} from "bun:test";
import {spawn, spawnSync, type ChildProcess} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {once} from "node:events";
import {existsSync, readFileSync} from "node:fs";
import {chmod, copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {resolveTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {locateRepository} from "../src/core/repo.js";
import {createHerdrClient, HERDR_PANEL_METHODS} from "../src/herdr/client.js";
import {createLoginTicket} from "../src/server/auth.js";
import {checkDeliverable, deliverKeys, deliverText, type DeliveryContext} from "../src/server/delivery.js";
import {startPanelServer} from "../src/server/serve.js";
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

/** 起命名会话的 server；本机已有同名会话时不覆盖。 */
async function startSessionServer(): Promise<void> {
    const existing = JSON.parse(spawnSync("herdr", ["session", "list", "--json"], {env: cleanEnv, encoding: "utf8"}).stdout) as {sessions: Array<{name: string}>};
    if (existing.sessions.some((session) => session.name === SESSION)) throw new Error(`本机已有 herdr 会话 ${SESSION}，不覆盖；先确认它没人用再删掉`);
    server = spawn("herdr", ["--session", SESSION, "server"], {env: cleanEnv, stdio: "ignore"});
    for (let waited = 0; !existsSync(socketPath); waited += 100) {
        if (waited > 10_000) throw new Error("命名会话的 herdr server 10 秒内没有起来");
        await sleep(100);
    }
}

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

describe("真实 herdr 的投递（t11，命名会话里名为 claude 的假界面）", () => {
    const SCREENS = (JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", "fake-claude-screens.json"), "utf8")) as {screens: Record<string, string>}).screens;

    /** 在命名会话里起一格假 Claude：可执行文件名是 claude（herdr 按进程名认），再报一个会话 id。 */
    async function fakeClaude(root: string, cwd: string): Promise<{paneId: string; sessionId: string; screen: (name: string) => Promise<void>; bytes: () => Promise<string[]>; clearLog: () => Promise<void>}> {
        const bin = join(root, "bin");
        await mkdir(bin, {recursive: true});
        await copyFile(resolve(import.meta.dirname, "fixtures", "fake-claude-tui.py"), join(bin, "claude"));
        await chmod(join(bin, "claude"), 0o755);
        const screenFile = join(root, "screen.txt");
        const log = join(root, "tui.log");
        await writeFile(screenFile, SCREENS["idle-empty"]!);
        await writeFile(log, "");
        const created = herdr(["workspace", "create", "--cwd", cwd, "--no-focus"]) as {result: {root_pane: {pane_id: string}}};
        const paneId = created.result.root_pane.pane_id;
        herdr(["pane", "run", paneId, `SCREEN='${screenFile}' FAKE_LOG='${log}' '${join(bin, "claude")}'`]);
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
        return {
            paneId,
            sessionId,
            // herdr 按清单读屏要一点时间（S0 实测 1.5 秒够）。
            async screen(name) {
                await writeFile(screenFile, SCREENS[name]!);
                await sleep(1_500);
            },
            async bytes() {
                return (await readFile(log, "utf8")).split("\n").filter((line) => line !== "");
            },
            async clearLog() {
                await writeFile(log, "");
            },
        };
    }

    test.skipIf(!herdrInstalled)("认不出的确认界面、详细记录、模型选择、命令表、输入框有字都判不可投、不写一个字节；空输入框（含暗色占位）可投、投进去；按键的字节；换了会话 id 就拒绝", async () => {
        await startSessionServer();
        const fixture = await createFixture("herdr-live-deliver");
        const tui = await fakeClaude(fixture.root, fixture.main);
        const context: DeliveryContext = {client: createHerdrClient({socketPath, allow: HERDR_PANEL_METHODS}), repoRoots: [fixture.main]};
        const target = {paneId: tui.paneId, sessionKey: `claude:${tui.sessionId}`};

        for (const name of ["unknown-confirm", "transcript", "model-picker", "slash-menu", "idle-typed"]) {
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
