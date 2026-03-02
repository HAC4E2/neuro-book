<script setup lang="ts">
const props = withDefaults(defineProps<{
    modelValue: string;
    type?: "text" | "search" | "password" | "number";
    placeholder?: string;
    readonly?: boolean;
}>(), {
    type: "text",
    placeholder: "",
    readonly: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();
</script>

<template>
    <!-- 通用紧凑输入框 -->
    <input
        :value="props.modelValue"
        :type="props.type"
        :placeholder="props.placeholder"
        :readonly="props.readonly"
        class="h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:opacity-80 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"
        :class="props.readonly ? 'cursor-default opacity-80' : ''"
        @focus="emit('focus', $event)"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
</template>
