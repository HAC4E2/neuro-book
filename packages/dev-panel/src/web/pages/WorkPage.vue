<script setup lang="ts">
import {Breadcrumb} from "@notnotype/nb-ui/components";
import {useRouter} from "vue-router";
import {HERDR_STATUS_LABEL, relativeDay, relativeTime, shortSession, taskLabel, workLabel} from "../host/format.js";
import {computed} from "vue";
import {useResource} from "../host/panel-data.js";
import {editHref, isPlainClick, newHref} from "../host/routes.js";
import {useStatusChange} from "../host/status-change.js";
import type {Meta, WorkView} from "../host/types.js";
import StatusSwitch from "../parts/StatusSwitch.vue";
import UncommittedDialog from "../parts/UncommittedDialog.vue";
import WriteNotice from "../parts/WriteNotice.vue";
import BranchNote from "../parts/BranchNote.vue";
import EphemeralFrame from "../parts/EphemeralFrame.vue";
import LeaseChip from "../parts/LeaseChip.vue";
import LoadState from "../parts/LoadState.vue";
import StaleNotice from "../parts/StaleNotice.vue";
import StatusBar from "../parts/StatusBar.vue";
import StatusChip from "../parts/StatusChip.vue";
import TaskTable from "../parts/TaskTable.vue";

/** Work 页（t03 第三轮 Work 页）：目标、Task 表、现在谁在动、Work 级的文档与产物；状态切换、编辑 README、新建 Task 的入口（t10）。 */
const props = defineProps<{workId: string}>();
const router = useRouter();
const work = useResource<WorkView>(() => `/api/work/${encodeURIComponent(props.workId)}`, ["records", "activity"]);
const meta = useResource<Meta>(() => "/api/meta", ["records"]);
const WORK_STATUSES = ["active", "done", "shelved"];
/** 写入口的可用性：主工作区不能写、记录来自分支时只说明原因。 */
const writeBlocked = computed(() => {
    const writable = meta.data.value?.mainWritable;
    if (writable && !writable.ok) return `主工作区现在不能写（${writable.message ?? writable.code}）`;
    const current = work.data.value;
    if (current?.source === "branch") return `记录在分支 ${current.branch ?? ""} 上维护，在那里改或先迁移`;
    return null;
});
const status = useStatusChange(() => `/api/works/${encodeURIComponent(props.workId)}/status`, () => work.data.value?.readmeHash ?? null, () => work.reload());

