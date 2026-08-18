<script setup lang="ts">
import {computed} from "vue";
import {useFormFieldContext} from "./form-field-context";

const props = withDefaults(defineProps<{
    modelValue: boolean;
    label?: string;
    id?: string;
    name?: string;
    disabled?: boolean;
    required?: boolean;
}>(), {
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
// 无 label 时回退显示当前布尔值，保留语义的同时让值可见
const displayLabel = computed(() => props.label || (props.modelValue ? "true" : "false"));
</script>

<template>
    <label class="inline-flex items-center gap-[var(--space-2)] text-[var(--text-sm)] text-[var(--text-main)]" :class="props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
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
        <span class="inline-flex h-[calc(var(--control-h-sm)*0.5)] w-[calc(var(--control-h-sm)*0.5)] shrink-0 items-center justify-center rounded-[calc(var(--radius-control)*0.6)] border-[length:var(--border-w)] bg-[var(--control-surface)] text-transparent transition-colors peer-checked:border-[color:var(--accent-main)] peer-checked:bg-[var(--accent-main)] peer-checked:text-[var(--text-inverse)] peer-focus-visible:border-[color:var(--focus-outline)] peer-focus-visible:shadow-[var(--focus-ring)]" :class="field?.invalid.value ? 'border-[color:var(--status-danger)]' : 'border-[color:var(--control-outline)]'">
            <span class="i-lucide-check h-[0.9em] w-[0.9em]" aria-hidden="true"></span>
        </span>
        <span>{{ displayLabel }}</span>
    </label>
</template>
