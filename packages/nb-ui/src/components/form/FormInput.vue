<script setup lang="ts">
import {computed} from "vue";
import {useFormFieldContext} from "./form-field-context";

export type FormInputType = "text" | "search" | "password" | "number";
export type FormInputSize = "default" | "sm" | "md";

const props = withDefaults(defineProps<{
    modelValue?: string;
    id?: string;
    name?: string;
    type?: FormInputType;
    placeholder?: string;
    size?: FormInputSize;
    disabled?: boolean;
    readonly?: boolean;
    required?: boolean;
    autofocus?: boolean;
    autocomplete?: string;
    inputmode?: "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
    minlength?: number;
    maxlength?: number;
    step?: string;
    min?: string;
    max?: string;
}>(), {
    modelValue: "",
    id: "",
    name: "",
    type: "text",
    placeholder: "",
    size: "default",
    disabled: false,
    readonly: false,
    required: false,
    autofocus: false,
    autocomplete: "",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const field = useFormFieldContext();

const isSmall = computed(() => props.size === "sm");
const controlSizeClass = computed(() => isSmall.value
    ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[var(--text-xs)]"
    : "nb-ui-control-h-md nb-ui-control-px text-[var(--text-sm)]");

// prefix 与裸 input 两个分支共享同一份属性绑定，排除组件层 size prop 避免原生 HTMLInputElement size 属性类型冲突
const inputAttrs = computed(() => ({
    value: props.modelValue,
    id: props.id || field?.inputId.value || undefined,
    name: props.name || undefined,
    type: props.type,
    placeholder: props.placeholder,
    disabled: props.disabled,
    readonly: props.readonly,
    required: props.required || field?.required.value,
    autofocus: props.autofocus,
    autocomplete: props.autocomplete || undefined,
    inputmode: props.inputmode,
    minlength: props.minlength,
    maxlength: props.maxlength,
    step: props.step,
    min: props.min,
    max: props.max,
    "aria-describedby": field?.ariaDescribedby.value,
    "aria-invalid": field?.invalid.value || undefined,
}));
</script>

<template>
    <div
        v-if="$slots.prefix"
        class="nb-ui-control flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] focus-within:outline-none"
        :class="[controlSizeClass, field?.invalid.value ? 'nb-ui-control-invalid' : '']"
    >
        <slot name="prefix"></slot>
        <input
            v-bind="inputAttrs"
            class="min-w-0 flex-1 bg-transparent text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            @focus="emit('focus', $event)"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        >
    </div>
    <input
        v-else
        v-bind="inputAttrs"
        class="nb-ui-control w-full rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
        :class="[controlSizeClass, field?.invalid.value ? 'nb-ui-control-invalid' : '']"
        @focus="emit('focus', $event)"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
</template>
