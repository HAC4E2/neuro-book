<script setup lang="ts">
withDefaults(defineProps<{branch: string | null; checkoutKey?: string | null}>(), {checkoutKey: null});
</script>

<template>
    <p class="flex items-start gap-1.5 rounded-[var(--radius-control)] px-2 py-1" style="background: var(--status-warning-bg, var(--bg-subtle)); color: var(--text-secondary); font-size: var(--text-xs)">
        <span class="i-lucide-git-branch mt-0.5 size-3.5 shrink-0" style="color: var(--status-warning)" aria-hidden="true" />
        <span>来自分支：记录在 <code>{{ branch ?? "未知分支" }}</code><template v-if="checkoutKey">（{{ checkoutKey }}）</template>上维护，这里读的是那份 worktree，nbdev 不写它</span>
    </p>
</template>
