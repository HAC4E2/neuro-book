<script setup lang="ts">
/** 视图贡献的标题动作（同名 .md）：一排 24px 图标按钮，点了交给宿主执行。 */
import {IconButton} from "@notnotype/nb-ui/components";

import type {ViewActionEntry} from "../titlebar/titlebar-source";

defineOptions({name: "WorkbenchViewActions"});

defineProps<{actions: ReadonlyArray<ViewActionEntry>}>();
const emit = defineEmits<{run: [index: number]}>();
</script>

<template>
    <span class="workbench-view-actions">
        <IconButton
            v-for="(entry, index) in actions"
            :key="entry.action.command"
            size="xs"
            :icon-class="entry.action.icon"
            :aria-label="entry.title"
            :title="entry.disabledReason ?? entry.title"
            :aria-pressed="entry.pressed"
            :disabled="entry.disabledReason !== null"
            :data-view-action="entry.action.command"
            @click="emit('run', index)"
        />
    </span>
</template>

<style scoped>
.workbench-view-actions {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}
</style>
