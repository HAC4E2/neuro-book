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
    <!-- 紧凑开关字段；轨道/滑球尺寸从 --control-h-sm 推导（对照页 sc-switch 配方） -->
    <button type="button" role="switch" class="nb-ui-focus-ring flex w-full items-center justify-between gap-[var(--space-4)] rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[color:var(--control-outline)] bg-[var(--control-surface)] px-[var(--control-px)] py-[var(--space-2)] text-left transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-55" :disabled="props.disabled" :aria-checked="props.modelValue" @click="emit('update:modelValue', !props.modelValue)">
        <span class="min-w-0">
            <span class="block text-[var(--text-sm)] text-[var(--text-main)]">{{ props.label }}</span>
            <span v-if="props.description" class="mt-0.5 block text-[var(--text-xs)] text-[var(--text-muted)]">{{ props.description }}</span>
        </span>
        <span class="relative h-[calc(var(--control-h-sm)*0.64)] w-[calc(var(--control-h-sm)*1.6)] shrink-0 rounded-[var(--radius-pill)] border-[length:var(--border-w)] transition-colors [transition-duration:var(--motion-base)]" :class="props.modelValue ? 'border-[color:var(--accent-main)] bg-[var(--accent-main)]' : 'border-[color:var(--control-outline)] bg-[var(--bg-subtle)]'">
            <span
                class="absolute top-1/2 h-[calc(var(--control-h-sm)*0.64-var(--space-2)-var(--border-w)*2)] w-[calc(var(--control-h-sm)*0.64-var(--space-2)-var(--border-w)*2)] -translate-y-1/2 rounded-[var(--radius-pill)] bg-[var(--bg-panel)] shadow-[var(--elevation-raised)] transition-[left] [transition-duration:var(--motion-base)]"
                :style="{left: props.modelValue ? 'calc(100% - var(--control-h-sm)*0.64 + var(--space-1) + var(--border-w))' : 'var(--space-1)'}"
            ></span>
        </span>
    </button>
</template>
