<script setup lang="ts">
/** 取色器（同名 .md）：触发器显示当前颜色，点开是取色面板（ColorPickerPanel）。 */
import {computed, ref} from "vue";
import {PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger} from "reka-ui";

import {useDropdownSurfaceStyle} from "../../composables/useDropdownSurfaceStyle";
import ColorPickerPanel from "./ColorPickerPanel.vue";

// 面板与下拉选择同一种浮层面（材质、阴影与层级都从这里取）；内边距按面板自己的。
const {popoverStyle} = useDropdownSurfaceStyle();

const props = withDefaults(defineProps<{
    modelValue?: string;
    defaultValue?: string;
    disabled?: boolean;
    readonly?: boolean;
    swatches?: string[];
    size?: "sm" | "md";
}>(), {
    modelValue: undefined,
    defaultValue: "#3b82f6",
    disabled: false,
    readonly: false,
    swatches: () => [
        "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b",
        "#10b981", "#06b6d4", "#64748b", "#1e293b", "#8f3f2e", "#2f5d8a",
    ],
    size: "md",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
}>();

const open = ref(false);
const currentColor = computed(() => props.modelValue ?? props.defaultValue);
</script>

<template>
    <PopoverRoot v-model:open="open">
        <PopoverTrigger as-child>
            <button
                type="button"
                class="nb-ui-control nb-ui-focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)] border bg-[var(--control-surface)] px-2 transition-colors [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40"
                :class="props.size === 'sm' ? 'nb-ui-control-h-sm text-xs' : 'nb-ui-control-h-md text-sm'"
                :disabled="props.disabled"
                data-color-picker-trigger
            >
                <span
                    class="h-4 w-4 shrink-0 rounded-[calc(var(--radius-control)*0.6)] border border-[color-mix(in_srgb,var(--text-main)_20%,transparent)]"
                    :style="{backgroundColor: currentColor}"
                    aria-hidden="true"
                />
                <span class="font-mono text-xs text-[var(--text-main)]">{{ currentColor.toLowerCase() }}</span>
            </button>
        </PopoverTrigger>

        <PopoverPortal>
            <PopoverContent
                :side-offset="6"
                :style="popoverStyle"
                class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion p-3 text-[var(--text-main)] outline-none select-none"
            >
                <ColorPickerPanel
                    :model-value="currentColor"
                    :swatches="props.swatches"
                    :disabled="props.disabled"
                    :readonly="props.readonly"
                    @update:model-value="(value: string) => emit('update:modelValue', value)"
                />
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
