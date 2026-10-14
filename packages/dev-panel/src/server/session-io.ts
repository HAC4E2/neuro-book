import {newActionId, readAuditStatus, type AuditWriter} from "../core/audit.js";
import {isNbdevError, NbdevError} from "../core/errors.js";
import {PANEL_DEVELOPER} from "../core/identity.js";
import {assertPlainText} from "../core/text-rules.js";
import type {HerdrClient} from "../herdr/client.js";
import {checkDeliverable, checkSession, deliverKeys, deliverText, readHistory, readPaneHistory, readScreen, screenDigest, type DeliveryContext, type DeliveryTarget} from "./delivery.js";
import {lockKeyOf, type ControlRegistry} from "./control-registry.js";
import {AUTO_NOTIFY_VERSIONS, auditUnavailable, checkError, type Notifier, type PaneLocks} from "./notifier.js";
import type {PanelState} from "./state.js";
import {NotReady} from "./views.js";
import {readFields, statusOf, usage, type Envelope} from "./writes.js";

/**
 * 通知与会话页的接口（t11）：读通知任务、手动发送与“不通知”，会话的屏幕末尾、输入框与按键。
 * 写请求到这里之前 `serve.ts` 已核过转发头、Host、登录、`Sec-Fetch-Site`、Origin 与 CSRF。之后的顺序（S8）：
 * 字段与长度、键名白名单 → 审计已初始化 → Ctrl+C 限速（调 herdr 之前记账）→ `agent.get` 核对会话、仓库与状态 →
 * 写审计意图 → 调 herdr → 写审计结果。合同见 docs/panel.md 的“通知”“会话页”。
 */

const KIB = 1024;
const MAX_PROMPT = 4000;
/** 更早的输出读多少行：手机上翻得过来、一次响应不大（omp 一行通常不到 200 字节）。 */
const HISTORY_LINES = 1000;
const PANE_ID = /^[A-Za-z0-9_.:-]{1,64}$/u;
/** 面板给的按键（herdr 的逻辑键名，S0 逐个核实过字节）；不接受任意键名。 */
export const PANEL_KEYS: readonly string[] = ["up", "down", "shift+tab", "enter", "esc", "ctrl+c", "y", "n"];
/** 要两步确认的键：服务端的 `confirmed: true` 只防前端误发（确认框在前端）。上、下单击即发。 */
const CONFIRM_KEYS = new Set(["shift+tab", "enter", "esc", "ctrl+c", "y", "n"]);
/** 同一格 pane 3 秒内只允许一次 Ctrl+C：Claude 连按两次会退出。 */
const CTRL_C_GAP_MS = 3_000;

export type SessionIoDeps = {state: PanelState; notifier: Notifier; locks: PaneLocks; controls: ControlRegistry; audit: AuditWriter; client: HerdrClient | null; envelope: Envelope; log: (message: string) => void};

