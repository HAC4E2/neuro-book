<script setup lang="ts">
import {Badge, Button, FormTextarea} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {HERDR_STATUS_LABEL, relativeTime, shortSession} from "../host/format.js";

/** 一个会话的屏幕与贴在它下面的输入区（投递结果、能不能发、输入框、按键）；契约见同名 .md。 */
const props = withDefaults(defineProps<{
    session: {sessionKey: string; paneId: string; agent: string | null; status: string};
    screen: string | null;
    screenAt: string | null;
    disabledReason: string | null;
    pending: boolean;
    resetKey: number;
    /** 屏幕由插槽给（t12 的实时终端），不显示快照与“重读屏幕”。 */
    live?: boolean;
    /** 正在接管键盘：不给输入框（直接在终端里打），按钮单击即发。 */
    controlling?: boolean;
    /** 同一格 pane 换了会话、草稿留着时的一行提示（发出去会发给新会话）。 */
    sessionChange?: string | null;
}>(), {live: false, controlling: false, sessionChange: null});
const emit = defineEmits<{refresh: []; prompt: [text: string]; key: [key: string]}>();
/** 输入框里 Ctrl+Enter（Mac 上 ⌘+Enter）发送，Enter 换行。 */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
const sendShortcut = isMac ? "⌘+Enter" : "Ctrl+Enter";
function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.isComposing || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    send();
}

const MAX = 4000;
const draft = ref("");
watch(() => props.resetKey, () => {
    draft.value = "";
});
/** `hint` 是不接管时的说明（经接口发，要确认的键先给屏幕再确认）；`controlHint` 是接管中的说明（经终端连接，单击即发、不限速）。 */
/** `confirm`：不接管时要先给开发者看屏幕再发的键（与 host/session-console.ts 的 KEY_CONFIRM 一致）。 */
const KEYS: Array<{key: string; label: string; hint: string; controlHint: string; confirm: boolean}> = [
    {key: "up", label: "↑", hint: "上（翻历史、选上一项）", controlHint: "上（接管中，单击即发）", confirm: false},
    {key: "down", label: "↓", hint: "下（选下一项）", controlHint: "下（接管中，单击即发）", confirm: false},
    {key: "shift+tab", label: "Shift+Tab", hint: "切换权限模式（要确认）", controlHint: "切换权限模式（接管中，单击即发）", confirm: true},
    {key: "enter", label: "Enter", hint: "回车：会确认确认界面上的缺省项（要确认）", controlHint: "回车（接管中，单击即发）", confirm: true},
    {key: "esc", label: "Esc", hint: "打断这一轮（要确认）", controlHint: "打断这一轮（接管中，单击即发）", confirm: true},
    {key: "ctrl+c", label: "Ctrl+C", hint: "打断；连按两次 Claude 会退出，3 秒内只能按一次（要确认）", controlHint: "打断；连按两次 Claude 会退出（接管中，单击即发）", confirm: true},
    {key: "y", label: "y", hint: "回答确认界面（未核实是否有效，要确认）", controlHint: "y（接管中，单击即发）", confirm: true},
    {key: "n", label: "n", hint: "回答确认界面（未核实是否有效，要确认）", controlHint: "n（接管中，单击即发）", confirm: true},
];
const idle = computed(() => props.session.status === "idle" || props.session.status === "done");
const promptBlocked = computed(() => {
    if (props.disabledReason) return props.disabledReason;
    if (props.session.status === "working") return "会话在工作中：空闲之后才能发文字（不排队）";
    if (props.session.status === "blocked") return "会话在等确认：用下面的按键回应";
    if (!idle.value) return `会话状态是${HERDR_STATUS_LABEL[props.session.status] ?? props.session.status}：空闲之后才能发文字`;
    return null;
});
const canSend = computed(() => promptBlocked.value === null && !props.pending && draft.value.trim() !== "" && draft.value.length <= MAX);
function send(): void {
    if (canSend.value) emit("prompt", draft.value);
}
</script>

<template>
    <section class="flex min-h-0 flex-1 flex-col" :aria-label="`会话 ${shortSession(session.sessionKey)} 的屏幕与输入`">
        <div v-if="!live" class="nbdev-term-snapshot-bar nbdev-small flex items-center gap-2 px-3 py-2">
            <span class="nbdev-secondary">屏幕快照<template v-if="screenAt"> · 读于 {{ relativeTime(screenAt) }}</template></span>
            <Button class="ml-auto" size="sm" variant="ghost" icon-class="i-lucide-rotate-cw" :disabled="pending || disabledReason !== null" @click="emit('refresh')">重读屏幕</Button>
        </div>
        <slot name="screen">
            <pre class="nbdev-pre min-h-0 flex-1 overflow-auto p-3" aria-label="屏幕末尾">{{ screen ?? "还没读到屏幕" }}</pre>
        </slot>
        <!-- 输入区贴在终端下面：结果、能不能发、输入框、按键一屏内都看得到（ux-b F3）。 -->
        <div class="nbdev-dock nbdev-divider flex shrink-0 flex-col gap-2 border-t px-3 py-2.5">
            <slot name="result" />
            <p v-if="sessionChange && !controlling" class="nbdev-warn nbdev-small" role="status">{{ sessionChange }}</p>
            <p v-if="controlling" class="nbdev-note">接管中输入框收起：直接在上面的终端里打字。15 分钟没有输入自动释放。</p>
            <p v-else-if="promptBlocked" class="nbdev-note flex flex-wrap items-center gap-2">
                <Badge tone="neutral" variant="soft" size="sm">{{ HERDR_STATUS_LABEL[session.status] ?? session.status }}</Badge>{{ promptBlocked }}
            </p>
            <form v-if="!controlling" class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2" @submit.prevent="send">
                <FormTextarea v-model="draft" :rows="2" :maxlength="MAX" :disabled="promptBlocked !== null" :placeholder="`发给这个会话的文字：替你在它的输入框里打字并回车（${sendShortcut} 发送）`" aria-label="发给会话的文字" @keydown="onKeydown" />
                <div class="flex flex-col items-end gap-1">
                    <span class="nbdev-caption nbdev-num">{{ draft.length }} / {{ MAX }}</span>
                    <Button type="submit" size="sm" variant="primary" :disabled="!canSend" :loading="pending" :aria-keyshortcuts="isMac ? 'Meta+Enter' : 'Control+Enter'">发送 <kbd class="nbdev-send-kbd">{{ sendShortcut }}</kbd></Button>
                </div>
            </form>
            <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="按键">
                <span class="nbdev-note">按键{{ controlling ? "（接管中单击即发）" : "" }}：</span>
                <Button v-for="entry in KEYS" :key="entry.key" size="sm" variant="secondary" :title="controlling ? entry.controlHint : entry.hint" :aria-label="controlling ? entry.controlHint : entry.hint" :disabled="pending || (disabledReason !== null && !controlling)" @click="emit('key', entry.key)">{{ entry.label }}<span v-if="!controlling && entry.confirm" class="nbdev-confirm-mark" aria-hidden="true">确认</span></Button>
                <span v-if="!controlling" class="nbdev-caption">带“确认”的键先给你看屏幕再发</span>
            </div>
        </div>
    </section>
</template>

<style scoped>
.nbdev-dock, .nbdev-term-snapshot-bar {
    background: var(--panel-surface);
}
.nbdev-send-kbd {
    margin-left: 0.25em;
    font-family: var(--font-mono);
    font-size: 0.85em;
    opacity: 0.85;
}
.nbdev-confirm-mark {
    margin-left: 0.25em;
    font-size: 0.75em;
    color: var(--status-warning);
}
</style>
