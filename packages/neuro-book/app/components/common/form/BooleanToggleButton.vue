<script setup lang="ts">
const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();
</script>

<template>
    <button
        type="button"
        class="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[14px] font-semibold transition-colors"
        :class="props.modelValue
            ? 'border-[var(--accent-main)] bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-[0_0_0_2px_var(--accent-bg)]'
            : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)]'"
        @click="emit('update:modelValue', !props.modelValue)"
    >
        <span :class="props.modelValue ? 'i-lucide-circle-check h-4 w-4' : 'i-lucide-circle h-4 w-4'"></span>
        {{ props.modelValue ? "已开启" : "已关闭" }}
    </button>
</template>
