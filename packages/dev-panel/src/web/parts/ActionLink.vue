<script setup lang="ts">
import {isPlainClick} from "../host/routes.js";

/** 去别的页的次要操作：一个看起来像 ghost 按钮的真实链接（图标加文字）。契约见同名 .md。 */
const props = withDefaults(defineProps<{href: string; icon?: string; external?: boolean}>(), {icon: "", external: false});
const emit = defineEmits<{navigate: [href: string]}>();
function follow(event: MouseEvent): void {
    if (props.external || !isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", props.href);
}
</script>

<template>
    <a :href="href" class="nbdev-action-link" :target="external ? '_blank' : undefined" :rel="external ? 'noopener noreferrer' : undefined" @click="follow">
        <span v-if="icon" :class="icon" class="size-3.5 shrink-0" aria-hidden="true" />
        <slot />
    </a>
</template>

<style scoped>
.nbdev-action-link {
    display: inline-flex;
    min-height: 1.75rem;
    align-items: center;
    gap: 0.375rem;
    border-radius: var(--radius-control);
    padding: 0.125rem 0.5rem;
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: 500;
    white-space: nowrap;
}
.nbdev-action-link:hover {
    background: var(--bg-hover);
}
</style>
