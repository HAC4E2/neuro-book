<script setup lang="ts">
defineProps<{title: string}>();
</script>

<template>
    <section class="ephemeral-frame relative rounded-[var(--radius-control)] border border-dashed px-3 pb-2 pt-3" :aria-label="`${title}（临时）`">
        <span class="ephemeral-label absolute -top-2 left-2 px-1">{{ title }} · 临时</span>
        <slot />
    </section>
</template>

<style scoped>
.ephemeral-frame {
    border-color: var(--status-info, var(--accent-main));
}
/* 标签压在虚线框的上边线上：底色与页面相同，把那一段线盖住。 */
.ephemeral-label {
    background: var(--bg-main);
    font-size: var(--text-2xs);
    color: var(--status-info, var(--accent-main));
}
</style>
