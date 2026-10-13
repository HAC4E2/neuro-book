import {createHash} from "node:crypto";
import {HerdrError, type HerdrAgentInfo, type HerdrClient} from "../herdr/client.js";
import {judgeDeliverable} from "../herdr/screens.js";
import type {NotifyResult} from "../core/notify.js";

/**
 * 往一格 Agent 的输入框里投一行文字（t11 的通知、会话页的文字），以及发按键。判据见 docs/herdr.md 的“投递”：
 * 按会话键认人、只投本仓库的 pane、只在 idle 或 done 时投、正向白名单（`agent.explain` 为准，读屏交叉核对）、
 * 聚焦的那一格要隔一秒再读一次，紧贴投递再 `agent.get` 复核一遍，投递后看会话有没有弹出确认界面。
 * herdr 粘贴之后约 300 毫秒才写回车、回车前不复查状态，所以这个窗口缩不掉，只能事后察觉（`delivered_into_blocked`）。
 */

export type DeliveryTarget = {paneId: string; sessionKey: string};
export type DeliveryContext = {client: HerdrClient; repoRoots: readonly string[]; sleep?: (ms: number) => Promise<void>};

export type CheckFailure = {
    ok: false;
    /** `not_stable`：状态序号变了（之前记下的“空闲”作废）；`settling`：序号没变、只是还不到稳定时长（记下的照样有效）。 */
    code: "not_found" | "session_changed" | "not_in_repository" | "agent_busy" | "agent_blocked" | "status_unknown" | "not_stable" | "settling" | "not_deliverable" | "herdr_unavailable";
    detail: string;
    /** 不可投时屏幕末尾的样子（纯文字），界面拿它给开发者看。 */
    screen: string | null;
    agent: HerdrAgentInfo | null;
};
export type CheckResult = {ok: true; agent: HerdrAgentInfo; screen: string} | CheckFailure;

export const PROMPT_WAIT_MS = 10_000;

/**
 * 不可投时开发者看到的那一屏的摘要：判定原因加屏幕末尾的 sha256。确认时带回来，服务端重新判定后比对，
 * 不同就不发、再给新屏幕：开发者同意的是“对这一屏发送”，不是“这个 pane 不管现在什么样都发”（t11 实现审查第 6 条）。
 */
export function screenDigest(failure: Pick<CheckFailure, "detail" | "screen">): string {
    return createHash("sha256").update(`${failure.detail}\0${failure.screen ?? ""}`).digest("hex");
}
const FOCUSED_RECHECK_MS = 1_000;
const AFTER_PROMPT_MS = 500;

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function sessionKeyOf(agent: Pick<HerdrAgentInfo, "session">): string | null {
    return agent.session ? `${agent.session.agent}:${agent.session.value}` : null;
}

function within(path: string | null, roots: readonly string[]): boolean {
    return path !== null && roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/** 去掉转义序列，只留最后几行：给开发者看“屏幕末尾”。 */
export function screenTail(visibleAnsi: string, lines = 16): string {
    return visibleAnsi.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][0-9A-Za-z]|\r/gu, "").replace(/\s+$/u, "").split("\n").slice(-lines).join("\n");
}

function fail(code: CheckFailure["code"], detail: string, agent: HerdrAgentInfo | null = null, screen: string | null = null): CheckFailure {
    return {ok: false, code, detail, screen, agent};
}

/** 只看身份、仓库与状态（不读屏）。`requireIdle`：投文字要 idle 或 done；发按键不要求（按键常用来回应确认界面）。 */
async function identity(context: DeliveryContext, target: DeliveryTarget, requireIdle: boolean): Promise<{ok: true; agent: HerdrAgentInfo} | CheckFailure> {
    let agent: HerdrAgentInfo | null;
    try {
        agent = await context.client.agentGet(target.paneId);
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        return fail("herdr_unavailable", `herdr 不可用（${error.code}）：${error.message}`);
    }
    if (!agent) return fail("not_found", `${target.paneId} 上没有 herdr 认得的 Agent`);
    if (sessionKeyOf(agent) !== target.sessionKey) return fail("session_changed", `${target.paneId} 上现在是 ${sessionKeyOf(agent) ?? "（没有会话）"}，不是 ${target.sessionKey}`, agent);
    if (!within(agent.cwd, context.repoRoots) && !within(agent.foregroundCwd, context.repoRoots)) return fail("not_in_repository", `${target.paneId} 不在本仓库的 checkout 里`, agent);
    if (!requireIdle) return {ok: true, agent};
    if (agent.status === "working") return fail("agent_busy", "会话在工作", agent);
    if (agent.status === "blocked") return fail("agent_blocked", "会话在等确认", agent);
    if (agent.status !== "idle" && agent.status !== "done") return fail("status_unknown", `会话状态是 ${agent.status}`, agent);
    return {ok: true, agent};
}

