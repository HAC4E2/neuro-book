<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {ApiError, getJson, sendJson} from "../host/api.js";
import {HERDR_STATUS_LABEL, relativeTime, shortSession} from "../host/format.js";
import {deliveryNotice, useNotifyActions} from "../host/notify-actions.js";
import {useResource} from "../host/panel-data.js";
import type {DeliveryData, Meta, NotifyData, ScreenData, SessionsData} from "../host/types.js";
import {describeFailure, type Notice} from "../host/writes.js";
import DeveloperMessageDialog from "../parts/DeveloperMessageDialog.vue";
import EphemeralFrame from "../parts/EphemeralFrame.vue";
import LoadState from "../parts/LoadState.vue";
import NotifyStatus from "../parts/NotifyStatus.vue";
import RunList from "../parts/RunList.vue";
import ScreenConfirmDialog from "../parts/ScreenConfirmDialog.vue";
import SessionConsole from "../parts/SessionConsole.vue";
import SessionList from "../parts/SessionList.vue";
import WriteNotice from "../parts/WriteNotice.vue";

/**
 * 会话页（t03 第三轮会话页的左半边；终端在 t12）：会话以会话 id 加 Agent 名称认，状态与它的运行分开列，附租约；
 * 无主的运行单列；herdr 里不在本仓库的 pane 单列；herdr 不可用时给出说明。“在等你”只认登记的提问，不从终端推断。
 * t11 加两块：最上面是通知（排队的、要处理的、最近 24 小时发过的），以及选中一个会话（`?pane=`）后的屏幕末尾、输入框与按键。
 * 屏幕打开时与每次发送后各读一次，不轮询；要确认的键先重读屏幕、给开发者看过再发。
 */
const route = useRoute();
const router = useRouter();
const sessions = useResource<SessionsData>(() => "/api/sessions", ["activity", "sessions"]);
const notify = useResource<NotifyData>(() => "/api/notify", ["notify", "sessions"]);
const meta = useResource<Meta>(() => "/api/meta", ["notify"]);
const data = computed(() => sessions.data.value);
const managedKeys = computed(() => new Set((data.value?.sessions ?? []).map((session) => session.sessionId)));
const otherPanes = computed(() => (data.value?.panes ?? []).filter((pane) => pane.agent !== null && !pane.inRepository));
const idlePanes = computed(() => (data.value?.panes ?? []).filter((pane) => pane.agent !== null && pane.inRepository && !managedKeys.value.has(pane.session?.value ?? null)));

const notifyActions = useNotifyActions(() => notify.reload());
const recent = computed(() => (notify.data.value?.recent ?? []).slice(0, 30));
const audit = computed(() => meta.data.value?.audit ?? null);

/** 选中的会话：`?pane=` 指的那一格，且它在本仓库、herdr 认得出会话。 */
const paneId = computed(() => (typeof route.query.pane === "string" ? route.query.pane : null));
const selected = computed(() => {
    const pane = (data.value?.panes ?? []).find((entry) => entry.paneId === paneId.value);
    if (!pane?.session || !pane.inRepository) return null;
    return {paneId: pane.paneId, sessionKey: `${pane.session.agent}:${pane.session.value}`, agent: pane.agent, status: pane.status};
});
function open(target: string): void {
    void router.replace({query: {...route.query, pane: target}});
}
function close(): void {
    const {pane: _pane, ...rest} = route.query;
    void router.replace({query: rest});
}

const screen = ref<ScreenData | null>(null);
const screenAt = ref<string | null>(null);
const consolePending = ref(false);
const consoleNotice = ref<Notice | null>(null);
const resetKey = ref(0);
const consoleDisabled = computed(() => {
    if (audit.value && !audit.value.enabled) return audit.value.reason === "not_initialized" ? "审计还没初始化：运行 bun run --cwd packages/dev-panel audit-init 之后才能替你打字或按键" : `审计不可用，不能替你打字或按键：${audit.value.detail}`;
    if (data.value && !data.value.herdr.available) return "herdr 不可用";
    return null;
});

async function readScreen(): Promise<void> {
    const current = selected.value;
    if (!current) return;
    try {
        const body = await getJson<ScreenData>(`/api/sessions/${encodeURIComponent(current.paneId)}/screen?session=${encodeURIComponent(current.sessionKey)}`);
        if (selected.value?.paneId !== current.paneId) return;
        screen.value = body.data;
        screenAt.value = new Date().toISOString();
    } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        consoleNotice.value = {tone: "warning", title: "读不到屏幕", message: error.message, items: [], retry: false};
    }
}
watch(() => selected.value?.sessionKey ?? null, (key) => {
    screen.value = null;
    screenAt.value = null;
    consoleNotice.value = null;
    if (key) void readScreen();
}, {immediate: true});

