/**
 * 标题栏菜单的“焦点在原生输入框里”改写（docs/specs/ui/workbench-shell.md 外壳四输出 29）。条目从哪里来、怎样排见
 * `workbench/titlebar-menu.test.ts`（真实内核）与命令插件的 `shared/menus.test.ts`。
 */

import {describe, expect, it} from "bun:test";

import type {MenuEntry} from "./menu-model";
import {withNativeEditing} from "./menu-model";

const entry = (id: string, label: string, extra: Partial<MenuEntry> = {}): MenuEntry => ({id, command: id, args: {}, context: null, label, enabled: true, reason: null, shortcut: null, checked: null, icon: null, placement: "inline", ...extra});

describe("Spec ui.workbench-shell 外壳四输出 29：原生输入框", () => {
    it("焦点在原生输入框里时撤销、重做禁用并带原因，其余条目与分组不变", () => {
        const groups = [
            {id: "edit", label: "编辑", sections: [[
                entry("nbook.edit.undo", "撤销", {shortcut: "Ctrl+Z"}),
                entry("nbook.edit.redo", "重做", {enabled: false, reason: "没有活动的编辑器"}),
            ]]},
            {id: "view", label: "视图", sections: [[entry("nbook.view.x", "侧栏", {checked: true})]]},
        ];
        const result = withNativeEditing(groups, "焦点在输入框里时由它自己撤销");
        expect(result[0]?.sections[0]?.map((entry) => [entry.enabled, entry.reason, entry.shortcut])).toEqual([[false, "焦点在输入框里时由它自己撤销", "Ctrl+Z"], [false, "焦点在输入框里时由它自己撤销", null]]);
        expect(result[1]).toEqual(groups[1]);
        expect(groups[0]?.sections[0]?.[0]?.enabled).toBe(true);
    });
});
