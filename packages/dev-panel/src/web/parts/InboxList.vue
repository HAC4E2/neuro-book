<script setup lang="ts">
import {Badge, EmptyState} from "@notnotype/nb-ui/components";
import {shortSession, taskLabel, workLabel} from "../host/format.js";
import type {InboxItem, InboxQuestion} from "../host/types.js";
import LeaseChip from "./LeaseChip.vue";

defineProps<{items: InboxItem[]}>();
defineEmits<{"open-question": [item: InboxQuestion]}>();
</script>

<template>
    <EmptyState v-if="items.length === 0" icon-class="i-lucide-inbox" title="收件箱是空的" description="没有待答的必答题，也没有撞号" />
    <ul v-else class="flex flex-col">
        <li v-for="item in items" :key="item.kind === 'question' ? `${item.workId}/${item.taskId}/${item.artifactId}#${item.questionId}` : `conflict:${item.label}`" class="border-b last:border-b-0" style="border-color: var(--divider)">
            <button v-if="item.kind === 'question'" type="button" class="flex w-full min-w-0 flex-col gap-1 px-1 py-2 text-left hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]" @click="$emit('open-question', item)">
                <span class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-message-circle-question size-4 shrink-0" style="color: var(--status-warning)" aria-hidden="true" />
                    <span class="truncate font-medium">{{ item.label }}</span>
                </span>
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6" style="font-size: var(--text-xs); color: var(--text-secondary)">
                    <span>{{ workLabel(item.workId) }} / {{ taskLabel(item.taskId) }} · {{ item.artifactId }}#{{ item.questionId }}</span>
                    <LeaseChip v-if="item.askedBy" :session="shortSession(item.askedBy)" :ended="item.askerActive === false" :hint="item.askerActive === false ? '提问的会话已经不在（租约失效），答了要等别的会话来采纳' : '提问的会话'" />
                    <span v-else style="color: var(--text-muted)">提问者未知</span>
                </span>
            </button>
            <div v-else class="flex items-center gap-2 px-1 py-2">
                <span class="i-lucide-triangle-alert size-4 shrink-0" style="color: var(--status-danger)" aria-hidden="true" />
                <span class="font-medium">撞号 {{ item.label }}</span>
                <Badge v-if="item.live" tone="danger" variant="soft" size="sm">正在发生</Badge>
            </div>
        </li>
    </ul>
</template>
