<script setup lang="ts">
import {computed} from "vue";

/** 显示一段统一差异（`git diff` 的输出，或前端算出的行级差异）：增删着色，等宽字体，过长时在框内滚动。 */
const props = defineProps<{text: string}>();
const lines = computed(() => props.text.split("\n").map((line) => ({
    line,
    kind: line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") ? "meta"
        : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "same",
})));
</script>

<template>
    <pre class="max-h-80 overflow-auto rounded-[var(--radius-control)] p-2" style="background: var(--bg-subtle); font-size: var(--text-xs); line-height: 1.5"><code><span v-for="(entry, index) in lines" :key="index" class="block whitespace-pre" :class="`diff-${entry.kind}`">{{ entry.line || " " }}</span></code></pre>
</template>

<style scoped>
.diff-add { background: var(--status-success-bg, color-mix(in srgb, var(--status-success) 14%, transparent)); }
.diff-del { background: var(--status-danger-bg, color-mix(in srgb, var(--status-danger) 14%, transparent)); }
.diff-hunk, .diff-meta { color: var(--text-muted); }
</style>
