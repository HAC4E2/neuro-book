<script setup lang="ts">
import {Badge, Table} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {workLabel} from "../host/format.js";
import {useResource} from "../host/panel-data.js";
import type {SessionsData} from "../host/types.js";
import LoadState from "../parts/LoadState.vue";

/** checkout 页（Proposal 第九节）：路径、分支、HEAD、是哪个 Work 的执行 worktree。不做“是否可清理”（判据在根 scripts 的 governance:worktree，见 t09 计划“不一致”）。 */
const sessions = useResource<SessionsData>(() => "/api/sessions", ["records"]);
type Row = {key: string; branch: string; head: string; root: string; works: string; checkout: SessionsData["checkouts"][number]};
const rows = computed<Row[]>(() => (sessions.data.value?.checkouts ?? []).map((checkout) => ({key: checkout.key, branch: "", head: "", root: "", works: "", checkout})));
const columns: Array<{key: keyof Row & string; label: string; width?: string}> = [
    {key: "key", label: "checkout"}, {key: "branch", label: "分支"}, {key: "head", label: "HEAD", width: "7rem"}, {key: "works", label: "执行 worktree 于"}, {key: "root", label: "路径"},
];
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-4 p-4 md:p-6">
        <h1 class="font-semibold" style="font-size: var(--text-xl)">checkout</h1>
        <LoadState v-if="!sessions.data.value" :loading="sessions.loading.value" :error="sessions.error.value" label="正在读取 checkout" @retry="sessions.reload()" />
        <Table v-else :columns="columns" :rows="rows" row-key="key" density="compact" :hoverable="false">
            <template #cell-key="{row}">
                <RouterLink :to="{name: 'docs', query: {checkout: row.checkout.key}}">{{ row.checkout.key }}</RouterLink>
                <Badge v-if="row.checkout.isMain" tone="accent" variant="soft" size="sm" class="ml-1">主工作区</Badge>
            </template>
            <template #cell-branch="{row}">{{ row.checkout.branch ?? "分离 HEAD" }}</template>
            <template #cell-head="{row}"><code>{{ row.checkout.head.slice(0, 9) }}</code></template>
            <template #cell-works="{row}">
                <span v-if="row.checkout.executionOf.length > 0">{{ row.checkout.executionOf.map(workLabel).join("、") }}</span>
                <span v-else style="color: var(--text-muted)">—</span>
            </template>
            <template #cell-root="{row}"><code class="break-all" style="color: var(--text-secondary); font-size: var(--text-xs)">{{ row.checkout.root }}</code></template>
        </Table>
    </div>
</template>
