<script setup lang="ts">
import {Badge, Breadcrumb, FormSelect} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {useRouter} from "vue-router";
import {relativeTime, taskLabel, workLabel} from "../host/format.js";
import {sendJson} from "../host/api.js";
import {useResource} from "../host/panel-data.js";
import {isPlainClick} from "../host/routes.js";
import type {ArtifactPageData, Meta, WriteData} from "../host/types.js";
import {failureNotice, successNotice, useWrite, type Notice} from "../host/writes.js";
import AnswerForm from "../parts/AnswerForm.vue";
import LoadState from "../parts/LoadState.vue";
import QuestionPanel from "../parts/QuestionPanel.vue";
import WriteNotice from "../parts/WriteNotice.vue";

/**
 * 产物页（t03 第二轮产物页）：左边是产物来源上的原页（沙箱 iframe，不给同源），右边是问题侧栏与答复表单（t10）。
 * 页面文件不按版本保存，所以切版本只切换题表，iframe 上标“页面是当前版本”；磁盘内容与最新一版不同时标“有未发布的改动”。
 * 答复只经侧栏表单提交：外壳不监听 iframe 发来的消息（页面自己的脚本能伪造任何取值）。390 宽时侧栏移到 iframe 下面。
 */
const props = defineProps<{workId: string; taskId: string; artifactId: string}>();
const router = useRouter();
const version = ref<number | null>(null);
watch(() => [props.workId, props.taskId, props.artifactId], () => {
    version.value = null;
});
const artifact = useResource<ArtifactPageData>(() => `/api/artifact/${encodeURIComponent(props.workId)}/${encodeURIComponent(props.taskId)}/${encodeURIComponent(props.artifactId)}${version.value === null ? "" : `?version=${version.value}`}`, ["records"]);
const data = computed(() => artifact.data.value);
const versionOptions = computed(() => [...(data.value?.versions ?? [])].reverse().map((entry) => ({value: String(entry), label: entry === data.value?.latestVersion ? `v${entry}（最新）` : `v${entry}`})));
const crumbs = computed(() => [
    {label: "产物", href: "/artifacts"},
    {label: workLabel(props.workId), href: `/work/${props.workId}`},
    ...(props.taskId === "-" ? [] : [{label: taskLabel(props.taskId), href: `/work/${props.workId}/task/${props.taskId}`}]),
    {label: props.artifactId, current: true},
]);
const meta = useResource<Meta>(() => "/api/meta", ["records"]);
const write = useWrite();
const notice = ref<Notice | null>(null);
const formErrors = ref<Record<string, string>>({});
const resetKey = ref(0);
/** 表单只给有发布记录的 Task 产物；能不能答写成原因，零件据此置只读。 */
const showForm = computed(() => data.value !== undefined && data.value !== null && data.value.ref.taskId !== null && data.value.state !== "unpublished");
const answerDisabled = computed(() => {
    const current = data.value;
    if (!current) return null;
    const writable = meta.data.value?.mainWritable;
    if (writable && !writable.ok) return `主工作区现在不能写（${writable.message ?? writable.code}）`;
    if (current.source === "branch") return `记录在分支 ${current.branch ?? ""} 上维护，在那里答或先迁移`;
    if (current.state === "closed") return "产物已关闭，不能再答";
    if (current.version !== current.latestVersion) return `只能对最新一版（v${current.latestVersion}）答复；切回最新一版再答`;
    return null;
});
type AnswerInput = {values: Record<string, unknown>; comments: Record<string, string>; note: string | null};
let lastAnswer: AnswerInput | null = null;
async function submitAnswer(answer: AnswerInput): Promise<void> {
    lastAnswer = answer;
    const current = data.value;
    if (!current?.ref.taskId || current.latestVersion === null) return;
    notice.value = null;
    formErrors.value = {};
    const body = {workId: current.ref.workId, taskId: current.ref.taskId, artifactId: current.ref.artifactId, version: current.latestVersion, ...answer};
    const outcome = await write.run(() => sendJson<WriteData>("POST", "/api/answers", body));
    if (outcome.ok) {
        notice.value = successNotice("答复已提交", outcome.body);
        resetKey.value += 1;
        artifact.reload();
        return;
    }
    const {failure} = outcome;
    const problems = Array.isArray(failure.details.problems) ? failure.details.problems as Array<{questionId: string; reason: string}> : [];
    formErrors.value = Object.fromEntries([...problems.map((problem) => [problem.questionId, problem.reason]), ...(typeof failure.details.questionId === "string" ? [[failure.details.questionId, failure.message]] : [])]);
    notice.value = failure.action === "unknown"
        ? {...failureNotice("结果未知", failure), message: `${failure.message}。已重新载入，看下面“已答”里有没有这次的答复`}
        : failureNotice("答复没有提交", failure);
    if (failure.action === "reload" || failure.action === "unknown") artifact.reload();
}

function followCrumb(item: {href?: string}, event: MouseEvent): void {
    if (!item.href || !isPlainClick(event)) return;
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
                <div v-if="versionOptions.length > 1" class="ml-auto w-40">
                    <FormSelect :model-value="String(data.version)" :options="versionOptions" aria-label="看哪一版的题表" @update:model-value="(value: string) => (version = Number(value) === data!.latestVersion ? null : Number(value))" />
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
                    <div class="flex flex-col gap-4">
                        <WriteNotice v-if="notice" :notice="notice" @dismiss="notice = null" @retry="lastAnswer && submitAnswer(lastAnswer)" />
                        <AnswerForm v-if="showForm" :questions="data.questions" :pending="write.pending.value" :slow="write.slow.value" :disabled-reason="answerDisabled" :errors="formErrors" :reset-key="resetKey" @submit="submitAnswer" />
                        <QuestionPanel :questions="data.questions" :version="data.version ?? 0" :latest-version="data.latestVersion ?? 0" :answering="showForm" />
                    </div>
                </aside>
            </div>
        </template>
    </div>
</template>
