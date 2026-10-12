<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {useRouter} from "vue-router";
import {daysSince, HERDR_STATUS_LABEL} from "../host/format.js";
import {useResource} from "../host/panel-data.js";
import type {InboxQuestion, Overview, OverviewWork} from "../host/types.js";
import InboxList from "../parts/InboxList.vue";
import LoadState from "../parts/LoadState.vue";
import WorkCard from "../parts/WorkCard.vue";

/**
 * 首页（t03 第三轮首页 A）：收件箱在上，Work 卡片在下。只为进行中与未标的 Work 列卡片，按最近更新排序；
 * 超过 30 天没有更新的、done 与 shelved 的收进“其余 N 个”（不做状态推断，见 t09 计划“与 Proposal、实施计划的不一致”）。
 */
const router = useRouter();
const overview = useResource<Overview>(() => "/api/overview", ["records", "activity"]);
const STALE_DAYS = 30;
const showRest = ref(false);

const updatedOf = (work: OverviewWork) => work.updated.value ?? "";
const sorted = computed(() => [...(overview.data.value?.works ?? [])].sort((left, right) => updatedOf(right).localeCompare(updatedOf(left)) || left.workId.localeCompare(right.workId)));
const isCurrent = (work: OverviewWork) => (work.status.value === null || work.status.value === "active") && work.updated.value !== null && daysSince(work.updated.value) <= STALE_DAYS;
const current = computed(() => sorted.value.filter(isCurrent));
const rest = computed(() => sorted.value.filter((work) => !isCurrent(work)));
const sessionLine = computed(() => {
    const sessions = overview.data.value?.sessions;
    if (!sessions) return "";
    const parts = Object.entries(sessions.byStatus).map(([status, count]) => `${HERDR_STATUS_LABEL[status] ?? status} ${count}`);
    return `${sessions.total} 个会话${parts.length > 0 ? `（${parts.join("、")}）` : ""}${sessions.unownedRuns > 0 ? `，${sessions.unownedRuns} 个无主的运行` : ""}`;
});

function openQuestion(item: InboxQuestion): void {
    void router.push(`/artifact/${item.workId}/${item.taskId}/${item.artifactId}`);
}
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-6 p-4 md:p-6">
        <LoadState v-if="!overview.data.value" :loading="overview.loading.value" :error="overview.error.value" label="正在读取 Work 与收件箱" @retry="overview.reload()" />
        <template v-else>
            <section class="flex flex-col gap-2" aria-labelledby="inbox-title">
                <h1 id="inbox-title" class="flex items-center gap-2 font-semibold" style="font-size: var(--text-lg)">
                    收件箱<span style="color: var(--text-muted); font-size: var(--text-sm)">{{ overview.data.value.inbox.length }}</span>
                </h1>
                <div class="rounded-[var(--radius-panel)] px-3 py-1" style="background: var(--panel-surface); border: var(--border-w, 1px) solid var(--divider)">
                    <InboxList :items="overview.data.value.inbox" @open-question="openQuestion" />
                </div>
            </section>
            <section class="flex flex-col gap-3" aria-labelledby="works-title">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="works-title" class="font-semibold" style="font-size: var(--text-lg)">Work</h2>
                    <RouterLink to="/live/sessions" style="color: var(--text-secondary); font-size: var(--text-xs)">{{ sessionLine }}</RouterLink>
                </div>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <WorkCard v-for="work in current" :key="work.workId" :work="work" @open="(workId) => router.push(`/work/${workId}`)" />
                </div>
                <p v-if="current.length === 0" style="color: var(--text-muted)">最近 {{ STALE_DAYS }} 天没有在动的 Work</p>
                <div v-if="rest.length > 0" class="flex flex-col gap-3">
                    <Button variant="ghost" size="sm" :icon-class="showRest ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="self-start" :aria-expanded="showRest" @click="showRest = !showRest">
                        其余 {{ rest.length }} 个 Work（完成、搁置或超过 {{ STALE_DAYS }} 天没有更新）
                    </Button>
                    <div v-if="showRest" class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <WorkCard v-for="work in rest" :key="work.workId" :work="work" @open="(workId) => router.push(`/work/${workId}`)" />
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>
