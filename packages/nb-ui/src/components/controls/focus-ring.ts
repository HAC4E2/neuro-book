/** 焦点画法：缺省外扩光晕；控件填满所在的条、四周没有余地时用内嵌焦点线（styles.css）。 */
export type FocusRingStyle = "outer" | "inset";

export function focusRingClass(style: FocusRingStyle): string {
    return style === "inset" ? "nb-ui-focus-ring-inset" : "nb-ui-focus-ring";
}
