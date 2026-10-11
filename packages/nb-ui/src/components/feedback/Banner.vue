<script setup lang="ts">
// 常驻横幅：区域或页面顶部一条满宽的状态带，平铺无投影；与 Notification 的区别是它不进队列、不自动消失，由宿主决定何时出现与收起。
import {computed} from "vue";

export type BannerTone = "info" | "success" | "warning" | "error";

const props = withDefaults(defineProps<{
    tone?: BannerTone;
    title?: string;
    message?: string;
    actionLabel?: string;
    dismissible?: boolean;
    closeLabel?: string;
}>(), {
    tone: "info",
    title: "",
    message: "",
    actionLabel: "",
    dismissible: false,
    closeLabel: "关闭",
});

const emit = defineEmits<{
    (e: "action"): void;
    (e: "dismiss"): void;
}>();

const toneClass = computed(() => `nb-banner--${props.tone}`);
// 错误用 alert：出现时读屏立刻播报；其余是 status，等当前朗读完再播。
const role = computed(() => (props.tone === "error" ? "alert" : "status"));
const iconClass = computed(() => {
    if (props.tone === "success") return "i-lucide-check-circle-2";
    if (props.tone === "warning") return "i-lucide-alert-triangle";
    if (props.tone === "error") return "i-lucide-circle-x";
    return "i-lucide-info";
});
</script>

<template>
    <div :role="role" class="nb-banner flex w-full items-center gap-3 border-b px-4 py-2 text-sm" :class="toneClass">
        <span class="h-4 w-4 shrink-0" :class="iconClass"></span>
        <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span v-if="$slots.title || props.title" class="font-medium text-[var(--text-main)]">
                <slot name="title">{{ props.title }}</slot>
            </span>
            <span class="min-w-0 text-[var(--text-secondary)]">
                <slot>{{ props.message }}</slot>
            </span>
        </span>
        <button v-if="$slots.action || props.actionLabel" type="button" class="nb-ui-focus-ring shrink-0 rounded-[var(--radius-control)] px-2 py-0.5 text-sm font-medium text-[var(--nb-banner-tone)] hover:bg-[color-mix(in_srgb,var(--nb-banner-tone)_12%,transparent)] cursor-pointer" @click="emit('action')">
            <slot name="action">{{ props.actionLabel }}</slot>
        </button>
        <button v-if="props.dismissible" type="button" class="nb-ui-focus-ring -mr-1 shrink-0 rounded-[calc(var(--radius-control)*0.75)] p-0.5 text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:text-[var(--text-main)] cursor-pointer" :aria-label="props.closeLabel" :title="props.closeLabel" @click="emit('dismiss')">
            <span class="i-lucide-x h-4 w-4"></span>
        </button>
    </div>
</template>

<style scoped>
.nb-banner {
    --nb-banner-tone: var(--accent-main);
    border-color: color-mix(in srgb, var(--nb-banner-tone) 25%, transparent);
    background: color-mix(in srgb, var(--nb-banner-tone) 9%, var(--bg-panel));
    color: var(--text-main);
}

.nb-banner--success {
    --nb-banner-tone: var(--status-success);
}

.nb-banner--warning {
    --nb-banner-tone: var(--status-warning);
}

.nb-banner--error {
    --nb-banner-tone: var(--status-danger);
}
</style>
