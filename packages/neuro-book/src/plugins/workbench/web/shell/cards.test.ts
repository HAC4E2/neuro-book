/**
 * 外壳部件的卡片边（docs/specs/ui/workbench-shell.md 输出 38）：用真实的外壳投影，看各种位置、隐藏、拖到零、最大化与
 * 紧凑呈现下每个部件四边各挨着什么，以及活动栏何时与侧栏相连。
 */
import {describe, expect, it} from "bun:test";
import type {GridExtent} from "@notnotype/nb-ui/layout";

import {shellCardInset, shellCards} from "./cards";
import type {ShellCardSide} from "./cards";
import {projectShell} from "./layout";
import type {ShellProjectionInput} from "./layout";
import type {PanelState} from "./panel-state";
import {SHELL_COMPACT_WIDTH, SHELL_SIZE_DEFAULTS} from "./sizes";

const VIEWPORT: GridExtent = {width: 1440, height: 900};
const PANEL: PanelState = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false};

function cards(overrides: Partial<ShellProjectionInput> = {}) {
    return shellCards(projectShell({extent: VIEWPORT, preferences: SHELL_SIZE_DEFAULTS, panel: PANEL, hiddenParts: [], ...overrides}));
}

const outer: ShellCardSide = {kind: "outer"};
const joined: ShellCardSide = {kind: "joined"};
const inner = (occupied: number): ShellCardSide => ({kind: "inner", occupied});

describe("外壳部件的卡片边", () => {
    it("缺省布局（底部居中面板、没有右栏）：活动栏与侧栏相连，其余按挨着的部件留半缝、贴边留整缝", () => {
        const result = cards({hiddenParts: ["auxiliarybar"]});
        expect(result.activitybar).toEqual({top: outer, right: joined, bottom: outer, left: outer});
        expect(result.sidebar).toEqual({top: outer, right: inner(1), bottom: outer, left: joined});
        expect(result.editor).toEqual({top: outer, right: outer, bottom: inner(1), left: inner(1)});
        expect(result.panel).toEqual({top: inner(1), right: outer, bottom: outer, left: inner(1)});
        expect(result.auxiliarybar).toBeUndefined();
    });

    it("右栏显示：编辑区与面板的右边挨着右栏，右栏贴着窗体右缘", () => {
        const result = cards();
        expect(result.editor?.right).toEqual(inner(1));
        expect(result.panel?.right).toEqual(inner(1));
        expect(result.auxiliarybar).toEqual({top: outer, right: outer, bottom: outer, left: inner(1)});
    });

    it("侧栏拖到零：活动栏不再相连；编辑区左边越过零宽的侧栏挨着活动栏，占用是侧栏那条 1px 边界", () => {
        const result = cards({hiddenParts: ["auxiliarybar"], dragCollapsedParts: {sidebar: true}});
        expect(result.activitybar?.right).toEqual(inner(1));
        expect(result.editor?.left).toEqual(inner(1));
        expect(result.sidebar?.left).toEqual(inner(0));
    });

    it("侧栏隐藏或面板跨到侧栏下方（左对齐）时不相连；活动栏隐藏时侧栏贴着窗体左缘", () => {
        expect(cards({hiddenParts: ["sidebar"]}).activitybar?.right).toEqual(inner(0));
        const spanning = cards({panel: {...PANEL, alignment: "left"}});
        expect(spanning.activitybar?.right).toEqual(inner(0));
        expect(spanning.sidebar?.left).toEqual(inner(0));
        expect(spanning.sidebar?.bottom).toEqual(inner(1));
        expect(spanning.panel?.left).toEqual(inner(0));
        expect(cards({hiddenParts: ["activitybar"]}).sidebar?.left).toEqual(outer);
    });

    it("面板在右侧：编辑区与面板横排；最大化时编辑区为零，面板顶到标题栏下", () => {
        const right = cards({hiddenParts: ["auxiliarybar"], panel: {...PANEL, position: "right"}});
        expect(right.editor?.right).toEqual(inner(1));
        expect(right.panel).toEqual({top: outer, right: outer, bottom: outer, left: inner(1)});
        const maximized = cards({panel: {...PANEL, maximized: true}});
        expect(maximized.panel?.top).toEqual(outer);
    });

    it("紧凑呈现：其余部件在活动栏右侧上下排，都不与活动栏相连", () => {
        const result = cards({extent: {width: SHELL_COMPACT_WIDTH - 1, height: 900}});
        expect(result.activitybar?.right.kind).toBe("inner");
        expect(result.sidebar?.left.kind).toBe("inner");
        expect(result.sidebar?.top).toEqual(outer);
        expect(result.panel?.bottom).toEqual(outer);
        expect(result.editor?.top.kind).toBe("inner");
    });

    it("每一边留多宽：贴边整缝，相连 0，相邻半缝扣掉一半的边界占用、不小于 0", () => {
        expect(shellCardInset(outer)).toBe("var(--shell-gap, 0px)");
        expect(shellCardInset(joined)).toBe("0px");
        expect(shellCardInset(inner(1))).toBe("max(0px, calc(var(--shell-gap, 0px) / 2 - 0.5px))");
        expect(shellCardInset(inner(0))).toBe("max(0px, calc(var(--shell-gap, 0px) / 2 - 0px))");
    });
});
