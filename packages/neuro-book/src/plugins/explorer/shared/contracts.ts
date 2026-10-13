/**
 * `nbook.explorer` 对其它插件公开的合同：右键菜单的菜单位置 `explorer.context`（docs/specs/workbench/files-explorer.md 的
 * “右键菜单”，菜单项的共同规则见 docs/specs/workbench/menus.md）。贡献项排在资源管理器自己的固定动作之后；当前文件是这次
 * 右键作用的选择，`context: "selection"` 的项执行时收到 `{addresses}`。其它插件在运行时只引用本文件。
 */

import {MENU_EXTENSIONS, menuItemValidator, menuLocation} from "nbook/plugins/commands/shared/contracts";
import type {MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";

export const EXPLORER_CONTEXT_POINT = "explorer.context";

export type ExplorerContextItemDeclaration = MenuItemDeclaration;

export const explorerContextLocation = menuLocation(EXPLORER_CONTEXT_POINT, {...MENU_EXTENSIONS}, {contexts: ["selection"]});

export const validateExplorerContextItem = menuItemValidator(explorerContextLocation);
