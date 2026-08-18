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
// 尺寸从控件高度 token 推导（对照页 sc-badge 配方），主题改密度时徽章跟着走
const sizeClass = computed(() => (props.size === "sm"
    ? "h-[calc(var(--control-h-sm)*0.6)] gap-[var(--space-1)] px-[calc(var(--control-px)*0.45)] text-[var(--text-2xs)]"
    : "h-[calc(var(--control-h-sm)*0.72)] gap-[var(--space-2)] px-[calc(var(--control-px)*0.6)] text-[var(--text-2xs)]"));
</script>

<template>
    <span class="nb-badge inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--radius-pill)] border-[length:var(--border-w)] [font-weight:var(--weight-medium)]" :class="[toneClass, variantClass, sizeClass]">
        <span v-if="props.dot" class="h-[var(--space-2)] w-[var(--space-2)] shrink-0 rounded-[var(--radius-pill)] bg-current"></span>
        <span v-if="props.iconClass" :class="props.iconClass" class="h-[1.2em] w-[1.2em] shrink-0"></span>
        <slot />
    </span>
</template>

<style scoped>
/* 色调 = 状态三件套（主色/底色/边框色）的角色映射，与对照页 sc-badge 同源 */
.nb-badge {
    --nb-badge-tone: var(--text-secondary);
    --nb-badge-tone-bg: var(--bg-subtle);
    --nb-badge-tone-border: var(--border-color);
}

.nb-badge--accent {
    --nb-badge-tone: var(--accent-main);
    --nb-badge-tone-bg: var(--accent-bg);
    --nb-badge-tone-border: var(--border-accent);
}

.nb-badge--success {
    --nb-badge-tone: var(--status-success);
    --nb-badge-tone-bg: var(--status-success-bg);
    --nb-badge-tone-border: var(--status-success-border);
}

.nb-badge--warning {
    --nb-badge-tone: var(--status-warning);
    --nb-badge-tone-bg: var(--status-warning-bg);
    --nb-badge-tone-border: var(--status-warning-border);
}

.nb-badge--danger {
    --nb-badge-tone: var(--status-danger);
    --nb-badge-tone-bg: var(--status-danger-bg);
    --nb-badge-tone-border: var(--status-danger-border);
}

.nb-badge--soft {
    border-color: var(--nb-badge-tone-border);
    background: var(--nb-badge-tone-bg);
    color: var(--nb-badge-tone);
}

.nb-badge--outline {
    border-color: var(--nb-badge-tone-border);
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
