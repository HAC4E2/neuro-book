<script setup lang="ts">
import {Badge, EmptyState} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {shortSession, taskLabel, workLabel} from "../host/format.js";
import {groupInbox} from "../host/inbox.js";
import {artifactHref, isPlainClick} from "../host/routes.js";
import type {InboxItem} from "../host/types.js";
import LeaseChip from "./LeaseChip.vue";

/** 首页收件箱：待答的提问按产物合并成一行，撞号一条一行。契约见同名 .md。 */
const props = defineProps<{items: InboxItem[]}>();
const emit = defineEmits<{navigate: [href: string]}>();
const rows = computed(() => groupInbox(props.items));
/** 一行里列出的题数上限，其余写“等 N 道”。 */
const SHOWN = 3;
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}
</script>

<template>
    <EmptyState v-if="items.length === 0" icon-class="i-lucide-inbox" title="收件箱是空的" description="没有待答的必答题，也没有撞号" />
    <ul v-else class="flex flex-col">
        <li v-for="row in rows" :key="row.kind === 'artifact' ? row.key : `conflict:${row.label}`" class="border-b last:border-b-0 nbdev-divider">
            <a v-if="row.kind === 'artifact'" :href="artifactHref(row.workId, row.taskId, row.artifactId)" class="flex w-full min-w-0 flex-col gap-1 px-1 py-2 hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]" @click="follow($event, artifactHref(row.workId, row.taskId, row.artifactId))">
                <span class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-message-circle-question size-4 shrink-0 nbdev-warn" aria-hidden="true" />
                    <span class="truncate font-medium">{{ row.title ?? row.artifactId }}</span>
                    <!-- 收件箱只收必答题；产物页的“待答”也把必答单独数出来，两边都是“必答 N”。 -->
                    <Badge class="shrink-0" tone="warning" variant="soft" size="sm">必答 {{ row.questions.length }}</Badge>
                </span>
                <span class="nbdev-secondary min-w-0 pl-6 break-words">
                    {{ row.questions.slice(0, SHOWN).map((question) => question.label).join("；") }}<template v-if="row.questions.length > SHOWN">；等 {{ row.questions.length }} 道</template>
                </span>
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 nbdev-note">
                    <span>{{ workLabel(row.workId) }} / {{ taskLabel(row.taskId) }} · {{ row.artifactId }}</span>
                    <LeaseChip v-for="asker in row.askers" :key="asker.key" :session="shortSession(asker.key)" :ended="asker.active === false" :hint="asker.active === false ? '提问的会话已经不在（租约失效），答了要等别的会话来采纳' : '提问的会话'" />
                    <span v-if="row.askers.length === 0" class="nbdev-empty">提问者未知</span>
                </span>
            </a>
            <div v-else class="flex items-center gap-2 px-1 py-2">
                <span class="i-lucide-triangle-alert size-4 shrink-0 nbdev-danger" aria-hidden="true" />
                <span class="font-medium">撞号 {{ row.label }}</span>
                <Badge v-if="row.live" tone="danger" variant="soft" size="sm">正在发生</Badge>
            </div>
        </li>
    </ul>
</template>
