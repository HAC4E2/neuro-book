<script setup lang="ts">
defineProps<{title: string}>();
</script>

<template>
    <section class="relative rounded-[var(--radius-control)] border border-dashed px-3 pb-2 pt-3" style="border-color: var(--status-info, var(--accent-main))" :aria-label="`${title}（临时）`">
        <span class="absolute -top-2 left-2 px-1" style="background: var(--bg-main); font-size: var(--text-2xs); color: var(--status-info, var(--accent-main))">{{ title }} · 临时</span>
        <slot />
    </section>
</template>
