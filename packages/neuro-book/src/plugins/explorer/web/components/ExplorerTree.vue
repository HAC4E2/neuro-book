<script setup lang="ts">
/** 资源管理器的虚拟树（同名 .md）。 */
import {DropFeedbackOverlay} from "@notnotype/nb-ui/components";
import type {DropFeedbackPreview} from "@notnotype/nb-ui/components";
import {useLayoutExtent} from "@notnotype/nb-ui/composables";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import {zoneOf} from "../actions/drop";
import type {DropAction, DropZone} from "../actions/drop";
import type {KeyOutcome} from "../controller";
import {explorerText} from "../messages";
import {createTreeDrag} from "../tree-drag";
import type {TreeDrag, TreeDragPoint} from "../tree-drag";
import type {TreeKey} from "../tree/keys";
import type {Row} from "../tree/rows";
import type {Modifiers} from "../tree/selection";
import {clampTop, renderedRows, revealTop} from "../tree/window";
import ExplorerRow from "./ExplorerRow.vue";

const props = defineProps<{
    rows: ReadonlyArray<Row>;
    selected: ReadonlyArray<string>;
    focus: string | null;
    locale: DisplayLocale;
    label: string;
    handleKey: (key: TreeKey, page: number) => KeyOutcome;
    /** 项目根显示的作品名；不给时显示“项目”。 */
    projectTitle?: string | null;
    /** 正在内联输入的行：新建的输入行或改名的资源行，以及名字、错误文字与是否在提交。 */
    editing?: {readonly id: string; readonly name: string; readonly error: string | null; readonly busy: boolean} | null;
    /** 拖动过了门槛：返回 false 时不起拖。缺省不能拖。 */
    startDrag?: (id: string) => boolean;
    /** 拖动中最后显示的落点动作；不在拖动为 null。 */
    drag?: {readonly action: DropAction} | null;
}>();

const emit = defineEmits<{
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    (event: "retry", address: string): void;
    (event: "focus-change", focused: boolean): void;
    (event: "edit-input", name: string): void;
    (event: "edit-commit"): void;
    (event: "edit-cancel"): void;
    (event: "drag-hover", over: {readonly id: string; readonly zone: DropZone} | null): void;
    (event: "drag-drop", over: {readonly id: string; readonly zone: DropZone} | null): void;
    (event: "drag-cancel"): void;
}>();

/** 探针还没量出尺寸（没有布局的环境）时的行高与视口高度。 */
const FALLBACK_ROW_HEIGHT = 26;
const FALLBACK_VIEWPORT = 600;

const root = ref<HTMLElement | null>(null);
const probe = ref<HTMLElement | null>(null);
const extent = useLayoutExtent(root);
const probeExtent = useLayoutExtent(probe);
const prefix = useId();

const rowHeight = computed(() => (probeExtent.value !== null && probeExtent.value.height > 0 ? probeExtent.value.height : FALLBACK_ROW_HEIGHT));
/** 视图停放时尺寸为零：沿用最后一次的正尺寸，不让窗口缩成空、也不改记住的滚动位置。 */
const viewport = ref(FALLBACK_VIEWPORT);
watch(extent, (next) => {
    if (next !== null && next.height > 0) viewport.value = next.height;
}, {immediate: true});

const scrollTop = ref(0);
const treeFocused = ref(false);

const selectedSet = computed(() => new Set(props.selected));
const focusIndex = computed(() => (props.focus === null ? -1 : props.rows.findIndex((row) => row.id === props.focus)));
const editIndex = computed(() => (props.editing == null ? -1 : props.rows.findIndex((row) => row.id === props.editing?.id)));
const rendered = computed(() => renderedRows({count: props.rows.length, rowHeight: rowHeight.value, viewport: viewport.value, scrollTop: scrollTop.value, keep: [focusIndex.value, editIndex.value]}).map((index) => ({index, row: props.rows[index] as Row})));
const page = computed(() => Math.max(1, Math.floor(viewport.value / rowHeight.value)));

