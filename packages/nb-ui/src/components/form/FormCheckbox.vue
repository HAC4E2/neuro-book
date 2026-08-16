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
const displayLabel = computed(() => props.label || (props.modelValue ? "true" : "false"));
</script>

<template>
    <component :is="field ? 'div' : 'label'" class="inline-flex items-center gap-2 text-sm text-[var(--text-main)]" :class="props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
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
        <span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border bg-[var(--control-surface)] text-transparent transition-colors peer-checked:border-[var(--accent-main)] peer-checked:bg-[var(--accent-main)] peer-checked:text-[var(--text-inverse)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent-main)]" :class="field?.invalid.value ? 'border-[var(--status-danger)]' : 'border-[var(--control-outline)]'">
            <span class="i-lucide-check h-2.5 w-2.5" aria-hidden="true"></span>
        </span>
        <span>{{ displayLabel }}</span>
    </component>
</template>
