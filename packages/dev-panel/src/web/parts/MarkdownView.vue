<script setup lang="ts">
import {isPlainClick} from "../host/routes.js";

const emit = defineEmits<{navigate: [href: string]}>();
withDefaults(defineProps<{html: string; inline?: boolean}>(), {inline: false});

function onClick(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const anchor = (event.target as Element | null)?.closest("a[data-internal]");
    if (!anchor) return;
    event.preventDefault();
    emit("navigate", anchor.getAttribute("href") ?? "/");
}
</script>

<template>
    <!-- 只接 host/markdown.ts 清洗过的 HTML。行内的（renderInlineMarkdown 的结果）放进 span，不带正文排版。 -->
    <span v-if="inline" class="nbdev-markdown-inline" @click="onClick" v-html="html" />
    <div v-else class="nbdev-markdown" @click="onClick" v-html="html" />
</template>