function followCrumb(item: {href?: string}, event: MouseEvent): void {
    if (!item.href || !isPlainClick(event)) return;
    event.preventDefault();
    void router.push(item.href);
}
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-5 p-4 md:p-6">
        <StaleNotice v-if="work.stale.value" :error="work.error.value!" :received-at="work.receivedAt.value" up-href="/" up-label="回到首页" @navigate="(href) => router.push(href)" @retry="work.reload()" />
        <LoadState v-if="!work.data.value" :loading="work.loading.value" :error="work.error.value" label="正在读取 Work" @retry="work.reload()" />
        <template v-else>
            <Breadcrumb :items="[{label: '首页', href: '/'}, {label: workLabel(work.data.value.workId), current: true}]" @click="followCrumb" />
            <header class="flex flex-col gap-2">
                <div class="flex flex-wrap items-center gap-2">
                    <StatusChip :status="work.data.value.status" size="md" />
                    <h1 class="font-semibold" style="font-size: var(--text-xl)">{{ work.data.value.title ?? work.data.value.workId }}</h1>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <StatusSwitch :status="work.data.value.status.value" :options="WORK_STATUSES" :subject="workLabel(work.data.value.workId)" :disabled-reason="writeBlocked" :pending="status.write.pending.value" :slow="status.write.slow.value" @confirm="status.change" />
                    <template v-if="!writeBlocked">
                        <RouterLink :to="editHref(work.data.value.readmePath)" style="font-size: var(--text-xs)">编辑 README</RouterLink>
                        <RouterLink :to="newHref(work.data.value.workId)" style="font-size: var(--text-xs)">新建 Task</RouterLink>
                    </template>
                </div>
                <WriteNotice v-if="status.notice.value" :notice="status.notice.value" @dismiss="status.notice.value = null" @retry="status.retry" />
                <p :style="{color: work.data.value.goal.value ? 'var(--text-secondary)' : 'var(--text-muted)'}" class="max-w-[72ch] whitespace-pre-line">{{ work.data.value.goal.value ?? "目标：未标" }}</p>
                <div class="flex flex-wrap gap-3" style="font-size: var(--text-xs); color: var(--text-secondary)">
                    <span>{{ work.data.value.workId }}</span>
                    <span>{{ work.data.value.updated.value ? `最近更新 ${relativeDay(work.data.value.updated.value)}` : "最近更新：未标" }}</span>
                    <span>记录：{{ work.data.value.source === "branch" ? `分支 ${work.data.value.branch ?? ""}` : "master" }}</span>
                    <RouterLink :to="{name: 'docs', query: {checkout: 'main', path: work.data.value.readmePath}}">看 README</RouterLink>
                </div>
                <BranchNote v-if="work.data.value.source === 'branch'" :branch="work.data.value.branch" :checkout-key="work.data.value.checkoutKey" />
                <div class="max-w-md"><StatusBar :counts="work.data.value.taskCounts" /></div>
            </header>
            <section class="flex flex-col gap-2" aria-labelledby="tasks-title">
                <h2 id="tasks-title" class="font-semibold" style="font-size: var(--text-lg)">Task</h2>
                <TaskTable :work-id="props.workId" :tasks="work.data.value.tasks" @navigate="(href) => router.push(href)" />
            </section>
            <UncommittedDialog :open="status.pending.value !== null" :path="status.pending.value?.path ?? ''" :changes="status.pending.value?.changes ?? null" :pending="status.write.pending.value" @confirm="status.confirmUncommitted" @cancel="status.pending.value = null" />
            <EphemeralFrame title="现在谁在动">
                <p v-if="work.data.value.sessions.length === 0" style="color: var(--text-muted)">没有会话持有这个 Work 的租约</p>
                <ul v-else class="flex flex-col gap-1.5">
                    <li v-for="session in work.data.value.sessions" :key="session.key" class="flex flex-wrap items-center gap-2">
                        <LeaseChip :session="shortSession(session.key, session.label)" :ended="session.alive === false" />
                        <span style="color: var(--text-secondary); font-size: var(--text-xs)">
                            {{ session.herdr ? HERDR_STATUS_LABEL[session.herdr.status] ?? session.herdr.status : "不在 herdr 里" }}
                            · 在动 {{ session.leases.map((lease) => taskLabel(lease.taskId)).join("、") }}
                            · 最近 {{ relativeTime(session.leases[0]?.lastActivityAt ?? new Date().toISOString()) }}
                            <template v-if="session.runs > 0"> · {{ session.runs }} 个运行</template>
                        </span>
                    </li>
                </ul>
            </EphemeralFrame>
            <section v-if="work.data.value.documents.length > 0 || work.data.value.artifacts.length > 0" class="flex flex-col gap-2">
                <h2 class="font-semibold" style="font-size: var(--text-lg)">Work 级的文档与产物</h2>
                <ul class="flex flex-col gap-1">
                    <li v-for="document in work.data.value.documents" :key="document.path">
                        <RouterLink :to="{name: 'docs', query: {checkout: work.data.value.checkoutKey ?? 'main', path: document.path}}">{{ document.title ?? document.path }}</RouterLink>
                    </li>
                    <li v-for="artifact in work.data.value.artifacts" :key="artifact.artifactId">
                        <RouterLink :to="`/artifact/${work.data.value.workId}/-/${artifact.artifactId}`">{{ artifact.title ?? artifact.artifactId }}</RouterLink>
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>
