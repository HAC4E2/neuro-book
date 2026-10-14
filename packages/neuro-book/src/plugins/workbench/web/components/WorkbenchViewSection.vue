<script setup lang="ts">
/** 视图外框（同名 .md）：multiple 的标题行与收起；内容由宿主搬进默认插槽，不在这里创建，滚动也归内容。 */
import {IconButton} from "@notnotype/nb-ui/components";

defineOptions({name: "WorkbenchViewSection"});

const props = defineProps<{
    viewId: string;
    title: string;
    icon: string;
    axis: "vertical" | "horizontal";
    chrome: boolean;
    collapsed: boolean;
    collapseLabel: string;
    expandLabel: string;
    /** 标题这个键盘拖动把手的可访问名称，例如“拖动 资源管理器”。 */
    dragLabel: string;
}>();

const emit = defineEmits<{
    (event: "toggle-collapsed", collapsed: boolean): void;
}>();

/** 与拖动会话的起拖门槛一致：按下到松开移动超过它就是拖动，不算点击。 */
const CLICK_SLOP_PX = 6;
let pressedAt: {x: number; y: number} | null = null;

function onHeadPointerDown(event: PointerEvent): void {
    pressedAt = {x: event.clientX, y: event.clientY};
}

/**
 * 整行点击切换收起（docs/specs/ui/workbench-shell.md 外壳二输出 16）：按下后移动过门槛的是拖动。带 `data-no-drag` 的
 * 展开标记与动作区的点击归它们自己，展开标记已经切过一次，这里不再切。
 */
function onHeadClick(event: MouseEvent): void {
    const start = pressedAt;
    pressedAt = null;
    if (event.target instanceof Element && event.target.closest("[data-no-drag]") !== null) return;
    if (start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
    emit("toggle-collapsed", !props.collapsed);
}

defineSlots<{
    actions?(): unknown;
    default?(): unknown;
}>();
</script>

<template>
    <section
        class="workbench-view-section"
        :class="[`workbench-view-section--${axis}`, {'workbench-view-section--collapsed': chrome && collapsed}]"
        role="region"
        :aria-label="title"
        :data-view-section="viewId"
        :data-view-collapsed="chrome && collapsed ? 'true' : 'false'"
    >
        <header v-if="chrome" class="workbench-view-section__head" :data-drag-view="viewId" @pointerdown="onHeadPointerDown" @click="onHeadClick">
            <IconButton
                size="2xs"
                :icon-class="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
                :aria-label="collapsed ? expandLabel : collapseLabel"
                :title="collapsed ? expandLabel : collapseLabel"
                :aria-expanded="!collapsed"
                data-view-toggle
                data-no-drag
                @click="emit('toggle-collapsed', !collapsed)"
            />
            <span class="workbench-view-section__icon" :class="icon" aria-hidden="true"></span>
            <!-- 标题文字是键盘拖动的把手：聚焦后按空格拿起（外壳三输出 23）；指针拖动用整个标题行。 -->
            <h3 class="workbench-view-section__title"><span class="nb-ui-focus-ring workbench-view-section__handle" role="button" tabindex="0" :aria-label="dragLabel" data-drag-handle>{{ title }}</span></h3>
            <div v-if="!collapsed" class="workbench-view-section__actions" data-no-drag>
                <slot name="actions"></slot>
            </div>
        </header>
        <div v-show="!(chrome && collapsed)" class="workbench-view-section__body">
            <slot></slot>
        </div>
    </section>
</template>

<style scoped>
.workbench-view-section {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.workbench-view-section__head {
    position: relative;
    isolation: isolate;
    display: flex;
    flex: 0 0 32px;
    align-items: center;
    gap: 2px;
    height: 32px;
    min-width: 0;
    /* 14px 的展开标记离左边 8px：外扩焦点光环（实色 3.5px）不被分节的裁切切掉；右边 6px 给动作区的 24px 按钮留 4px 以上。 */
    padding-inline: 8px 6px;
    cursor: pointer;
    /* 标题整块是视图的拖动源：不扩选文字，触摸按住起拖而不是滚动。 */
    touch-action: none;
    user-select: none;
}

/* 整行可点的悬停底色：左右各留 4px、上下各留 3px，不贴满整行（t83 第三轮稿 R3-2）。 */
.workbench-view-section__head::before {
    position: absolute;
    z-index: -1;
    inset: 3px 4px;
    border-radius: 6px;
    background: transparent;
    content: "";
    transition: background-color var(--motion-fast) var(--ease-standard);
}

.workbench-view-section__head:hover::before {
    background: var(--bg-hover);
}

.workbench-view-section__icon {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    margin-inline-start: 2px;
    color: var(--text-muted);
}

/*
 * 省略号裁切放在把手自己身上：标题不裁切，把手的焦点光环才不会被标题切掉上下。上限用行向尺寸：收起成竖条时标题竖排，
 * 行向是竖的，限制的是高度。
 */
.workbench-view-section__handle {
    display: inline-block;
    max-inline-size: 100%;
    overflow: hidden;
    border-radius: var(--radius-control);
    text-overflow: ellipsis;
    vertical-align: middle;
}

.workbench-view-section__title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
}

.workbench-view-section__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}

.workbench-view-section__body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

/* 横向容器收起成 32px 竖条：标题行转成竖排，展开按钮在顶部。 */
.workbench-view-section--horizontal.workbench-view-section--collapsed .workbench-view-section__head {
    flex: 1 1 auto;
    flex-direction: column;
    width: 32px;
    height: 100%;
    /* 顶部的展开标记离边 8px、左右各余 9px：外扩焦点光环不被分节的裁切切掉。 */
    padding-block: 8px;
    padding-inline: 0;
}

/* 竖条的悬停底色四周各留 3px。 */
.workbench-view-section--horizontal.workbench-view-section--collapsed .workbench-view-section__head::before {
    inset: 3px;
}

.workbench-view-section--horizontal.workbench-view-section--collapsed .workbench-view-section__icon {
    margin-inline-start: 0;
}

/* 竖排的标题要能比文字短：不写 min-height 时弹性项最矮也是文字的高度，长标题会伸出竖条、在底边被截断而没有省略号。 */
.workbench-view-section--horizontal.workbench-view-section--collapsed .workbench-view-section__title {
    flex: 0 1 auto;
    min-height: 0;
    writing-mode: vertical-rl;
}
</style>
