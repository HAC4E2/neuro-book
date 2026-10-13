<script setup lang="ts">
import {Terminal} from "@xterm/xterm";
import {onBeforeUnmount, onMounted, ref} from "vue";
import type {TerminalFrame, TerminalSource} from "../host/terminal-socket.js";

/** 终端当前屏幕的纯文字视图（手机用）；契约见同名 .md。 */
const props = defineProps<{source: TerminalSource}>();
const text = ref("");
let term: Terminal | null = null;
let unsubscribe: (() => void) | null = null;

function onFrame(frame: TerminalFrame): void {
    if (!term) return;
    if (term.cols !== frame.w || term.rows !== frame.h) term.resize(frame.w, frame.h);
    term.write(frame.bytes, () => {
        if (!term) return;
        const buffer = term.buffer.active;
        const lines: string[] = [];
        for (let index = 0; index < buffer.length; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
        text.value = lines.join("\n").replace(/\s+$/u, "");
    });
}

onMounted(() => {
    // 不 open：只用它解析帧（光标定位、宽字符），不画到页面上。
    term = new Terminal({scrollback: 0, allowProposedApi: false});
    unsubscribe = props.source.subscribe(onFrame);
});
onBeforeUnmount(() => {
    unsubscribe?.();
    term?.dispose();
    term = null;
});
</script>

<template>
    <pre class="max-h-[60vh] min-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] p-2" style="background: var(--bg-hover); font-size: var(--text-xs)" aria-label="终端的当前屏幕（文字）">{{ text || "还没有画面" }}</pre>
</template>
