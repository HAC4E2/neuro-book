import type {HerdrAgentSession} from "../herdr/client.js";
import {trustedClaudeSession, type ClaudeIdentity, type SessionRef} from "./identity.js";
import {readEnviron, startTimeIso, systemdUnitOf, type ProcessEntry} from "./procfs.js";

/**
 * 运行：会话派出、在后台完成的一件事（omp 审查、测试、开发服务）。运行不持有租约，不写任何文件。
 *
 * 归属只认 Agent 工具派出的进程：Claude 给工具子进程的环境里一定有 `CLAUDE_PID`，omp 的是 `OMPCODE=1`。
 * 只有 `HERDR_PANE_ID` 不算线索：环境变量是启动时继承的，脱离终端的守护进程（codex、`claude bg-pty-host`、
 * Claude 的 daemon 与 spare）会把它一直带到那格 pane 关掉之后。没有工具标记的进程沿父进程链找 pane；
 * 先碰到 Agent 进程的是 Agent 的内部进程（MCP 服务、omp 的 broker），排除。
 */
export type PaneProcesses = {paneId: string; shellPid: number | null; foregroundPids: number[]; session: HerdrAgentSession | null};

export type RunView = {
    pid: number;
    startedAt: string;
    command: string;
    cwd: string;
    checkout: string;
    owner: SessionRef | null;
    ownerVia: "tool-env" | "pane" | null;
    paneId: string | null;
    unit: string | null;
    /**
     * 无主的运行若带着 Claude 的工具标记、但那个会话进程已不在（会话结束或 `claude --resume` 换了进程）：
     * `sessionHint` 是标记里的会话键，`sessionAlive` 为 false。其余为 null。
     */
    sessionHint: string | null;
    sessionAlive: boolean | null;
    descendants: Array<{pid: number; command: string}>;
};

export type DiscoverRunsInput = {
    processes: readonly ProcessEntry[];
    checkoutRoots: readonly string[];
    selfPid: number;
    /** herdr 不可用时为 null：只能按工具标记里的 Claude 那一条归属。 */
    panes: readonly PaneProcesses[] | null;
    bootTime: number;
    /**
     * 经 nbdev 起的运行（`run/procs/` 的监管进程、组长与后代快照）的 pid：运行树里（根或任何后代）含有其中之一，整棵不算会话的运行或无主的运行，
     * 由“在跑”页的第一块列出（t14 设计审查 S7）。按完整后代集合判断，不只看显示用的前 5 条。
     */
    exclude?: ReadonlySet<number>;
    /** 以下三个默认读真实的 /proc；合成进程表的测试注入替身。 */
    readEnv?: (pid: number) => Promise<Record<string, string> | null>;
    unitOf?: (pid: number) => Promise<string | null>;
    resolveClaude?: (env: Record<string, string>) => Promise<ClaudeIdentity | "untrusted" | null>;
};

const MAX_DESCENDANTS = 5;
const MAX_COMMAND = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Claude 的 Bash 工具把命令包成 `zsh -c source …/shell-snapshots/… && … && eval '<命令>' …`：显示时取 eval 里的命令
 * （单引号里的 `'\''` 还原成 `'`）。取不到时用第一个后代的命令行；不是这种包装时原样显示。
 */
export function displayCommand(root: Pick<ProcessEntry, "cmdline" | "comm">, firstDescendant: Pick<ProcessEntry, "cmdline" | "comm"> | null): string {
    const raw = root.cmdline || root.comm;
    if (!raw.includes("/shell-snapshots/")) return raw;
    const start = raw.indexOf("eval '");
    if (start >= 0) {
        let command = "";
        for (let index = start + "eval '".length; index < raw.length;) {
            if (raw[index] !== "'") {
                command += raw[index];
                index += 1;
            } else if (raw.startsWith("'\\''", index)) {
                command += "'";
                index += 4;
            } else {
                return command;
            }
        }
    }
    return firstDescendant ? firstDescendant.cmdline || firstDescendant.comm : raw;
}

function sessionRefOf(session: HerdrAgentSession): SessionRef {
    return {key: `${session.agent}:${session.value}`, agent: session.agent, sessionId: session.value, label: null, parentSessionId: null, nestedSessionId: null};
}

function claudeRef(identity: ClaudeIdentity): SessionRef {
    return {key: `claude:${identity.sessionId}`, agent: "claude", sessionId: identity.sessionId, label: null, parentSessionId: identity.parentSessionId, nestedSessionId: identity.nestedSessionId};
}

