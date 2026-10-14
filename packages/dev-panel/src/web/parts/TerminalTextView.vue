<script setup lang="ts">
import {Terminal} from "@xterm/xterm";
import {onBeforeUnmount, onMounted, ref} from "vue";
import type {TerminalFrame, TerminalSource} from "../host/terminal-socket.js";

/** 终端当前屏幕的纯文字视图（手机用）；契约见同名 .md。 */
const props = defineProps<{source: TerminalSource}>();
const text = ref("");
/** 文字最多每 200 毫秒更新一次：会话刷屏时帧很密，逐帧重排文字在手机上费电。 */
const THROTTLE_MS = 200;
let term: Terminal | null = null;
let unsubscribe: (() => void) | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

function refresh(): void {
    pending = null;
    if (!term) return;
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    text.value = lines.join("\n").replace(/\s+$/u, "");
}

function onFrame(frame: TerminalFrame): void {
    if (!term) return;
    if (term.cols !== frame.w || term.rows !== frame.h) term.resize(frame.w, frame.h);
    term.write(frame.bytes, () => {
        if (pending === null) pending = setTimeout(refresh, THROTTLE_MS);
    });
}

onMounted(() => {
    // 不 open：只用它解析帧（光标定位、宽字符），不画到页面上。
    term = new Terminal({scrollback: 0, allowProposedApi: false});
    unsubscribe = props.source.subscribe(onFrame);
});
onBeforeUnmount(() => {
    if (pending !== null) clearTimeout(pending);
    unsubscribe?.();
    term?.dispose();
    term = null;
});
</script>

<template>
    <pre class="max-h-[60vh] min-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] p-2 nbdev-pre nbdev-small" aria-label="终端的当前屏幕（文字）">{{ text || "还没有画面" }}</pre>
</template>
