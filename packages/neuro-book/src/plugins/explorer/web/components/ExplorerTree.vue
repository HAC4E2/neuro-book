<script setup lang="ts">
/** 资源管理器的虚拟树（同名 .md）。 */
import {DropFeedbackOverlay} from "@notnotype/nb-ui/components";
import type {DropFeedbackPreview} from "@notnotype/nb-ui/components";
import {useLayoutExtent} from "@notnotype/nb-ui/composables";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import {zoneOf} from "../actions/drop";
import type {DropAction, DropOver} from "../actions/drop";
import type {KeyOutcome} from "../controller";
import {explorerText} from "../messages";
import {createTreeDrag} from "../tree-drag";
import type {TreeDrag, TreeDragPointer, TreeDragTarget} from "../tree-drag";
import type {TreeKey} from "../tree/keys";
import {displayLabel} from "../tree/rows";
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
    /** 拖动中：被拖的源（行 id）与最后显示的落点动作；不在拖动为 null。 */
    drag?: {readonly sources: ReadonlyArray<string>; readonly action: DropAction} | null;
    /** 缩进参考线：不画、悬停或有焦点时画、一直画；默认 `hover`。 */
    indentGuides?: "none" | "hover" | "always";
    /** 设置“隐藏 Markdown 扩展名”；默认 false。 */
    hideMarkdownExtension?: boolean;
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
    (event: "drag-hover", over: DropOver | null): void;
    (event: "drag-drop", over: DropOver | null): void;
    (event: "drag-cancel"): void;
    /** 拖动中指针在收起的目录行中段停了 600 毫秒：展开它。 */
    (event: "drag-expand", id: string): void;
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

/**
 * 加深的那一段参考线：焦点行（没有焦点时取第一个选中行）与它连续的同层兄弟（中间夹着的更深的行也算），加深的是它们上级
 * 的那一层。焦点在根或根的直接子项上时没有可加深的线。
 */
const guideRange = computed((): {readonly lo: number; readonly hi: number; readonly level: number} | null => {
    let anchor = focusIndex.value;
    if (anchor < 0) anchor = props.selected.length === 0 ? -1 : props.rows.findIndex((row) => row.id === props.selected[0]);
    const row = anchor < 0 ? undefined : props.rows[anchor];
    if (row === undefined || row.depth < 2) return null;
    let lo = anchor;
    let hi = anchor;
    while (lo > 0 && (props.rows[lo - 1] as Row).depth >= row.depth) lo -= 1;
    while (hi < props.rows.length - 1 && (props.rows[hi + 1] as Row).depth >= row.depth) hi += 1;
    return {lo, hi, level: row.depth - 1};
});
const guideActiveAt = (index: number): number | null => {
    const range = guideRange.value;
    return range !== null && index >= range.lo && index <= range.hi ? range.level : null;
};
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
    if (row.kind === "edit") return;
    emit("row-press", row.id, {toggle: event.ctrlKey || event.metaKey, range: event.shiftKey}, part);
};

const context = (row: Row, event: MouseEvent): void => {
    focusTree();
    if (row.kind === "root" || row.kind === "entry") emit("row-context", row.id, event.clientX, event.clientY);
};

// ---- 拖动：手势在 `tree-drag.ts`，落点判定与提交在控制器。 ----

/**
 * 指针下的落点与画反馈要用的几何：行的矩形；移入目录时还要那个目录在树里的整段范围，按交出落点那一刻的树矩形与滚动位置
 * 换算（之后滚动会先撤下落点，不会用到过期的几何）。
 */
interface Hovered {
    readonly over: DropOver;
    readonly rect: DOMRect;
    readonly tree: DOMRect;
    readonly scrollTop: number;
}
const hovered = ref<Hovered | null>(null);
const pointer = ref<TreeDragPointer | null>(null);
const overOf = (target: TreeDragTarget | null): Hovered | null => {
    if (target === null || root.value === null) return null;
    const geometry = {rect: target.rect, tree: root.value.getBoundingClientRect(), scrollTop: root.value.scrollTop};
    if (target.kind === "blank") return {over: {kind: "blank"}, ...geometry};
    if (target.kind === "editor") return {over: {kind: "editor", group: target.group}, ...geometry};
    const row = props.rows.find((candidate) => candidate.id === target.id);
    return row === undefined ? null : {over: {kind: "row", id: target.id, zone: zoneOf(row, target.offset)}, ...geometry};
};

