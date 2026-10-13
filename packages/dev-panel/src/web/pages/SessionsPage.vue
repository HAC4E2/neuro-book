<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {HERDR_STATUS_LABEL, relativeTime, shortSession} from "../host/format.js";
import {useNotifyActions} from "../host/notify-actions.js";
import {useResource} from "../host/panel-data.js";
import {useSessionConsoleHost} from "../host/session-console.js";
import type {Meta, NotifyData, SessionsData} from "../host/types.js";
import DeveloperMessageDialog from "../parts/DeveloperMessageDialog.vue";
import EphemeralFrame from "../parts/EphemeralFrame.vue";
import LoadState from "../parts/LoadState.vue";
import NotifyStatus from "../parts/NotifyStatus.vue";
import RunList from "../parts/RunList.vue";
import ScreenConfirmDialog from "../parts/ScreenConfirmDialog.vue";
import SessionConsole from "../parts/SessionConsole.vue";
import SessionList from "../parts/SessionList.vue";
import TakeoverDialog from "../parts/TakeoverDialog.vue";
import TerminalTextView from "../parts/TerminalTextView.vue";
import TerminalView from "../parts/TerminalView.vue";
import WriteNotice from "../parts/WriteNotice.vue";

/**
 * 会话页（t03 第三轮会话页的左半边；终端在 t12）：会话以会话 id 加 Agent 名称认，状态与它的运行分开列，附租约；
 * 无主的运行单列；herdr 里不在本仓库的 pane 单列；herdr 不可用时给出说明。“在等你”只认登记的提问，不从终端推断。
 * t11 加两块：最上面是通知（排队的、要处理的、最近 24 小时发过的），以及选中一个会话（`?pane=`）后的屏幕末尾、输入框与按键。
 * 屏幕打开时与每次发送后各读一次，不轮询；要确认的键先重读屏幕、给开发者看过再发。
 * t12：网页终端可用时（`/api/meta.terminal`），会话详情里的屏幕换成实时终端（手机上是文字视图，可切到终端画面只看），
 * 可以接管键盘；接管期间按钮单击即发、经终端连接，输入框不给。连接、心跳、切后台的释放在 `host/terminal-socket.ts`。
 * 对选中会话的操作（终端连接、读屏、发送、两步确认、接管小窗）在 `host/session-console.ts`，都绑定发起时的目标（t15）。
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
    return {paneId: pane.paneId, terminalId: pane.terminalId, sessionKey: `${pane.session.agent}:${pane.session.value}`, agent: pane.agent, status: pane.status};
});
const terminalAvailable = computed(() => meta.data.value?.terminal?.available === true);
const host = useSessionConsoleHost({selected, terminalAvailable});
const terminal = host.terminal;

/** 手机（窄屏或粗指针）：默认文字视图，不给接管。 */
const narrowQuery = window.matchMedia("(max-width: 767px), (pointer: coarse)");
const narrow = ref(narrowQuery.matches);
const onNarrow = () => {
    narrow.value = narrowQuery.matches;
};
narrowQuery.addEventListener("change", onNarrow);
onBeforeUnmount(() => narrowQuery.removeEventListener("change", onNarrow));
const showTerminalOnPhone = ref(false);
watch(host.connection, () => {
    showTerminalOnPhone.value = false;
});

const controlling = computed(() => terminal.value?.state.mode === "control");
const takeoverBlocked = computed(() => {
    if (narrow.value) return "手机上不给接管，用下面的输入框";
    if (audit.value && !audit.value.enabled) return "审计不可用，不能接管";
    return null;
});
const controllerNote = computed(() => {
    const controller = terminal.value?.state.controller;
    return controller && controller.by === "other_browser" ? `面板的另一个浏览器正在接管（${relativeTime(controller.since)}起）` : null;
});
function openLink(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
}
function open(target: string): void {
    void router.replace({query: {...route.query, pane: target}});
}
function close(): void {
    const {pane: _pane, ...rest} = route.query;
    void router.replace({query: rest});
}

const consoleDisabled = computed(() => {
    if (audit.value && !audit.value.enabled) return audit.value.reason === "not_initialized" ? "审计还没初始化：运行 bun run --cwd packages/dev-panel audit-init 之后才能替你打字或按键" : `审计不可用，不能替你打字或按键：${audit.value.detail}`;
    if (data.value && !data.value.herdr.available) return "herdr 不可用";
    return null;
});
const sessionChangeNote = computed(() => (host.sessionChange.value ? `这格的会话换了（${shortSession(host.sessionChange.value.from)} → ${shortSession(host.sessionChange.value.to)}），发出去会发给后者` : null));

