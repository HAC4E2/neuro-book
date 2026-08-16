<script setup lang="ts">
export type ButtonVariant = "primary" | "secondary" | "subtle" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const props = withDefaults(defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    block?: boolean;
    disabled?: boolean;
    loading?: boolean;
    type?: "button" | "submit" | "reset";
}>(), {
    variant: "primary",
    size: "md",
    block: false,
    disabled: false,
    loading: false,
    type: "button",
});

function variantClass(): string {
    if (props.variant === "secondary") {
        return "border-[var(--button-outline)] bg-[var(--button-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]";
    }
    if (props.variant === "subtle") {
        return "border-transparent bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]";
    }
    if (props.variant === "danger") {
        // 这里刻意用白色而非 --text-inverse：深色主题的 text-inverse 是深色，压在中饱和红底上对比不足
        return "border-transparent bg-[var(--status-danger)] text-white hover:opacity-90";
    }
    if (props.variant === "ghost") {
        return "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]";
    }
    return "border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] hover:opacity-90";
}
</script>

<template>
    <button
        :type="props.type"
        :disabled="props.disabled || props.loading"
        class="nb-ui-focus-ring inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
        :class="[
            props.size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3 text-sm',
            props.block ? 'w-full' : '',
            variantClass(),
        ]"
        :aria-busy="props.loading || undefined"
    >
        <span v-if="props.loading" class="i-lucide-loader-2 h-4 w-4 animate-spin"></span>
        <slot />
    </button>
</template>
