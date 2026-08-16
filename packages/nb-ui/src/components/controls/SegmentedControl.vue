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
        if (optionTone(option) === "warning") {
            return "bg-[var(--bg-panel)] text-[var(--status-warning)] shadow-xs";
        }
        if (optionTone(option) === "accent") {
            return "bg-[var(--bg-panel)] text-[var(--accent-main)] shadow-xs";
        }
        return "bg-[var(--bg-panel)] text-[var(--text-main)] shadow-xs";
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
    <div role="group" :aria-label="props.ariaLabel || undefined" class="inline-flex max-w-full rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-subtle)] p-0.5" :class="props.wrap ? 'flex-wrap' : 'flex-nowrap'">
        <!--
            段的圆角由外框推出来，不取控件档：选中段是**贴着**外框四角的（内边距只有 p-0.5=2px），
            两个圆角不同心时，外框与段之间那圈 2px 的缝在直边上是 2px、到角上会被挤到几乎看不见，
            看起来就像段"顶破"了外框。判据与完整推导见 docs/design-language.md 的同心圆角一节。
            max() 兜底：主题若把 --radius-control 调到比 border+padding 还小，负值会让整条声明作废（变方角）。
        -->
        <button
            v-for="option in props.options"
            :key="optionKey(option)"
            type="button"
            class="nb-ui-focus-ring inline-flex min-w-0 items-center justify-center gap-1 rounded-[max(2px,calc(var(--radius-control)_-_var(--border-w)_-_2px))] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            :class="[props.size === 'xs' ? 'h-6 px-2 text-[11px]' : 'h-7 px-3 text-xs', buttonClass(option)]"
            :aria-pressed="isSelected(option)"
            :data-testid="option.testId"
            :disabled="option.disabled"
            :title="option.title"
            @click="selectOption(option)"
        >
            <span v-if="option.iconClass" class="h-3.5 w-3.5 shrink-0" :class="option.iconClass"></span>
            <span class="truncate">{{ option.label }}</span>
            <span v-if="option.count !== undefined" class="shrink-0 font-mono text-[10px] opacity-80">{{ option.count }}</span>
        </button>
    </div>
</template>