async function screenOf(context: DeliveryContext, agent: HerdrAgentInfo): Promise<{ok: boolean; detail: string; screen: string}> {
    const [explain, visible] = await Promise.all([
        agent.agent === "claude" ? context.client.agentExplain(agent.paneId) : Promise.resolve(null),
        context.client.agentRead(agent.paneId, "visible", "ansi"),
    ]);
    const verdict = judgeDeliverable({agent: agent.agent, explain, visibleAnsi: visible});
    return {ok: verdict.ok, detail: verdict.ok ? "" : verdict.detail, screen: screenTail(visible)};
}

/**
 * 投文字之前的完整判定。`stable`：上一次看到 idle 时记下的状态序号与时刻（防状态抖动）；序号变了或不足 3 秒就不投。
 * 聚焦的那一格要隔一秒再读一次，两次都可投才算（开发者的键盘最可能在那里）。
 */
export async function checkDeliverable(context: DeliveryContext, target: DeliveryTarget, options: {stable?: {seq: number | null; since: number}; stableMs?: number; now?: () => number} = {}): Promise<CheckResult> {
    const now = options.now ?? Date.now;
    const sleep = context.sleep ?? defaultSleep;
    const first = await identity(context, target, true);
    if (!first.ok) return first;
    if (options.stable && first.agent.stateChangeSeq !== options.stable.seq) return fail("not_stable", "状态变过，空闲要重新计时", first.agent);
    if (options.stable && now() - options.stable.since < (options.stableMs ?? 3_000)) return fail("settling", "空闲还不到稳定时长", first.agent);
    try {
        const screen = await screenOf(context, first.agent);
        if (!screen.ok) return fail("not_deliverable", screen.detail, first.agent, screen.screen);
        if (first.agent.focused) {
            await sleep(FOCUSED_RECHECK_MS);
            const again = await identity(context, target, true);
            if (!again.ok) return again;
            if (again.agent.stateChangeSeq !== first.agent.stateChangeSeq) return fail("not_stable", "复读期间状态变了", again.agent);
            const second = await screenOf(context, again.agent);
            if (!second.ok) return fail("not_deliverable", `聚焦的那一格复读不可投：${second.detail}`, again.agent, second.screen);
            return {ok: true, agent: again.agent, screen: second.screen};
        }
        return {ok: true, agent: first.agent, screen: screen.screen};
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        return fail("herdr_unavailable", `读屏失败（${error.code}）：${error.message}`, first.agent);
    }
}

export type DeliveryOutcome = {result: NotifyResult; code: string | null; message: string; agent: HerdrAgentInfo | null};

/**
 * 投递：紧贴着再 `agent.get` 复核会话、仓库、状态与状态序号（`before` 是判定时看到的），再 `agent.prompt`；
 * 之后用返回体与约 500 毫秒后的 `agent.get` 判断有没有在回车前后弹出确认界面（还在等确认，或状态序号一次跳了两格以上）、有没有换了会话。
 */
