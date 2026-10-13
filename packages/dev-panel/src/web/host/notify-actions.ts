import {computed, ref} from "vue";
import {ApiError, sendJson} from "./api.js";
import {readDismissedNotify, writeDismissedNotify} from "./prefs.js";
import type {DeliveryData, NotifyAttempt, NotifyCandidate, NotifyData, NotifyJob} from "./types.js";
import {describeFailure, type Notice} from "./writes.js";

/**
 * 页面（宿主）处理通知的动作：手动发送、“不通知”、发给不是提问者的会话之前的小窗、判定不可投时先看屏幕再确认，以及“知道了”。
 * 产物页与会话页共用；零件只发意图（见 `NotifyStatus`、`DeveloperMessageDialog`、`ScreenConfirmDialog`）。
 * 发给提问者本人的是固定的 `[nbdev]` 指针消息；发给别的会话（会话已更换后的新会话、持有租约的会话）先开小窗，
 * 由开发者确认或改写一段以自己名义的普通消息再发（t11 实现审查第 2 条）。
 */

const dismissed = ref<string[]>(readDismissedNotify());

/** 要开发者处理的：会话已更换、没有可通知的会话（且有可选的会话或要选“不通知”），以及没“知道了”的醒目尝试。 */
export function attentionCount(data: NotifyData | null): number {
    if (!data) return 0;
    const jobs = data.jobs.filter((job) => job.state === "replaced" || job.state === "no_target").length;
    return jobs + data.recent.filter((attempt) => isAttention(attempt) && !dismissed.value.includes(attempt.attemptId)).length;
}

export function isAttention(attempt: NotifyAttempt): boolean {
    return attempt.intentOnly || ["delivered_into_blocked", "delivered_maybe_wrong_session", "uncertain"].includes(attempt.result);
}

export function deliveryNotice(result: DeliveryData, target: string): Notice {
    switch (result.result) {
    case "delivered": return {tone: "success", title: "已投递", message: `已发给 ${target}`, items: [], retry: false};
    case "delivered_into_blocked": return {tone: "error", title: "投递时会话弹出了确认界面", message: "回车可能确认了它，请马上看终端", items: [], retry: false};
    case "delivered_maybe_wrong_session": return {tone: "warning", title: "投递的瞬间换了会话", message: "消息可能进了别的会话，请看终端", items: [], retry: false};
    case "uncertain": return {tone: "warning", title: "结果未知", message: "已写入，但没看到会话开始工作；请看终端，不要重发", items: [], retry: false};
    default: return {tone: "warning", title: "没有发出去", message: `${result.message}（${result.code ?? result.result}）`, items: [], retry: false};
    }
}

type ScreenConfirm = {title: string; message: string; screen: string | null; confirmLabel: string; run: () => Promise<void>};
export type Compose = {job: NotifyJob; target: NotifyCandidate; kind: "replaced" | "alternative"};
type Target = {paneId: string; sessionKey: string};
const isAsker = (job: NotifyJob, target: Target) => target.paneId === job.paneId && target.sessionKey === job.sessionKey;

export function useNotifyActions(reload: () => void) {
    const pending = ref(false);
    const notice = ref<Notice | null>(null);
    const compose = ref<Compose | null>(null);
    const confirm = ref<ScreenConfirm | null>(null);

    async function post(path: string, body: Record<string, unknown>): Promise<{ok: true; data: DeliveryData | null} | {ok: false; error: ApiError}> {
        pending.value = true;
        try {
            const response = await sendJson<DeliveryData | {skipped: true}>("POST", path, body);
            reload();
            return {ok: true, data: "result" in response.data ? response.data : null};
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            reload();
            return {ok: false, error};
        } finally {
            pending.value = false;
        }
    }

    /** 零件发来的“通知它”：提问者本人直接发指针消息，别的会话先开小窗。 */
    function request(job: NotifyJob, target: Target): void {
        if (isAsker(job, target)) {
            void deliver(job, target, null);
            return;
        }
        const candidate = [...(job.replacedBy ? [job.replacedBy] : []), ...job.alternatives].find((entry) => entry.paneId === target.paneId && entry.sessionKey === target.sessionKey);
        if (candidate) compose.value = {job, target: candidate, kind: job.replacedBy?.paneId === candidate.paneId ? "replaced" : "alternative"};
    }

    function openReplaced(job: NotifyJob): void {
        if (job.replacedBy) compose.value = {job, target: job.replacedBy, kind: "replaced"};
    }

    /** `text`：发给不是提问者的会话时开发者确认过的消息；发给提问者为 null（服务端发指针消息）。 */
    async function deliver(job: NotifyJob, target: Target, text: string | null, confirmScreen: string | null = null): Promise<void> {
        notice.value = null;
        const outcome = await post("/api/notify/send", {workId: job.workId, taskId: job.taskId, sessionKey: job.sessionKey, target, confirmScreen, text});
        compose.value = null;
        if (outcome.ok) {
            notice.value = deliveryNotice(outcome.data!, target.paneId);
            return;
        }
        const {error} = outcome;
        if (error.code === "not_deliverable" && typeof error.details.screenDigest === "string") {
            const digest = error.details.screenDigest;
            confirm.value = {
                title: confirmScreen === null ? "输入框不是认得出的空" : "屏幕变了，再看一次",
                message: `${target.paneId} 的输入框里可能有字、开着菜单或别的界面（${error.message}）。看过屏幕再决定：仍然发送会把这一行连同回车打进去。`,
                screen: typeof error.details.screen === "string" ? error.details.screen : null,
                confirmLabel: "仍然发送",
                run: () => deliver(job, target, text, digest),
            };
            return;
        }
        const failure = describeFailure(error);
        notice.value = {tone: "error", title: "通知没有发出去", message: failure.message, items: [], retry: false};
    }

    async function skip(job: NotifyJob): Promise<void> {
        notice.value = null;
        const outcome = await post("/api/notify/skip", {workId: job.workId, taskId: job.taskId, sessionKey: job.sessionKey});
        compose.value = null;
        notice.value = outcome.ok ? {tone: "info", title: "不通知", message: "这些答复不再通知这个会话", items: [], retry: false} : {tone: "error", title: "没有记下“不通知”", message: outcome.error.message, items: [], retry: false};
    }

    async function confirmRun(): Promise<void> {
        const current = confirm.value;
        if (!current) return;
        await current.run();
        if (confirm.value === current) confirm.value = null;
    }

    function dismiss(attemptId: string): void {
        dismissed.value = [...dismissed.value.filter((entry) => entry !== attemptId), attemptId];
        writeDismissedNotify(dismissed.value);
    }

    return {pending, notice, compose, confirm, dismissed: computed(() => dismissed.value), request, openReplaced, deliver, skip, confirmRun, dismiss, openScreenConfirm: (value: ScreenConfirm) => (confirm.value = value)};
}
