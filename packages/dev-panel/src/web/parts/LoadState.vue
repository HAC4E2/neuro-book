<script setup lang="ts">
import {Button, Spinner} from "@notnotype/nb-ui/components";

withDefaults(defineProps<{
    loading: boolean;
    error?: {message: string} | null;
    label?: string;
    retryable?: boolean;
}>(), {
    error: null,
    label: "正在读取",
    retryable: true,
});

defineEmits<{retry: []}>();
</script>

<template>
    <div v-if="error" role="alert" class="flex min-h-40 w-full flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
        <span class="i-lucide-circle-alert size-6" style="color: var(--status-danger)" aria-hidden="true" />
        <p class="max-w-md" style="color: var(--text-secondary)">{{ error.message }}</p>
        <Button v-if="retryable" variant="secondary" size="sm" icon-class="i-lucide-rotate-cw" @click="$emit('retry')">重试</Button>
    </div>
    <div v-else-if="loading" role="status" aria-busy="true" aria-live="polite" class="flex min-h-40 w-full flex-1 flex-col items-center justify-center gap-3 px-4 py-8">
        <Spinner :label="label" />
        <p style="color: var(--text-secondary)">{{ label }}</p>
    </div>
</template>
