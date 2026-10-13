import {applyColorway} from "@notnotype/nb-ui";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import type {ITheme} from "@xterm/xterm";
import {terminalFontFamily} from "./terminal-font.js";

/**
 * 终端块一律暗色（评审板第三轮的做法），页面的明暗切换不影响它。颜色在运行时从 nb-ui 的暗色配色读（token），不写字面颜色
 * （nb-ui 界面开发规范第 2 节）：先给终端的容器套上 nbook 暗色配色，再 `getComputedStyle` 读变量。nb-ui 只有红、绿、黄、蓝、青
 * 对得上状态色与强调色，其余 ANSI 色用 xterm.js 的缺省值。
 */
export function applyTerminalScope(container: HTMLElement): void {
    applyColorway(container, nbookTheme.colorways!["nbook-dark"]!);
}

export function readTerminalTheme(container: HTMLElement): ITheme {
    const style = getComputedStyle(container);
    const token = (name: string) => style.getPropertyValue(name).trim() || undefined;
    return {
        background: token("--bg-main"),
        foreground: token("--text-main"),
        cursor: token("--text-main"),
        cursorAccent: token("--bg-main"),
        selectionBackground: token("--selection-bg") ?? token("--accent-bg"),
        red: token("--status-danger"),
        green: token("--status-success"),
        yellow: token("--status-warning"),
        blue: token("--accent-main"),
        cyan: token("--status-info"),
    };
}

/** 从元素上读 `--font-mono` 的计算值并拼成字体串。 */
export function readTerminalFont(element: HTMLElement): string {
    return terminalFontFamily(getComputedStyle(element).getPropertyValue("--font-mono"));
}

/**
 * 这串字体下一个格子的宽度与字号之比，与 xterm 的量法相同；canvas 不接受这串字体时回 null（读回来不是设的字号）。
 * 观看时按它缩字号，让整屏放进容器。
 */
export function measureCellRatio(family: string): number | null {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return null;
    context.font = `100px ${family}`;
    if (!context.font.startsWith("100px")) return null;
    return context.measureText("W").width / 100;
}
