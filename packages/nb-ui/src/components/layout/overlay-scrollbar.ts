/**
 * 叠加滚动条（`OverlayScrollbar`）的几何：纯函数，输入滚动元素的三个读数，给出滑块的位置与大小，以及拖动、点轨道时的
 * 目标滚动位置。轨道就是滚动元素的可见高度，滑块高度与可见比例相同、不小于下限。
 */

/** 滚动元素的三个读数（`scrollTop`、`clientHeight`、`scrollHeight`）。 */
export interface ScrollMetrics {
    readonly scrollTop: number;
    readonly clientHeight: number;
    readonly scrollHeight: number;
}

/** 滑块：`null` 表示内容不溢出、不画。 */
export interface ThumbGeometry {
    readonly offset: number;
    readonly size: number;
}

/** 滑块最短 20px：内容很长时仍能抓住。 */
export const MIN_THUMB_PX = 20;

/** 内容只比可见区高出不到 1px 时按不溢出算：缩放与小数像素会让 scrollHeight 比 clientHeight 多出零点几。 */
const OVERFLOW_EPSILON = 1;

const maxScroll = (metrics: ScrollMetrics): number => Math.max(0, metrics.scrollHeight - metrics.clientHeight);

export function thumbGeometry(metrics: ScrollMetrics, minThumb = MIN_THUMB_PX): ThumbGeometry | null {
    const {clientHeight, scrollHeight} = metrics;
    if (clientHeight <= 0 || scrollHeight - clientHeight < OVERFLOW_EPSILON) return null;
    const size = Math.min(clientHeight, Math.max(minThumb, (clientHeight * clientHeight) / scrollHeight));
    const travel = clientHeight - size;
    const range = maxScroll(metrics);
    const offset = range > 0 ? (Math.min(Math.max(metrics.scrollTop, 0), range) / range) * travel : 0;
    return {offset, size};
}

/** 从按下时的滚动位置起，指针纵向移动 `delta` 像素后的滚动位置：滑块走完轨道等于内容滚完。 */
export function dragScrollTop(start: ScrollMetrics, delta: number, minThumb = MIN_THUMB_PX): number {
    const thumb = thumbGeometry(start, minThumb);
    const range = maxScroll(start);
    if (thumb === null || range === 0) return start.scrollTop;
    const travel = start.clientHeight - thumb.size;
    if (travel <= 0) return start.scrollTop;
    return Math.min(range, Math.max(0, start.scrollTop + (delta / travel) * range));
}

/** 点在滑块以外的轨道上：朝那一侧滚一页（可见高度），不越界。`at` 是点击处相对轨道顶的纵坐标。 */
export function pageScrollTop(metrics: ScrollMetrics, at: number, minThumb = MIN_THUMB_PX): number {
    const thumb = thumbGeometry(metrics, minThumb);
    if (thumb === null) return metrics.scrollTop;
    const range = maxScroll(metrics);
    if (at < thumb.offset) return Math.max(0, metrics.scrollTop - metrics.clientHeight);
    if (at > thumb.offset + thumb.size) return Math.min(range, metrics.scrollTop + metrics.clientHeight);
    return metrics.scrollTop;
}
