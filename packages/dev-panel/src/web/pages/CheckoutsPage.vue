<script setup lang="ts">
import {Badge, Table} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref} from "vue";
import {relativeTime, taskLabel, workLabel} from "../host/format.js";
import {useResource} from "../host/panel-data.js";
import type {CheckoutRow, CheckoutsData} from "../host/types.js";
import LoadState from "../parts/LoadState.vue";
import StaleNotice from "../parts/StaleNotice.vue";

/**
 * checkout 页（Proposal 第九节）：路径、分支、HEAD、是哪个 Work 的执行 worktree；t14 加未提交条数（只算已跟踪的文件）、
 * 相对 master 的领先落后、在跑的服务、是哪些 Task 的 `home`。这几列请求时现算、每个 checkout 留 10 秒。
 * 页面开着时每 10 秒自己重取一次：改了文件不会改变“活动”，只随推送重取会一直显示旧的“干净”（t14 实现审查 I4）；服务端有同样长的缓存，
 * 不会放大开销。“N 秒前算的”按秒走。不做“是否可清理”（判据在根 scripts 的 governance:worktree，见 t09 计划“不一致”）。
 */
const REFETCH_MS = 10_000;
const checkouts = useResource<CheckoutsData>(() => "/api/checkouts", ["records", "activity"]);
const refetch = setInterval(() => checkouts.reload(), REFETCH_MS);
const now = ref(Date.now());
const clock = setInterval(() => {
    now.value = Date.now();
}, 1_000);
onBeforeUnmount(() => {
    clearInterval(refetch);
    clearInterval(clock);
});
type Row = {key: string; branch: string; head: string; dirty: string; sync: string; runs: string; homes: string; works: string; root: string; checkout: CheckoutRow};
const rows = computed<Row[]>(() => (checkouts.data.value?.checkouts ?? []).map((checkout) => ({key: checkout.key, branch: "", head: "", dirty: "", sync: "", runs: "", homes: "", works: "", root: "", checkout})));
const computedAt = computed(() => checkouts.data.value?.checkouts.map((row) => row.at).sort()[0] ?? null);
const computedAgo = computed(() => {
    if (!computedAt.value) return null;
    const seconds = Math.max(0, Math.floor((now.value - Date.parse(computedAt.value)) / 1000));
    return seconds < 60 ? `${seconds} 秒前` : relativeTime(computedAt.value, new Date(now.value));
});
const columns: Array<{key: keyof Row & string; label: string; width?: string}> = [
    {key: "key", label: "checkout"}, {key: "branch", label: "分支"}, {key: "head", label: "HEAD", width: "7rem"}, {key: "dirty", label: "未提交", width: "5rem"},
    {key: "sync", label: "相对 master", width: "7rem"}, {key: "runs", label: "在跑"}, {key: "homes", label: "home 是它的 Task"}, {key: "works", label: "执行 worktree 于"}, {key: "root", label: "路径"},
];
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-4 p-4 md:p-6">
        <div class="flex flex-wrap items-baseline gap-2">
            <h1 class="font-semibold" style="font-size: var(--text-xl)">checkout</h1>
            <span v-if="computedAgo" style="color: var(--text-secondary); font-size: var(--text-xs)">未提交与领先落后是 {{ computedAgo }}算的</span>
        </div>
        <StaleNotice v-if="checkouts.stale.value" :error="checkouts.error.value!" :received-at="checkouts.receivedAt.value" @retry="checkouts.reload()" />
        <LoadState v-if="!checkouts.data.value" :loading="checkouts.loading.value" :error="checkouts.error.value" label="正在读取 checkout" @retry="checkouts.reload()" />
        <!-- 列多：窄屏上整张表横向滚动，不把每列挤成一字一行。 -->
        <div v-else class="overflow-x-auto">
            <div class="min-w-[64rem]">
            <Table class="nbdev-table" :columns="columns" :rows="rows" row-key="key" density="compact" :hoverable="false">
                <template #cell-key="{row}">
                    <RouterLink :to="{name: 'docs', query: {checkout: row.checkout.key}}">{{ row.checkout.key }}</RouterLink>
                    <Badge v-if="row.checkout.isMain" tone="accent" variant="soft" size="sm" class="ml-1">主工作区</Badge>
                </template>
                <template #cell-branch="{row}">{{ row.checkout.branch ?? "分离 HEAD" }}</template>
                <template #cell-head="{row}"><code>{{ row.checkout.head.slice(0, 9) }}</code></template>
                <template #cell-dirty="{row}">
                    <span v-if="row.checkout.error" style="color: var(--status-warning)" :title="row.checkout.error">读不出</span>
                    <span v-else-if="row.checkout.dirty" style="color: var(--status-warning)">{{ row.checkout.dirty }} 个文件</span>
                    <span v-else style="color: var(--text-muted)">干净</span>
                </template>
                <template #cell-sync="{row}">
                    <span v-if="row.checkout.ahead === null" style="color: var(--text-muted)">—</span>
                    <span v-else>领先 {{ row.checkout.ahead }} · 落后 {{ row.checkout.behind }}</span>
                </template>
                <template #cell-runs="{row}">
                    <span v-if="row.checkout.runs.length === 0" style="color: var(--text-muted)">—</span>
                    <span v-for="run in row.checkout.runs" :key="run.runId" class="block break-all" style="font-size: var(--text-xs)">{{ run.url ? `${run.script} · ${run.url}` : run.script }}</span>
                </template>
                <template #cell-homes="{row}">
                    <span v-if="row.checkout.homeOf.length === 0" style="color: var(--text-muted)">—</span>
                    <span v-else>{{ row.checkout.homeOf.map((home) => `${workLabel(home.workId)}/${taskLabel(home.taskId)}`).join("、") }}</span>
                </template>
                <template #cell-works="{row}">
                    <span v-if="row.checkout.executionOf.length > 0">{{ row.checkout.executionOf.map(workLabel).join("、") }}</span>
                    <span v-else style="color: var(--text-muted)">—</span>
                </template>
                <template #cell-root="{row}"><code class="break-all" style="color: var(--text-secondary); font-size: var(--text-xs)">{{ row.checkout.root }}</code></template>
            </Table>
            </div>
        </div>
    </div>
</template>
