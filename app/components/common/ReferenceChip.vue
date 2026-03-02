<script setup lang="ts">
import {getReferenceChipMeta} from "nbook/app/components/common/reference-chip";

const props = defineProps<{
    label: string;
    target?: string;
    targetId?: string;
    entryType?: string | null;
    status?: string | null;
    icon?: string | null;
    broken?: boolean;
    kind?: string;
}>();

/**
 * 当前引用的视觉元数据。
 */
const normalizedTarget = computed(() => props.target ?? props.targetId ?? "");
const normalizedEntryType = computed(() => props.entryType ?? props.kind ?? null);
const meta = computed(() => getReferenceChipMeta({
    target: normalizedTarget.value,
    entryType: normalizedEntryType.value,
    icon: props.icon ?? null,
    broken: props.broken ?? false,
}));
</script>

<template>
    <!-- 通用引用 chip -->
    <span
        class="nb-reference-chip"
        :class="meta.toneClass"
        :data-reference-target="normalizedTarget"
        :data-reference-entry-type="normalizedEntryType ?? ''"
        contenteditable="false"
        :title="normalizedTarget"
    >
        <span class="nb-reference-chip__icon" :class="meta.iconClass" aria-hidden="true"></span>
        <span class="nb-reference-chip__label">{{ props.label }}</span>
        <span class="nb-reference-chip__badge">{{ meta.badgeLabel }}</span>
    </span>
</template>

<style>
.nb-reference-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: min(100%, 24rem);
    margin: 0 0.1rem;
    padding: 0.04rem 0.38rem;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-radius: 0.8rem;
    background: color-mix(in srgb, currentColor 9%, var(--bg-panel));
    color: var(--text-main);
    vertical-align: baseline;
    line-height: 1.2;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 4%, transparent);
}

.nb-reference-chip__icon {
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
    opacity: 0.88;
}

.nb-reference-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.88em;
    line-height: 1.25;
    font-weight: 600;
}

.nb-reference-chip__badge {
    flex: none;
    padding: 0.02rem 0.26rem;
    border-radius: 0.6rem;
    background: color-mix(in srgb, currentColor 12%, transparent);
    font-size: 0.58rem;
    line-height: 1.1;
    letter-spacing: 0.08em;
    color: color-mix(in srgb, currentColor 78%, var(--text-main));
}

.nb-reference-chip.is-chapter {
    color: #2563eb;
}

.nb-reference-chip.is-volume {
    color: #7c3aed;
}

.nb-reference-chip.is-lorebook {
    color: #0f766e;
}

.nb-reference-chip.is-character {
    color: #0f766e;
}

.nb-reference-chip.is-location {
    color: #0891b2;
}

.nb-reference-chip.is-item {
    color: #c2410c;
}

.nb-reference-chip.is-rule {
    color: #be123c;
}

.nb-reference-chip.is-note {
    color: #6b7280;
}

.nb-reference-chip.is-plan {
    color: #4f46e5;
}

.nb-reference-chip.is-file {
    color: #475569;
}

.nb-reference-chip.is-folder {
    color: #b45309;
}

.nb-reference-chip.is-broken {
    color: #dc2626;
    text-decoration: line-through;
}

.nb-reference-chip.is-thread {
    color: #c2410c;
}

.nb-reference-chip.is-scene {
    color: #0891b2;
}

.nb-reference-chip.is-plot {
    color: #be123c;
}

.nb-reference-chip.is-pending {
    color: #6b7280;
}

.nb-inline-comment {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: min(100%, 30rem);
    margin: 0 0.1rem;
    padding: 0.08rem 0.42rem;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, currentColor 10%, var(--bg-panel));
    color: var(--text-main);
    vertical-align: baseline;
    line-height: 1.25;
    color: #7c3aed;
}

.nb-inline-comment__badge {
    flex: none;
    padding: 0.04rem 0.28rem;
    border-radius: 0.55rem;
    background: color-mix(in srgb, currentColor 12%, transparent);
    font-size: 0.58rem;
    line-height: 1.1;
    letter-spacing: 0.08em;
}

.nb-inline-comment__body {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.86em;
    font-weight: 600;
}
</style>
