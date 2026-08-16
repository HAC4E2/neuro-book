<script setup lang="ts">
const props = withDefaults(defineProps<{
    modelValue: boolean;
    label: string;
    description?: string;
    disabled?: boolean;
}>(), {
    description: "",
    disabled: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();
</script>

<template>
    <!-- 紧凑开关字段 -->
    <button type="button" role="switch" class="nb-ui-focus-ring flex w-full items-center justify-between gap-4 rounded-[var(--radius-control)] border border-[var(--control-outline)] bg-[var(--control-surface)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-55" :disabled="props.disabled" :aria-checked="props.modelValue" @click="emit('update:modelValue', !props.modelValue)">
        <span class="min-w-0">
            <span class="block text-sm text-[var(--text-main)]">{{ props.label }}</span>
            <span v-if="props.description" class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ props.description }}</span>
        </span>
        <span class="relative h-5 w-9 shrink-0 rounded-full border transition-colors" :class="props.modelValue ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-strong)] bg-[var(--bg-subtle)]'">
            <!-- 圆球刻意用白色：在全部主题的 accent/subtle 轨道底色上都成立，--text-inverse 在深色主题会变成深球不可辨 -->
            <span class="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform" :class="props.modelValue ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
        </span>
    </button>
</template>
