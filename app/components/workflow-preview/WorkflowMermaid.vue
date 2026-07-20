<script setup lang="ts">
import {ref, watch} from "vue";
import {renderMermaidSvg} from "nbook/app/utils/workflow-preview/render-mermaid";

const props = defineProps<{code: string}>();

const svg = ref("");

watch(() => props.code, async (code) => {
    svg.value = code ? await renderMermaidSvg(code) : "";
}, {immediate: true});
</script>

<template>
    <!-- mermaid 图容器：图形内容固定浅色底（mermaid neutral 主题），外框走主题变量 -->
    <div class="workflow-mermaid overflow-x-auto rounded-lg border border-[var(--border-color)] p-3" v-html="svg"></div>
</template>

<style scoped>
.workflow-mermaid { background: #f7f8fa; min-height: 48px; }
</style>
