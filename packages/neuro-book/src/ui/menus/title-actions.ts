/**
 * 标题行动作的数据（视图标题 docs/specs/workbench/views.md 输出 10、11，编辑区标题 docs/specs/workbench/editor.md 输出 34）：
 * 按钮一排，“⋯”里按节分好。拥有者（工作台、编辑器）各自算出自己的动作与别的插件贡献的项，用 `assembleTitleActions`
 * 按同一规则拼起来：自己的在前、贡献的在后，按钮有上限，放不下的按钮回到它所在的那一节、收进“⋯”。纯函数，不认识命令。
 */

export interface TitleActionEntry {
    /** 稳定身份：拥有者自己的动作用它自己的写法（例如 `own:0`），贡献来的是贡献 id；执行时按它找回动作。 */
    readonly key: string;
    readonly command: string;
    readonly title: string;
    /** 收进“⋯”的项可以没有图标。 */
    readonly icon: string | null;
    /** 可用时为 null。 */
    readonly disabledReason: string | null;
    /** 按下态；不是开关的动作没有这一项。 */
    readonly pressed?: boolean;
    /** 按平台写好的快捷键，在“⋯”里显示；命令没有声明键位时没有这一项。 */
    readonly shortcut?: string;
}

export interface TitleActionsModel {
    readonly buttons: ReadonlyArray<TitleActionEntry>;
    /** 节之间画分隔线；为空时不画“⋯”。 */
    readonly menu: ReadonlyArray<ReadonlyArray<TitleActionEntry>>;
}

export interface TitleActionCandidate {
    readonly entry: TitleActionEntry;
    /** 声明了收进“⋯”（`placement: "menu"`）。 */
    readonly menu: boolean;
}

export const NO_TITLE_ACTIONS: TitleActionsModel = {buttons: [], menu: []};

/** 按钮（`IconButton` 的 xs）与它们之间的间距（`--space-1`），与 `TitleActions.vue` 的样式一致。 */
const BUTTON_PX = 24;
const GAP_PX = 2;

/**
 * 宽度给定时放得下几个按钮：先给别的内容留出 `reserved`，再给“⋯”留一格，剩下的按每格按钮加间距（26px）算，至多 `max` 个。量不到
 * 宽度（还没挂上）时按 `max`。
 */
export function buttonBudget(width: number | null, reserved: number, max: number): number {
    if (width === null) return max;
    return Math.max(0, Math.min(max, Math.floor((width - reserved - BUTTON_PX) / (BUTTON_PX + GAP_PX))));
}

/**
 * 拼出标题行：按钮是自己的按钮在前、贡献来的按钮在后，至多 `maxButtons` 个。其余的项都进“⋯”，按来源分节：自己的一节在前
 * （放不下的按钮与声明了 menu 的动作，按声明顺序），贡献来的各节在后、保留原来的分节与节内顺序。没有项的节不出现。
 */
export function assembleTitleActions(own: ReadonlyArray<TitleActionCandidate>, contributed: ReadonlyArray<ReadonlyArray<TitleActionCandidate>>, maxButtons: number): TitleActionsModel {
    const buttons = [...own, ...contributed.flat()].filter((item) => !item.menu).slice(0, Math.max(0, maxButtons)).map((item) => item.entry);
    const shown = new Set(buttons);
    const rest = (section: ReadonlyArray<TitleActionCandidate>): TitleActionEntry[] => section.map((item) => item.entry).filter((entry) => !shown.has(entry));
    return {buttons, menu: [rest(own), ...contributed.map(rest)].filter((section) => section.length > 0)};
}
