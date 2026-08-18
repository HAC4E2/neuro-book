<script setup lang="ts">
export type SegmentedControlValue = string | number | boolean | null;
export type SegmentedControlSize = "xs" | "sm";
export type SegmentedControlTone = "default" | "accent" | "warning";
export type SegmentedControlOption = {
    count?: number | string;
    disabled?: boolean;
    iconClass?: string;
    label: string;
    testId?: string;
    title?: string;
    tone?: SegmentedControlTone;
    value: SegmentedControlValue;
};

const props = withDefaults(defineProps<{
    modelValue: SegmentedControlValue;
    options: SegmentedControlOption[];
    ariaLabel?: string;
    size?: SegmentedControlSize;
    tone?: SegmentedControlTone;
    wrap?: boolean;
}>(), {
    ariaLabel: "",
    size: "sm",
    tone: "default",
    wrap: true,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: SegmentedControlValue): void;
}>();

function optionKey(option: SegmentedControlOption): string {
    return `${typeof option.value}:${String(option.value)}`;
}

function optionTone(option: SegmentedControlOption): SegmentedControlTone {
    return option.tone ?? props.tone;
}

function isSelected(option: SegmentedControlOption): boolean {
    return option.value === props.modelValue;
}

function buttonClass(option: SegmentedControlOption): string {
    if (isSelected(option)) {
        // 选中段：面板色 + 渐变抬起 + 阴影（对照页 sc-seg 配方）
        const surface = "bg-[var(--bg-panel)] bg-[image:var(--surface-raise)] shadow-[var(--elevation-raised)]";
        if (optionTone(option) === "warning") {
            return `${surface} text-[var(--status-warning)]`;
        }
        if (optionTone(option) === "accent") {
            return `${surface} text-[var(--accent-main)]`;
        }
        return `${surface} text-[var(--text-main)]`;
    }
    return "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]";
}

function selectOption(option: SegmentedControlOption): void {
    if (option.disabled) {
        return;
    }
    emit("update:modelValue", option.value);
}
</script>

<template>
    <!-- 互斥的紧凑模式切换控件 -->
    <div role="group" :aria-label="props.ariaLabel || undefined" class="inline-flex max-w-full gap-[var(--space-1)] rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[color:var(--control-outline)] bg-[var(--bg-subtle)] p-[var(--space-1)]" :class="props.wrap ? 'flex-wrap' : 'flex-nowrap'">
        <!--
            段的圆角由外框推出来，不取控件档：选中段贴着外框内缘，
            两个圆角不同心时缝在直边和角上不一致，看起来像段"顶破"了外框。
            判据与完整推导见 docs/design-language.md 的同心圆角一节。
            max() 兜底：主题若把 --radius-control 调到比 padding 还小，负值会让整条声明作废（变方角）。
        -->
        <button
            v-for="option in props.options"
            :key="optionKey(option)"
            type="button"
            class="nb-ui-focus-ring inline-flex min-w-0 items-center justify-center gap-[var(--space-2)] rounded-[max(2px,calc(var(--radius-control)-var(--space-1)))] [font-weight:var(--weight-medium)] transition-colors [transition-duration:var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-45"
            :class="[props.size === 'xs' ? 'h-[calc(var(--control-h-sm)-var(--space-1)*3)] px-[calc(var(--control-px)*0.6)] text-[var(--text-2xs)]' : 'h-[calc(var(--control-h-sm)-var(--space-1)*2)] px-[calc(var(--control-px)*0.8)] text-[var(--text-xs)]', buttonClass(option)]"
            :aria-pressed="isSelected(option)"
            :data-testid="option.testId"
            :disabled="option.disabled"
            :title="option.title"
            @click="selectOption(option)"
        >
            <span v-if="option.iconClass" class="h-[1.2em] w-[1.2em] shrink-0" :class="option.iconClass"></span>
            <span class="truncate">{{ option.label }}</span>
            <span v-if="option.count !== undefined" class="shrink-0 font-mono text-[var(--text-2xs)] opacity-80">{{ option.count }}</span>
        </button>
    </div>
</template>