async function sendPrompt(text: string, confirmScreen: string | null = null): Promise<void> {
    const current = selected.value;
    if (!current) return;
    consolePending.value = true;
    consoleNotice.value = null;
    try {
        const body = await sendJson<DeliveryData>("POST", `/api/sessions/${encodeURIComponent(current.paneId)}/prompt`, {text, expectedSession: current.sessionKey, confirmScreen});
        consoleNotice.value = deliveryNotice(body.data, current.paneId);
        if (body.data.result !== "not_deliverable" && body.data.result !== "agent_blocked" && body.data.result !== "session_changed") resetKey.value += 1;
    } catch (error) {
        if (error instanceof ApiError && error.code === "not_deliverable" && typeof error.details.screenDigest === "string") {
            const digest = error.details.screenDigest;
            notifyActions.openScreenConfirm({
                title: confirmScreen === null ? "输入框不是认得出的空" : "屏幕变了，再看一次",
                message: `${current.paneId} 的输入框里可能有字、开着菜单或别的界面（${error.message}）。看过屏幕再决定：仍然发送会把你的文字连同回车打进去。`,
                screen: typeof error.details.screen === "string" ? error.details.screen : null,
                confirmLabel: "仍然发送",
                run: () => sendPrompt(text, digest),
            });
        } else {
            consoleNotice.value = {tone: "error", title: "没有发出去", message: describeFailure(error).message, items: [], retry: false};
        }
    } finally {
        consolePending.value = false;
        await readScreen();
    }
}

const KEY_CONFIRM: Record<string, {label: string; message: string}> = {
    "shift+tab": {label: "Shift+Tab", message: "将按下 Shift+Tab：切换会话的权限模式（例如进出计划模式、自动接受编辑）。"},
    enter: {label: "Enter", message: "将按下 Enter：会提交输入框，或确认确认界面上的缺省项（可能是“允许执行”）。"},
    esc: {label: "Esc", message: "将按下 Esc：打断会话正在做的这一轮。"},
    "ctrl+c": {label: "Ctrl+C", message: "将按下 Ctrl+C：打断会话；Claude 连按两次会退出，同一会话 3 秒内只能按一次。"},
    y: {label: "y", message: "将按下 y：回答确认界面。y 能不能回答 Claude 的确认界面还没有核实，可能批准一次危险的工具调用。"},
    n: {label: "n", message: "将按下 n：回答确认界面（还没有核实是否有效）。"},
};

async function sendKey(key: string, confirmed: boolean): Promise<void> {
    const current = selected.value;
    if (!current) return;
    consolePending.value = true;
    consoleNotice.value = null;
    try {
        await sendJson<{sent: string[]}>("POST", `/api/sessions/${encodeURIComponent(current.paneId)}/keys`, {keys: [key], expectedSession: current.sessionKey, ...(confirmed ? {confirmed: true} : {})});
        consoleNotice.value = {tone: "success", title: "已按下", message: `${KEY_CONFIRM[key]?.label ?? key} → ${current.paneId}`, items: [], retry: false};
    } catch (error) {
        consoleNotice.value = {tone: "error", title: "没有按下", message: describeFailure(error).message, items: [], retry: false};
    } finally {
        consolePending.value = false;
        await readScreen();
    }
}

