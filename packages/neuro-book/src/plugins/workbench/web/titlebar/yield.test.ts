/**
 * 标题栏逐级让位（docs/specs/ui/workbench-shell.md 输出 30）：档位按“这一档要的宽度”判定，顺序固定，往回展开要余量。
 */

import {describe, expect, it} from "bun:test";

import {TITLEBAR_HYSTERESIS_PX, titlebarLevel, titlebarRequired} from "./yield";
import type {TitlebarWidths} from "./yield";

const widths: TitlebarWidths = {lockup: 120, mark: 26, project: 110, projectIcon: 44, divider: 9, menubar: 190, menuIcon: 32, shortcut: 90, layout: 92, items: 0, gap: 4, chrome: 32, search: 480};

describe("标题栏逐级让位", () => {
    it("每一档按顺序多收一项：标志、菜单栏、快捷键提示、布局按钮、项目名；要的宽度单调变小", () => {
        const required = [0, 1, 2, 3, 4, 5].map((level) => titlebarRequired(widths, level));
        expect(required).toEqual([...required].sort((a, b) => b - a));
        expect(required[0]! - required[1]!).toBe(widths.lockup - widths.mark);
        expect(required[1]! - required[2]!).toBe(widths.menubar - widths.menuIcon);
        expect(required[2]! - required[3]!).toBe(widths.shortcut);
        expect(required[3]! - required[4]!).toBe(widths.layout);
        expect(required[4]! - required[5]!).toBe(widths.project - widths.projectIcon);
    });

    it("放得下就不收；差一点就收下一项；比最后一档还窄时停在最后一档", () => {
        const full = titlebarRequired(widths, 0);
        expect(titlebarLevel(widths, full, 0)).toBe(0);
        expect(titlebarLevel(widths, full - 1, 0)).toBe(1);
        expect(titlebarLevel(widths, titlebarRequired(widths, 2) - 1, 0)).toBe(3);
        expect(titlebarLevel(widths, 100, 0)).toBe(5);
    });

    it("往回展开要多出 40px：在切换点附近来回不跳", () => {
        const edge = titlebarRequired(widths, 1);
        const collapsed = titlebarLevel(widths, edge - 1, 1);
        expect(collapsed).toBe(2);
        expect(titlebarLevel(widths, edge, collapsed)).toBe(2);
        expect(titlebarLevel(widths, edge + TITLEBAR_HYSTERESIS_PX - 1, collapsed)).toBe(2);
        expect(titlebarLevel(widths, edge + TITLEBAR_HYSTERESIS_PX, collapsed)).toBe(1);
    });

    it("有条目时条目区的最小宽度也算进去；没有快捷键时第 3 档不省宽度", () => {
        expect(titlebarRequired({...widths, items: 28}, 0) - titlebarRequired(widths, 0)).toBe(28 + widths.gap);
        const plain = {...widths, shortcut: 0};
        expect(titlebarRequired(plain, 2)).toBe(titlebarRequired(plain, 3));
    });
});
