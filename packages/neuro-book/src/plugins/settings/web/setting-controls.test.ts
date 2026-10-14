/**
 * 通用列表的控件选法（docs/specs/settings/settings-window.md 输出 9）：按 schema 与 `choices` 选控件、给出选项名、范围与长度。
 * 声明都经 `defineSetting` 写出，与插件声明配置项的写法相同。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {defineSetting} from "nbook/shared/settings";

import {settingControl} from "./setting-controls";

const title = {"zh-CN": "项", "en-US": "Item"};
const declare = (name: string, options: Omit<Parameters<typeof defineSetting>[0], "plugin" | "name" | "title">) => defineSetting({plugin: "x.test", name, title, ...options} as Parameters<typeof defineSetting>[0]).declaration;

describe("控件选法", () => {
    it("布尔用开关", () => {
        expect(settingControl(declare("flag", {schema: Type.Boolean(), default: false}), "zh-CN")).toEqual({kind: "switch"});
    });

    it("有 choices 的字面量联合不超过 3 项用分段，选项名按显示语言取 choices 的 title", () => {
        const declaration = declare("appearance", {
            schema: Type.Union([Type.Literal("light"), Type.Literal("dark"), Type.Literal("system")]),
            default: "light",
            choices: [
                {value: "light", title: {"zh-CN": "浅色", "en-US": "Light"}},
                {value: "dark", title: {"zh-CN": "深色", "en-US": "Dark"}},
                {value: "system", title: {"zh-CN": "跟随系统", "en-US": "System"}},
            ],
        });
        expect(settingControl(declaration, "zh-CN")).toEqual({kind: "segmented", choices: [{value: "light", label: "浅色"}, {value: "dark", label: "深色"}, {value: "system", label: "跟随系统"}]});
        expect(settingControl(declaration, "en-US")).toMatchObject({kind: "segmented", choices: [{label: "Light"}, {label: "Dark"}, {label: "System"}]});
    });

    it("多于 3 项用下拉；没有 choices 的字面量联合同样排法，选项名是字面量本身（数字、布尔也是）", () => {
        const four = declare("sort", {schema: Type.Union([Type.Literal("a"), Type.Literal("b"), Type.Literal("c"), Type.Literal("d")]), default: "a"});
        expect(settingControl(four, "zh-CN")).toEqual({kind: "select", choices: ["a", "b", "c", "d"].map((value) => ({value, label: value}))});
        const numbers = declare("size", {schema: Type.Union([Type.Literal(12), Type.Literal(14)]), default: 12});
        expect(settingControl(numbers, "zh-CN")).toEqual({kind: "segmented", choices: [{value: 12, label: "12"}, {value: 14, label: "14"}]});
        const booleans = declare("tri", {schema: Type.Union([Type.Literal(true), Type.Literal(false)]), default: true});
        expect(settingControl(booleans, "zh-CN")).toEqual({kind: "segmented", choices: [{value: true, label: "true"}, {value: false, label: "false"}]});
    });

    it("数字用数字框：整数、范围与步长取 schema；没写的不出现", () => {
        expect(settingControl(declare("interval", {schema: Type.Integer({minimum: 5, maximum: 600}), default: 30}), "zh-CN")).toEqual({kind: "number", integer: true, min: 5, max: 600});
        expect(settingControl(declare("ratio", {schema: Type.Number({multipleOf: 0.05}), default: 1}), "zh-CN")).toEqual({kind: "number", integer: false, step: 0.05});
    });

    it("字符串用输入框，长度取 schema", () => {
        expect(settingControl(declare("signature", {schema: Type.String({minLength: 1, maxLength: 40}), default: "x"}), "zh-CN")).toEqual({kind: "text", minLength: 1, maxLength: 40});
        expect(settingControl(declare("plain", {schema: Type.String(), default: ""}), "zh-CN")).toEqual({kind: "text"});
    });

    it("数组、对象、单个常量与别的联合画不了：只读", () => {
        for (const declaration of [
            declare("tags", {schema: Type.Array(Type.String()), default: []}),
            declare("extra", {schema: Type.Object({a: Type.Number()}), default: {a: 1}}),
            declare("fixed", {schema: Type.Literal("only"), default: "only"}),
            declare("mixed", {schema: Type.Union([Type.String(), Type.Number()]), default: ""}),
        ]) {
            expect(settingControl(declaration, "zh-CN")).toEqual({kind: "readonly"});
        }
    });
});
