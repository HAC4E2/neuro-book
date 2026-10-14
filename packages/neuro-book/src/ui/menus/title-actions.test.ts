/**
 * 标题行的拼装（title-actions.ts）：按钮自己的在前、贡献的在后、有上限；其余进“⋯”，自己的一节在前，贡献的保留原来的分节
 * 与节内顺序（docs/specs/workbench/views.md 输出 11、docs/specs/workbench/editor.md 输出 34、docs/specs/workbench/menus.md 输出 4）。
 */

import {describe, expect, it} from "bun:test";

import {assembleTitleActions, buttonBudget} from "./title-actions";
import type {TitleActionCandidate} from "./title-actions";

const candidate = (key: string, menu = false): TitleActionCandidate => ({menu, entry: {key, command: `test.${key}`, title: key, icon: menu ? null : "i-x", disabledReason: null}});
const keys = (model: ReturnType<typeof assembleTitleActions>) => ({buttons: model.buttons.map((entry) => entry.key), menu: model.menu.map((section) => section.map((entry) => entry.key))});

describe("标题行的拼装", () => {
    it("放不下的按钮回到它自己的那一节：自己的一节在前，贡献的各节按原来的顺序", () => {
        const own = [candidate("own:a"), candidate("own:menu", true)];
        const contributed = [[candidate("x:1"), candidate("x:menu", true), candidate("x:2")], [candidate("y:1"), candidate("y:menu", true)]];
        expect(keys(assembleTitleActions(own, contributed, 2))).toEqual({
            buttons: ["own:a", "x:1"],
            menu: [["own:menu"], ["x:menu", "x:2"], ["y:1", "y:menu"]],
        });
    });

    it("自己的按钮也放不下时，它们排在自己那一节里、在 menu 动作之前（按声明顺序）；上限为 0 时全部进“⋯”", () => {
        const own = [candidate("own:a"), candidate("own:b"), candidate("own:menu", true)];
        expect(keys(assembleTitleActions(own, [[candidate("x:1")]], 1))).toEqual({buttons: ["own:a"], menu: [["own:b", "own:menu"], ["x:1"]]});
        expect(keys(assembleTitleActions(own, [], 0))).toEqual({buttons: [], menu: [["own:a", "own:b", "own:menu"]]});
    });

    it("都放得下时“⋯”里只有声明了 menu 的项；没有项的节不出现", () => {
        expect(keys(assembleTitleActions([candidate("own:a")], [[candidate("x:1")], []], 8))).toEqual({buttons: ["own:a", "x:1"], menu: []});
    });
});

describe("按宽度算按钮个数", () => {
    it("先留出别的内容与“⋯”的一格，余下按每格 26px 算，至多 max；放不下时为 0；量不到宽度时按 max", () => {
        expect(buttonBudget(null, 100, 4)).toBe(4);
        expect(buttonBudget(1000, 100, 4)).toBe(4);
        expect(buttonBudget(100 + 24 + 26 * 2, 100, 4)).toBe(2);
        expect(buttonBudget(100 + 24 + 26 * 2 - 1, 100, 4)).toBe(1);
        expect(buttonBudget(80, 100, 4)).toBe(0);
    });
});
