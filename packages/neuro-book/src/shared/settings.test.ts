/**
 * 配置项的定义与声明校验（docs/specs/settings/configuration.md 输入“声明”、输出 1、21）。
 */

import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {defineSetting, SETTINGS_POINT, settingDeclarationProblem} from "./settings";
import type {SettingDeclaration} from "./settings";

const title = {"zh-CN": "主题", "en-US": "Theme"};
const theme = Type.Union([Type.Literal("nbook"), Type.Literal("macos")]);

function declaration(overrides: Partial<Record<keyof SettingDeclaration, unknown>> = {}): Record<string, unknown> {
    return {schema: theme, default: "nbook", title, layers: ["user", "project"], applies: "now", ...overrides};
}

describe("defineSetting", () => {
    it("键是 <插件 id>/<名>，缺省两层都允许、改动立即生效；贡献写到贡献点 settings.properties，id 就是键", () => {
        const setting = defineSetting({plugin: "nbook.workbench", name: "theme", schema: theme, default: "nbook", title});
        expect(setting.key).toBe("nbook.workbench/theme");
        expect(setting.declaration).toMatchObject({default: "nbook", layers: ["user", "project"], applies: "now"});
        expect(setting.contribution).toEqual({capability: SETTINGS_POINT, id: "nbook.workbench/theme", declaration: setting.declaration});
    });

    it("默认值复制后逐层冻结：改原对象不影响定义，定义里的值改不动", () => {
        const original = {size: 12, families: ["serif"]};
        const setting = defineSetting({plugin: "x.editor", name: "font", schema: Type.Object({size: Type.Number(), families: Type.Array(Type.String())}), default: original, title});
        original.families.push("mono");
        expect(setting.declaration.default).toEqual({size: 12, families: ["serif"]});
        expect(Object.isFrozen(setting.declaration.default)).toBe(true);
        expect(Object.isFrozen((setting.declaration.default as {families: string[]}).families)).toBe(true);
    });

    it("不合规则的定义在加载时抛 TypeError", () => {
        expect(() => defineSetting({plugin: "x.editor", name: "Font", schema: theme, default: "nbook", title})).toThrow(TypeError);
        expect(() => defineSetting({plugin: "x.editor", name: "theme", schema: theme, default: "solarized" as "nbook", title})).toThrow("不符合 schema");
    });
});

describe("settingDeclarationProblem：只看这一条声明", () => {
    it("合格的声明没有问题；名字可以以点分段", () => {
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration())).toBeNull();
        expect(settingDeclarationProblem("x.editor", "x.editor/editor.fontSize", declaration({schema: Type.Number(), default: 14}))).toBeNull();
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({description: title, layers: ["user"], applies: "restart", secret: false}))).toBeNull();
    });

    it("键前缀不是贡献方插件、名字不合规则或超过 128 个字符", () => {
        expect(settingDeclarationProblem("x.editor", "x.other/theme", declaration())).toContain("x.editor/<名>");
        for (const name of ["Theme", "font-size", "editor..size", "1st", ".size", "size."]) {
            expect(settingDeclarationProblem("x.editor", `x.editor/${name}`, declaration()), name).toContain("不合规则");
        }
        expect(settingDeclarationProblem("x.editor", `x.editor/${"a".repeat(129)}`, declaration())).toContain("128");
        expect(settingDeclarationProblem("x.editor", `x.editor/${"a".repeat(128)}`, declaration())).toBeNull();
    });

    it("默认值必须是 JSON 能如实表示的值且符合 schema：undefined、NaN、Date、Map 都被拒", () => {
        const any = Type.Unknown();
        for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(0), new Map(), () => 1]) {
            expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({schema: any, default: value})), String(value)).toContain("JSON");
        }
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({default: "solarized"}))).toContain("不符合 schema");
    });

    it("schema 不能 JSON 序列化、layers 为空或有未知层或重复、title 缺语言、有未知字段", () => {
        const schemaWithFunction = {...theme, check: () => true};
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({schema: schemaWithFunction}))).toContain("schema");
        for (const layers of [[], ["machine"], ["user", "user"], "user"]) {
            expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({layers})), JSON.stringify(layers)).toContain("layers");
        }
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({title: {"zh-CN": "主题"}}))).toContain("title");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({description: "主题"}))).toContain("description");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", {...declaration(), scope: "machine"})).toContain("scope");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", null)).toContain("对象");
    });

    it("声明 secret: true 被拒，原因写明密钥存储尚未实现", () => {
        expect(settingDeclarationProblem("x.editor", "x.editor/token", declaration({schema: Type.String(), default: "", secret: true}))).toContain("密钥存储尚未实现");
    });
});

