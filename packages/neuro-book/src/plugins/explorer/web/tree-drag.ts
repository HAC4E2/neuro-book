/**
 * 树内拖动的手势（docs/specs/workbench/files-explorer.md 的“拖动”）：装在树的滚动元素上，一场指针拖动从按下到放下。
 * 门槛与取消规则照外壳的拖动会话（`plugins/workbench/web/views/drag-session.ts`）；源的冻结、落点判定与提交归控制器，
 * 本模块只把指针下的行与它在行里的位置交出去。
 *
 * - 激活门槛：鼠标与笔移动 6px；触摸按住 200ms 且不超过 6px（先动了就让给滚动）。没过门槛的按下照常是点击。
 * - 每次指针移动（一帧一次）按当下坐标交一次落点，控制器据此算出并显示动作；放下时按那一刻的坐标再交一次，控制器只提交
 *   与最后显示相同的动作。用户自己滚动或行变了而指针没动时撤下显示的落点：指针下已经不是用户看到的那一行，放下不写。
 * - 落点有三类：树里的一行、树里行以外的空白、树外的编辑组（`data-editor-group`，docs/specs/workbench/editor.md 输出 35）。
 * - 边缘滚动：指针在树的横向范围内、离树的上下边缘不到 24px（或已经越过边缘）时逐帧滚动，越靠边越快。每一帧先按上一帧
 *   滚动后重新渲染出的行判一次落点，再滚这一帧：虚拟列表在滚动事件之后才补上新进视口的行，同一帧里判会落在空白上。
 *   自己滚出来的滚动不撤落点（每帧都重新交了）。
 * - Escape、`pointercancel`、失去指针捕获、窗口失焦、页面隐藏、销毁都取消且不写。结束时吞掉同一手势末尾的那次 click。
 *
 * 树里的按下不进外壳的拖动会话：外壳只认视图标题与标签上的拖动源标记。
 */

const DRAG_DISTANCE_PX = 6;
const TOUCH_DELAY_MS = 200;
const TOUCH_TOLERANCE_PX = 6;

/** 指针下的落点：一行（行 id、指针相对行顶的比例 0 到 1 与相对行左边的像素）、树里行以外的空白，或树外的一个编辑组；`rect` 是它的视口矩形。 */
export type TreeDragTarget =
    | {readonly kind: "row"; readonly id: string; readonly offset: number; readonly x: number; readonly rect: DOMRect}
    | {readonly kind: "blank"; readonly rect: DOMRect}
    | {readonly kind: "editor"; readonly group: string; readonly rect: DOMRect};

/** 指针的视口坐标（画拖影用）。 */
export interface TreeDragPointer {
    readonly x: number;
    readonly y: number;
}

export interface TreeDragOptions {
    /** 树的滚动元素：行都在它里面。 */
    readonly root: HTMLElement;
    /** 过了门槛：控制器冻结源；返回 false 时不起拖（源不能拖、在编辑或有批量在途）。 */
    start(id: string): boolean;
    /** 每帧交一次指针下的落点与指针坐标；落点 `null` 是哪儿都不是，或要撤下显示的落点。 */
    hover(target: TreeDragTarget | null, pointer: TreeDragPointer): void;
    /** 放下：那一刻指针下的落点。 */
    drop(target: TreeDragTarget | null): void;
    /** 手势被取消（Escape、指针取消、失焦等）。 */
    cancel(): void;
}

export interface TreeDrag {
    /** 撤下显示的落点（滚动、行变了），直到指针再动。 */
    invalidate(): void;
    /** 控制器那边已经结束了这场拖动（切换显示、源失效）：手势随之收场，不再回调。 */
    abort(): void;
    dispose(): void;
}

interface Pending {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly x: number;
    readonly y: number;
    readonly id: string;
    timer: ReturnType<typeof setTimeout> | null;
}

const ROW_SELECTOR = "[data-explorer-row]";
const EDITOR_GROUP_SELECTOR = "[data-editor-group]";
/** 装行的容器：它的底边之下才是“树里行以外的空白”。 */
const ROWS_SELECTOR = "[data-explorer-rows]";
/** 边缘滚动：离边缘多近开始滚、最快每帧滚多少。 */
const EDGE_PX = 24;
const EDGE_MAX_STEP_PX = 16;
/** 行里的输入框与按钮自己处理指针。 */
const BLOCKING_SELECTOR = "input, textarea, button, [contenteditable='true'], [contenteditable='']";

