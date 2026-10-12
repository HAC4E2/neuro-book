import {HerdrError, type HerdrClient, type HerdrPane} from "../herdr/client.js";
import {NbdevError, type Warning} from "./errors.js";
import {readEnviron, readProcStat} from "./procfs.js";

/** 会话的身份。`key` 是租约与登记表认人的主键；`parentSessionId` 在嵌套调用（会话里起的 `claude -p`）时为外层会话 id，身份已归到它。 */
export type SessionRef = {key: string; agent: string; sessionId: string | null; label: string | null; parentSessionId: string | null};
export type ProcessRef = {pid: number; startTicks: string};
/** 调用者在 herdr 里的位置；`managed` 表示 herdr 现在的列表里能找到这个会话（能通知），与会话是否还在无关。 */
export type CallerHerdr = {socketPath: string; paneId: string; terminalId: string; status: HerdrPane["status"]; managed: boolean};
export type SessionCaller = {kind: "session"; ref: SessionRef; via: "as" | "claude-env" | "herdr-pane"; process: ProcessRef | null; herdr: CallerHerdr | null};
export type Caller =
    | SessionCaller
    | {kind: "unknown"; reason: "no_identity" | "herdr_unavailable" | "pane_without_agent"; herdrPaneId: string | null};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const LABEL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
const MAX_NESTING = 5;

type ClaudeIdentity = {sessionId: string; process: ProcessRef; parentSessionId: string | null};

/**
 * 从 Claude Code 给工具子进程的环境变量认会话。只在 `CLAUDE_PID` 存在、进程还活着、id 是 UUID 时才信：
 * herdr server 或 tmux 若曾从某个 Claude 的 Bash 里起过，所有 pane 都会继承一个过期的会话 id。
 * 嵌套的 `claude -p`（会话 A 的 Bash 里起的 B）会给自己的子进程换成 B 的 id；B 的进程环境里仍带着 A 的 id
 * （顶层 Claude 进程的环境里没有这个变量），据此一层层归到最外层会话。
 */
async function claudeIdentity(env: NodeJS.ProcessEnv, warnings: Warning[]): Promise<ClaudeIdentity | null> {
    const sessionId = env.CLAUDE_CODE_SESSION_ID;
    if (!sessionId) return null;
    const pid = Number(env.CLAUDE_PID);
    const stat = Number.isInteger(pid) && pid > 0 ? await readProcStat(pid) : null;
    if (!UUID_PATTERN.test(sessionId) || !stat) {
        warnings.push({
            code: "claude_env_untrusted",
            message: "环境里的 CLAUDE_CODE_SESSION_ID 不可信（缺 CLAUDE_PID、进程已不在或 id 不是 UUID），已忽略",
            details: {sessionId, claudePid: env.CLAUDE_PID ?? null},
        });
        return null;
    }
    let current: ClaudeIdentity = {sessionId, process: {pid, startTicks: stat.startTicks}, parentSessionId: null};
    for (let depth = 0; depth < MAX_NESTING; depth += 1) {
        const outerEnv = await readEnviron(current.process.pid);
        const outerId = outerEnv?.CLAUDE_CODE_SESSION_ID;
        const outerPid = Number(outerEnv?.CLAUDE_PID);
        if (!outerId || !UUID_PATTERN.test(outerId) || outerId === current.sessionId || !Number.isInteger(outerPid)) break;
        const outerStat = await readProcStat(outerPid);
        if (!outerStat) break;
        current = {sessionId: outerId, process: {pid: outerPid, startTicks: outerStat.startTicks}, parentSessionId: outerId};
    }
    return current;
}

async function herdrAvailable(herdr: HerdrClient | null): Promise<boolean> {
    return herdr !== null && (await herdr.availability()).ok;
}

/**
 * 认出调用 nbdev 的会话。判定顺序：`--as` 标签；可信的 Claude 环境变量；`HERDR_PANE_ID` 指向的 pane 上的 Agent 会话；都没有为未知。
 * 只在命令行边界调用：核心函数只接收这里的结果，不自己读 `process.env`。
 */