export async function discoverRuns(input: DiscoverRunsInput): Promise<{runs: RunView[]; ignored: number}> {
    const readEnv = input.readEnv ?? readEnviron;
    const unitOf = input.unitOf ?? systemdUnitOf;
    const resolveClaude = input.resolveClaude ?? trustedClaudeSession;
    const byPid = new Map(input.processes.map((entry) => [entry.pid, entry]));
    // worktree 在主工作区的 .worktree/ 下，两者都是 cwd 的前缀：取最长的那个。
    const rootsByLength = [...input.checkoutRoots].sort((left, right) => right.length - left.length);
    const checkoutOf = (cwd: string | null): string | null => {
        if (cwd === null) return null;
        return rootsByLength.find((root) => cwd === root || cwd.startsWith(`${root}/`)) ?? null;
    };
    const candidates = input.processes.filter((entry) => checkoutOf(entry.cwd) !== null);
    const envCache = new Map<number, Promise<Record<string, string> | null>>();
    const envOf = (pid: number) => {
        let cached = envCache.get(pid);
        if (!cached) {
            cached = readEnv(pid);
            envCache.set(pid, cached);
        }
        return cached;
    };

    const panesById = new Map((input.panes ?? []).map((pane) => [pane.paneId, pane]));
    const paneOfPid = new Map<number, PaneProcesses>();
    const agentPids = new Set<number>();
    for (const pane of input.panes ?? []) {
        if (pane.shellPid !== null) paneOfPid.set(pane.shellPid, pane);
        for (const pid of pane.foregroundPids) {
            paneOfPid.set(pid, pane);
            if (pane.session) agentPids.add(pid);
        }
    }
    for (const candidate of candidates) {
        const claudePid = Number((await envOf(candidate.pid))?.CLAUDE_PID);
        if (Number.isInteger(claudePid) && claudePid > 0) agentPids.add(claudePid);
    }
    const selfChain = new Set<number>();
    for (let pid: number | undefined = input.selfPid; pid !== undefined && pid > 1 && !selfChain.has(pid); pid = byPid.get(pid)?.ppid) selfChain.add(pid);
    // 同一条命令里的管道伙伴（`nbdev status | head`）与调用者同一个进程组；它们不是运行。
    const selfGroup = byPid.get(input.selfPid)?.pgrp ?? null;

    const eligible = candidates.filter((entry) => !agentPids.has(entry.pid) && !selfChain.has(entry.pid) && entry.pgrp !== selfGroup && !(paneOfPid.get(entry.pid)?.shellPid === entry.pid));
    const eligiblePids = new Set(eligible.map((entry) => entry.pid));
    const roots = eligible.filter((entry) => !eligiblePids.has(entry.ppid));
    const rootOf = (entry: ProcessEntry): number => {
        let current = entry;
        while (eligiblePids.has(current.ppid)) current = byPid.get(current.ppid)!;
        return current.pid;
    };
    const descendantsByRoot = new Map<number, ProcessEntry[]>();
    for (const entry of eligible) {
        const root = rootOf(entry);
        if (root === entry.pid) continue;
        const list = descendantsByRoot.get(root) ?? [];
        list.push(entry);
        descendantsByRoot.set(root, list);
    }

    const runs: RunView[] = [];
    let ignored = 0;
    for (const root of roots) {
        if (input.exclude && (input.exclude.has(root.pid) || (descendantsByRoot.get(root.pid) ?? []).some((entry) => input.exclude!.has(entry.pid)))) continue;
        const attribution = await attribute(root, {envOf, resolveClaude, unitOf, panesById, paneOfPid, agentPids, byPid});
        if (attribution === "exclude") continue;
        if (attribution === "ignore") {
            ignored += 1;
            continue;
        }
        const descendants = descendantsByRoot.get(root.pid) ?? [];
        runs.push({
            pid: root.pid,
            startedAt: startTimeIso(input.bootTime, root.startTicks),
            command: displayCommand(root, descendants[0] ?? null).slice(0, MAX_COMMAND),
            cwd: root.cwd!,
            checkout: checkoutOf(root.cwd)!,
            sessionHint: null,
            sessionAlive: null,
            ...attribution,
            descendants: descendants.slice(0, MAX_DESCENDANTS).map((entry) => ({pid: entry.pid, command: (entry.cmdline || entry.comm).slice(0, MAX_COMMAND)})),
        });
    }
    return {runs, ignored};
}

type Attribution = Pick<RunView, "owner" | "ownerVia" | "paneId" | "unit"> & Partial<Pick<RunView, "sessionHint" | "sessionAlive">>;

async function attribute(root: ProcessEntry, context: {
    envOf(pid: number): Promise<Record<string, string> | null>;
    resolveClaude: NonNullable<DiscoverRunsInput["resolveClaude"]>;
    unitOf: NonNullable<DiscoverRunsInput["unitOf"]>;
    panesById: ReadonlyMap<string, PaneProcesses>;
    paneOfPid: ReadonlyMap<number, PaneProcesses>;
    agentPids: ReadonlySet<number>;
    byPid: ReadonlyMap<number, ProcessEntry>;
}): Promise<Attribution | "exclude" | "ignore"> {
    const env = await context.envOf(root.pid) ?? {};
    const envPane = env.HERDR_PANE_ID ? context.panesById.get(env.HERDR_PANE_ID) ?? null : null;
    let hint: Pick<RunView, "sessionHint" | "sessionAlive"> | null = null;
    if (env.CLAUDE_PID) {
        const claude = await context.resolveClaude(env);
        if (claude !== null && claude !== "untrusted") return {owner: claudeRef(claude), ownerVia: "tool-env", paneId: envPane?.paneId ?? null, unit: null};
        // 标记里的 Claude 会话不可信（多半是会话进程已经不在）：仍沿父进程链找；链上也没有着落时列为无主并带上这条线索，不忽略。
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        hint = {sessionHint: sessionId && UUID_PATTERN.test(sessionId) ? `claude:${sessionId}` : null, sessionAlive: context.byPid.has(Number(env.CLAUDE_PID))};
    }
    if (env.OMPCODE === "1" && envPane?.session) return {owner: sessionRefOf(envPane.session), ownerVia: "tool-env", paneId: envPane.paneId, unit: null};
    for (let pid = root.ppid, steps = 0; pid > 1 && steps < 256; steps += 1) {
        if (context.agentPids.has(pid)) return "exclude";
        const pane = context.paneOfPid.get(pid);
        if (pane) return pane.session ? {owner: sessionRefOf(pane.session), ownerVia: "pane", paneId: pane.paneId, unit: null} : {owner: null, ownerVia: null, paneId: pane.paneId, unit: null};
        const parent = context.byPid.get(pid);
        if (!parent) break;
        pid = parent.ppid;
    }
    const unit = await context.unitOf(root.pid);
    if (hint) return {owner: null, ownerVia: null, paneId: null, unit, ...hint};
    return unit ? {owner: null, ownerVia: null, paneId: null, unit} : "ignore";
}