export function createTreeDrag(options: TreeDragOptions): TreeDrag {
    const {root} = options;
    const document = root.ownerDocument;
    const view = document.defaultView!;
    let pending: Pending | null = null;
    let active: {readonly pointerId: number; x: number; y: number} | null = null;
    let frame = 0;
    /** 拖动刚结束：同一手势末尾的 click 要吞掉。被吞掉或下一次按下时清。 */
    let swallowClick = false;
    let detach: (() => void) | null = null;
    let scrollFrame = 0;
    /** 边缘滚动正在滚：这期间的滚动事件是自己滚的，不撤落点。 */
    let autoScrolling = false;

    function pointAt(x: number, y: number): TreeDragTarget | null {
        const hit = document.elementFromPoint(x, y);
        if (hit === null) return null;
        const asRow = (element: HTMLElement): TreeDragTarget => {
            const rect = element.getBoundingClientRect();
            return {kind: "row", id: element.dataset.explorerRow as string, offset: rect.height > 0 ? (y - rect.top) / rect.height : 0.5, x: x - rect.left, rect};
        };
        const row = hit.closest<HTMLElement>(ROW_SELECTOR);
        if (row !== null && root.contains(row)) return asRow(row);
        if (root.contains(hit)) {
            // 只有最后一行之下才是空白；行左右的内边距与滚动条那一条按同一高度的行算（取树中线上的那一行）。
            const tree = root.getBoundingClientRect();
            const rowsBottom = root.querySelector<HTMLElement>(ROWS_SELECTOR)?.getBoundingClientRect().bottom ?? tree.top;
            if (y >= rowsBottom) return {kind: "blank", rect: tree};
            const beside = document.elementFromPoint(tree.left + tree.width / 2, y)?.closest<HTMLElement>(ROW_SELECTOR);
            return beside != null && root.contains(beside) ? asRow(beside) : null;
        }
        const group = hit.closest<HTMLElement>(EDITOR_GROUP_SELECTOR);
        const id = group?.dataset.editorGroup;
        return group == null || id === undefined || id === "" ? null : {kind: "editor", group: id, rect: group.getBoundingClientRect()};
    }

    function publish(): void {
        frame = 0;
        if (active !== null) options.hover(pointAt(active.x, active.y), {x: active.x, y: active.y});
    }

    /** 这一刻该滚多快（负数向上）；指针不在树的横向范围内时不滚。 */
    function edgeStep(x: number, y: number): number {
        const rect = root.getBoundingClientRect();
        if (x < rect.left || x > rect.right || rect.height <= EDGE_PX * 2) return 0;
        const fromTop = y - rect.top;
        const fromBottom = rect.bottom - y;
        if (fromTop < EDGE_PX) return -Math.ceil(Math.min(1, (EDGE_PX - fromTop) / EDGE_PX) * EDGE_MAX_STEP_PX);
        if (fromBottom < EDGE_PX) return Math.ceil(Math.min(1, (EDGE_PX - fromBottom) / EDGE_PX) * EDGE_MAX_STEP_PX);
        return 0;
    }

    function autoScroll(): void {
        scrollFrame = 0;
        const current = active;
        const step = current === null ? 0 : edgeStep(current.x, current.y);
        const before = root.scrollTop;
        if (current === null || step === 0) {
            autoScrolling = false;
            return;
        }
        options.hover(pointAt(current.x, current.y), {x: current.x, y: current.y});
        autoScrolling = true;
        root.scrollTop = before + step;
        // 已经滚到头：停下，等指针再动。
        if (root.scrollTop === before) {
            autoScrolling = false;
            return;
        }
        scrollFrame = requestAnimationFrame(autoScroll);
    }

    function clearPending(): void {
        if (pending?.timer != null) clearTimeout(pending.timer);
        pending = null;
    }

    /** 收场：清帧、拆这场的监听、释放捕获。幂等。 */
    function end(): void {
        clearPending();
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        if (scrollFrame !== 0) cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        autoScrolling = false;
        const current = active;
        active = null;
        detach?.();
        detach = null;
        delete root.dataset.explorerDragging;
        if (current === null) return;
        swallowClick = true;
        if (root.hasPointerCapture(current.pointerId)) root.releasePointerCapture(current.pointerId);
    }

    function cancel(): void {
        if (active === null) return;
        end();
        options.cancel();
    }

    function begin(from: Pending): void {
        clearPending();
        if (!options.start(from.id)) return;
        active = {pointerId: from.pointerId, x: from.x, y: from.y};
        root.dataset.explorerDragging = "";
        document.getSelection()?.removeAllRanges();
        // 捕获到树上：指针移出树与窗口后仍收得到移动与松手。
        root.setPointerCapture(from.pointerId);
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
        };
        const onHidden = (): void => {
            if (document.visibilityState === "hidden") cancel();
        };
        const onLost = (event: PointerEvent): void => {
            if (event.pointerId === active?.pointerId) cancel();
        };
        const onScroll = (): void => {
            if (active !== null && !autoScrolling) options.hover(null, {x: active.x, y: active.y});
        };
        // 触摸拖动中不让页面滚动。
        const onTouchMove = (event: TouchEvent): void => event.preventDefault();
        view.addEventListener("keydown", onKey, true);
        view.addEventListener("blur", cancel);
        document.addEventListener("visibilitychange", onHidden);
        root.addEventListener("lostpointercapture", onLost);
        root.addEventListener("scroll", onScroll, {passive: true});
        root.addEventListener("touchmove", onTouchMove, {passive: false});
        detach = () => {
            view.removeEventListener("keydown", onKey, true);
            view.removeEventListener("blur", cancel);
            document.removeEventListener("visibilitychange", onHidden);
            root.removeEventListener("lostpointercapture", onLost);
            root.removeEventListener("scroll", onScroll);
            root.removeEventListener("touchmove", onTouchMove);
        };
        publish();
    }

    function onPointerDown(event: PointerEvent): void {
        swallowClick = false;
        if (pending !== null || active !== null || event.button !== 0 || !event.isPrimary) return;
        if (!(event.target instanceof Element) || event.target.closest(BLOCKING_SELECTOR) !== null) return;
        const row = event.target.closest<HTMLElement>(ROW_SELECTOR);
        if (row === null || !root.contains(row)) return;
        const next: Pending = {pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, id: row.dataset.explorerRow as string, timer: null};
        pending = next;
        if (event.pointerType === "touch") next.timer = setTimeout(() => begin(next), TOUCH_DELAY_MS);
    }

    function onPointerMove(event: PointerEvent): void {
        const from = pending;
        if (from !== null && event.pointerId === from.pointerId) {
            const moved = Math.hypot(event.clientX - from.x, event.clientY - from.y);
            if (from.pointerType === "touch") {
                if (moved > TOUCH_TOLERANCE_PX) clearPending();
            } else if (moved >= DRAG_DISTANCE_PX) {
                begin({...from, x: event.clientX, y: event.clientY});
            }
        }
        if (active !== null && event.pointerId === active.pointerId) {
            active.x = event.clientX;
            active.y = event.clientY;
            if (frame === 0) frame = requestAnimationFrame(publish);
            if (scrollFrame === 0 && edgeStep(active.x, active.y) !== 0) scrollFrame = requestAnimationFrame(autoScroll);
        }
    }

    function onPointerUp(event: PointerEvent): void {
        if (pending !== null && event.pointerId === pending.pointerId) clearPending();
        const current = active;
        if (current === null || event.pointerId !== current.pointerId) return;
        if (autoScrolling) {
            // 边缘滚动中松手：显示的落点是上一帧滚动之前判的，这一刻指针下的行可能已经换了。先停滚，等虚拟列表按最后的
            // 滚动位置渲染完，再交一次落点让它显示出来，然后按同一个落点放下，不让这次放下因为“与显示的不同”而静默不写。
            if (scrollFrame !== 0) cancelAnimationFrame(scrollFrame);
            scrollFrame = 0;
            autoScrolling = false;
            swallowClick = true;
            const at = {x: event.clientX, y: event.clientY};
            requestAnimationFrame(() => {
                if (active !== current) return;
                const target = pointAt(at.x, at.y);
                options.hover(target, at);
                end();
                options.drop(target);
            });
            return;
        }
        const target = pointAt(event.clientX, event.clientY);
        end();
        options.drop(target);
    }

    function onPointerCancel(event: PointerEvent): void {
        if (pending !== null && event.pointerId === pending.pointerId) clearPending();
        if (active !== null && event.pointerId === active.pointerId) cancel();
    }

    function onClick(event: MouseEvent): void {
        if (!swallowClick || event.detail === 0) return;
        swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
    }

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("click", onClick, true);
    view.addEventListener("pointermove", onPointerMove, true);
    view.addEventListener("pointerup", onPointerUp, true);
    view.addEventListener("pointercancel", onPointerCancel, true);

    return {
        invalidate: () => {
            if (active === null) return;
            if (frame !== 0) cancelAnimationFrame(frame);
            frame = 0;
            options.hover(null, {x: active.x, y: active.y});
        },
        abort: () => {
            end();
        },
        dispose: () => {
            cancel();
            clearPending();
            root.removeEventListener("pointerdown", onPointerDown);
            root.removeEventListener("click", onClick, true);
            view.removeEventListener("pointermove", onPointerMove, true);
            view.removeEventListener("pointerup", onPointerUp, true);
            view.removeEventListener("pointercancel", onPointerCancel, true);
        },
    };
}
