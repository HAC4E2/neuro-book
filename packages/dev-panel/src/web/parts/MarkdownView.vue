<script setup lang="ts">
const emit = defineEmits<{navigate: [href: string]}>();
defineProps<{html: string}>();

function onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest("a[data-internal]");
    if (!anchor) return;
    event.preventDefault();
    emit("navigate", anchor.getAttribute("href") ?? "/");
}
</script>

<template>
    <!-- 只接 host/markdown.ts 清洗过的 HTML。 -->
    <div class="nbdev-markdown" @click="onClick" v-html="html" />
</template>
