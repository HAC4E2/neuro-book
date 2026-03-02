<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import type { DropdownItem } from "nbook/app/components/common/dropdown.types";

const props = withDefaults(defineProps<{
    items: DropdownItem[];
    menuClass?: string;
}>(), {
    menuClass: "left-0 top-full mt-2 min-w-full",
});

const emit = defineEmits<{
    (e: "select", value: string): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);

/**
 * 切换菜单显示状态。
 */
const toggle = (): void => {
    open.value = !open.value;
};

/**
 * 选中菜单项。
 */
const select = (value: string): void => {
    emit("select", value);
    open.value = false;
};

onClickOutside(rootRef, () => {
    open.value = false;
});
</script>

<template>
    <!-- 下拉菜单容器 -->
    <div ref="rootRef" class="relative w-full">
        <div class="w-full" @click.stop="toggle">
            <slot />
        </div>

        <div
            v-if="open"
            class="absolute z-[60] rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-1 shadow-xl backdrop-blur-sm"
            :class="menuClass"
        >
            <button
                v-for="item in props.items"
                :key="item.value"
                class="mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors last:mb-0"
                :class="item.active ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                @click.stop="select(item.value)"
            >
                <span class="inline-flex items-center gap-2">
                    <span v-if="item.iconClass" :class="item.iconClass" class="h-4 w-4 text-[var(--text-muted)]"></span>
                    <span>{{ item.label }}</span>
                </span>
                <span v-if="item.rightIconClass" :class="item.rightIconClass" class="h-4 w-4 text-[var(--accent-text)]"></span>
            </button>
        </div>
    </div>
</template>
