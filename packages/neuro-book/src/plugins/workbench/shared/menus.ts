/**
 * 工作台拥有的菜单位置（docs/specs/workbench/menus.md 的位置表）：标题栏应用菜单 `workbench.titlebar-menu`。菜单项的共同形状、
 * 校验与排序在命令插件的共享合同里，这里只加位置自己的字段。声明是纯数据，前后端都能引用。
 */

import {Type} from "typebox";

import {menuItemValidator, menuLocation} from "nbook/plugins/commands/shared/contracts";
import type {MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {LocalizedText} from "nbook/shared/localized-text";

export const WORKBENCH_TITLEBAR_MENU_POINT = "workbench.titlebar-menu";

/** 标题栏的四个组，按这个顺序画（docs/specs/ui/workbench-shell.md 外壳四输出 29）。组由工作台定，条目由各插件贡献。 */
export const TITLEBAR_MENU_GROUPS = [
    {id: "file", title: {"zh-CN": "文件", "en-US": "File"}},
    {id: "edit", title: {"zh-CN": "编辑", "en-US": "Edit"}},
    {id: "view", title: {"zh-CN": "视图", "en-US": "View"}},
    {id: "help", title: {"zh-CN": "帮助", "en-US": "Help"}},
] as const satisfies ReadonlyArray<{readonly id: string; readonly title: LocalizedText}>;

export type TitlebarMenuGroup = (typeof TITLEBAR_MENU_GROUPS)[number]["id"];

export type TitlebarMenuItemDeclaration = MenuItemDeclaration & {readonly group: TitlebarMenuGroup};

export const titlebarMenuLocation = menuLocation(WORKBENCH_TITLEBAR_MENU_POINT, {group: Type.Union(TITLEBAR_MENU_GROUPS.map((group) => Type.Literal(group.id)))});

export const validateTitlebarMenuItem = menuItemValidator(titlebarMenuLocation);
