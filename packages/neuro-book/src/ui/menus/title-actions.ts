/**
 * 标题行动作的数据（视图标题 docs/specs/workbench/views.md 输出 10、11，编辑区标题 docs/specs/workbench/editor.md 输出 34）：
 * 按钮一排，“⋯”里按节分好。拥有者（工作台、编辑器）各自算出自己的动作与别的插件贡献的项，用 `assembleTitleActions`
 * 按同一规则拼起来：自己的在前、贡献的在后，按钮有上限，多出的收进“⋯”的第一节。纯函数，不认识命令。
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

/**
 * 拼出标题行：按钮是自己的按钮在前、贡献来的按钮在后，至多 `maxButtons` 个，多出的按顺序成为“⋯”的第一节；之后是自己的
 * 菜单动作一节，再是贡献来的菜单项（保留它们的分节）。没有项的节不出现。
 */
export function assembleTitleActions(own: ReadonlyArray<TitleActionCandidate>, contributed: ReadonlyArray<ReadonlyArray<TitleActionCandidate>>, maxButtons: number): TitleActionsModel {
    const buttons = [...own.filter((item) => !item.menu), ...contributed.flat().filter((item) => !item.menu)].map((item) => item.entry);
    const menu = [
        buttons.slice(maxButtons),
        own.filter((item) => item.menu).map((item) => item.entry),
        ...contributed.map((section) => section.filter((item) => item.menu).map((item) => item.entry)),
    ].filter((section) => section.length > 0);
    return {buttons: buttons.slice(0, maxButtons), menu};
}