export async function deliverText(context: DeliveryContext, target: DeliveryTarget, text: string, before: HerdrAgentInfo): Promise<DeliveryOutcome> {
    const sleep = context.sleep ?? defaultSleep;
    const last = await identity(context, target, true);
    if (!last.ok) return {result: last.code === "session_changed" ? "session_changed" : last.code === "agent_blocked" ? "agent_blocked" : "not_deliverable", code: last.code, message: last.detail, agent: last.agent};
    if (last.agent.stateChangeSeq !== before.stateChangeSeq) return {result: "not_deliverable", code: "not_stable", message: "判定之后状态变了", agent: last.agent};
    let prompted: {type: string; agent: HerdrAgentInfo | null};
    try {
        prompted = await context.client.agentPrompt(target.paneId, text, {until: ["working", "blocked"], timeoutMs: PROMPT_WAIT_MS});
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        if (error.code === "agent_blocked") return {result: "agent_blocked", code: error.code, message: "会话在等确认，一个字节都没写", agent: last.agent};
        if (error.code === "agent_prompt_stalled" || error.code === "timeout" || error.code === "client_timeout") {
            return {result: "uncertain", code: error.code, message: "已写入，但没看到会话开始工作；请看终端，不要重发", agent: last.agent};
        }
        if (error.code === "agent_not_found" || error.code === "agent_not_running" || error.code === "pane_not_found") return {result: "session_changed", code: error.code, message: error.message, agent: last.agent};
        return {result: "failed", code: error.code, message: error.message, agent: last.agent};
    }
    await sleep(AFTER_PROMPT_MS);
    let after: HerdrAgentInfo | null = prompted.agent;
    try {
        after = (await context.client.agentGet(target.paneId)) ?? prompted.agent;
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        // 复读失败只少一道事后核对，投递本身已经完成：用返回体里的状态判断。
        after = prompted.agent;
    }
    if (after && sessionKeyOf(after) !== target.sessionKey) {
        return {result: "delivered_maybe_wrong_session", code: null, message: "投递的瞬间 pane 上换了会话，请看终端", agent: after};
    }
    if (after && after.status === "blocked" && after.stateChangeSeq !== last.agent.stateChangeSeq) {
        return {result: "delivered_into_blocked", code: null, message: "投递时会话弹出了确认界面，回车可能确认了它，请马上看终端", agent: after};
    }
    // 正常是“空闲到工作”一次变化。跳了两次以上，或者返回体里出现过 blocked，多半是回车前后弹出了确认界面、回车又确认了它
    // （会话已回到 working，上面那条看不出来；t11 实现审查第 7 条）。宁可多提示一次。
    const jumps = after?.stateChangeSeq != null && last.agent.stateChangeSeq !== null ? after.stateChangeSeq - last.agent.stateChangeSeq : 0;
    if (jumps >= 2 || prompted.agent?.status === "blocked") {
        return {result: "delivered_into_blocked", code: "state_jumped", message: "投递后状态变了不止一次，可能经过了确认界面、回车确认了它，请马上看终端", agent: after};
    }
    return {result: "delivered", code: null, message: "已投递", agent: after};
}

/** 只核身份与仓库（发按键之前、写审计意图之前用）。 */
export function checkSession(context: DeliveryContext, target: DeliveryTarget): Promise<{ok: true; agent: HerdrAgentInfo} | CheckFailure> {
    return identity(context, target, false);
}

/** 按键：只核身份与仓库（任何状态都能发，按键常用来回应确认界面）。 */
export async function deliverKeys(context: DeliveryContext, target: DeliveryTarget, keys: readonly string[]): Promise<{ok: true; agent: HerdrAgentInfo} | CheckFailure> {
    const checked = await identity(context, target, false);
    if (!checked.ok) return checked;
    try {
        await context.client.agentSendKeys(target.paneId, keys);
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        return fail("herdr_unavailable", `发按键失败（${error.code}）：${error.message}`, checked.agent);
    }
    return checked;
}

/** 屏幕末尾（会话页）：`visible`，不带行数（`recent` 加行数会滚动 Claude 的界面，工作中还会报错）。 */
export async function readScreen(context: DeliveryContext, target: DeliveryTarget): Promise<{ok: true; agent: HerdrAgentInfo; screen: string} | CheckFailure> {
    const checked = await identity(context, target, false);
    if (!checked.ok) return checked;
    try {
        return {ok: true, agent: checked.agent, screen: screenTail(await context.client.agentRead(target.paneId, "visible", "ansi"), 60)};
    } catch (error) {
        if (!(error instanceof HerdrError)) throw error;
        return fail("herdr_unavailable", `读屏失败（${error.code}）：${error.message}`, checked.agent);
    }
}
