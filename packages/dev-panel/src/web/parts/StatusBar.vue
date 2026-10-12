<script setup lang="ts">
import {computed} from "vue";

type Key = "planned" | "active" | "done" | "shelved" | "unset" | "invalid";
const props = defineProps<{counts: Record<Key, number>}>();

const ORDER: Array<{key: Key; label: string; color: string}> = [
    {key: "active", label: "进行中", color: "var(--accent-main)"},
    {key: "planned", label: "计划中", color: "var(--text-muted)"},
    {key: "done", label: "完成", color: "var(--status-success)"},
    {key: "shelved", label: "搁置", color: "var(--status-warning)"},
    {key: "invalid", label: "不合规", color: "var(--status-danger)"},
    {key: "unset", label: "未标", color: "var(--divider)"},
];
const total = computed(() => ORDER.reduce((sum, entry) => sum + (props.counts[entry.key] ?? 0), 0));
const segments = computed(() => ORDER.filter((entry) => (props.counts[entry.key] ?? 0) > 0).map((entry) => ({...entry, count: props.counts[entry.key], share: props.counts[entry.key] / total.value})));
const summary = computed(() => (total.value === 0 ? "还没有 Task" : segments.value.map((segment) => `${segment.label} ${segment.count}`).join("，")));
</script>

<template>
    <div class="flex flex-col gap-1.5">
        <div class="flex h-1.5 w-full overflow-hidden rounded-full" style="background: var(--bg-subtle)" role="img" :aria-label="`Task 状态：${summary}`">
            <span v-for="segment in segments" :key="segment.key" class="h-full" :style="{width: `${segment.share * 100}%`, background: segment.color}" />
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1" style="font-size: var(--text-xs); color: var(--text-secondary)">
            <span v-if="total === 0">还没有 Task</span>
            <span v-for="segment in segments" :key="segment.key" class="inline-flex items-center gap-1">
                <span class="inline-block size-2 rounded-full" :style="{background: segment.color}" aria-hidden="true" />{{ segment.label }} {{ segment.count }}
            </span>
        </div>
    </div>
</template>
