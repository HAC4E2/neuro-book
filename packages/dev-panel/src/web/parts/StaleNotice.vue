<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {relativeTime} from "../host/format.js";
import {isPlainClick} from "../host/routes.js";

/** 已有数据时这次重取失败：写明显示的是上次读到的内容，给重试或回上一级；契约见同名 .md。 */
const props = withDefaults(defineProps<{
    error: {message: string; status: number};
    receivedAt: string | null;
    upHref?: string | null;
    upLabel?: string;
}>(), {upHref: null, upLabel: "回到上一级"});
const emit = defineEmits<{retry: []; navigate: [href: string]}>();
const missing = computed(() => props.error.status === 404);
const when = computed(() => (props.receivedAt ? relativeTime(props.receivedAt) : "之前"));
function follow(event: MouseEvent): void {
    if (!props.upHref || !isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", props.upHref);
}
</script>

<template>
    <p role="status" class="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 nbdev-hint">
        <span class="i-lucide-history size-3.5 nbdev-warn" aria-hidden="true" />
        <span v-if="missing">已经找不到了（可能被删或改了名）；下面是{{ when }}读到的内容</span>
        <span v-else>显示的是{{ when }}读到的内容；这次重取失败：{{ error.message }}</span>
        <a v-if="missing && upHref" :href="upHref" @click="follow">{{ upLabel }}</a>
        <Button v-else-if="!missing" size="sm" variant="ghost" icon-class="i-lucide-rotate-cw" @click="emit('retry')">重试</Button>
    </p>
</template>
