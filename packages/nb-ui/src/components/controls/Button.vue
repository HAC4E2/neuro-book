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

/*
 * 尺寸与材质全部消费主题 token（与对照页 sc-btn 同一配方）：
 * 高度/内边距走 styles.css 的注册基座（主题密度的静态消费点），
 * min-width 是成组按钮的规矩——2 字与 3 字标签并排时宽度一致，整排才整齐。
 * 字面 px 不进模板：主题改密度时按钮跟着走。
 */
function sizeClass(): string {
    if (props.size === "sm") {
        return "nb-ui-control-h-sm min-w-[calc(var(--control-h-sm)*2.1)] px-[calc(var(--control-px)*0.75)] text-[var(--text-xs)]";
    }
    return "nb-ui-control-h-md nb-ui-control-px min-w-[calc(var(--control-h-md)*2.1)] text-[var(--text-sm)]";
}

function variantClass(): string {
    if (props.variant === "secondary") {
        return "border-[color:var(--button-outline)] bg-[var(--button-surface)] bg-[image:var(--surface-raise)] text-[var(--text-main)] shadow-[var(--elevation-raised)] hover:bg-[var(--bg-hover)]";
    }
    if (props.variant === "subtle") {
        return "border-[color:transparent] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]";
    }
    if (props.variant === "danger") {
        return "border-[color:var(--status-danger)] bg-[var(--status-danger)] text-[var(--text-inverse)] shadow-[var(--elevation-raised)] hover:bg-[color-mix(in_srgb,var(--status-danger)_86%,var(--text-main))]";
    }
    if (props.variant === "ghost") {
        return "border-[color:transparent] bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]";
    }
    return "border-[color:var(--accent-main)] bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-[var(--elevation-raised)] hover:bg-[color-mix(in_srgb,var(--accent-main)_86%,var(--text-main))]";
}
</script>

<template>
    <button
        :type="props.type"
        :disabled="props.disabled || props.loading"
        class="nb-ui-focus-ring inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-control)] border-[length:var(--border-w)] [font-weight:var(--weight-medium)] [letter-spacing:var(--tracking-ui)] whitespace-nowrap transition-[background-color,border-color,transform,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] active:[transform:var(--glass-lift)] disabled:cursor-not-allowed disabled:opacity-45"
        :class="[
            sizeClass(),
            props.block ? 'w-full' : '',
            variantClass(),
        ]"
        :aria-busy="props.loading || undefined"
    >
        <span v-if="props.loading" class="i-lucide-loader-2 h-[1em] w-[1em] animate-spin"></span>
        <slot />
    </button>
</template>