async function pressKey(key: string): Promise<void> {
    const confirm = KEY_CONFIRM[key];
    if (!confirm) {
        await sendKey(key, false);
        return;
    }
    await readScreen();
    notifyActions.openScreenConfirm({title: `将按下 ${confirm.label}`, message: confirm.message, screen: screen.value?.screen ?? null, confirmLabel: `按下 ${confirm.label}`, run: () => sendKey(key, true)});
}
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-5 p-4 md:p-6">
        <h1 class="font-semibold" style="font-size: var(--text-xl)">会话</h1>
        <LoadState v-if="!data" :loading="sessions.loading.value" :error="sessions.error.value" label="正在读取会话" @retry="sessions.reload()" />
        <template v-else>
            <p class="flex flex-wrap items-center gap-2" style="font-size: var(--text-xs); color: var(--text-secondary)">
                <Badge :tone="data.herdr.available ? 'success' : 'warning'" variant="soft" size="sm">{{ data.herdr.available ? `herdr ${data.herdr.version ?? ""}` : "herdr 不可用" }}</Badge>
                <span v-if="data.herdr.available">{{ data.herdr.mode === "subscribed" ? "已订阅推送" : "轮询中" }}<template v-if="data.herdr.at"> · {{ relativeTime(data.herdr.at) }}更新</template><template v-if="data.herdr.missedEvents > 0"> · 对账补上了 {{ data.herdr.missedEvents }} 次漏掉的状态变化</template></span>
                <span v-else>{{ data.herdr.error ?? "连不上 herdr" }}：租约照常按会话进程与 24 小时判断，看不到会话的状态</span>
                <template v-if="notify.data.value && data.herdr.available && !notify.data.value.auto.enabled"> · 这个 herdr 版本不自动投递通知，只能手动发</template>
            </p>
            <section id="notify" class="flex flex-col gap-2" aria-label="通知">
                <h2 class="font-semibold">通知</h2>
                <p v-if="audit && !audit.enabled && audit.reason === 'not_initialized'" style="font-size: var(--text-xs); color: var(--status-warning)">审计还没初始化：不发通知，也不能替你打字或按键。在终端运行 <code>bun run --cwd packages/dev-panel audit-init</code>（建 {{ audit.path }}）。</p>
                <p v-else-if="audit && !audit.enabled" style="font-size: var(--text-xs); color: var(--status-warning)">审计不可用：不发通知，也不能替你打字或按键。{{ audit.detail }}</p>
                <NotifyStatus :jobs="notify.data.value?.jobs ?? []" :attempts="recent" show-task :pending="notifyActions.pending.value" :dismissed="notifyActions.dismissed.value" empty-text="没有排队的通知，最近 24 小时也没有发过" @send="(job, target) => notifyActions.request(job, target)" @skip="(job) => notifyActions.skip(job)" @replaced="(job) => notifyActions.openReplaced(job)" @dismiss="notifyActions.dismiss" />
                <WriteNotice v-if="notifyActions.notice.value" :notice="notifyActions.notice.value" @dismiss="notifyActions.notice.value = null" />
            </section>
            <section v-if="paneId" class="flex flex-col gap-2 rounded-[var(--radius-panel)] p-4" style="background: var(--panel-surface); border: var(--border-w, 1px) solid var(--divider)" aria-label="会话详情">
                <div class="flex items-center gap-2">
                    <h2 class="font-semibold">会话详情</h2>
                    <Button class="ml-auto" size="sm" variant="ghost" icon-class="i-lucide-x" @click="close">关闭</Button>
                </div>
                <SessionConsole v-if="selected" :session="selected" :screen="screen?.screen ?? null" :screen-at="screenAt" :disabled-reason="consoleDisabled" :pending="consolePending" :reset-key="resetKey" @refresh="readScreen" @prompt="(text) => sendPrompt(text)" @key="pressKey" />
                <p v-else style="color: var(--text-muted)">pane {{ paneId }} 上没有 herdr 认得出的会话，或它不在本仓库里</p>
                <WriteNotice v-if="consoleNotice" :notice="consoleNotice" @dismiss="consoleNotice = null" />
            </section>
            <EphemeralFrame title="持有租约或运行的会话">
                <SessionList :sessions="data.sessions" openable @open="open" />
            </EphemeralFrame>
            <EphemeralFrame title="无主的运行">
                <p v-if="data.unownedRuns.length === 0" style="color: var(--text-muted)">没有</p>
                <RunList v-else :runs="data.unownedRuns" show-pane />
            </EphemeralFrame>
            <EphemeralFrame v-if="idlePanes.length > 0" title="本仓库里的其它 Agent pane">
                <ul class="flex flex-col gap-1" style="font-size: var(--text-xs)">
                    <li v-for="pane in idlePanes" :key="pane.paneId" class="flex flex-wrap items-center gap-2">
                        <span>{{ pane.session ? shortSession(`${pane.session.agent}:${pane.session.value}`) : pane.agent }} · pane {{ pane.paneId }} · {{ HERDR_STATUS_LABEL[pane.status] ?? pane.status }}<template v-if="pane.workspaceLabel"> · {{ pane.workspaceLabel }}</template></span>
                        <Button v-if="pane.session" size="sm" variant="ghost" icon-class="i-lucide-terminal" @click="open(pane.paneId)">屏幕与输入</Button>
                    </li>
                </ul>
            </EphemeralFrame>
            <EphemeralFrame v-if="otherPanes.length > 0" title="不在本仓库的会话">
                <ul class="flex flex-col gap-1" style="font-size: var(--text-xs); color: var(--text-secondary)">
                    <li v-for="pane in otherPanes" :key="pane.paneId">{{ pane.agent }} · pane {{ pane.paneId }} · {{ HERDR_STATUS_LABEL[pane.status] ?? pane.status }} · {{ pane.foregroundCwd ?? pane.cwd ?? "目录未知" }}</li>
                </ul>
            </EphemeralFrame>
            <p v-if="data.ignoredProcesses > 0" style="font-size: var(--text-xs); color: var(--text-muted)">另有 {{ data.ignoredProcesses }} 个短命或无关的进程没有列出</p>
        </template>
        <DeveloperMessageDialog :open="notifyActions.compose.value !== null" :compose="notifyActions.compose.value" :pending="notifyActions.pending.value" @send="(job, target, text) => notifyActions.deliver(job, target, text)" @skip="(job) => notifyActions.skip(job)" @cancel="notifyActions.compose.value = null" />
        <ScreenConfirmDialog :open="notifyActions.confirm.value !== null" :title="notifyActions.confirm.value?.title ?? ''" :message="notifyActions.confirm.value?.message ?? ''" :screen="notifyActions.confirm.value?.screen ?? null" :confirm-label="notifyActions.confirm.value?.confirmLabel ?? '确认'" :pending="notifyActions.pending.value || consolePending" @confirm="notifyActions.confirmRun()" @cancel="notifyActions.confirm.value = null" />
    </div>
</template>