const domId = (id: string): string => `${prefix}-${encodeURIComponent(id)}`;
const activeDescendant = computed(() => (focusIndex.value < 0 ? undefined : domId(props.focus as string)));

/** 滚动锚点：首个可见行与行内偏移。行变了时按它还原阅读位置。 */
let anchor: {id: string; offset: number} | null = null;
const remember = (): void => {
    const index = Math.floor(scrollTop.value / rowHeight.value);
    const row = props.rows[index];
    anchor = row === undefined ? null : {id: row.id, offset: scrollTop.value - index * rowHeight.value};
};

const setScroll = (top: number): void => {
    const element = root.value;
    scrollTop.value = top;
    if (element !== null && Math.abs(element.scrollTop - top) > 0.5) element.scrollTop = top;
};

watch(() => props.rows, (rows) => {
    let top = scrollTop.value;
    if (anchor !== null) {
        const index = rows.findIndex((row) => row.id === anchor?.id);
        if (index >= 0) top = index * rowHeight.value + anchor.offset;
    }
    void nextTick(() => {
        setScroll(clampTop(top, rows.length, rowHeight.value, viewport.value));
        remember();
    });
});

/**
 * 行高变了（主题、字号）：同一个 scrollTop 在新行高下指向别的行，按锚点换算，行内偏移按行高等比缩放。要在内容高度随
 * 新行高改变、浏览器夹紧滚动位置并发出 scroll 之前读锚点，所以这里不等布局，直接用旧锚点算。
 */
watch(rowHeight, (height, previous) => {
    if (anchor === null || previous === undefined || previous <= 0) return;
    const index = props.rows.findIndex((row) => row.id === anchor?.id);
    if (index < 0) return;
    const top = index * height + Math.min(anchor.offset * (height / previous), height - 1);
    void nextTick(() => {
        setScroll(clampTop(top, props.rows.length, height, viewport.value));
        remember();
    });
});

/**
 * 焦点换了一行（键盘移动、点击）或开始编辑另一行时，把它滚入视口。按 id 的变化触发，不按下标：前方插入或删除行只
 * 改变下标，那时由上面的锚点保持阅读位置，不能被拉回焦点行。
 */
const reveal = (id: string | null | undefined): void => {
    if (id == null) return;
    void nextTick(() => {
        const index = props.rows.findIndex((row) => row.id === id);
        if (index < 0) return;
        setScroll(revealTop(index, rowHeight.value, viewport.value, scrollTop.value));
        remember();
    });
};
watch(() => props.editing?.id, reveal);
watch(() => props.focus, reveal);

const onScroll = (): void => {
    if (root.value === null) return;
    // 停放（尺寸为零）期间浏览器可能把滚动位置夹成零：不记它。
    if (root.value.clientHeight === 0) return;
    scrollTop.value = root.value.scrollTop;
    remember();
};

const focusTree = (): void => {
    root.value?.focus({preventScroll: true});
};

const onKeydown = (event: KeyboardEvent): void => {
    // 行里的按钮与输入框自己处理按键。
    if (event.target !== root.value) return;
    const outcome = props.handleKey({key: event.key, shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey, alt: event.altKey}, page.value);
    if (outcome === "none") return;
    event.preventDefault();
    if (outcome === "handled") return;
    // 键盘打开的右键菜单落在焦点行下方。
    const element = document.getElementById(domId(outcome.menu));
    const rect = element?.getBoundingClientRect();
    emit("row-context", outcome.menu, (rect?.left ?? 0) + 24, rect?.bottom ?? 0);
};

const onFocus = (event: FocusEvent): void => {
    if (event.target !== root.value) return;
    treeFocused.value = true;
    emit("focus-change", true);
};

const onBlur = (event: FocusEvent): void => {
    if (event.target !== root.value) return;
    treeFocused.value = false;
    emit("focus-change", false);
};

