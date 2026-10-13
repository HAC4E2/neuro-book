/**
 * 拖动时的预备区（docs/specs/ui/workbench-shell.md 外壳三输出 20）：此刻没显示的侧栏、右栏、面板，按“显示出来会在
 * 哪里、多大”求出矩形，叠在当前布局上当落点，不改布局。
 */

import {createShellGrid, projectShell, shellNodeRects} from "./layout";
import type {ShellNodeRect, ShellProjectionInput} from "./layout";

export type RevealPart = "sidebar" | "auxiliarybar" | "panel";

export const REVEAL_PARTS: ReadonlyArray<RevealPart> = ["sidebar", "auxiliarybar", "panel"];

export interface RevealZone {
    readonly part: RevealPart;
    /** 相对外壳网格根的矩形。 */
    readonly rect: ShellNodeRect;
}

/** 此刻没显示的：隐藏（含空着缺省不显示）或拖到零。面板收成标题头仍算显示。 */
export function hiddenRevealParts(input: Pick<ShellProjectionInput, "panel" | "hiddenParts" | "dragCollapsedParts">): RevealPart[] {
    return REVEAL_PARTS.filter((part) => (part === "panel"
        ? input.panel.hidden || input.dragCollapsedParts?.panel === true
        : (input.hiddenParts ?? []).includes(part) || input.dragCollapsedParts?.[part] === true));
}

/**
 * 把没显示的 Part 一起当作显示（隐藏位与拖到零都清掉，面板不收起、不最大化，与“显示面板”一致）再投影一次，取它们的
 * 叶矩形。一起投影，预备区之间就不会重叠。显示之后是紧凑呈现就不浮出：那时 Part 叠放，没有“显示在哪里”；多显示几个
 * Part 只会更容易进紧凑，所以此刻已经紧凑时这里同样为空。
 */
export function revealZones(input: ShellProjectionInput): RevealZone[] {
    const parts = hiddenRevealParts(input);
    if (parts.length === 0) return [];
    const revealed = new Set<string>(parts);
    const shown: ShellProjectionInput = {
        ...input,
        panel: revealed.has("panel") ? {...input.panel, hidden: false, collapsed: false, maximized: false} : input.panel,
        hiddenParts: (input.hiddenParts ?? []).filter((part) => !revealed.has(part)),
        dragCollapsedParts: Object.fromEntries(Object.entries(input.dragCollapsedParts ?? {}).filter(([part]) => !revealed.has(part))),
    };
    const projection = projectShell(shown);
    if (projection.mode === "compact") return [];
    const grid = createShellGrid(projection);
    const rects = shellNodeRects(grid, grid.layout(input.extent));
    return parts.flatMap((part) => {
        const rect = rects[part];
        return rect !== undefined && rect.right > rect.left && rect.bottom > rect.top ? [{part, rect}] : [];
    });
}