export async function resolveCaller(input: {env: NodeJS.ProcessEnv; as?: string; herdr: HerdrClient | null}): Promise<{caller: Caller; warnings: Warning[]}> {
    const {env, herdr} = input;
    const warnings: Warning[] = [];
    if (input.as !== undefined) {
        if (!LABEL_PATTERN.test(input.as)) throw new NbdevError("usage", `--as 的标签只能用字母、数字、点、下划线与连字符，最长 64 个字符：${input.as}`);
        return {caller: {kind: "session", ref: {key: `external:${input.as}`, agent: "external", sessionId: null, label: input.as, parentSessionId: null}, via: "as", process: null, herdr: null}, warnings};
    }
    const paneId = env.HERDR_PANE_ID ?? null;
    const claude = await claudeIdentity(env, warnings);
    if (claude) {
        let callerHerdr: CallerHerdr | null = null;
        if (paneId !== null && await herdrAvailable(herdr)) {
            const panes = await listPanesOrWarn(herdr!, warnings);
            const managed = panes.find((pane) => pane.session?.value === claude.sessionId);
            const location = managed ?? panes.find((pane) => pane.paneId === paneId);
            if (location) callerHerdr = {socketPath: herdr!.socketPath, paneId: location.paneId, terminalId: location.terminalId, status: location.status, managed: managed !== undefined};
        } else if (paneId !== null) {
            warnings.push(await unavailableWarning(herdr));
        }
        return {
            caller: {
                kind: "session",
                ref: {key: `claude:${claude.sessionId}`, agent: "claude", sessionId: claude.sessionId, label: null, parentSessionId: claude.parentSessionId},
                via: "claude-env",
                process: claude.process,
                herdr: callerHerdr,
            },
            warnings,
        };
    }
    if (paneId === null) return {caller: {kind: "unknown", reason: "no_identity", herdrPaneId: null}, warnings};
    if (!await herdrAvailable(herdr)) {
        warnings.push(await unavailableWarning(herdr));
        return {caller: {kind: "unknown", reason: "herdr_unavailable", herdrPaneId: paneId}, warnings};
    }
    const pane = (await listPanesOrWarn(herdr!, warnings)).find((candidate) => candidate.paneId === paneId);
    if (!pane) return {caller: {kind: "unknown", reason: "no_identity", herdrPaneId: paneId}, warnings};
    if (!pane.session) return {caller: {kind: "unknown", reason: "pane_without_agent", herdrPaneId: paneId}, warnings};
    const info = await herdr!.processInfo(pane.paneId);
    const mainPid = info?.foregroundGroupId ?? info?.foregroundPids[0] ?? null;
    const mainStat = mainPid === null ? null : await readProcStat(mainPid);
    return {
        caller: {
            kind: "session",
            ref: {key: `${pane.session.agent}:${pane.session.value}`, agent: pane.session.agent, sessionId: pane.session.value, label: null, parentSessionId: null},
            via: "herdr-pane",
            process: mainStat ? {pid: mainStat.pid, startTicks: mainStat.startTicks} : null,
            herdr: {socketPath: herdr!.socketPath, paneId: pane.paneId, terminalId: pane.terminalId, status: pane.status, managed: true},
        },
        warnings,
    };
}

async function listPanesOrWarn(herdr: HerdrClient, warnings: Warning[]): Promise<HerdrPane[]> {
    try {
        return await herdr.listPanes();
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        warnings.push({code: "herdr_unavailable", message: `读 herdr 的 pane 列表失败：${error.message}`, details: {code: error.code, socketPath: herdr.socketPath}});
        return [];
    }
}

async function unavailableWarning(herdr: HerdrClient | null): Promise<Warning> {
    const availability = herdr ? await herdr.availability() : null;
    return {
        code: "herdr_unavailable",
        message: availability && !availability.ok ? `herdr 不可用：${availability.detail}` : "没有可用的 herdr",
        details: availability && !availability.ok ? {reason: availability.reason, socketPath: availability.socketPath} : {},
    };
}
