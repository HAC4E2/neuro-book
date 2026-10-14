<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {useRouter} from "vue-router";
import {daysSince, HERDR_STATUS_LABEL} from "../host/format.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import type {Overview, OverviewWork} from "../host/types.js";
import InboxList from "../parts/InboxList.vue";
import ActionLink from "../parts/ActionLink.vue";
import LoadState from "../parts/LoadState.vue";
import PageShell from "../parts/PageShell.vue";
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

const navigate = (href: string) => void router.push(href);
</script>

<template>
    <PageShell title="首页">
        <LoadState v-bind="loadStateOf(overview)" label="正在读取 Work 与收件箱" @retry="overview.reload()" />
        <template v-if="overview.data.value">
            <section class="nbdev-stack" aria-labelledby="inbox-title">
                <h2 id="inbox-title" class="nbdev-heading flex items-center gap-2">
                    收件箱<span class="nbdev-secondary nbdev-num font-normal">{{ overview.data.value.inbox.length }}</span>
                </h2>
                <div class="nbdev-surface px-3 py-1">
                    <InboxList :items="overview.data.value.inbox" @navigate="navigate" />
                </div>
            </section>
            <section class="nbdev-stack" aria-labelledby="works-title">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="works-title" class="nbdev-heading">Work</h2>
                    <ActionLink href="/live/sessions" icon="i-lucide-terminal" @navigate="navigate">{{ sessionLine }}</ActionLink>
                </div>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <WorkCard v-for="work in current" :key="work.workId" :work="work" @navigate="navigate" />
                </div>
                <p v-if="current.length === 0" class="nbdev-empty">最近 {{ STALE_DAYS }} 天没有在动的 Work</p>
                <div v-if="rest.length > 0" class="nbdev-stack">
                    <Button variant="ghost" size="sm" :icon-class="showRest ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="self-start" :aria-expanded="showRest" @click="showRest = !showRest">
                        其余 {{ rest.length }} 个 Work（完成、搁置或超过 {{ STALE_DAYS }} 天没有更新）
                    </Button>
                    <div v-if="showRest" class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <WorkCard v-for="work in rest" :key="work.workId" :work="work" @navigate="navigate" />
                    </div>
                </div>
            </section>
        </template>
    </PageShell>
</template>
