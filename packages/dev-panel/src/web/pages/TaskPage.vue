<script setup lang="ts">
import {Badge, Breadcrumb} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {useRouter} from "vue-router";
import {relativeDay, shortSession, taskLabel, workLabel} from "../host/format.js";
import {renderMarkdown} from "../host/markdown.js";
import {useResource} from "../host/panel-data.js";
import {editHref, isPlainClick, workHref} from "../host/routes.js";
import {useStatusChange} from "../host/status-change.js";
import type {Meta, TaskPageData} from "../host/types.js";
import StatusSwitch from "../parts/StatusSwitch.vue";
import UncommittedDialog from "../parts/UncommittedDialog.vue";
import WriteResult from "../parts/WriteResult.vue";
import EphemeralFrame from "../parts/EphemeralFrame.vue";
import LeaseChip from "../parts/LeaseChip.vue";
import LoadState from "../parts/LoadState.vue";
import MarkdownView from "../parts/MarkdownView.vue";
import StaleNotice from "../parts/StaleNotice.vue";
import StatusChip from "../parts/StatusChip.vue";

/**
 * Task 页（Proposal 第九节；第三轮没有单独的稿，结构照 Work 页）：当前情况、执行 checkout 与它上面的提交、README、
 * 产物与文档类产物、证据、链到的 Spec、谁在动。从这里进文档页时带上执行 checkout。
 */
const props = defineProps<{workId: string; taskId: string}>();
const router = useRouter();
const page = useResource<TaskPageData>(() => `/api/task/${encodeURIComponent(props.workId)}/${encodeURIComponent(props.taskId)}`, ["records", "activity"]);
const meta = useResource<Meta>(() => "/api/meta", ["records"]);
const TASK_STATUSES = ["planned", "active", "done", "shelved"];
const writeBlocked = computed(() => {
    const writable = meta.data.value?.mainWritable;
    if (writable && !writable.ok) return `主工作区现在不能写（${writable.message ?? writable.code}）`;
    const task = page.data.value?.task;
    if (task?.source === "branch") return `记录在分支 ${task.branch ?? ""} 上维护，在那里改或先迁移`;
    return null;
});
// 改成完成或搁置时核心会释放这个 Task 的全部租约，并提醒还有没答的必答题（警告照列）。
const status = useStatusChange(() => `/api/works/${encodeURIComponent(props.workId)}/tasks/${encodeURIComponent(props.taskId)}/status`, () => page.data.value?.task.readmeHash ?? null, () => page.reload());

