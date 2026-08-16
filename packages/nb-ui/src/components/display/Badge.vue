<script setup lang="ts">
import {computed} from "vue";

// 状态徽章：用于列表、卡片、详情页的状态标注。
// tone 语义对齐 nb-ui 状态变量：neutral 中性、accent 强调/进行中、success 完成、warning 待定、danger 异常。
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";
export type BadgeVariant = "soft" | "outline" | "solid";
export type BadgeSize = "sm" | "md";

const props = withDefaults(defineProps<{
    tone?: BadgeTone;
    variant?: BadgeVariant;
    size?: BadgeSize;
    /** 在文字前渲染一个 tone 色圆点，适合“运行中/在线”这类状态 */
    dot?: boolean;
    iconClass?: string;
}>(), {
    tone: "neutral",
    variant: "soft",
    size: "md",
    dot: false,
    iconClass: "",
});

const toneClass = computed(() => `nb-badge--${props.tone}`);
const variantClass = computed(() => `nb-badge--${props.variant}`);
const sizeClass = computed(() => (props.size === "sm" ? "h-5 gap-1 px-2 text-[11px]" : "h-6 gap-1.5 px-2.5 text-xs"));
</script>

<template>
    <span class="nb-badge inline-flex shrink-0 items-center whitespace-nowrap rounded-full border font-medium" :class="[toneClass, variantClass, sizeClass]">
        <span v-if="props.dot" class="h-1.5 w-1.5 shrink-0 rounded-full bg-current"></span>
        <span v-if="props.iconClass" :class="props.iconClass" class="h-3.5 w-3.5 shrink-0"></span>
        <slot />
    </span>
</template>

<style scoped>
.nb-badge {
    --nb-badge-tone: var(--text-secondary);
}

.nb-badge--accent {
    --nb-badge-tone: var(--accent-main);
}

.nb-badge--success {
    --nb-badge-tone: var(--status-success);
}

.nb-badge--warning {
    --nb-badge-tone: var(--status-warning);
}

.nb-badge--danger {
    --nb-badge-tone: var(--status-danger);
}

.nb-badge--soft {
    border-color: transparent;
    background: color-mix(in srgb, var(--nb-badge-tone) 13%, transparent);
    color: var(--nb-badge-tone);
}

.nb-badge--outline {
    border-color: color-mix(in srgb, var(--nb-badge-tone) 45%, transparent);
    background: transparent;
    color: var(--nb-badge-tone);
}

.nb-badge--solid {
    border-color: transparent;
    background: var(--nb-badge-tone);
    color: var(--text-inverse);
}

/* neutral solid：中性色不适合做实底强调，用 hover 面色 + 主文字色 */
.nb-badge--solid.nb-badge--neutral {
    background: var(--bg-hover);
    color: var(--text-main);
}
</style>