const press = (row: Row, event: MouseEvent, part: "twisty" | "row"): void => {
    focusTree();
    if (row.kind === "status" || row.kind === "edit") return;
    emit("row-press", row.id, {toggle: event.ctrlKey || event.metaKey, range: event.shiftKey}, part);
};

const context = (row: Row, event: MouseEvent): void => {
    focusTree();
    if (row.kind === "root" || row.kind === "entry") emit("row-context", row.id, event.clientX, event.clientY);
};

// ---- 拖动：手势在 `tree-drag.ts`，落点判定与提交在控制器。 ----

/** 指针下的行与它的矩形：落点反馈画在这里。 */
const hovered = ref<{readonly id: string; readonly zone: DropZone; readonly rect: DOMRect} | null>(null);
const overOf = (point: TreeDragPoint | null): {readonly id: string; readonly zone: DropZone; readonly rect: DOMRect} | null => {
    const row = point === null ? undefined : props.rows.find((candidate) => candidate.id === point.id);
    return point === null || row === undefined ? null : {id: point.id, zone: zoneOf(row, point.offset), rect: point.rect};
};
const strip = (over: {readonly id: string; readonly zone: DropZone} | null) => (over === null ? null : {id: over.id, zone: over.zone});
let gesture: TreeDrag | null = null;
onMounted(() => {
    if (root.value === null) return;
    gesture = createTreeDrag({
        root: root.value,
        start: (id) => props.startDrag?.(id) ?? false,
        hover: (point) => {
            hovered.value = overOf(point);
            emit("drag-hover", strip(hovered.value));
        },
        drop: (point) => {
            hovered.value = null;
            emit("drag-drop", strip(overOf(point)));
        },
        cancel: () => {
            hovered.value = null;
            emit("drag-cancel");
        },
    });
});
onBeforeUnmount(() => gesture?.dispose());

/**
 * 展开收起的动画（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：树是虚拟列表，滚动时窗口两端也有
 * 行进出，不能一律做进出动画。只在展开的目录变了之后的一个 `--motion-base` 里打 `data-expanding`，样式只在这时让新出现的行
 * 从上方滑下并淡入、离开的行反向、其余行的位置跟着过渡。系统减少动画时这个时长是 0，不打。watch 在渲染之前跑，标记与新行
 * 同一次渲染出现，进场的过渡才有起点。
 */
const expanding = ref(false);
let expandingTimer: ReturnType<typeof setTimeout> | null = null;
/** 动画结束后多留这么久再撤标记：离开的行可能晚一帧开始过渡，撤早了会被截断。 */
const EXPANDING_SLACK_MS = 100;
const expandedIds = computed(() => props.rows.flatMap((row) => ((row.kind === "root" || row.kind === "entry") && row.expanded ? [row.id] : [])).join("\n"));
watch(expandedIds, () => {
    const element = root.value;
    if (element === null) return;
    const duration = Number.parseFloat(getComputedStyle(element).getPropertyValue("--motion-base"));
    if (!(duration > 0)) return;
    if (expandingTimer !== null) clearTimeout(expandingTimer);
    expanding.value = true;
    expandingTimer = setTimeout(() => {
        expanding.value = false;
        expandingTimer = null;
    }, duration + EXPANDING_SLACK_MS);
});
onBeforeUnmount(() => {
    if (expandingTimer !== null) clearTimeout(expandingTimer);
});
// 控制器结束了这场拖动（切换显示、源或落点失效）：手势随之收场。
watch(() => props.drag == null, (ended) => {
    if (!ended) return;
    hovered.value = null;
    gesture?.abort();
});
// 行变了而指针没动：指针下已经不是显示的那一行，撤下落点。
watch(() => props.rows, () => gesture?.invalidate());

