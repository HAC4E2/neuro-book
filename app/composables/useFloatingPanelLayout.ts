import {computed, nextTick, ref, watch, type Ref} from "vue";
import {useEventListener, useResizeObserver} from "@vueuse/core";

export type FloatingPanelDirection = "auto" | "down" | "up";

interface UseFloatingPanelLayoutOptions {
    open: Ref<boolean>;
    anchorRef: Ref<HTMLElement | null>;
    panelRef: Ref<HTMLElement | null>;
    direction: Ref<FloatingPanelDirection>;
    maxHeight?: number;
    minHeight?: number;
    viewportGap?: number;
    matchAnchorWidth?: boolean;
}

/**
 * 统一计算浮层的展开方向、宽度与最大高度。
 * 适用于需要和锚点同宽，并支持 up/down/auto 的下拉层。
 */
export function useFloatingPanelLayout(options: UseFloatingPanelLayoutOptions) {
    const maxHeight = options.maxHeight ?? 192;
    const minHeight = options.minHeight ?? 96;
    const viewportGap = options.viewportGap ?? 12;
    const matchAnchorWidth = options.matchAnchorWidth ?? true;

    const resolvedDirection = ref<"down" | "up">("down");
    const panelWidth = ref<number | null>(null);
    const panelMaxHeight = ref(maxHeight);

    /**
     * 根据锚点与视口空间刷新浮层布局。
     */
    const updateLayout = (): void => {
        const anchorElement = options.anchorRef.value;
        const panelElement = options.panelRef.value;

        if (!import.meta.client || !anchorElement) {
            resolvedDirection.value = options.direction.value === "up" ? "up" : "down";
            panelWidth.value = null;
            panelMaxHeight.value = maxHeight;
            return;
        }

        if (matchAnchorWidth) {
            panelWidth.value = Math.round(anchorElement.getBoundingClientRect().width);
        }

        if (options.direction.value === "down" || options.direction.value === "up") {
            resolvedDirection.value = options.direction.value;
            panelMaxHeight.value = maxHeight;
            return;
        }

        const anchorRect = anchorElement.getBoundingClientRect();
        const contentHeight = Math.min(panelElement?.scrollHeight || maxHeight, maxHeight);
        const bottomSpace = Math.max(window.innerHeight - anchorRect.bottom - viewportGap, 0);
        const topSpace = Math.max(anchorRect.top - viewportGap, 0);

        if (bottomSpace >= contentHeight) {
            resolvedDirection.value = "down";
        } else if (topSpace >= contentHeight) {
            resolvedDirection.value = "up";
        } else {
            resolvedDirection.value = topSpace > bottomSpace ? "up" : "down";
        }

        const availableSpace = resolvedDirection.value === "down" ? bottomSpace : topSpace;
        panelMaxHeight.value = Math.max(Math.min(availableSpace, maxHeight), minHeight);
    };

    watch(
        [options.open, options.direction],
        async ([open]) => {
            if (!open) {
                return;
            }
            await nextTick();
            updateLayout();
        },
        {flush: "post"},
    );

    useResizeObserver(options.anchorRef, () => {
        if (options.open.value) {
            updateLayout();
        }
    });

    useResizeObserver(options.panelRef, () => {
        if (options.open.value) {
            updateLayout();
        }
    });

    if (import.meta.client) {
        useEventListener(window, "resize", () => {
            if (options.open.value) {
                updateLayout();
            }
        });

        useEventListener(window, "scroll", () => {
            if (options.open.value) {
                updateLayout();
            }
        }, {capture: true, passive: true});
    }

    const panelStyle = computed(() => ({
        maxHeight: `${String(panelMaxHeight.value)}px`,
        width: panelWidth.value === null ? undefined : `${String(panelWidth.value)}px`,
    }));

    return {
        resolvedDirection,
        panelStyle,
        updateLayout,
    };
}
