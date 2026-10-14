import {describe, expect, test} from "bun:test";
import {wantsSearchFocus, type ShortcutKey, type ShortcutTarget} from "../src/web/host/shortcuts.js";

/** 外壳的搜索快捷键（t15 阶段 2d）：焦点在可编辑的地方、对话框里时不抢。 */
const key = (value: string, mods: Partial<ShortcutKey> = {}): ShortcutKey => ({key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, defaultPrevented: false, ...mods});
const element = (tagName: string, options: {type?: string; editable?: boolean; inside?: string[]} = {}): ShortcutTarget => ({
    tagName,
    isContentEditable: options.editable ?? false,
    getAttribute: (name) => (name === "type" ? options.type ?? null : null),
    closest: (selector) => ((options.inside ?? []).some((name) => selector.includes(name)) ? {} : null),
});

describe("搜索快捷键", () => {
    test("焦点在页面上（链接、按钮、body）时 / 与 Ctrl+K、Cmd+K 去搜索；别的组合不算", () => {
        for (const target of [element("A"), element("BUTTON"), element("BODY"), null, element("INPUT", {type: "checkbox"})]) {
            expect([wantsSearchFocus(key("/"), target), wantsSearchFocus(key("k", {ctrlKey: true}), target), wantsSearchFocus(key("K", {metaKey: true}), target)]).toEqual([true, true, true]);
        }
        expect([wantsSearchFocus(key("k"), null), wantsSearchFocus(key("/", {ctrlKey: true}), null), wantsSearchFocus(key("k", {ctrlKey: true, shiftKey: true}), null), wantsSearchFocus(key("]", {ctrlKey: true}), null)]).toEqual([false, false, false, false]);
    });

    test("焦点在输入框、textarea、contenteditable、xterm、对话框里时不处理；输入法组字中、已被拦下的按键也不处理", () => {
        const editable = [element("INPUT"), element("INPUT", {type: "search"}), element("TEXTAREA"), element("SELECT"), element("DIV", {editable: true}), element("TEXTAREA", {inside: [".xterm"]}), element("DIV", {inside: [".xterm"]}), element("BUTTON", {inside: ["dialog"]})];
        for (const target of editable) {
            expect([wantsSearchFocus(key("/"), target), wantsSearchFocus(key("k", {ctrlKey: true}), target)]).toEqual([false, false]);
        }
        expect([wantsSearchFocus(key("/", {isComposing: true}), null), wantsSearchFocus(key("/", {defaultPrevented: true}), null)]).toEqual([false, false]);
    });
});
