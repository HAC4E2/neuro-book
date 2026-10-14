<script setup lang="ts">
/** fill 设置页的二级列表（同名 .md）：受控单选，选中样式与设置窗口的分区导航区分开（settings-window.md 输出 19）。 */
import {computed, ref} from "vue";

export interface SettingsPageListItem {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly icon?: string;
    readonly disabledReason?: string;
}

defineOptions({name: "SettingsPageList"});

const props = defineProps<{
    items: ReadonlyArray<SettingsPageListItem>;
    modelValue: string | null;
    label: string;
}>();

const emit = defineEmits<{
    (event: "update:modelValue", id: string): void;
}>();

defineSlots<{
    end?(props: {item: SettingsPageListItem; selected: boolean}): unknown;
}>();

const root = ref<HTMLElement | null>(null);
const enabled = computed(() => props.items.filter((item) => item.disabledReason === undefined));
/** 唯一的 Tab 停靠点：选中项，没有选中（或选中项停用）时第一条可用的。 */
const stop = computed(() => enabled.value.find((item) => item.id === props.modelValue)?.id ?? enabled.value[0]?.id ?? null);

function pick(item: SettingsPageListItem): void {
    if (item.disabledReason !== undefined || item.id === props.modelValue) return;
    emit("update:modelValue", item.id);
}

function onKeydown(event: KeyboardEvent): void {
    const list = enabled.value;
    if (list.length === 0) return;
    const at = list.findIndex((item) => item.id === stop.value);
    const target = event.key === "ArrowDown" ? list[Math.min(at + 1, list.length - 1)]
        : event.key === "ArrowUp" ? list[Math.max(at - 1, 0)]
            : event.key === "Home" ? list[0]
                : event.key === "End" ? list[list.length - 1]
                    : undefined;
    if (target === undefined) return;
    event.preventDefault();
    pick(target);
    root.value?.querySelector<HTMLElement>(`[data-settings-page-list-item="${CSS.escape(target.id)}"]`)?.focus();
}
</script>

<template>
    <div ref="root" class="settings-page-list" role="listbox" :aria-label="label" @keydown="onKeydown">
        <div
            v-for="item in items"
            :key="item.id"
            class="settings-page-list__item nb-ui-focus-ring"
            :class="{'settings-page-list__item--selected': item.id === modelValue, 'settings-page-list__item--disabled': item.disabledReason !== undefined}"
            role="option"
            :aria-selected="item.id === modelValue"
            :aria-disabled="item.disabledReason === undefined ? undefined : 'true'"
            :tabindex="item.id === stop ? 0 : -1"
            :title="item.disabledReason"
            :data-settings-page-list-item="item.id"
            @click="pick(item)"
        >
            <span v-if="item.icon !== undefined" class="settings-page-list__icon" :class="item.icon" aria-hidden="true"></span>
            <span class="settings-page-list__text">
                <span class="settings-page-list__title">{{ item.title }}</span>
                <span v-if="item.description !== undefined" class="settings-page-list__description">{{ item.description }}</span>
            </span>
            <slot name="end" :item="item" :selected="item.id === modelValue" />
        </div>
    </div>
</template>

<style scoped>
.settings-page-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
}

.settings-page-list__item {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: var(--border-w) solid transparent;
    border-radius: var(--radius-control);
    color: var(--text-main);
    cursor: pointer;
    outline: none;
    transition-property: background-color, border-color, color;
    transition-duration: var(--motion-fast);
    transition-timing-function: var(--ease-standard);
}

.settings-page-list__item:hover {
    background: var(--bg-hover);
}

.settings-page-list__item--selected,
.settings-page-list__item--selected:hover {
    border-color: var(--border-accent);
    background: var(--accent-bg);
    color: var(--accent-text);
}

.settings-page-list__item--disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.settings-page-list__item--disabled:hover {
    background: transparent;
}

.settings-page-list__icon {
    width: var(--text-md);
    height: var(--text-md);
    flex-shrink: 0;
    color: var(--text-secondary);
}

.settings-page-list__item--selected .settings-page-list__icon {
    color: var(--accent-text);
}

.settings-page-list__text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
}

.settings-page-list__title {
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.settings-page-list__description {
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