describe("界面字段（输出 21）", () => {
    const choices = [{value: "nbook", title: {"zh-CN": "NeuroBook", "en-US": "NeuroBook"}}, {value: "macos", title: {"zh-CN": "macOS", "en-US": "macOS"}, description: title}];
    const check = (overrides: Partial<Record<keyof SettingDeclaration | "restart", unknown>>): string | null => settingDeclarationProblem("x.editor", "x.editor/theme", declaration(overrides));

    it("合格的界面字段：分区可以是别的插件的，小组随分区，order 在范围内，choices 与字面量一一对应（顺序不限），applies 取四个值之一", () => {
        expect(check({section: "nbook.appearance", group: "ui", order: 10, choices})).toBeNull();
        expect(check({section: "other.plugin.page", order: -1_000_000})).toBeNull();
        expect(check({choices: [...choices].reverse()})).toBeNull();
        for (const applies of ["now", "next-run", "next-session", "restart"]) expect(check({applies}), applies).toBeNull();
        // 数与布尔的字面量也行。
        const mixed = Type.Union([Type.Literal(1), Type.Literal(true)]);
        expect(check({schema: mixed, default: 1, choices: [{value: 1, title}, {value: true, title}]})).toBeNull();
    });

    it("defineSetting 带上界面字段，choices 复制后逐层冻结", () => {
        const options = [{value: "nbook" as const, title}, {value: "macos" as const, title}];
        const setting = defineSetting({plugin: "x.editor", name: "theme", schema: theme, default: "nbook", title, section: "x.editor.main", group: "look", order: 2, choices: options, applies: "next-run"});
        expect(setting.declaration).toMatchObject({section: "x.editor.main", group: "look", order: 2, choices: options, applies: "next-run"});
        expect(Object.isFrozen(setting.declaration.choices) && Object.isFrozen(setting.declaration.choices?.[0])).toBe(true);
        expect(() => defineSetting({plugin: "x.editor", name: "theme", schema: theme, default: "nbook", title, choices: [options[0]!]})).toThrow("macos");
    });

    it("section 不是分区 id、group 不是小组 id 或没有 section、order 越界或不是有限数", () => {
        for (const section of ["appearance", "Nbook.appearance", "nbook..x", "nbook.", 3, `x.${"a".repeat(127)}`]) expect(check({section}), String(section)).toContain("section");
        expect(check({section: `x.${"a".repeat(126)}`})).toBeNull();
        for (const group of ["UI", "a.b", "", 1, "a".repeat(65)]) expect(check({section: "nbook.appearance", group}), String(group)).toContain("group");
        expect(check({group: "ui"})).toContain("没有 section");
        for (const order of [1_000_001, -1_000_001, Number.NaN, Number.POSITIVE_INFINITY, "1"]) expect(check({order}), String(order)).toContain("order");
    });

    it("choices 与字面量不一一对应：少一个、多一个、与字面量不符、重复、title 缺语言、有未知字段", () => {
        expect(check({choices: [choices[0]]})).toContain("缺少字面量 \"macos\"");
        expect(check({choices: [...choices, {value: "solarized", title}]})).toContain("\"solarized\" 不是 schema 的字面量");
        expect(check({choices: [choices[0], {value: "MacOS", title}]})).toContain("不是 schema 的字面量");
        expect(check({choices: [...choices, choices[0]]})).toContain("不止一次");
        expect(check({choices: [choices[0], {value: "macos", title: {"zh-CN": "macOS"}}]})).toContain("title");
        expect(check({choices: [choices[0], {value: "macos", title, icon: "x"}]})).toContain("icon");
        expect(check({choices: "nbook"})).toContain("数组");
    });

    it("schema 不是字面量联合却写了 choices", () => {
        expect(check({schema: Type.String(), default: "a", choices: [{value: "a", title}]})).toContain("字面量联合");
        expect(check({schema: Type.Literal("a"), default: "a", choices: [{value: "a", title}]})).toContain("字面量联合");
        expect(check({schema: Type.Union([Type.Literal("a"), Type.String()]), default: "a", choices: [{value: "a", title}]})).toContain("字面量联合");
        expect(check({schema: Type.Union([Type.Literal("a"), Type.Literal("b")]), default: "a"})).toBeNull();
    });

    it("applies 不在四个值里或缺失；restart 字段已删除，按未知字段被拒", () => {
        for (const applies of ["later", true, undefined]) expect(check({applies}), String(applies)).toContain("applies");
        expect(check({restart: true})).toContain("未知字段：restart");
        expect(check({restart: false})).toContain("未知字段：restart");
    });
});
