<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {relativeDay, shortSession, taskLabel, workLabel} from "../host/format.js";
import type {OverviewWork} from "../host/types.js";
import BranchNote from "./BranchNote.vue";
import EphemeralFrame from "./EphemeralFrame.vue";
import LeaseChip from "./LeaseChip.vue";
import StatusBar from "./StatusBar.vue";
import StatusChip from "./StatusChip.vue";

defineProps<{work: OverviewWork}>();
defineEmits<{open: [workId: string]}>();
</script>

<template>
    <article class="flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] p-4" style="background: var(--panel-surface); border: var(--border-w, 1px) solid var(--divider)">
        <header class="flex min-w-0 items-start gap-2">
            <StatusChip :status="work.status" />
            <button type="button" class="min-w-0 flex-1 text-left font-semibold hover:underline focus-visible:underline" style="font-size: var(--text-md)" @click="$emit('open', work.workId)">
                <span style="color: var(--text-muted)">{{ workLabel(work.workId) }}</span>
                {{ work.title ?? work.workId }}
            </button>
        </header>
        <p class="line-clamp-3" :style="{color: work.goal.value ? 'var(--text-secondary)' : 'var(--text-muted)'}">
            {{ work.goal.value ?? "目标：未标" }}
        </p>
        <StatusBar :counts="work.taskCounts" />
        <div class="flex flex-wrap items-center gap-2" style="font-size: var(--text-xs); color: var(--text-secondary)">
            <Badge v-if="work.openRequired > 0" tone="warning" variant="soft" size="sm" icon-class="i-lucide-message-circle-question">待答 {{ work.openRequired }}</Badge>
            <span v-if="work.updated.value">最近更新 {{ relativeDay(work.updated.value) }}</span>
            <span v-else style="color: var(--text-muted)">最近更新：未标</span>
            <span v-if="work.uncommitted">· 有未提交的改动</span>
        </div>
        <BranchNote v-if="work.source === 'branch'" :branch="work.branch" :checkout-key="work.checkoutKey" />
        <EphemeralFrame v-if="work.activeLeases.length > 0" title="谁在动">
            <div class="flex flex-wrap gap-1.5">
                <LeaseChip v-for="lease in work.activeLeases" :key="`${lease.sessionKey}/${lease.taskId}`" :session="shortSession(lease.sessionKey, lease.label)" :task="taskLabel(lease.taskId)" :stale="lease.stale" />
            </div>
        </EphemeralFrame>
    </article>
</template>
