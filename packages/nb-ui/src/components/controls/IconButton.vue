<script setup lang="ts">
export type IconButtonVariant = "default" | "danger" | "accent";
export type IconButtonSize = "sm" | "md";

const props = withDefaults(defineProps<{
    title?: string;
    ariaLabel?: string;
    variant?: IconButtonVariant;
    size?: IconButtonSize;
    disabled?: boolean;
}>(), {
    title: "",
    ariaLabel: "",
    variant: "default",
    size: "md",
    disabled: false,
});
</script>

<template>
    <!-- 通用紧凑图标按钮 -->
    <button
        type="button"
        :title="props.title"
        :aria-label="props.ariaLabel || props.title"
        :disabled="props.disabled"
        class="nb-ui-focus-ring inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[color:transparent] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] disabled:cursor-not-allowed disabled:opacity-45"
        :class="[
            props.size === 'sm' ? 'h-[var(--control-h-sm)] w-[var(--control-h-sm)]' : 'h-[var(--control-h-md)] w-[var(--control-h-md)]',
            props.variant === 'danger'
                ? 'text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] hover:text-[var(--status-danger)]'
                : props.variant === 'accent'
                    ? 'text-[var(--accent-text)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent-main)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
        ]"
    >
        <slot />
    </button>
</template>
