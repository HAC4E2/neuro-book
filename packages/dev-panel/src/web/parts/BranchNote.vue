<script setup lang="ts">
withDefaults(defineProps<{branch: string | null; checkoutKey?: string | null}>(), {checkoutKey: null});
</script>

<template>
    <p class="nbdev-hint nbdev-hint-warn flex items-start gap-1.5">
        <span class="i-lucide-git-branch mt-0.5 size-3.5 shrink-0 nbdev-warn" aria-hidden="true" />
        <span>来自分支：记录在 <code>{{ branch ?? "未知分支" }}</code><template v-if="checkoutKey">（{{ checkoutKey }}）</template>上维护，这里读的是那份 worktree，nbdev 不写它</span>
    </p>
</template>
