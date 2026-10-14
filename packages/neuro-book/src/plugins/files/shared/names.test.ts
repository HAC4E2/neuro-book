/**
 * 名字排序的中文数字（docs/specs/workspace/folder-kinds.md 的“名字排序”）。列出时的整体顺序在 `files.test.ts`。
 */

import {describe, expect, it} from "bun:test";

import {chineseNumber, compareNames} from "./names";

describe("Spec workspace.folder-kinds 名字排序：中文数字", () => {
    it("按位权与逐位两种写法都换成数值", () => {
        expect(["十", "十二", "二十", "一百零五", "两万三千", "一千零一十", "一〇二", "三"].map(chineseNumber)).toEqual([10, 12, 20, 105, 23000, 1010, 102, 3]);
    });

    it("只认“第 + 中文数字 + 卷 / 章 …”；别处的中文数字照常按字比较", () => {
        const sorted = ["第十回 风起.md", "第九回 夜雨.md", "第一百章.md", "第九十九章.md", "三个人.md", "一个人.md"].sort(compareNames);
        expect(sorted.slice(0, 4)).toEqual(["第九回 夜雨.md", "第十回 风起.md", "第九十九章.md", "第一百章.md"]);
        // “三个人”“一个人”不在格式里，按 zh-CN 的字序（拼音 san 在 yi 前）。
        expect(sorted.slice(4)).toEqual(["三个人.md", "一个人.md"]);
    });
});
