<script setup lang="ts">
import {computed} from "vue";

/** 显示一段统一差异（`git diff` 的输出，或前端算出的行级差异）：增删着色，等宽字体，过长时在框内滚动；`fill` 时不限高、按行折行。契约见同名 .md。 */
const props = withDefaults(defineProps<{text: string; fill?: boolean}>(), {fill: false});
const lines = computed(() => props.text.split("\n").map((line) => ({
    line,
    kind: line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") ? "meta"
        : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "same",
})));
</script>

<template>
    <pre class="diff-view rounded-[var(--radius-control)] p-2" :class="fill ? '' : 'max-h-80 overflow-auto'"><code><span v-for="(entry, index) in lines" :key="index" class="block" :class="[`diff-${entry.kind}`, fill ? 'whitespace-pre-wrap break-words' : 'whitespace-pre']">{{ entry.line || " " }}</span></code></pre>
</template>

<style scoped>
.diff-view { background: var(--bg-subtle); font-size: var(--text-xs); line-height: 1.5; }
.diff-add { background: var(--status-success-bg, color-mix(in srgb, var(--status-success) 14%, transparent)); }
.diff-del { background: var(--status-danger-bg, color-mix(in srgb, var(--status-danger) 14%, transparent)); }
.diff-hunk, .diff-meta { color: var(--text-muted); }
</style>
