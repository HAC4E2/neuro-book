<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";
import {HERDR_STATUS_LABEL, relativeTime, shortSession, taskLabel, workLabel} from "../host/format.js";
import type {SessionView} from "../host/types.js";
import LeaseChip from "./LeaseChip.vue";
import RunList from "./RunList.vue";

withDefaults(defineProps<{sessions: SessionView[]; openable?: boolean}>(), {openable: false});
const emit = defineEmits<{open: [paneId: string]}>();
const TONE: Record<string, "neutral" | "accent" | "warning" | "success"> = {idle: "neutral", working: "accent", blocked: "warning", done: "success"};
</script>

<template>
    <p v-if="sessions.length === 0" style="color: var(--text-muted)">没有会话持有租约或运行</p>
    <ul v-else class="flex flex-col gap-3">
        <li v-for="session in sessions" :key="session.key" class="flex flex-col gap-1.5 border-b pb-3 last:border-b-0" style="border-color: var(--divider)">
            <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium" :class="{'line-through': session.alive === false}">{{ shortSession(session.key, session.label) }}</span>
                <Badge :tone="session.herdr ? TONE[session.herdr.status] ?? 'neutral' : 'neutral'" variant="soft" size="sm">{{ session.herdr ? HERDR_STATUS_LABEL[session.herdr.status] ?? session.herdr.status : "不在 herdr 里" }}</Badge>
                <span style="color: var(--text-muted); font-size: var(--text-xs)">{{ session.agent }}<template v-if="session.herdr"> · pane {{ session.herdr.paneId }}</template><template v-if="session.alive === false"> · 会话进程已退出</template></span>
                <Button v-if="openable && session.herdr" class="ml-auto" size="sm" variant="ghost" icon-class="i-lucide-terminal" @click="emit('open', session.herdr.paneId)">屏幕与输入</Button>
            </div>
            <div v-if="session.leases.length > 0" class="flex flex-wrap gap-1.5">
                <LeaseChip v-for="lease in session.leases" :key="`${lease.workId}/${lease.taskId}`" :session="`${workLabel(lease.workId)}/${taskLabel(lease.taskId)}`" :stale="lease.stale" :hint="`最近 ${relativeTime(lease.lastActivityAt)}：${lease.lastAction}`" />
            </div>
            <RunList v-if="session.runs.length > 0" :runs="session.runs" />
        </li>
    </ul>
</template>
