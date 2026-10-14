/**
 * 本窗口提交的结构变化的预告（docs/specs/workbench/files-explorer.md 的“动画”）：控制器在提交之前发出，树在之后的刷新里
 * 认出这些地址才放动画。其它原因的刷新（外部改动、别的窗口）没有预告，也就没有动画。
 */
export interface MotionNote {
    /** 每份预告不同：同样内容的两次提交也要各认一次。 */
    readonly id: number;
    /** 移动、放到指定位置与调整顺序：原地址 → 新地址（调整顺序两者相同）。 */
    readonly moves: ReadonlyArray<{readonly from: string; readonly to: string}>;
    /** 新建与粘贴出来的地址。 */
    readonly arrivals: ReadonlyArray<string>;
    /** 要删除的地址。 */
    readonly departures: ReadonlyArray<string>;
}
