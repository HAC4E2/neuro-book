/**
 * 标题栏逐级让位（docs/specs/ui/workbench-shell.md 输出 30）：按实测宽度“放不下就收下一项”，不写死宽度边界。纯函数，
 * 各部件在各种样子下的宽度由组件从测量层量出来传入。
 *
 * 档位从 0（全部展开）到 5，每升一档多收一项：
 *   1 横排标志换成图形标志；2 菜单栏收成 ≡；3 收起搜索里的快捷键提示；4 布局按钮收进 ≡ 的“视图”组；5 项目切换只留图标。
 * 每一档要的宽度是两侧内容加上搜索的舒适宽度 `search`：搜索宁可先保住，两侧先让；全部收完之后搜索才继续收窄，
 * 最窄的那一档由组件的网格保证（外壳四输出 30 的 120px）。
 */

export const TITLEBAR_MAX_LEVEL = 5;

/** 往回展开时多留的余量：窗口宽在切换点附近来回拖时不跳。 */
export const TITLEBAR_HYSTERESIS_PX = 40;

export interface TitlebarWidths {
    /** 横排标志、图形标志（都含外边距）。 */
    readonly lockup: number;
    readonly mark: number;
    /** 项目切换：带显示名、只留图标。 */
    readonly project: number;
    readonly projectIcon: number;
    /** 项目与菜单之间的短分隔（含外边距）。 */
    readonly divider: number;
    /** 完整菜单栏、收起后的 ≡ 按钮。 */
    readonly menubar: number;
    readonly menuIcon: number;
    /** 搜索里的快捷键提示（含与文字的间距）；没有快捷键时为 0。 */
    readonly shortcut: number;
    /** 三个布局按钮连同它们之间的间距。 */
    readonly layout: number;
    /** 条目区收到最少时的宽度（只剩“更多”）；没有条目为 0。 */
    readonly items: number;
    /** 组内相邻两项的间距。 */
    readonly gap: number;
    /** 标题栏左右内边距与三栏之间的间距之和。 */
    readonly chrome: number;
    /** 判定让位时搜索要留的宽度（不含快捷键提示）。 */
    readonly search: number;
}

/** 这一档要的宽度。 */
export function titlebarRequired(widths: TitlebarWidths, level: number): number {
    const start = [level < 1 ? widths.lockup : widths.mark, level < 5 ? widths.project : widths.projectIcon, widths.divider, level < 2 ? widths.menubar : widths.menuIcon];
    const end = [...(level < 4 ? [widths.layout] : []), ...(widths.items > 0 ? [widths.items] : [])];
    const sum = (parts: ReadonlyArray<number>): number => parts.reduce((total, part) => total + part, 0) + widths.gap * Math.max(0, parts.length - 1);
    const search = widths.search + (level < 3 ? widths.shortcut : 0);
    return widths.chrome + sum(start) + search + sum(end);
}

/** 放得下的最宽松一档；都放不下时是最后一档。 */
function levelFor(widths: TitlebarWidths, available: number): number {
    for (let level = 0; level < TITLEBAR_MAX_LEVEL; level += 1) if (titlebarRequired(widths, level) <= available) return level;
    return TITLEBAR_MAX_LEVEL;
}

/** 下一档：变窄放不下就收；变宽要多出余量才放，否则保持。 */
export function titlebarLevel(widths: TitlebarWidths, available: number, current: number): number {
    const tight = levelFor(widths, available);
    if (tight > current) return tight;
    const loose = levelFor(widths, available - TITLEBAR_HYSTERESIS_PX);
    return loose < current ? loose : current;
}