export function createSessionIo(deps: SessionIoDeps) {
    const {state, notifier, locks, client, envelope, log} = deps;
    const lastCtrlC = new Map<string, number>();

    function context(): DeliveryContext {
        if (!client) throw new NbdevError("herdr_unavailable", "面板没有连 herdr");
        return {client, repoRoots: state.checkouts.filter((checkout) => !checkout.prunable).map((checkout) => checkout.root), controlled: (terminalId) => deps.controls.isControlled(terminalId), watchStatus: (paneId) => state.herdr.watchStatus(paneId)};
    }

    async function requireAudit(): Promise<void> {
        const status = await readAuditStatus(deps.audit.paths);
        if (!status.enabled) throw auditUnavailable(status);
    }

    function paneOf(segment: string | undefined): string {
        if (segment === undefined || !PANE_ID.test(segment)) throw usage(`pane 的写法不对：${segment ?? ""}`, {field: "paneId", reason: "pane_id"});
        return segment;
    }

    function sessionField(value: unknown): string {
        if (typeof value !== "string" || value.trim() === "" || value.length > 200) throw usage("缺少 expectedSession（打开页面时看到的会话键）", {field: "expectedSession", reason: "missing"});
        return value;
    }

    /** 通知任务与最近 24 小时的尝试；`workId`、`taskId` 可选。 */
    function notifyView(url: URL): Response {
        const workId = url.searchParams.get("workId");
        const taskId = url.searchParams.get("taskId");
        const keep = (entry: {workId: string; taskId: string}) => (workId === null || entry.workId === workId) && (taskId === null || entry.taskId === taskId);
        const herdr = state.herdr.current();
        const audit = notifier.audit;
        return envelope({
            jobs: notifier.jobs.filter(keep),
            recent: notifier.recent().filter(keep),
            audit: audit ? (audit.enabled ? {enabled: true, initAt: audit.initAt} : {enabled: false, reason: audit.reason, detail: audit.detail}) : null,
            auto: {versions: AUTO_NOTIFY_VERSIONS, version: herdr.version, enabled: herdr.version !== null && AUTO_NOTIFY_VERSIONS.includes(herdr.version)},
        }, [], null);
    }

    /** 屏幕末尾：`agent.read` 的 `visible`，打开时与每次发送后各读一次，不轮询。 */
    async function screen(paneId: string, url: URL): Promise<Response> {
        const target = {paneId, sessionKey: sessionField(url.searchParams.get("session"))};
        const read = await readScreen(context(), target);
        if (!read.ok) throw checkError(read);
        return envelope({paneId, sessionKey: target.sessionKey, agent: read.agent.agent, status: read.agent.status, focused: read.agent.focused, screen: read.screen}, [], null);
    }

    /** 更早的输出（t12，手机的文字视图）：只给 omp，Claude 回 409 `history_unavailable`；不往会话里写，接管期间照样能读。 */
    async function history(paneId: string, url: URL): Promise<Response> {
        const target = {paneId, sessionKey: sessionField(url.searchParams.get("session"))};
        const read = await readHistory(context(), target, HISTORY_LINES);
        if (!read.ok) throw checkError(read);
        return envelope({paneId, sessionKey: target.sessionKey, lines: HISTORY_LINES, text: read.text}, [], null);
    }

    /** 没有会话键的 pane 的更早输出（t15 阶段 4 第 3 批）：没有会话可核对，按 pane 读；不写审计。 */
    async function paneHistory(paneId: string): Promise<Response> {
        const read = await readPaneHistory(context(), paneId, HISTORY_LINES);
        // 这个接口没有会话：pane 不在是“找不到”（404），不借会话接口的 session_changed。
        if (!read.ok && read.code === "not_found") throw new NbdevError("pane_not_found", read.detail);
        if (!read.ok) throw checkError(read);
        return envelope({paneId, lines: HISTORY_LINES, text: read.text}, [], null);
    }

    /** 输入框：只发给空闲的会话；正向白名单不过时回 409 带屏幕末尾与摘要，开发者看过之后带回摘要（`confirmScreen`）再发，屏幕变了就再回 409。 */
    async function prompt(req: Request, paneId: string): Promise<Response> {
        const fields = await readFields(req, 32 * KIB, {text: {type: "string", required: true}, expectedSession: {type: "string", required: true}, confirmScreen: {type: "nullable-string"}});
        const text = fields.text as string;
        if (text.trim() === "") throw usage("文字不能为空", {field: "text", reason: "missing"});
        if (text.length > MAX_PROMPT) throw usage(`文字超过 ${MAX_PROMPT} 字`, {field: "text", reason: "too_long"});
        assertPlainText(text, "文字", true);
        const target: DeliveryTarget = {paneId, sessionKey: sessionField(fields.expectedSession)};
        await requireAudit();
        const delivery = context();
        const outcome = await notifier.track(locks.run(lockKeyOf(state, paneId), async () => {
            const checked = await checkDeliverable(delivery, target);
            if (!checked.ok && !(checked.code === "not_deliverable" && checked.agent && fields.confirmScreen === screenDigest(checked))) throw checkError(checked);
            const before = checked.ok ? checked.agent : checked.agent!;
            const actionId = newActionId();
            const auditTarget = {paneId, sessionKey: target.sessionKey};
            await deps.audit.append({actionId, phase: "intent", action: "prompt", device: PANEL_DEVELOPER.device, target: auditTarget, detail: {text, confirmedScreen: !checked.ok}});
            const result = await deliverText(delivery, target, text, before);
            await notifier.auditResult(actionId, "prompt", auditTarget, {result: result.result, code: result.code});
            log(`会话页向 ${target.sessionKey}（${paneId}）发了文字：${result.result}${result.code ? `（${result.code}）` : ""}`);
            return result;
        }));
        return envelope({result: outcome.result, code: outcome.code, message: outcome.message}, [], null);
    }

    /** 按键：只核身份与仓库（在等确认时也能发）；Enter、y、n、Esc、Ctrl+C、Shift+Tab 要 `confirmed`。 */
    async function keys(req: Request, paneId: string): Promise<Response> {
        const fields = await readFields(req, 4 * KIB, {keys: {type: "string-array", required: true}, expectedSession: {type: "string", required: true}, confirmed: {type: "boolean"}});
        const list = fields.keys as string[];
        if (list.length === 0 || list.length > 4) throw usage("一次发 1 到 4 个键", {field: "keys", reason: "count"});
        const unknown = list.find((key) => !PANEL_KEYS.includes(key));
        if (unknown !== undefined) throw new NbdevError("key_not_allowed", `不在按键清单里：${unknown}`, {details: {key: unknown, allowed: PANEL_KEYS}});
        if (list.some((key) => CONFIRM_KEYS.has(key)) && fields.confirmed !== true) throw usage("这个键要先在页面上确认（confirmed: true）", {field: "confirmed", reason: "missing"});
        const ctrlC = list.filter((key) => key === "ctrl+c").length;
        if (ctrlC > 1) throw new NbdevError("key_rate_limited", "一次只能发一个 Ctrl+C", {details: {key: "ctrl+c"}});
        const target: DeliveryTarget = {paneId, sessionKey: sessionField(fields.expectedSession)};
        await requireAudit();
        if (ctrlC === 1) {
            const now = Date.now();
            const last = lastCtrlC.get(paneId);
            if (last !== undefined && now - last < CTRL_C_GAP_MS) throw new NbdevError("key_rate_limited", "同一个会话 3 秒内只能发一次 Ctrl+C（Claude 连按两次会退出）", {details: {key: "ctrl+c", retryAfterMs: CTRL_C_GAP_MS - (now - last)}});
            lastCtrlC.set(paneId, now);
        }
        const delivery = context();
        await notifier.track(locks.run(lockKeyOf(state, paneId), async () => {
            const checked = await checkSession(delivery, target);
            if (!checked.ok) throw checkError(checked);
            const actionId = newActionId();
            const auditTarget = {paneId, sessionKey: target.sessionKey};
            await deps.audit.append({actionId, phase: "intent", action: "keys", device: PANEL_DEVELOPER.device, target: auditTarget, detail: {keys: list, status: checked.agent.status}});
            const sent = await deliverKeys(delivery, target, list);
            await notifier.auditResult(actionId, "keys", auditTarget, sent.ok ? {result: "sent", code: null} : {result: "not_sent", code: sent.code});
            if (!sent.ok) throw checkError(sent);
        }));
        return envelope({sent: list}, [], null);
    }

    async function send(req: Request): Promise<Response> {
        const fields = await readFields(req, 32 * KIB, {workId: {type: "string", required: true}, taskId: {type: "string", required: true}, sessionKey: {type: "string", required: true}, target: {type: "object", required: true}, confirmScreen: {type: "nullable-string"}, text: {type: "nullable-string"}});
        const target = fields.target as Record<string, unknown>;
        if (typeof target.paneId !== "string" || !PANE_ID.test(target.paneId) || typeof target.sessionKey !== "string" || Object.keys(target).length !== 2) {
            throw usage("target 要写成 {paneId, sessionKey}", {field: "target", reason: "type"});
        }
        const outcome = await notifier.sendManual({
            workId: fields.workId as string, taskId: fields.taskId as string, sessionKey: fields.sessionKey as string,
            target: {paneId: target.paneId, sessionKey: target.sessionKey}, confirmScreen: (fields.confirmScreen as string | null | undefined) ?? null, text: (fields.text as string | null | undefined) ?? null,
        });
        return envelope({result: outcome.result, code: outcome.code, message: outcome.message}, [], null);
    }

    async function skip(req: Request): Promise<Response> {
        const fields = await readFields(req, 4 * KIB, {workId: {type: "string", required: true}, taskId: {type: "string", required: true}, sessionKey: {type: "string", required: true}});
        await notifier.skip({workId: fields.workId as string, taskId: fields.taskId as string, sessionKey: fields.sessionKey as string});
        return envelope({skipped: true}, [], null);
    }

    function route(req: Request, segments: readonly string[], url: URL): Promise<Response> | Response | null {
        const [, first, second, third, ...extra] = segments;
        if (extra.length > 0) return null;
        if (req.method === "GET") {
            if (first === "notify" && second === undefined) return notifyView(url);
            if (first === "sessions" && second !== undefined && third === "screen") return screen(paneOf(second), url);
            if (first === "sessions" && second !== undefined && third === "history") return history(paneOf(second), url);
            if (first === "panes" && second !== undefined && third === "history") return paneHistory(paneOf(second));
            return null;
        }
        if (req.method === "POST") {
            if (first === "notify" && second === "send" && third === undefined) return send(req);
            if (first === "notify" && second === "skip" && third === undefined) return skip(req);
            if (first === "sessions" && second !== undefined && third === "prompt") return prompt(req, paneOf(second));
            if (first === "sessions" && second !== undefined && third === "keys") return keys(req, paneOf(second));
        }
        return null;
    }

    /** 这里的路由返回回应；不是这里的路由返回 null，交回调用方。 */
    return async function handleSessionIo(req: Request, segments: readonly string[], url: URL): Promise<Response | null> {
        try {
            return await route(req, segments, url);
        } catch (error) {
            if (error instanceof NotReady) return envelope(null, [], {code: "warming_up", message: error.message}, 503);
            if (isNbdevError(error)) return envelope(null, [], {code: error.code, message: error.message, details: error.details}, statusOf(error));
            log(`接口 ${req.method} ${url.pathname} 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            return envelope(null, [], {code: "internal", message: "面板内部错误，详见面板的日志"}, 500);
        }
    };
}
