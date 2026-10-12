<script setup lang="ts">
import {Badge, Breadcrumb, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {useRouter} from "vue-router";
import {relativeTime, taskLabel, workLabel} from "../host/format.js";
import {useResource} from "../host/panel-data.js";
import type {ArtifactPageData} from "../host/types.js";
import LoadState from "../parts/LoadState.vue";
import QuestionPanel from "../parts/QuestionPanel.vue";

/**
 * 产物页（t03 第二轮产物页）：左边是产物来源上的原页（沙箱 iframe，不给同源），右边是问题侧栏。
 * 页面文件不按版本保存，所以切版本只切换题表，iframe 上标“页面是当前版本”；磁盘内容与最新一版不同时标“有未发布的改动”。
 * 390 宽时侧栏移到 iframe 下面。
 */
const props = defineProps<{workId: string; taskId: string; artifactId: string}>();
const router = useRouter();
const version = ref<number | null>(null);
watch(() => [props.workId, props.taskId, props.artifactId], () => {
    version.value = null;
});
const artifact = useResource<ArtifactPageData>(() => `/api/artifact/${encodeURIComponent(props.workId)}/${encodeURIComponent(props.taskId)}/${encodeURIComponent(props.artifactId)}${version.value === null ? "" : `?version=${version.value}`}`, ["records"]);
const data = computed(() => artifact.data.value);
const versionOptions = computed(() => (data.value?.versions ?? []).map((entry) => ({value: String(entry), label: `v${entry}`})));
const crumbs = computed(() => [
    {label: "产物", href: "/artifacts"},
    {label: workLabel(props.workId), href: `/work/${props.workId}`},
    ...(props.taskId === "-" ? [] : [{label: taskLabel(props.taskId), href: `/work/${props.workId}/task/${props.taskId}`}]),
    {label: props.artifactId, current: true},
]);
function followCrumb(item: {href?: string}, event: MouseEvent): void {
    if (!item.href) return;
    event.preventDefault();
    void router.push(item.href);
}
</script>

<template>
    <div class="flex min-h-full w-full flex-col gap-3 p-4 md:p-6">
        <Breadcrumb :items="crumbs" @click="followCrumb" />
        <LoadState v-if="!data" :loading="artifact.loading.value" :error="artifact.error.value" label="正在读取产物" @retry="artifact.reload()" />
        <template v-else>
            <header class="flex flex-wrap items-center gap-2">
                <h1 class="font-semibold" style="font-size: var(--text-xl)">{{ data.title ?? props.artifactId }}</h1>
                <Badge v-if="data.state === 'closed'" tone="neutral" variant="outline" size="sm">已关闭</Badge>
                <Badge v-if="data.state === 'unpublished'" tone="warning" variant="soft" size="sm">还没发布</Badge>
                <Badge v-if="data.unpublishedChanges" tone="warning" variant="soft" size="sm" icon-class="i-lucide-pencil">有未发布的改动</Badge>
                <span v-if="data.publishedAt" style="color: var(--text-muted); font-size: var(--text-xs)">v{{ data.latestVersion }} 发布于 {{ relativeTime(data.publishedAt) }}</span>
                <div v-if="versionOptions.length > 1" class="ml-auto">
                    <SegmentedControl :model-value="String(data.version)" :options="versionOptions" aria-label="看哪一版的题表" @update:model-value="(value) => (version = Number(value) === data!.latestVersion ? null : Number(value))" />
                </div>
            </header>
            <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
                <section v-if="data.pageUrl" class="flex min-h-[32rem] min-w-0 flex-col gap-1.5">
                    <div class="flex flex-wrap items-center gap-2" style="font-size: var(--text-xs); color: var(--text-secondary)">
                        <span class="i-lucide-info size-3.5" aria-hidden="true" />页面是当前版本（磁盘上的），切换版本只切换右边的题表
                        <a class="ml-auto" :href="data.pageUrl" target="_blank" rel="noopener noreferrer">单独打开</a>
                    </div>
                    <iframe :src="data.pageUrl" sandbox="allow-scripts allow-forms allow-popups" referrerpolicy="no-referrer" class="min-h-[32rem] w-full flex-1 rounded-[var(--radius-panel)]" style="border: var(--border-w, 1px) solid var(--divider); background: var(--page-surface, var(--bg-main))" :title="`${data.title ?? props.artifactId} 的页面`" />
                </section>
                <aside class="min-w-0 rounded-[var(--radius-panel)] p-4" :class="{'lg:col-span-2': !data.pageUrl}" style="background: var(--panel-surface); border: var(--border-w, 1px) solid var(--divider)" aria-label="问题">
                    <QuestionPanel :questions="data.questions" :version="data.version ?? 0" :latest-version="data.latestVersion ?? 0" />
                </aside>
            </div>
        </template>
    </div>
</template>
