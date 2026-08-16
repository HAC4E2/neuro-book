<script setup lang="ts">
import {computed, nextTick, ref} from "vue";

// 线性标签页（仅标签栏，内容面板由消费方渲染）。
// 与 SegmentedControl 的分工：Tabs 用于页面/区块级导航（底部指示线），SegmentedControl 用于紧凑的互斥模式切换。
export type TabsItem = {
    value: string;
    label: string;
    iconClass?: string;
    count?: number | string;
    disabled?: boolean;
};
export type TabsSize = "sm" | "md";

const props = withDefaults(defineProps<{
    modelValue: string;
    items: TabsItem[];
    ariaLabel?: string;
    size?: TabsSize;
}>(), {
    ariaLabel: "",
    size: "md",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
}>();

const tablistRef = ref<HTMLDivElement | null>(null);

const enabledItems = computed(() => props.items.filter((item) => !item.disabled));

function isSelected(item: TabsItem): boolean {
    return item.value === props.modelValue;
}

function select(item: TabsItem): void {
    if (item.disabled) {
        return;
    }
    emit("update:modelValue", item.value);
}

/** 方向键/Home/End 在启用的标签间移动选中项，并把焦点跟到新标签上 */
function handleKeydown(event: KeyboardEvent): void {
    const enabled = enabledItems.value;
    if (enabled.length === 0) {
        return;
    }
    const currentIndex = Math.max(0, enabled.findIndex((item) => item.value === props.modelValue));
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % enabled.length;
    } else if (event.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
    } else if (event.key === "Home") {
        nextIndex = 0;
    } else if (event.key === "End") {
        nextIndex = enabled.length - 1;
    }
    if (nextIndex === null) {
        return;
    }
    event.preventDefault();
    const nextItem = enabled[nextIndex];
    if (!nextItem) {
        return;
    }
    emit("update:modelValue", nextItem.value);
    void nextTick(() => {
        const tabs = Array.from(tablistRef.value?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? []);
        tabs.find((tab) => tab.dataset.tabValue === nextItem.value)?.focus();
    });
}

function tabClass(item: TabsItem): string {
    if (isSelected(item)) {
        return "border-[var(--accent-main)] text-[var(--text-main)]";
    }
    return "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]";
}
</script>

<template>
    <!-- 标签栏：底边线 + 选中项指示线 -->
    <div ref="tablistRef" role="tablist" :aria-label="props.ariaLabel || undefined" class="flex items-end gap-1 overflow-x-auto border-b border-[var(--border-color)]" @keydown="handleKeydown">
        <button
            v-for="item in props.items"
            :key="item.value"
            type="button"
            role="tab"
            :data-tab-value="item.value"
            :aria-selected="isSelected(item)"
            :tabindex="isSelected(item) ? 0 : -1"
            :disabled="item.disabled"
            class="nb-ui-focus-ring -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            :class="[props.size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm', tabClass(item)]"
            @click="select(item)"
        >
            <span v-if="item.iconClass" :class="item.iconClass" class="h-4 w-4 shrink-0"></span>
            <span>{{ item.label }}</span>
            <span v-if="item.count !== undefined" class="rounded-full bg-[var(--bg-subtle)] px-1.5 font-mono text-[10px] leading-4 text-[var(--text-muted)]">{{ item.count }}</span>
        </button>
    </div>
</template>
