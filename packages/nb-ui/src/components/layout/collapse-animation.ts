/**
 * 折叠内容的高度动画进行中打 `data-animating`（styles.css 只在这时裁切）。挂在内容元素自己的 animationstart、
 * animationend、animationcancel 上，用 `.self` 过滤掉里面子元素冒上来的动画事件。
 */
export function markCollapseAnimation(event: AnimationEvent): void {
    (event.currentTarget as HTMLElement).toggleAttribute("data-animating", event.type === "animationstart");
}