/** 确认框只有一个：会话页自己的（按键、文字），或通知的（手动发送判定不可投）。 */
const activeConfirm = computed(() => host.confirm.value ?? notifyActions.confirm.value);
function runConfirm(): void {
    if (host.confirm.value) void host.confirmRun();
    else void notifyActions.confirmRun();
}
function cancelConfirm(): void {
    if (host.confirm.value) host.cancelConfirm();
    else notifyActions.confirm.value = null;
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
                <SessionConsole v-if="selected" :session="selected" :screen="host.screen.value?.screen ?? null" :screen-at="host.screenAt.value" :disabled-reason="consoleDisabled" :pending="host.pending.value" :reset-key="host.resetKey.value" :session-change="sessionChangeNote" :live="terminal !== null" :controlling="controlling" @refresh="host.readScreen" @prompt="(text) => host.sendPrompt(text)" @key="host.pressKey">
                    <template v-if="terminal" #screen>
                        <p v-if="terminal.state.closedReason" style="color: var(--status-warning); font-size: var(--text-xs)">{{ terminal.state.closedReason }}</p>
                        <!-- 接管中不换成文字视图（桌面窗口缩窄时）：释放的入口与“正在接管”的提示都在终端视图里。 -->
                        <template v-else-if="narrow && !showTerminalOnPhone && !controlling">
                            <template v-if="host.history.value">
                                <p style="font-size: var(--text-xs); color: var(--text-secondary)">更早的输出（最近 {{ host.history.value.lines }} 行，{{ relativeTime(host.history.value.at) }}读取）</p>
                                <pre class="max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] p-2" style="background: var(--bg-hover); font-size: var(--text-xs)" aria-label="更早的输出">{{ host.history.value.text || "没有更早的输出" }}</pre>
                            </template>
                            <!-- key 是这一条连接：source 在零件实例的一生里不变，换连接就整体重建（t15）。 -->
                            <TerminalTextView :key="host.connection.value" :source="terminal.source" />
                            <div class="flex flex-wrap gap-2">
                                <Button size="sm" variant="ghost" icon-class="i-lucide-monitor" @click="showTerminalOnPhone = true">终端画面（只看）</Button>
                                <Button v-if="selected.agent === 'omp'" size="sm" variant="ghost" icon-class="i-lucide-history" :disabled="host.historyPending.value" @click="host.readHistory">{{ host.history.value ? "重读更早的输出" : "更早的输出" }}</Button>
                            </div>
                        </template>
                        <template v-else>
                            <TerminalView :key="host.connection.value" :source="terminal.source" :mode="terminal.state.mode" :cols="terminal.state.cols" :rows="terminal.state.rows" :size-known="terminal.state.sizeKnown" :bracketed-paste="selected.agent === 'claude' || selected.agent === 'omp'" :can-takeover="takeoverBlocked === null" :takeover-blocked="takeoverBlocked" :controller-note="controllerNote" :pending="terminal.state.pending" @takeover="host.askTakeover" @release="terminal.release()" @input="(data, paste) => terminal?.input(data, paste)" @resize="(cols, rows) => terminal?.resize(cols, rows)" @open-link="openLink" />
                            <Button v-if="narrow && !controlling" class="self-start" size="sm" variant="ghost" icon-class="i-lucide-text" @click="showTerminalOnPhone = false">回到文字视图</Button>
                        </template>
                    </template>
                </SessionConsole>
                <p v-else style="color: var(--text-muted)">pane {{ paneId }} 上没有 herdr 认得出的会话，或它不在本仓库里</p>
                <WriteNotice v-if="host.notice.value" :notice="host.notice.value" @dismiss="host.notice.value = null" />
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
        <TakeoverDialog :open="host.takeoverAsk.value !== null" :current="{cols: terminal?.state.cols ?? 0, rows: terminal?.state.rows ?? 0, known: terminal?.state.sizeKnown ?? false}" :next="{cols: host.takeoverAsk.value?.cols ?? 0, rows: host.takeoverAsk.value?.rows ?? 0}" :conflict="host.takeoverAsk.value?.force ? host.lastConflict.value : null" :pending="terminal?.state.pending ?? false" @confirm="host.confirmTakeover" @cancel="host.cancelTakeover" />
        <ScreenConfirmDialog :open="activeConfirm !== null" :title="activeConfirm?.title ?? ''" :message="activeConfirm?.message ?? ''" :screen="activeConfirm?.screen ?? null" :confirm-label="activeConfirm?.confirmLabel ?? '确认'" :pending="notifyActions.pending.value || host.pending.value" @confirm="runConfirm" @cancel="cancelConfirm" />
    </div>
</template>
