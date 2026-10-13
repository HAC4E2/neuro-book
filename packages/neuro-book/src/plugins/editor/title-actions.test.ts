/**
 * 编辑区标题的动作（docs/specs/workbench/editor.md 输出 34）：真实的命令注册表与编辑组布局。编辑器自己的“向右拆分”是按钮、
 * “用其它编辑器重新打开”在“⋯”里；别的插件的项排在后面，按后缀与当前文件显示，`context: "resource"` 的收到活动标签的
 * 地址；按钮至多 4 个；“⋯”的菜单身份随活动组与活动标签变。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";

import type {EditorTitleItemDeclaration} from "./shared/contracts";
import {REOPEN_WITH_COMMAND, SPLIT_RIGHT_COMMAND} from "./web/commands";
import {createEditorGroups} from "./web/groups/groups";
import {createEditorTitleActions} from "./web/title-actions";

const PREVIEW = "nbook.editor.preview-test";

function setup(items: ReadonlyArray<{readonly id: string; readonly declaration: EditorTitleItemDeclaration}>) {
    const calls: Array<[string, unknown]> = [];
    const commands = createCommandRegistry({contextKeys: contextTable({}, () => ({})), report: () => undefined});
    for (const [id, title] of [[SPLIT_RIGHT_COMMAND, "向右拆分"], [REOPEN_WITH_COMMAND, "用其它编辑器重新打开"], [PREVIEW, "预览"]] as const) {
        const registered = commands.register({
            id,
            source: "nbook.test",
            declaration: {title: {"zh-CN": title, "en-US": title}, description: "test", args: Type.Object({address: Type.Optional(Type.String())}, {additionalProperties: false}), effect: "read"},
            run: (args) => {
                calls.push([id, args]);
                return {ok: true, value: null};
            },
        });
        if (!registered.ok) throw new Error(registered.reason);
    }
    const groups = createEditorGroups();
    const titles = createEditorTitleActions({area: () => ({groups}), commands, state: {read: () => ({status: "undeclared"})}, items: () => items, platform: "other"});
    return {titles, groups, calls};
}

const keys = (entries: ReadonlyArray<{readonly key: string}>) => entries.map((entry) => entry.key);
const preview = (extra: Partial<EditorTitleItemDeclaration> = {}) => ({id: "acme.preview.button", declaration: {section: "1", command: PREVIEW, icon: "i-lucide-eye", extensions: [".md"], context: "resource", ...extra}});

describe("编辑区标题的动作（editor.md 输出 34）", () => {
    it("编辑器自己的：向右拆分是按钮、用其它编辑器重新打开在“⋯”里；贡献的按后缀出现在后面，活动标签换成别的后缀或页面就消失", () => {
        const {titles, groups} = setup([preview()]);
        groups.open("project://a.md", {mode: "permanent", editor: "markdown"});
        const md = titles.current("zh-CN")!;
        expect(md.group).toBe(groups.activeGroup.value);
        expect(keys(md.model.buttons)).toEqual(["own:split-right", "acme.preview.button"]);
        expect(md.model.menu.map(keys)).toEqual([["own:reopen-with"]]);
        expect(md.model.buttons.map((entry) => entry.title)).toEqual(["向右拆分", "预览"]);

        groups.open("project://b.txt", {mode: "permanent", editor: "code"});
        expect(keys(titles.current("zh-CN")!.model.buttons)).toEqual(["own:split-right"]);
        groups.open("page://nbook.projects.welcome", {mode: "permanent", editor: "page"});
        expect(keys(titles.current("zh-CN")!.model.buttons)).toEqual(["own:split-right"]);
    });

    it("context resource 的项收到点下去时活动标签的地址；活动标签不是文件时不执行；编辑器自己的动作参数是 {}", async () => {
        const {titles, groups, calls} = setup([preview(), {id: "acme.preview.args", declaration: {section: "2", command: PREVIEW, placement: "menu", args: {address: "fixed"}}}]);
        groups.open("project://notes/a.md", {mode: "permanent", editor: "markdown"});
        titles.run("acme.preview.button");
        titles.run("own:split-right");
        titles.run("acme.preview.args");
        groups.open("page://nbook.projects.welcome", {mode: "permanent", editor: "page"});
        titles.run("acme.preview.button");
        await Promise.resolve();
        expect(calls).toEqual([[PREVIEW, {address: "project://notes/a.md"}], [SPLIT_RIGHT_COMMAND, {}], [PREVIEW, {address: "fixed"}]]);
    });

    it("按钮至多 4 个，多出的收进“⋯”的第一节；菜单身份随活动组与活动标签变", () => {
        const many = Array.from({length: 4}, (_, index) => ({id: `acme.many.b${String(index)}`, declaration: {section: "1", order: index, command: PREVIEW, icon: "i-lucide-square"}}));
        const {titles, groups} = setup(many);
        const first = groups.open("project://a.md", {mode: "permanent", editor: "markdown"});
        const model = titles.current("zh-CN")!.model;
        expect(keys(model.buttons)).toEqual(["own:split-right", "acme.many.b0", "acme.many.b1", "acme.many.b2"]);
        expect(model.menu.map(keys)).toEqual([["acme.many.b3"], ["own:reopen-with"]]);
        const before = titles.current("zh-CN")!.identity;
        groups.open("project://b.md", {mode: "permanent", editor: "markdown"});
        expect(titles.current("zh-CN")!.identity).not.toBe(before);
        groups.activate(first.tab.id);
        expect(titles.current("zh-CN")!.identity).toBe(before);
    });
});