const RULE_LABEL: Record<string, string> = {readme: "README 的执行位置", name: "目录名", home: "登记表", work: "Work 的执行 worktree", master: "主工作区"};
const readmeHtml = computed(() => {
    const data = page.data.value;
    if (!data?.detail.readme.text) return "";
    // frontmatter 与第一个一级标题（页头已经写了标题）不重复显示。
    return renderMarkdown(data.detail.readme.text.replace(/^---\n[\s\S]*?\n---\n/u, "").replace(/^\s*# .*\n/u, ""), {checkoutKey: data.task.checkoutKey ?? "main", path: data.detail.readme.path, artifactBase: meta.data.value?.artifactBase ?? null});
});
const executionKey = computed(() => page.data.value?.detail.execution.chosen.key ?? "main");
const preferKeys = computed(() => (page.data.value?.detail.execution.candidates ?? []).map((candidate) => candidate.key).join(","));

function followCrumb(item: {href?: string}, event: MouseEvent): void {
    if (!item.href || !isPlainClick(event)) return;
    event.preventDefault();
    void router.push(item.href);
}
function navigate(href: string): void {
    void router.push(href);
}
function evidenceUrl(path: string): string | null {
    const base = meta.data.value?.artifactBase;
    const key = page.data.value?.task.checkoutKey;
    return base && key ? `${base}/${encodeURIComponent(key)}/${path.split("/").map(encodeURIComponent).join("/")}` : null;
}
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-5 p-4 md:p-6">
        <StaleNotice v-if="page.stale.value" :error="page.error.value!" :received-at="page.receivedAt.value" :up-href="workHref(workId)" up-label="回到 Work" @navigate="(href) => router.push(href)" @retry="page.reload()" />
        <LoadState v-if="!page.data.value" :loading="page.loading.value" :error="page.error.value" label="正在读取 Task" @retry="page.reload()" />
        <template v-else>
            <Breadcrumb :items="[{label: '首页', href: '/'}, {label: workLabel(props.workId), href: `/work/${props.workId}`}, {label: taskLabel(props.taskId), current: true}]" @click="followCrumb" />
            <header class="flex flex-col gap-2">
                <div class="flex flex-wrap items-center gap-2">
                    <StatusChip :status="page.data.value.task.status" size="md" />
                    <h1 class="font-semibold" style="font-size: var(--text-xl)">{{ page.data.value.task.title ?? page.data.value.task.taskId }}</h1>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <StatusSwitch :status="page.data.value.task.status.value" :options="TASK_STATUSES" :subject="taskLabel(props.taskId)" :disabled-reason="writeBlocked" :pending="status.write.pending.value" :slow="status.write.slow.value" @confirm="status.change" />
                    <RouterLink v-if="!writeBlocked" :to="editHref(page.data.value.task.readmePath)" style="font-size: var(--text-xs)">编辑 README</RouterLink>
                </div>
                <WriteResult v-if="status.notice.value" :notice="status.notice.value" @dismiss="status.notice.value = null" @retry="status.retry" />
                <UncommittedDialog :open="status.pending.value !== null" :path="status.pending.value?.path ?? ''" :changes="status.pending.value?.changes ?? null" :pending="status.write.pending.value" @confirm="status.confirmUncommitted" @cancel="status.pending.value = null" />
                <p :style="{color: page.data.value.task.currentState ? 'var(--text-secondary)' : 'var(--text-muted)'}">当前情况：{{ page.data.value.task.currentState ?? "未标" }}</p>
                <div class="flex flex-wrap gap-3" style="font-size: var(--text-xs); color: var(--text-secondary)">
                    <span>{{ page.data.value.task.workId }}/{{ page.data.value.task.taskId }}</span>
                    <span>{{ page.data.value.task.updated.value ? `最近更新 ${relativeDay(page.data.value.task.updated.value)}` : "最近更新：未标" }}</span>
                    <span>记录：{{ page.data.value.task.source === "branch" ? `分支 ${page.data.value.task.branch ?? ""}` : "master" }}{{ page.data.value.task.uncommitted ? "（有未提交的改动）" : "" }}</span>
                </div>
            </header>
            <div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <article class="min-w-0 rounded-[var(--radius-panel)] p-4 md:p-6" style="background: var(--panel-surface); border: var(--border-w, 1px) solid var(--divider)">
                    <MarkdownView v-if="readmeHtml" :html="readmeHtml" @navigate="navigate" />
                    <p v-else style="color: var(--text-muted)">没有 README</p>
                </article>
                <aside class="flex min-w-0 flex-col gap-5">
                    <section class="flex flex-col gap-2">
                        <h2 class="font-semibold">执行 checkout</h2>
                        <ul class="flex flex-col gap-1" style="font-size: var(--text-xs)">
                            <li v-for="candidate in page.data.value.detail.execution.candidates" :key="candidate.key" class="flex flex-wrap items-center gap-1.5">
                                <Badge v-if="candidate.key === executionKey" tone="accent" variant="soft" size="sm">选中</Badge>
                                <RouterLink :to="{name: 'docs', query: {checkout: candidate.key, prefer: preferKeys}}">{{ candidate.key }}</RouterLink>
                                <span style="color: var(--text-secondary)">{{ candidate.branch ?? "分离 HEAD" }} · 按{{ RULE_LABEL[candidate.rule] }}</span>
                            </li>
                        </ul>
                    </section>
                    <section class="flex flex-col gap-2">
                        <h2 class="font-semibold">{{ page.data.value.detail.commits.range === "branch" ? `${page.data.value.detail.commits.checkout} 分支上的提交` : "碰过这个 Task 的提交" }}</h2>
                        <p v-if="page.data.value.detail.commits.entries.length === 0" style="color: var(--text-muted)">没有</p>
                        <ol v-else class="flex flex-col gap-1" style="font-size: var(--text-xs)">
                            <li v-for="commit in page.data.value.detail.commits.entries" :key="commit.sha" class="flex min-w-0 gap-2">
                                <code style="color: var(--text-secondary)">{{ commit.sha.slice(0, 9) }}</code>
                                <span class="min-w-0 flex-1 truncate" :title="commit.subject">{{ commit.subject }}</span>
                                <span class="shrink-0" style="color: var(--text-secondary)">{{ relativeDay(commit.date) }}</span>
                            </li>
                        </ol>
                    </section>
                    <section class="flex flex-col gap-2">
                        <h2 class="font-semibold">产物与文档</h2>
                        <ul class="flex flex-col gap-1">
                            <li v-for="artifact in page.data.value.task.artifacts" :key="artifact.artifactId" class="flex flex-wrap items-center gap-1.5">
                                <RouterLink :to="`/artifact/${props.workId}/${props.taskId}/${artifact.artifactId}`">{{ artifact.title ?? artifact.artifactId }}</RouterLink>
                                <Badge v-if="artifact.openRequired > 0" tone="warning" variant="soft" size="sm">待答 {{ artifact.openRequired }}</Badge>
                                <span v-if="artifact.state === 'unpublished'" style="color: var(--text-muted); font-size: var(--text-xs)">没发布</span>
                            </li>
                            <li v-for="document in page.data.value.task.documents" :key="document.path">
                                <RouterLink :to="{name: 'docs', query: {checkout: page.data.value.task.checkoutKey ?? 'main', path: document.path}}">{{ document.title ?? document.path.slice(document.path.lastIndexOf("/") + 1) }}</RouterLink>
                            </li>
                            <li v-if="page.data.value.task.artifacts.length === 0 && page.data.value.task.documents.length === 0" style="color: var(--text-muted)">没有</li>
                        </ul>
                    </section>
                    <section v-if="page.data.value.detail.specs.length > 0" class="flex flex-col gap-2">
                        <h2 class="font-semibold">README 链到的 Spec</h2>
                        <ul class="flex flex-col gap-1">
                            <li v-for="spec in page.data.value.detail.specs" :key="spec"><RouterLink :to="{name: 'docs', query: {checkout: executionKey, path: spec, prefer: preferKeys}}">{{ spec }}</RouterLink></li>
                        </ul>
                    </section>
                    <section class="flex flex-col gap-2">
                        <h2 class="font-semibold">证据</h2>
                        <p v-if="page.data.value.detail.evidences.length === 0" style="color: var(--text-muted)">没有</p>
                        <ul v-else class="flex flex-col gap-1" style="font-size: var(--text-xs)">
                            <li v-for="evidence in page.data.value.detail.evidences" :key="evidence.path">
                                <a v-if="evidence.kind === 'file' && evidenceUrl(evidence.path)" :href="evidenceUrl(evidence.path)!" target="_blank" rel="noopener noreferrer">{{ evidence.name }}</a>
                                <span v-else>{{ evidence.name }}{{ evidence.kind === "dir" ? "/" : "" }}</span>
                            </li>
                        </ul>
                    </section>
                    <EphemeralFrame title="谁在动">
                        <p v-if="page.data.value.task.leases.length === 0" style="color: var(--text-muted)">没有</p>
                        <div v-else class="flex flex-wrap gap-1.5">
                            <LeaseChip v-for="lease in page.data.value.task.leases" :key="lease.sessionKey" :session="shortSession(lease.sessionKey, lease.label)" :stale="lease.stale" />
                        </div>
                    </EphemeralFrame>
                </aside>
            </div>
        </template>
    </div>
</template>
