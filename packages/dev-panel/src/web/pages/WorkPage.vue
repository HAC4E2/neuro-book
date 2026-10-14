<script setup lang="ts">
import {useRouter} from "vue-router";
import {HERDR_STATUS_LABEL, relativeDay, relativeTime, shortSession, taskLabel, workLabel} from "../host/format.js";
import {computed} from "vue";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {docHref, editHref, newHref} from "../host/routes.js";
import {useStatusChange} from "../host/status-change.js";
import type {Meta, WorkView} from "../host/types.js";
import ActionLink from "../parts/ActionLink.vue";
import PageShell from "../parts/PageShell.vue";
import StatusSwitch from "../parts/StatusSwitch.vue";
import UncommittedDialog from "../parts/UncommittedDialog.vue";
import WriteResult from "../parts/WriteResult.vue";
import BranchNote from "../parts/BranchNote.vue";
import EphemeralFrame from "../parts/EphemeralFrame.vue";
import LeaseChip from "../parts/LeaseChip.vue";
import LoadState from "../parts/LoadState.vue";
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
const navigate = (href: string) => void router.push(href);
</script>

<template>
    <PageShell :crumbs="[{label: '首页', href: '/'}, {label: workLabel(props.workId)}]" :title="work.data.value?.title ?? props.workId" @navigate="navigate">
        <template v-if="work.data.value" #status><StatusChip :status="work.data.value.status" size="md" /></template>
        <template v-if="work.data.value" #actions>
            <StatusSwitch :status="work.data.value.status.value" :options="WORK_STATUSES" :subject="workLabel(work.data.value.workId)" :disabled-reason="writeBlocked" :pending="status.write.pending.value" :slow="status.write.slow.value" @confirm="status.change" />
            <template v-if="!writeBlocked">
                <ActionLink :href="editHref(work.data.value.readmePath)" icon="i-lucide-pencil" @navigate="navigate">编辑 README</ActionLink>
                <ActionLink :href="newHref(work.data.value.workId)" icon="i-lucide-plus" @navigate="navigate">新建 Task</ActionLink>
            </template>
            <ActionLink :href="docHref('main', work.data.value.readmePath)" icon="i-lucide-book-open" @navigate="navigate">看 README</ActionLink>
        </template>
        <template v-if="work.data.value" #meta>
            <span>{{ work.data.value.workId }}</span>
            <span>{{ work.data.value.updated.value ? `最近更新 ${relativeDay(work.data.value.updated.value)}` : "最近更新：未标" }}</span>
            <span>记录：{{ work.data.value.source === "branch" ? `分支 ${work.data.value.branch ?? ""}` : "master" }}</span>
        </template>
        <template v-if="status.notice.value" #feedback>
            <WriteResult :notice="status.notice.value" @dismiss="status.notice.value = null" @retry="status.retry" />
        </template>
        <LoadState v-bind="loadStateOf(work)" label="正在读取 Work" up-href="/" up-label="回到首页" @navigate="navigate" @retry="work.reload()" />
        <template v-if="work.data.value">
            <section class="nbdev-stack">
                <p class="max-w-[72ch] whitespace-pre-line" :class="work.data.value.goal.value ? 'nbdev-secondary' : 'nbdev-empty'">{{ work.data.value.goal.value ?? "目标：未标" }}</p>
                <BranchNote v-if="work.data.value.source === 'branch'" :branch="work.data.value.branch" :checkout-key="work.data.value.checkoutKey" />
                <div class="max-w-md"><StatusBar :counts="work.data.value.taskCounts" /></div>
            </section>
            <section class="nbdev-stack" aria-labelledby="tasks-title">
                <h2 id="tasks-title" class="nbdev-heading">Task</h2>
                <TaskTable :work-id="props.workId" :tasks="work.data.value.tasks" @navigate="navigate" />
            </section>
            <UncommittedDialog :open="status.pending.value !== null" :path="status.pending.value?.path ?? ''" :changes="status.pending.value?.changes ?? null" :pending="status.write.pending.value" @confirm="status.confirmUncommitted" @cancel="status.pending.value = null" />
            <!-- 持久页里混着的临时片段，仍用虚线框标出（t15 阶段 3g）。 -->
            <EphemeralFrame title="现在谁在动">
                <p v-if="work.data.value.sessions.length === 0" class="nbdev-empty">没有会话持有这个 Work 的租约</p>
                <ul v-else class="nbdev-stack-tight">
                    <li v-for="session in work.data.value.sessions" :key="session.key" class="flex flex-wrap items-center gap-2">
                        <LeaseChip :session="shortSession(session.key, session.label)" :ended="session.alive === false" />
                        <span class="nbdev-note">
                            {{ session.herdr ? HERDR_STATUS_LABEL[session.herdr.status] ?? session.herdr.status : "不在 herdr 里" }}
                            · 在动 {{ session.leases.map((lease) => taskLabel(lease.taskId)).join("、") }}
                            · 最近 {{ relativeTime(session.leases[0]?.lastActivityAt ?? new Date().toISOString()) }}
                            <template v-if="session.runs > 0"> · {{ session.runs }} 个运行</template>
                        </span>
                    </li>
                </ul>
            </EphemeralFrame>
            <section v-if="work.data.value.documents.length > 0 || work.data.value.artifacts.length > 0" class="nbdev-stack">
                <h2 class="nbdev-heading">Work 级的文档与产物</h2>
                <ul class="nbdev-stack-tight">
                    <li v-for="document in work.data.value.documents" :key="document.path">
                        <RouterLink :to="{name: 'docs', query: {checkout: work.data.value.checkoutKey ?? 'main', path: document.path}}">{{ document.title ?? document.path }}</RouterLink>
                    </li>
                    <li v-for="artifact in work.data.value.artifacts" :key="artifact.artifactId">
                        <RouterLink :to="`/artifact/${work.data.value.workId}/-/${artifact.artifactId}`">{{ artifact.title ?? artifact.artifactId }}</RouterLink>
                    </li>
                </ul>
            </section>
        </template>
    </PageShell>
</template>
