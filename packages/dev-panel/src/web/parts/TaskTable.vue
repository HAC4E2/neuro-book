<script setup lang="ts">
import {Badge, Table} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {relativeDay, shortSession, taskLabel} from "../host/format.js";
import {isPlainClick, taskHref} from "../host/routes.js";
import type {TaskView} from "../host/types.js";
import LeaseChip from "./LeaseChip.vue";
import StatusChip from "./StatusChip.vue";

const props = defineProps<{workId: string; tasks: TaskView[]}>();
const emit = defineEmits<{navigate: [href: string]}>();
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}

type Row = {taskId: string; title: string; status: string; current: string; updated: string; artifacts: string; open: string; source: string; leases: string; task: TaskView};
const rows = computed<Row[]>(() => props.tasks.map((task) => ({taskId: task.taskId, title: "", status: "", current: "", updated: "", artifacts: "", open: "", source: "", leases: "", task})));
const columns: Array<{key: keyof Row & string; label: string; width?: string; align?: "left" | "center" | "right"}> = [
    {key: "title", label: "Task"},
    {key: "status", label: "状态", width: "6rem"},
    {key: "current", label: "当前情况"},
    {key: "updated", label: "最近更新", width: "7rem"},
    {key: "artifacts", label: "产物", width: "4rem", align: "right"},
    {key: "open", label: "待答", width: "4rem", align: "right"},
    {key: "source", label: "记录", width: "6rem"},
    {key: "leases", label: "谁在动"},
];
</script>

<template>
    <Table class="nbdev-table" :columns="columns" :rows="rows" row-key="taskId" density="compact" :hoverable="false" empty-text="这个 Work 还没有 Task">
        <template #cell-title="{row}">
            <a :href="taskHref(workId, row.task.taskId)" class="hover:underline focus-visible:underline" @click="follow($event, taskHref(workId, row.task.taskId))">
                <span style="color: var(--text-secondary)">{{ taskLabel(row.task.taskId) }}</span> {{ row.task.title ?? row.task.taskId }}
            </a>
        </template>
        <template #cell-status="{row}"><StatusChip :status="row.task.status" /></template>
        <template #cell-current="{row}">
            <span v-if="row.task.currentState" class="line-clamp-2" style="color: var(--text-secondary)">{{ row.task.currentState }}</span>
            <span v-else style="color: var(--text-muted)">未标</span>
        </template>
        <template #cell-updated="{row}">
            <span v-if="row.task.updated.value" style="color: var(--text-secondary)">{{ relativeDay(row.task.updated.value) }}</span>
            <span v-else style="color: var(--text-muted)">未标</span>
        </template>
        <template #cell-artifacts="{row}"><span style="color: var(--text-secondary)">{{ row.task.artifacts.length + row.task.documents.length }}</span></template>
        <template #cell-open="{row}">
            <Badge v-if="row.task.openRequired > 0" tone="warning" variant="soft" size="sm">{{ row.task.openRequired }}</Badge>
            <span v-else style="color: var(--text-muted)">0</span>
        </template>
        <template #cell-source="{row}">
            <span style="color: var(--text-secondary)">{{ row.task.source === "branch" ? "分支" : "master" }}</span>
            <span v-if="row.task.uncommitted" style="color: var(--status-warning)"> · 未提交</span>
        </template>
        <template #cell-leases="{row}">
            <div class="flex flex-wrap gap-1">
                <LeaseChip v-for="lease in row.task.leases" :key="lease.sessionKey" :session="shortSession(lease.sessionKey, lease.label)" :stale="lease.stale" />
            </div>
        </template>
    </Table>
</template>
