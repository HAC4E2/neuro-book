<script setup lang="ts">
import {computed} from "vue";

/**
 * 分段选择器（SegmentedControl · 方案 2-A 经典 macOS 系统蓝平滑滑动体系）。
 *
 * 视觉与动效规范：
 * 1. 底座：饱满超椭圆（Squircle，消费 var(--radius-control)），10% 柔灰实底 + 1px 细微反光外框；
 * 2. 指示块：纯正 Apple 蓝（var(--accent-main)）+ 纯白反色文字 + 300ms 舒缓物理滑动动画（消费 var(--motion-base) 与 var(--ease-standard)）；
 * 3. 分隔线：未选中项之间配备 1px 细微竖向分隔线，在选中项相邻两侧智能平滑消隐；
 * 4. 支持纯单选、图标、Count 徽标与禁用态。
 */

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
    fullWidth?: boolean;
}>(), {
    ariaLabel: "",
    size: "sm",
    tone: "default",
    wrap: false,
    fullWidth: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: SegmentedControlValue): void;
}>();

function optionKey(option: SegmentedControlOption): string {
    return `${typeof option.value}:${String(option.value)}`;
}

function isSelected(option: SegmentedControlOption): boolean {
    return option.value === props.modelValue;
}

const selectedIndex = computed(() => props.options.findIndex((opt) => opt.value === props.modelValue));

function selectOption(option: SegmentedControlOption): void {
    if (option.disabled) {
        return;
    }
    emit("update:modelValue", option.value);
}
</script>

<template>
    <div
        role="group"
        :aria-label="props.ariaLabel || undefined"
        class="relative inline-flex max-w-full items-stretch rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] p-[2px] select-none box-border"
        :class="[
            props.fullWidth ? 'w-full flex' : 'inline-flex',
            props.wrap ? 'flex-wrap' : 'flex-nowrap',
        ]"
    >
        <!-- 300ms 舒缓平滑滑动背景指示块（单选且选项固定等分时连续滑动） -->
        <div
            v-if="selectedIndex >= 0 && !props.wrap"
            class="absolute top-[2px] bottom-[2px] rounded-[max(2px,calc(var(--radius-control)-2px))] bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-[0_2px_8px_color-mix(in_srgb,var(--accent-main)_38%,transparent),0_0_0_1px_color-mix(in_srgb,var(--accent-main)_30%,transparent)] pointer-events-none transition-[transform,width,background-color,color,box-shadow] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)]"
            :style="{
                width: `calc((100% - 4px) / ${props.options.length})`,
                transform: `translateX(calc(${selectedIndex} * 100%))`,
            }"
        ></div>

        <!-- 选项按钮列表 -->
        <button
            v-for="(option, idx) in props.options"
            :key="optionKey(option)"
            type="button"
            class="nb-ui-focus-ring relative z-10 flex-1 inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[max(2px,calc(var(--radius-control)-2px))] [font-weight:var(--weight-medium)] transition-colors [transition-duration:var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
            :class="[
                props.size === 'xs'
                    ? 'h-[calc(var(--control-h-sm)-var(--space-1)*2)] px-2 text-[11px]'
                    : 'h-[calc(var(--control-h-sm)-var(--space-1))] px-3 text-xs',
                isSelected(option)
                    ? 'text-[var(--text-inverse)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]',
            ]"
            :aria-pressed="isSelected(option)"
            :data-testid="option.testId"
            :disabled="option.disabled"
            :title="option.title"
            @click="selectOption(option)"
        >
            <!-- 选项间细分隔线（选中项两侧自动隐去） -->
            <span
                v-if="idx > 0 && selectedIndex !== idx && selectedIndex !== idx - 1"
                class="absolute left-0 top-1.5 bottom-1.5 w-[1px] bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] pointer-events-none"
            ></span>

            <span v-if="option.iconClass" class="h-3.5 w-3.5 shrink-0 opacity-90" :class="option.iconClass"></span>
            <span class="truncate">{{ option.label }}</span>
            <span
                v-if="option.count !== undefined"
                class="shrink-0 font-mono text-[10px] px-1.5 py-0.2 rounded-full"
                :class="isSelected(option) ? 'bg-white/20 text-white' : 'bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] text-[var(--text-muted)]'"
            >{{ option.count }}</span>
        </button>
    </div>
</template>
