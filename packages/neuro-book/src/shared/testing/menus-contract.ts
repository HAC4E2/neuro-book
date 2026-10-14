/**
 * 测试插件 `test.menus` 的描述与命令（docs/specs/workbench/menus.md 的验收）：只由测试引用。它只有浏览器入口，往别的插件
 * 拥有的菜单位置贡献菜单项（视图标题给 `test.sample-views` 的视图）；它的命令把收到的参数发成一条常驻通知，e2e 读通知的
 * 文字核对菜单项执行时收到了什么。宿主测试入口按 `NBOOK_TEST_PLUGINS` 把描述加进本进程清单。
 */

import type {PluginDescriptor} from "nbook/manifest";

export const testMenusDescriptor: PluginDescriptor = {id: "test.menus", version: "0.1.0", locations: ["browser"]};

export const TEST_MENUS_RECORD_COMMAND = "test.menus.record";

/** 通知的文字：`收到 <参数的 JSON>`。 */
export const recordedText = (args: unknown): string => `收到 ${JSON.stringify(args)}`;
