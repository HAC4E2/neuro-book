/**
 * 标题栏应用菜单的数据（docs/specs/ui/workbench-shell.md 外壳四输出 29）：四个组的条目来自贡献点 `workbench.titlebar-menu`，
 * 由 `titlebar-source.ts` 按菜单项的共同规则（docs/specs/workbench/menus.md）算好交给菜单组件；执行由组件经命令服务
 * `execute(command, args)` 完成。本文件只有菜单的形状与“焦点在原生输入框里”的改写，纯函数。
 */

import type {MenuEntry} from "nbook/plugins/commands/shared/contracts";

export type {MenuEntry};

export interface MenuGroup {
    readonly id: string;
    readonly label: string;
    readonly sections: ReadonlyArray<ReadonlyArray<MenuEntry>>;
}

/** 原生输入框自己处理的编辑命令：焦点在输入框里时菜单不代替它（外壳四输出 29）。 */
export const NATIVE_EDIT_COMMANDS: ReadonlySet<string> = new Set(["nbook.edit.undo", "nbook.edit.redo"]);

/** 焦点在原生输入框里时的菜单：撤销、重做画成禁用并给出原因，其余不变。 */
export function withNativeEditing(groups: ReadonlyArray<MenuGroup>, reason: string): MenuGroup[] {
    return groups.map((group) => ({
        ...group,
        sections: group.sections.map((section) => section.map((entry) => (NATIVE_EDIT_COMMANDS.has(entry.command) ? {...entry, enabled: false, reason} : entry))),
    }));
}
