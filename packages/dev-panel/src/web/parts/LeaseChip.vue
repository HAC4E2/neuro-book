<script setup lang="ts">
withDefaults(defineProps<{session: string; task?: string | null; stale?: boolean; ended?: boolean; hint?: string}>(), {task: null, stale: false, ended: false, hint: ""});
</script>

<template>
    <span
        class="inline-flex max-w-full items-center gap-1 rounded-full border border-dashed px-2 py-0.5"
        :class="{'opacity-55': stale && !ended, 'line-through': ended}"
        :style="{borderColor: 'var(--status-info, var(--accent-main))', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)'}"
        :title="hint || undefined"
    >
        <span class="i-lucide-user-round size-3 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ session }}</span>
        <span v-if="task" class="shrink-0" style="color: var(--text-secondary)">· {{ task }}</span>
        <span v-if="ended" class="sr-only">（已失效）</span>
    </span>
</template>
