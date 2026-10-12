import {afterEach, describe, expect, test} from "bun:test";
import {spawn, spawnSync, type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {cleanupFixtures, createFixture, run} from "./git-fixture.js";
import {spawnMarked} from "./processes.js";

/**
 * L4：在本机 herdr 的命名会话 `nbdev-test` 里跑，绝不碰默认会话。
 * herdr 子进程只拿 HOME、PATH、TERM（不继承测试进程或 Claude 会话的 HERDR_* 变量），所有命令都显式带 `--session`。
 * 本机没有 herdr 时跳过，测试记录里记为未验证。
 */
const SESSION = "nbdev-test";
const herdrInstalled = spawnSync("herdr", ["--version"], {stdio: "ignore"}).status === 0;
const cleanEnv = {HOME: homedir(), PATH: process.env.PATH ?? "", TERM: "xterm-256color"};
const socketPath = join(homedir(), ".config", "herdr", "sessions", SESSION, "herdr.sock");

function herdr(args: string[]): Record<string, unknown> {
    const result = spawnSync("herdr", ["--session", SESSION, ...args], {env: cleanEnv, encoding: "utf8", timeout: 10_000});
    if (result.status !== 0) throw new Error(`herdr ${args.join(" ")} 失败：${result.stdout}${result.stderr}`);
    return result.stdout.trim() === "" ? {} : JSON.parse(result.stdout) as Record<string, unknown>;
}

const children: ChildProcess[] = [];
afterEach(async () => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
    await cleanupFixtures();
});

describe("真实 herdr（命名会话）", () => {
    test.skipIf(!herdrInstalled)("场景 1：herdr 里的 Claude 会话 task new 后，pane get 读回 work、task 标签；改成 done 后标签清掉", async () => {
        const existing = JSON.parse(spawnSync("herdr", ["session", "list", "--json"], {env: cleanEnv, encoding: "utf8"}).stdout) as {sessions: Array<{name: string}>};
        if (existing.sessions.some((session) => session.name === SESSION)) throw new Error(`本机已有 herdr 会话 ${SESSION}，不覆盖；先确认它没人用再删掉`);
        const server = spawn("herdr", ["--session", SESSION, "server"], {env: cleanEnv, stdio: "ignore"});
        children.push(server);
        try {
            for (let waited = 0; !existsSync(socketPath); waited += 100) {
                if (waited > 10_000) throw new Error("命名会话的 herdr server 10 秒内没有起来");
                await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            }
            const fixture = await createFixture("herdr-live");
            const created = herdr(["workspace", "create", "--cwd", fixture.main, "--no-focus"]) as {result: {root_pane: {pane_id: string}}};
            const paneId = created.result.root_pane.pane_id;
            const sessionId = randomUUID();
            // `pane.report_agent_session` 单独用不会让一格 bash pane 成为 Agent；用集成同样的 source 报 `report_agent` 才行（2026-10-12 实测）。
            herdr(["pane", "report-agent", paneId, "--source", "herdr:claude", "--agent", "claude", "--state", "idle", "--agent-session-id", sessionId]);
            const claude = await spawnMarked("sleep", ["60"]);
            children.push(claude);
            const env = {CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(claude.pid), HERDR_PANE_ID: paneId, HERDR_SOCKET_PATH: socketPath};

            const createdTask = await fixture.cli(["task", "new", "w00001", "live", "--title", "真实 herdr", "--json"], fixture.main, env);
            expect(createdTask.exitCode).toBe(0);
            expect(createdTask.json?.data).toMatchObject({lease: {session: {key: `claude:${sessionId}`, herdr: {socketPath, paneId}}}});
            const tagged = herdr(["pane", "get", paneId]) as {result: {pane: {tokens?: Record<string, string>}}};
            expect(tagged.result.pane.tokens).toEqual({work: "w00001", task: "t02"});

            const status = await fixture.cli(["status", "--json"], fixture.main, env);
            expect(status.json?.data).toMatchObject({caller: {kind: "session", herdr: {paneId, managed: true}}, herdr: {available: true, socketPath}});

            expect((await fixture.cli(["task", "status", "w00001", "t02", "done", "--json"], fixture.main, env)).exitCode).toBe(0);
            const cleared = herdr(["pane", "get", paneId]) as {result: {pane: {tokens?: Record<string, string>}}};
            expect(cleared.result.pane.tokens ?? {}).toEqual({});
        } finally {
            spawnSync("herdr", ["--session", SESSION, "server", "stop"], {env: cleanEnv, stdio: "ignore", timeout: 10_000});
            server.kill("SIGKILL");
            await run("herdr", ["session", "delete", SESSION], homedir(), undefined, 10_000, cleanEnv).catch((error: unknown) => {
                throw new Error(`删除命名会话 ${SESSION} 失败，请手动 herdr session delete ${SESSION}：${String(error)}`);
            });
        }
    }, 60_000);
});
