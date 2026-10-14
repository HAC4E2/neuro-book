<script setup lang="ts">
import {relativeTime} from "../host/format.js";
import type {RunView} from "../host/types.js";

withDefaults(defineProps<{runs: RunView[]; showPane?: boolean}>(), {showPane: false});
const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
</script>

<template>
    <ul class="flex flex-col gap-1" style="font-size: var(--text-xs)">
        <li v-for="run in runs" :key="run.pid" class="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span class="i-lucide-cog size-3 shrink-0 self-center" style="color: var(--text-muted)" aria-hidden="true" />
            <code class="min-w-0 max-w-full flex-1 truncate" :title="run.command">{{ run.command }}</code>
            <span style="color: var(--text-secondary)">{{ base(run.checkout) }} · {{ relativeTime(run.startedAt) }}起 · pid {{ run.pid }}<template v-if="run.descendants.length > 0"> · {{ run.descendants.length }} 个子进程</template><template v-if="run.unit"> · {{ run.unit }}</template><template v-if="showPane && run.paneId"> · pane {{ run.paneId }}</template></span>
            <span v-if="run.sessionAlive === false" style="color: var(--status-warning)">派出它的会话已不在</span>
        </li>
    </ul>
</template>
