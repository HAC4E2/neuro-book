<script setup lang="ts">
import {Badge, Button, FormTextarea} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {HERDR_STATUS_LABEL, relativeTime, shortSession} from "../host/format.js";

/** 一个会话的屏幕末尾、输入框与按键；契约见同名 .md。 */
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
}>(), {live: false, controlling: false});
const emit = defineEmits<{refresh: []; prompt: [text: string]; key: [key: string]}>();

const MAX = 4000;
const draft = ref("");
watch(() => props.resetKey, () => {
    draft.value = "";
});
const KEYS: Array<{key: string; label: string; hint: string}> = [
    {key: "up", label: "↑", hint: "上（翻历史、选上一项）"},
    {key: "down", label: "↓", hint: "下（选下一项）"},
    {key: "shift+tab", label: "Shift+Tab", hint: "切换权限模式（要确认）"},
    {key: "enter", label: "Enter", hint: "回车：会确认确认界面上的缺省项（要确认）"},
    {key: "esc", label: "Esc", hint: "打断这一轮（要确认）"},
    {key: "ctrl+c", label: "Ctrl+C", hint: "打断；连按两次 Claude 会退出，3 秒内只能按一次（要确认）"},
    {key: "y", label: "y", hint: "回答确认界面（未核实是否有效，要确认）"},
    {key: "n", label: "n", hint: "回答确认界面（未核实是否有效，要确认）"},
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
    <section class="flex flex-col gap-3" :aria-label="`会话 ${shortSession(session.sessionKey)} 的屏幕与输入`">
        <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ shortSession(session.sessionKey) }}</span>
            <Badge tone="neutral" variant="soft" size="sm">{{ HERDR_STATUS_LABEL[session.status] ?? session.status }}</Badge>
            <span style="color: var(--text-muted); font-size: var(--text-xs)">{{ session.agent ?? "Agent" }} · pane {{ session.paneId }}<template v-if="screenAt && !live"> · 屏幕读于 {{ relativeTime(screenAt) }}</template></span>
            <Button v-if="!live" class="ml-auto" size="sm" variant="ghost" icon-class="i-lucide-rotate-cw" :disabled="pending || disabledReason !== null" @click="emit('refresh')">重读屏幕</Button>
        </div>
        <slot name="screen">
            <pre class="max-h-96 min-h-24 overflow-auto rounded-[var(--radius-control)] p-2" style="background: var(--bg-hover); font-size: var(--text-2xs)" aria-label="屏幕末尾">{{ screen ?? "还没读到屏幕" }}</pre>
        </slot>
        <p v-if="promptBlocked && !controlling" style="color: var(--text-secondary); font-size: var(--text-xs)">{{ promptBlocked }}</p>
        <form v-if="!controlling" class="flex flex-col gap-2" @submit.prevent="send">
            <FormTextarea v-model="draft" :rows="4" :maxlength="MAX" :disabled="promptBlocked !== null" placeholder="发给这个会话的文字（替你在它的输入框里打字并回车）" aria-label="发给会话的文字" />
            <div class="flex items-center gap-2">
                <span style="color: var(--text-muted); font-size: var(--text-2xs)">{{ draft.length }} / {{ MAX }}</span>
                <Button class="ml-auto" type="submit" size="sm" variant="primary" :disabled="!canSend" :loading="pending">发送</Button>
            </div>
        </form>
        <div class="flex flex-wrap gap-1.5" role="group" aria-label="按键">
            <Button v-for="entry in KEYS" :key="entry.key" size="sm" variant="secondary" :title="controlling ? `${entry.label}（接管中，单击即发）` : entry.hint" :aria-label="entry.hint" :disabled="pending || (disabledReason !== null && !controlling)" @click="emit('key', entry.key)">{{ entry.label }}</Button>
        </div>
    </section>
</template>
