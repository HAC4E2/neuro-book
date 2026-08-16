<script setup lang="ts">
import {computed} from "vue";

// 行内加载指示器：按钮外的局部加载态（面板、表格、页面区块）。
export type SpinnerSize = "sm" | "md" | "lg";

const props = withDefaults(defineProps<{
    size?: SpinnerSize;
    /** 无障碍名称；showLabel 为 true 时同时作为可见文字 */
    label?: string;
    showLabel?: boolean;
}>(), {
    size: "md",
    label: "加载中",
    showLabel: false,
});

const iconSizeClass = computed(() => {
    if (props.size === "sm") {
        return "h-3.5 w-3.5";
    }
    if (props.size === "lg") {
        return "h-6 w-6";
    }
    return "h-4 w-4";
});
</script>

<template>
    <span role="status" :aria-label="props.label" class="inline-flex items-center gap-2 text-[var(--text-muted)]">
        <span class="i-lucide-loader-2 shrink-0 animate-spin" :class="iconSizeClass"></span>
        <span v-if="props.showLabel" class="text-sm">{{ props.label }}</span>
    </span>
</template>