/** 停留展开：指针停在收起的目录行中段 600 毫秒（docs/specs/workbench/files-explorer.md 的“拖动”）。落点换了重新计时。 */
const EXPAND_HOVER_MS = 600;
let expandTimer: ReturnType<typeof setTimeout> | null = null;
let expandFor = "";
const clearExpand = (): void => {
    if (expandTimer !== null) clearTimeout(expandTimer);
    expandTimer = null;
    expandFor = "";
};
watch(hovered, (next) => {
    const over = next?.over;
    const row = over?.kind === "row" && over.zone === "inside" ? props.rows.find((candidate) => candidate.id === over.id) : undefined;
    const waiting = row !== undefined && (row.kind === "root" || row.kind === "entry") && !row.expanded && (row.kind === "root" || row.expandable) ? row.id : "";
    if (waiting === expandFor) return;
    clearExpand();
    if (waiting === "") return;
    expandFor = waiting;
    expandTimer = setTimeout(() => {
        expandTimer = null;
        expandFor = "";
        emit("drag-expand", waiting);
    }, EXPAND_HOVER_MS);
});
onBeforeUnmount(clearExpand);

let gesture: TreeDrag | null = null;
onMounted(() => {
    if (root.value === null) return;
    gesture = createTreeDrag({
        root: root.value,
        start: (id) => props.startDrag?.(id) ?? false,
        hover: (target, at) => {
            pointer.value = at;
            hovered.value = overOf(target);
            emit("drag-hover", hovered.value?.over ?? null);
        },
        drop: (target) => {
            const over = overOf(target)?.over ?? null;
            hovered.value = null;
            pointer.value = null;
            clearExpand();
            emit("drag-drop", over);
        },
        cancel: () => {
            hovered.value = null;
            pointer.value = null;
            clearExpand();
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
    pointer.value = null;
    clearExpand();
    gesture?.abort();
});
// 行变了而指针没动：指针下已经不是显示的那一行，撤下落点。
watch(() => props.rows, () => gesture?.invalidate());

/**
 * 落点反馈：移入时画目标目录与它展开的子行那一整段（不画插入线），调整顺序画插入线，在编辑组打开画整个编辑组。目录的整段
 * 按行下标与交出落点那一刻的树矩形换算，夹在树的可见范围里。
 */
const dropPreview = computed((): DropFeedbackPreview | null => {
    const action = props.drag?.action;
    const at = hovered.value;
    if (action === undefined || action.kind === "none" || at === null) return null;
    const {left, right, top, bottom} = at.rect;
    if (action.kind === "open") return {areaRect: {left, right, top, bottom}, entryRect: null, indicator: null, orientation: "vertical"};
    if (action.kind === "reorder") {
        const edge = action.zone === "before" ? top : bottom;
        return {areaRect: null, entryRect: null, indicator: {left, right, top: edge - 1, bottom: edge + 1}, orientation: "vertical"};
    }
    const index = props.rows.findIndex((row) => row.id === action.target);
    if (index < 0) return null;
    const depth = (props.rows[index] as Row).depth;
    let last = index;
    while (last + 1 < props.rows.length && (props.rows[last + 1] as Row).depth > depth) last += 1;
    const start = at.tree.top - at.scrollTop + index * rowHeight.value;
    const end = at.tree.top - at.scrollTop + (last + 1) * rowHeight.value;
    // 行左右的内边距取指针下那一行的边；指针在空白上时没有行，取树的边。
    const edges = at.over.kind === "row" ? {left, right} : {left: at.tree.left, right: at.tree.right};
    return {areaRect: {...edges, top: Math.max(start, at.tree.top), bottom: Math.min(end, at.tree.bottom)}, entryRect: null, indicator: null, orientation: "vertical"};
});

const nameOfRow = (id: string): string => {
    const row = props.rows.find((candidate) => candidate.id === id);
    if (row?.kind === "entry") return displayLabel(row, props.hideMarkdownExtension === true);
    if (row?.kind === "root") return row.scheme === "project" ? (props.projectTitle ?? explorerText(props.locale, "projectRoot")) : explorerText(props.locale, "userRoot");
    return id;
};

/** 跟着指针的说明：动作（移入哪里、调整顺序、在这一组打开）；没有落点时只写被拖的东西。 */
const dropLabel = computed(() => {
    const action = props.drag?.action;
    if (action === undefined || action.kind === "none") return "";
    if (action.kind === "reorder") return explorerText(props.locale, "dropReorder");
    if (action.kind === "open") return explorerText(props.locale, action.skipped > 0 ? "dropOpenSome" : "dropOpen", {count: String(action.addresses.length), skipped: String(action.skipped)});
    return explorerText(props.locale, "dropInto", {name: nameOfRow(action.target)});
});

/** 拖影：指针右下的小浮块，写被拖的名字（多项写“N 项”）与动作。 */
const ghost = computed(() => {
    const sources = props.drag?.sources;
    const at = pointer.value;
    if (sources === undefined || sources.length === 0 || at === null) return null;
    const what = sources.length === 1 ? nameOfRow(sources[0] as string) : explorerText(props.locale, "dragItems", {count: String(sources.length)});
    return {x: at.x + 14, y: at.y + 18, what, action: dropLabel.value};
});

const dragSources = computed(() => new Set(props.drag?.sources ?? []));

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
        :data-guides="indentGuides ?? 'hover'"
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
                :hide-markdown-extension="hideMarkdownExtension === true"
                :guide-active="guideActiveAt(item.index)"
                :data-explorer-drag-source="dragSources.has(item.row.id) ? '' : undefined"
                @edit-input="(name) => emit('edit-input', name)"
                @edit-commit="emit('edit-commit')"
                @edit-cancel="emit('edit-cancel')"
                @press="(event, part) => press(item.row, event, part)"
                @activate="(item.row.kind === 'root' || item.row.kind === 'entry') && emit('row-activate', item.row.id)"
                @context="(event) => context(item.row, event)"
                @retry="item.row.kind !== 'edit' && emit('retry', item.row.id)"
            />
        </TransitionGroup>
        <DropFeedbackOverlay :preview="dropPreview" label="" :data-explorer-drop="drag?.action.kind" />
        <Teleport to="body">
            <div v-if="ghost" class="explorer-drag-ghost" :style="{left: `${ghost.x}px`, top: `${ghost.y}px`}" aria-hidden="true" data-explorer-drag-ghost>
                <div class="truncate font-medium">{{ ghost.what }}</div>
                <div v-if="ghost.action" class="truncate text-[var(--text-muted)]" data-explorer-drag-action>{{ ghost.action }}</div>
            </div>
            <!-- 读屏播报落点动作：反馈层自己的标签不用（说明画在拖影里），播报放在这里。 -->
            <span class="explorer-drag-live" aria-live="polite" aria-atomic="true" data-explorer-drop-live>{{ drag ? dropLabel : "" }}</span>
        </Teleport>
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

/* 被拖的行淡化，看得出拖走的是哪几行。 */
.explorer-tree__row[data-explorer-drag-source] {
    opacity: 0.45;
}

.explorer-drag-live {
    position: fixed;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

/* 拖影：跟着指针、不挡指针下的命中，画在最上层。 */
.explorer-drag-ghost {
    position: fixed;
    z-index: 9500;
    max-width: 260px;
    padding: 4px 8px;
    border-radius: var(--radius-control);
    border: var(--border-w) solid var(--panel-outline);
    background: var(--bg-panel);
    box-shadow: var(--elevation-menu, var(--elevation-popover));
    color: var(--text-main);
    font-size: 12px;
    line-height: 1.5;
    pointer-events: none;
}

.explorer-tree[data-expanding] .explorer-tree__row {
    transition: top var(--motion-base) var(--ease-standard), opacity var(--motion-base) var(--ease-standard), transform var(--motion-base) var(--ease-standard), background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.explorer-tree[data-expanding] .explorer-row-enter-from,
.explorer-tree[data-expanding] .explorer-row-leave-to {
    opacity: 0;
    transform: translateY(calc(-1 * var(--explorer-row-height)));
}

/* 缩进参考线的显示（行里的 `.explorer-guide` 读这个变量）：悬停档在鼠标位于树上或树里有焦点时显示。 */
.explorer-tree[data-guides="always"],
.explorer-tree[data-guides="hover"]:hover,
.explorer-tree[data-guides="hover"]:focus-within {
    --explorer-guide-opacity: 1;
}

.explorer-tree {
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-main) 24%, transparent) transparent;
}
</style>