const dropPreview = computed((): DropFeedbackPreview | null => {
    const action = props.drag?.action;
    const over = hovered.value;
    if (action === undefined || action.kind === "none" || over === null) return null;
    const {left, right, top, bottom} = over.rect;
    if (action.kind === "move") return {areaRect: {left, right, top, bottom}, entryRect: null, indicator: null, orientation: "vertical"};
    const edge = action.zone === "before" ? top : bottom;
    return {areaRect: null, entryRect: null, indicator: {left, right, top: edge - 1, bottom: edge + 1}, orientation: "vertical"};
});
const dropLabel = computed(() => {
    const action = props.drag?.action;
    if (action === undefined || action.kind === "none") return "";
    if (action.kind === "reorder") return explorerText(props.locale, "dropReorder");
    const row = props.rows.find((candidate) => candidate.id === action.target);
    const name = row?.kind === "entry" ? row.label : row?.kind === "root" ? (row.scheme === "project" ? (props.projectTitle ?? explorerText(props.locale, "projectRoot")) : explorerText(props.locale, "userRoot")) : action.target;
    return explorerText(props.locale, "dropInto", {name});
});

defineExpose({focus: focusTree});
</script>

<template>
    <div
        ref="root"
        role="tree"
        tabindex="0"
        aria-multiselectable="true"
        :aria-label="label"
        :aria-activedescendant="activeDescendant"
        class="explorer-tree relative h-full min-h-0 overflow-y-auto overflow-x-hidden outline-none"
        :style="{'--explorer-row-height': `${String(rowHeight)}px`}"
        data-explorer-tree
        :data-expanding="expanding ? '' : undefined"
        @scroll="onScroll"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="onBlur"
    >
        <div ref="probe" class="nb-ui-control-h-sm pointer-events-none invisible absolute left-0 top-0 w-px" aria-hidden="true"></div>
        <TransitionGroup name="explorer-row" tag="div" class="relative w-full" :style="{height: `${String(rows.length * rowHeight)}px`}">
            <!-- 行左右留出视图外框给的内边距（nbook 是 6px）：悬停与选中的底色是圆角块，不贴着侧栏的边，块边与别的视图的内容边对齐。 -->
            <ExplorerRow
                v-for="item in rendered"
                :key="item.row.id"
                class="explorer-tree__row absolute"
                :style="{top: `${String(item.index * rowHeight)}px`}"
                :row="item.row"
                :locale="locale"
                :project-title="projectTitle ?? null"
                :dom-id="domId(item.row.id)"
                :selected="selectedSet.has(item.row.id)"
                :active="treeFocused && item.row.id === focus"
                :height="rowHeight"
                :edit="editing != null && editing.id === item.row.id ? editing : null"
                @edit-input="(name) => emit('edit-input', name)"
                @edit-commit="emit('edit-commit')"
                @edit-cancel="emit('edit-cancel')"
                @press="(event, part) => press(item.row, event, part)"
                @activate="(item.row.kind === 'root' || item.row.kind === 'entry') && emit('row-activate', item.row.id)"
                @context="(event) => context(item.row, event)"
                @retry="item.row.kind === 'status' && emit('retry', item.row.parent)"
            />
        </TransitionGroup>
        <DropFeedbackOverlay :preview="dropPreview" :label="dropLabel" :data-explorer-drop="drag?.action.kind" />
    </div>
</template>

<style scoped>
.explorer-tree__row {
    left: var(--view-inset-inline, 6px);
    right: var(--view-inset-inline, 6px);
}

.explorer-tree[data-explorer-dragging] {
    cursor: grabbing;
}

.explorer-tree[data-expanding] .explorer-tree__row {
    transition: top var(--motion-base) var(--ease-standard), opacity var(--motion-base) var(--ease-standard), transform var(--motion-base) var(--ease-standard), background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.explorer-tree[data-expanding] .explorer-row-enter-from,
.explorer-tree[data-expanding] .explorer-row-leave-to {
    opacity: 0;
    transform: translateY(calc(-1 * var(--explorer-row-height)));
}

.explorer-tree {
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-main) 24%, transparent) transparent;
}
</style>
