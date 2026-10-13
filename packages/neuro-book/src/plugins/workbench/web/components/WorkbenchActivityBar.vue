<script setup lang="ts">
/** 活动栏（同名 .md）：Sidebar 的容器切换按钮；点了只发 `select`，切换与打开 Sidebar 由宿主做。 */
import {Dropdown, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref} from "vue";

import {layoutStrip} from "../items/item-strip";

export interface ActivityContainer {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
}

defineOptions({name: "WorkbenchActivityBar"});

const props = withDefaults(defineProps<{
    label: string;
    containers: ReadonlyArray<ActivityContainer>;
    selected: string | null;
    sidebarVisible: boolean;
    /** 条目作为拖动源的说明（写到 `aria-description`），例如“按空格拿起并拖动”。 */
    dragHint: string;
    /** 放不下时收起其余条目的“更多”按钮的可访问名称。 */
    moreLabel?: string;
}>(), {moreLabel: "更多"});

const emit = defineEmits<{
    (event: "select", id: string): void;
}>();

/**
 * 条目放不下时，末尾的收进底部的“更多”（docs/specs/ui/workbench-shell.md 输出 25）：与状态栏条目同一个预算
 * （`layoutStrip`），选中的优先级最高、总在外面。量不到条目区（还没挂上）时全部摆出来，条目区自己纵向滚动兜底。
 */
const bandEl = ref<HTMLElement | null>(null);
const available = ref<number | null>(null);
const ITEM_PX = 38;

function measureBand(): void {
    const band = bandEl.value;
    if (band === null) return;
    const style = getComputedStyle(band);
    const height = band.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0);
    available.value = height > 0 ? height : null;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
    measureBand();
    if (typeof ResizeObserver !== "function" || bandEl.value === null) return;
    observer = new ResizeObserver(measureBand);
    observer.observe(bandEl.value);
});
onBeforeUnmount(() => observer?.disconnect());

const strip = computed(() => {
    const room = available.value;
    if (room === null || bandEl.value === null) return {shown: props.containers.map((container) => container.id), hidden: [] as string[]};
    const gap = Number.parseFloat(getComputedStyle(bandEl.value).rowGap) || 0;
    return layoutStrip(props.containers.map((container, index) => ({id: container.id, order: index, priority: container.id === props.selected ? 1 : 0, width: ITEM_PX})), room, ITEM_PX, gap);
});
const shownContainers = computed(() => props.containers.filter((container) => strip.value.shown.includes(container.id)));
const moreItems = computed(() => props.containers.filter((container) => strip.value.hidden.includes(container.id)).map((container) => ({label: container.label, value: container.id, iconClass: container.icon})));
</script>

<template>
    <nav class="workbench-activity-bar" :aria-label="label">
        <div ref="bandEl" class="workbench-activity-bar__containers" data-switcher-band="sidebar">
            <Tooltip v-for="container in shownContainers" :key="container.id" :text="container.label" placement="right">
                <IconButton
                    size="lg"
                    :icon-class="container.icon"
                    :aria-label="container.label"
                    :aria-pressed="sidebarVisible && container.id === selected"
                    :data-activity-container="container.id"
                    :data-switcher-entry="container.id"
                    :data-drag-container="container.id"
                    :aria-description="dragHint"
                    class="workbench-activity-bar__item"
                    :class="{'workbench-activity-bar__item--active': sidebarVisible && container.id === selected}"
                    @click="emit('select', container.id)"
                />
            </Tooltip>
            <Dropdown v-if="moreItems.length > 0" :items="moreItems" side="right" align="end" compact @select="(id: string) => emit('select', id)">
                <IconButton size="lg" icon-class="i-lucide-ellipsis" :aria-label="moreLabel" class="workbench-activity-bar__item" data-activity-more />
            </Dropdown>
        </div>
        <div class="workbench-activity-bar__footer"></div>
    </nav>
</template>

<style scoped>
/* 外壳平铺（ui/workbench-shell.md 输出 38）：贴着窗体左边与侧栏，和侧栏同一块底色，不画外框与圆角。 */
.workbench-activity-bar {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding-block: var(--space-1);
    background: var(--panel-surface);
}

.workbench-activity-bar__containers {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    min-height: 0;
    /* 滚动区自己会裁切：上下留 4px，按钮（38px，左右各余 4px）的焦点光环不被它切掉。 */
    padding-block: var(--space-2);
    overflow-y: auto;
    scrollbar-width: none;
}

.workbench-activity-bar__footer {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
}

.workbench-activity-bar .workbench-activity-bar__item {
    flex: 0 0 auto;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    /* 活动条目也是整容器的拖动源：触摸按住起拖。 */
    touch-action: none;
}

.workbench-activity-bar .workbench-activity-bar__item:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.workbench-activity-bar .workbench-activity-bar__item--active {
    background: var(--bg-hover);
    color: var(--accent-text);
}
</style>
