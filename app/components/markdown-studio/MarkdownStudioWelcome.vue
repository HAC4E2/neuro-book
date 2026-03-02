<script setup lang="ts">
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";

const props = defineProps<{
    node: WorkspaceFileNode | null;
}>();
</script>

<template>
    <!-- Studio 欢迎页 -->
    <section class="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
        <div class="flex w-full max-w-[620px] flex-col items-center rounded-[18px] border border-[var(--border-color)] bg-[var(--bg-panel)] px-8 py-12 text-center shadow-[0_24px_80px_rgba(0,0,0,0.10)]">
            <div class="flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--accent-text)]">
                <span :class="props.node && !props.node.editable ? 'i-lucide-lock-keyhole' : 'i-lucide-files'" class="h-7 w-7"></span>
            </div>
            <div class="mt-5 text-xl font-semibold text-[var(--text-main)]">
                {{ props.node && !props.node.editable ? "当前文件不可编辑" : "未选择文件" }}
            </div>
            <p class="mt-3 max-w-[440px] text-sm leading-7 text-[var(--text-secondary)]">
                {{ props.node && !props.node.editable ? "请在左侧详情查看元信息，或选择 Markdown、txt、无扩展文本文件进行编辑。" : "从左侧 Files 文件树选择一个文件开始编辑。" }}
            </p>
            <div v-if="props.node" class="mt-7 w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3 text-left text-xs text-[var(--text-secondary)]">
                <div class="truncate font-mono text-[var(--text-main)]" :title="props.node.path">{{ props.node.path }}</div>
                <div class="mt-2 flex flex-wrap gap-2">
                    <span class="rounded border border-[var(--border-color)] px-2 py-1">editable: {{ props.node.editable ? "true" : "false" }}</span>
                    <span class="rounded border border-[var(--border-color)] px-2 py-1">type: {{ props.node.entryType || "-" }}</span>
                </div>
            </div>
        </div>
    </section>
</template>
