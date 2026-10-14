<script setup lang="ts">
import {Button, Spinner} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {relativeTime} from "../host/format.js";
import ActionLink from "./ActionLink.vue";

/**
 * 一份资源的加载、找不到、失败与旧数据（t15 阶段 3d，收进了阶段 1 的 StaleNotice）。不做骨架屏（nb-ui 界面开发规范第 4.3 节第 8 条）。
 * 契约见同名 .md。
 */
const props = withDefaults(defineProps<{
    loading: boolean;
    error?: {message: string; status?: number} | null;
    hasData?: boolean;
    receivedAt?: string | null;
    label?: string;
    retryable?: boolean;
    upHref?: string | null;
    upLabel?: string;
    subject?: string | null;
}>(), {
    error: null,
    hasData: false,
    receivedAt: null,
    label: "正在读取",
    retryable: true,
    upHref: null,
    upLabel: "回到上一级",
    subject: null,
});
const emit = defineEmits<{retry: []; navigate: [href: string]}>();
const missing = computed(() => props.error?.status === 404);
const when = computed(() => (props.receivedAt ? relativeTime(props.receivedAt) : "之前"));
// 服务端的 404 只说“找不到”，说不出是什么；是什么由宿主给（subject），这里不再拼服务端的文案。
const what = computed(() => (props.subject ? ` ${props.subject} ` : ""));
</script>

<template>
    <!-- 已有数据：页面照常显示上次读到的内容，这里只写一行“旧数据”。 -->
    <p v-if="hasData && error" role="status" class="nbdev-hint flex flex-wrap items-center gap-2">
        <span class="i-lucide-history nbdev-warn size-3.5" aria-hidden="true" />
        <span v-if="missing" class="min-w-0 break-words">已经找不到{{ what }}了（可能被删或改了名）；下面是{{ when }}读到的内容</span>
        <span v-else class="min-w-0 break-words">显示的是{{ when }}读到的内容；这次重取失败：{{ error.message }}</span>
        <ActionLink v-if="missing && upHref" :href="upHref" icon="i-lucide-arrow-left" @navigate="(href) => emit('navigate', href)">{{ upLabel }}</ActionLink>
        <Button v-else-if="!missing && retryable" size="sm" variant="ghost" icon-class="i-lucide-rotate-cw" @click="emit('retry')">重试</Button>
    </p>
    <div v-else-if="!hasData && error && missing" role="alert" class="flex min-h-40 w-full flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
        <span class="i-lucide-map-pin-off nbdev-secondary size-6" aria-hidden="true" />
        <p class="max-w-md font-semibold [overflow-wrap:anywhere]">{{ subject ? `找不到 ${subject}` : "找不到了" }}</p>
        <p class="nbdev-secondary max-w-md">可能被删或改了名</p>
        <ActionLink v-if="upHref" :href="upHref" icon="i-lucide-arrow-left" @navigate="(href) => emit('navigate', href)">{{ upLabel }}</ActionLink>
    </div>
    <div v-else-if="!hasData && error" role="alert" class="flex min-h-40 w-full flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
        <span class="i-lucide-circle-alert nbdev-danger size-6" aria-hidden="true" />
        <p class="nbdev-secondary max-w-md">{{ error.message }}</p>
        <Button v-if="retryable" variant="secondary" size="sm" icon-class="i-lucide-rotate-cw" @click="emit('retry')">重试</Button>
    </div>
    <div v-else-if="!hasData && loading" role="status" aria-busy="true" aria-live="polite" class="flex min-h-40 w-full flex-1 flex-col items-center justify-center gap-3 px-4 py-8">
        <Spinner :label="label" />
        <p class="nbdev-secondary">{{ label }}</p>
    </div>
    <!-- 还没到显示加载的时候（快的请求不闪）：先占住同样的高度，数据到了再换，页面不跳。 -->
    <div v-else-if="!hasData" class="min-h-40 w-full" aria-hidden="true" />
</template>
