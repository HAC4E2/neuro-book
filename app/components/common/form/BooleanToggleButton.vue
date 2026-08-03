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
        class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors"
        :class="props.modelValue
            ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
            : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)]'"
        @click="emit('update:modelValue', !props.modelValue)"
    >
        <span :class="props.modelValue ? 'i-lucide-check h-3.5 w-3.5' : 'i-lucide-x h-3.5 w-3.5'"></span>
        {{ props.modelValue ? "已开启" : "已关闭" }}
    </button>
</template>
