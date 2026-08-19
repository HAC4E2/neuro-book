<script setup lang="ts">
import {computed} from "vue";
import {useFormFieldContext} from "./form-field-context";

export type FormInputType = "text" | "search" | "password" | "number";

const props = withDefaults(defineProps<{
    modelValue: string;
    id?: string;
    name?: string;
    type?: FormInputType;
    placeholder?: string;
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
    id: "",
    name: "",
    type: "text",
    placeholder: "",
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
// prefix 分支判定用模板里的 $slots.prefix，不用 computed 包 slots——
// useSlots() 不是响应式源，computed 会把「挂载后才出现的条件插槽」缓存成 false（e2e 实测：
// /lab 切到 prefix 场景后前缀永远不渲染）。模板里每次渲染重读 $slots 才对。

// prefix 与裸 input 两个分支共享同一份属性绑定，写两遍必漂移
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
        class="nb-ui-control nb-ui-control-h-md nb-ui-control-px flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-sm)] text-[var(--text-main)] transition-colors focus-within:outline-none"
        :class="field?.invalid.value ? 'nb-ui-control-invalid' : ''"
    >
        <slot name="prefix"></slot>
        <input
            v-bind="inputAttrs"
            class="min-w-0 flex-1 bg-transparent text-[var(--text-sm)] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            @focus="emit('focus', $event)"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        >
    </div>
    <input
        v-else
        v-bind="inputAttrs"
        class="nb-ui-control nb-ui-control-h-md nb-ui-control-px w-full rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-sm)] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
        :class="field?.invalid.value ? 'nb-ui-control-invalid' : ''"
        @focus="emit('focus', $event)"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
</template>
