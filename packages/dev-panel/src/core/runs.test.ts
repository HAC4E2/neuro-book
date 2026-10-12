import {afterEach, describe, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {realpath, rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import "../../tests/git-fixture.js";
import {spawnMarked, stopProcess, type MarkedChild} from "../../tests/processes.js";
import type {ClaudeIdentity} from "./identity.js";
import {bootTime, processStartTicks, readProcessTable, type ProcessEntry} from "./procfs.js";
import {discoverRuns, type PaneProcesses} from "./runs.js";

const REPO = "/repo";
const S = "11111111-1111-4111-8111-111111111111";
const X = "22222222-2222-4222-8222-222222222222";

function proc(pid: number, ppid: number, cwd: string | null, cmdline: string): ProcessEntry {
    return {pid, ppid, cwd, cmdline, comm: cmdline.split(" ")[0] ?? "", startTicks: String(pid * 100)};
}

/**
 * 合成的进程表，覆盖设计审查列出的几类：Agent 工具派出的命令、MCP 服务、codex 守护进程（带着已关掉的 pane）、
 * `claude bg-pty-host` 与后台会话进程、Claude 的 daemon 与 spare、omp 的 broker 与工具命令、普通 shell pane 里的开发服务、
 * systemd 服务单元、VS Code 的进程，以及调用 nbdev 的进程自己。
 */
const PROCESSES: ProcessEntry[] = [
    proc(100, 50, REPO, "zsh"), proc(101, 100, REPO, "claude"), proc(102, 101, REPO, "zsh -c bun test"), proc(103, 102, REPO, "bun test"),
    proc(104, 101, REPO, "node mcp-server.js"),
    proc(200, 1, REPO, "codex app-server-daemon"),
    proc(300, 1, REPO, "claude bg-pty-host"), proc(301, 300, REPO, "claude --session-id x --fork-session"), proc(302, 301, `${REPO}/.worktree/w00005-a`, "bash -c run-pipeline"),
    proc(303, 1, REPO, "claude daemon run"), proc(304, 1, REPO, "claude bg-spare"),
    proc(400, 50, REPO, "zsh"), proc(401, 400, REPO, "bun omp"), proc(402, 401, REPO, "omp daemon broker"), proc(403, 401, REPO, "bash -c omp-tool"),
    proc(500, 50, REPO, "zsh"), proc(501, 500, `${REPO}/.worktree/w00017-a/packages/neuro-book`, "bun run dev"),
    proc(600, 1, REPO, "bun run long-job"),
    proc(699, 1, "/home/u/.vscode-server", "node vscode-server"), proc(700, 699, REPO, "node tsserver"),
    proc(800, 101, REPO, "zsh -c nbdev status"), proc(801, 800, REPO, "bun cli.ts status"),
];

const ENVIRONMENTS: Record<number, Record<string, string>> = {
    102: {CLAUDE_PID: "101", CLAUDE_CODE_SESSION_ID: S, HERDR_PANE_ID: "w1:p16"},
    103: {CLAUDE_PID: "101", CLAUDE_CODE_SESSION_ID: S, HERDR_PANE_ID: "w1:p16"},
    104: {CLAUDE_CODE_SESSION_ID: S},
    200: {HERDR_PANE_ID: "w1:p7"},
    300: {HERDR_PANE_ID: "w1:pK"},
    301: {HERDR_PANE_ID: "w1:pK"},
    302: {CLAUDE_PID: "301", CLAUDE_CODE_SESSION_ID: X, HERDR_PANE_ID: "w1:pK"},
    303: {HERDR_PANE_ID: "w1:pK"},
    304: {HERDR_PANE_ID: "w1:pK"},
    402: {HERDR_PANE_ID: "w1:pV"},
    403: {OMPCODE: "1", CLAUDECODE: "1", HERDR_PANE_ID: "w1:pV"},
    501: {HERDR_PANE_ID: "w1:pJ"},
    800: {CLAUDE_PID: "101", CLAUDE_CODE_SESSION_ID: S},
    801: {CLAUDE_PID: "101", CLAUDE_CODE_SESSION_ID: S},
};

const PANES: PaneProcesses[] = [
    {paneId: "w1:p16", shellPid: 100, foregroundPids: [101], session: {agent: "claude", kind: "id", value: S}},
    {paneId: "w1:pK", shellPid: 900, foregroundPids: [901], session: {agent: "claude", kind: "id", value: X}},
    {paneId: "w1:pV", shellPid: 400, foregroundPids: [401], session: {agent: "omp", kind: "path", value: "/o.jsonl"}},
    {paneId: "w1:pJ", shellPid: 500, foregroundPids: [501], session: null},
];

const fakeClaude = async (env: Record<string, string>): Promise<ClaudeIdentity | null> => {
    const sessionId = env.CLAUDE_CODE_SESSION_ID;
    return sessionId ? {sessionId, process: {pid: Number(env.CLAUDE_PID), startTicks: "1"}, parentSessionId: null, nestedSessionId: null} : null;
};

async function synthetic(panes: PaneProcesses[] | null) {
    return discoverRuns({
        processes: PROCESSES,
        checkoutRoots: [REPO, `${REPO}/.worktree/w00005-a`, `${REPO}/.worktree/w00017-a`],
        selfPid: 801,
        panes,
        bootTime: 1_790_000_000,
        readEnv: async (pid) => ENVIRONMENTS[pid] ?? {},
        unitOf: async (pid) => (pid === 600 ? "nbdev-dev.service" : null),
        resolveClaude: fakeClaude,
    });
}

describe("运行的发现与归属（合成进程表）", () => {
    test("只认工具标记；守护进程、宿主进程、Agent 的内部进程与调用者自己都不算运行", async () => {
        const {runs, ignored} = await synthetic(PANES);
        const summary = runs.map((run) => [run.pid, run.owner?.key ?? null, run.ownerVia, run.paneId, run.unit, run.descendants.map((entry) => entry.pid)]);
        expect(summary).toEqual([
            [102, `claude:${S}`, "tool-env", "w1:p16", null, [103]],
            [302, `claude:${X}`, "tool-env", "w1:pK", null, []],
            [403, "omp:/o.jsonl", "tool-env", "w1:pV", null, []],
            [501, null, null, "w1:pJ", null, []],
            [600, null, null, null, "nbdev-dev.service", []],
        ]);
        // 被忽略的根：codex（200）、bg-pty-host（300，后台会话 301 并在它下面）、daemon（303）、spare（304）、VS Code（700）。
        expect(ignored).toBe(5);
        expect(runs[0]?.startedAt).toBe(new Date((1_790_000_000 + 102) * 1000).toISOString());
    });

    test("herdr 不可用时只按 Claude 的工具标记归属，其余没有 pane 可查", async () => {
        const {runs} = await synthetic(null);
        const owned = runs.filter((run) => run.owner !== null).map((run) => [run.pid, run.owner?.key]);
        expect(owned).toEqual([[102, `claude:${S}`], [302, `claude:${X}`]]);
        expect(runs.some((run) => run.pid === 403 || run.pid === 104)).toBe(false);
    });
});

describe("运行的发现与归属（真实进程）", () => {
    const children: MarkedChild[] = [];
    afterEach(async () => {
        for (const child of children.splice(0)) await stopProcess(child);
    });

    test("带工具标记的进程归到会话；只带 HERDR_PANE_ID 的不归任何会话", async () => {
        const repo = await realpath(await createTestTmpRoot("dev-panel-runs", "dev-panel runs"));
        try {
            const claude = await spawnMarked("sleep", ["30"]);
            children.push(claude);
            const sessionId = randomUUID();
            const tool = await spawnMarked("sleep", ["31"], {cwd: repo, env: {CLAUDE_PID: String(claude.pid), CLAUDE_CODE_SESSION_ID: sessionId}});
            children.push(tool);
            const stray = await spawnMarked("sleep", ["32"], {cwd: repo, env: {HERDR_PANE_ID: "w9:gone"}});
            children.push(stray);
            expect(await processStartTicks(tool.pid)).not.toBeNull();
            const {runs} = await discoverRuns({processes: await readProcessTable(), checkoutRoots: [repo], selfPid: process.pid, panes: [], bootTime: await bootTime()});
            expect(runs.find((run) => run.pid === tool.pid)).toMatchObject({owner: {key: `claude:${sessionId}`}, ownerVia: "tool-env", checkout: repo});
            expect(runs.find((run) => run.pid === stray.pid)?.owner ?? null).toBeNull();
        } finally {
            await rm(repo, {recursive: true, force: true});
        }
    });
});
