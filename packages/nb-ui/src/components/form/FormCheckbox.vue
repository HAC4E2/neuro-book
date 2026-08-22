<script setup lang="ts">
import {computed} from "vue";
import {useFormFieldContext} from "./form-field-context";

/**
 * 复选框（FormCheckbox · 饱满超椭圆 Squircle 规范）。
 *
 * 视觉特征：
 * 1. 形态：18px × 18px 饱满超椭圆（rounded-[5px] / Squircle），与全站控件几何律动对齐；
 * 2. 未选中态：柔和深灰实底（14% 实底 + 16% 微边框）；
 * 3. 选中态：纯正 Apple 蓝底（var(--accent-main)）+ 纯白反色对勾 [✓]；
 * 4. 支持插槽自定义内容，无插槽/无 label 时回退布尔值状态。
 */

const props = withDefaults(defineProps<{
    modelValue?: boolean;
    label?: string;
    id?: string;
    name?: string;
    disabled?: boolean;
    required?: boolean;
}>(), {
    modelValue: false,
    label: "",
    id: "",
    name: "",
    disabled: false,
    required: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "focus", event: FocusEvent): void;
}>();

const field = useFormFieldContext();
const displayLabel = computed(() => props.label || (props.modelValue ? "true" : "false"));
</script>

<template>
    <label
        class="inline-flex items-center gap-[var(--space-2-5,0.625rem)] text-[var(--text-sm)] text-[var(--text-main)] select-none transition-opacity"
        :class="props.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'"
    >
        <input
            type="checkbox"
            :id="props.id || field?.inputId.value || undefined"
            :name="props.name || undefined"
            :checked="props.modelValue"
            :disabled="props.disabled"
            :required="props.required || field?.required.value"
            :aria-describedby="field?.ariaDescribedby.value"
            :aria-invalid="field?.invalid.value || undefined"
            class="peer sr-only"
            @focus="emit('focus', $event)"
            @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
        >
        <span
            class="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[length:var(--border-w)] bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] text-transparent transition-[background-color,border-color,color,box-shadow] [transition-duration:var(--motion-fast)] peer-checked:border-[color:var(--accent-main)] peer-checked:bg-[var(--accent-main)] peer-checked:text-[var(--text-inverse)] peer-focus-visible:border-[color:var(--focus-outline)] peer-focus-visible:shadow-[var(--focus-ring)]"
            :class="field?.invalid.value ? 'border-[color:var(--status-danger)]' : ''"
        >
            <span class="i-lucide-check h-3.5 w-3.5" aria-hidden="true"></span>
        </span>
        <span class="inline-flex flex-col"><slot>{{ displayLabel }}</slot></span>
    </label>
</template>
