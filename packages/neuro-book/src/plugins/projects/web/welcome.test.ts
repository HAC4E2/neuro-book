/**
 * 欢迎页宿主的两条规则（docs/specs/workbench/bookshelf.md 的“欢迎页”）：快捷入口按“大纲”“设定”的先后再按名字排，只要
 * 文件与文件夹；新建章节的名字避开项目根已有的。
 */

import {describe, expect, it} from "bun:test";

import {freeChapterName, quickEntries} from "./welcome";

describe("欢迎页宿主", () => {
    it("快捷入口：名字以“大纲”“设定”开头的文件与文件夹，大纲在前、同类按名字；别的名字、链接与缺失项不算", () => {
        expect(quickEntries([
            {name: "设定", kind: "directory"},
            {name: "正文", kind: "directory"},
            {name: "大纲-第二卷.md", kind: "file"},
            {name: "大纲.md", kind: "file"},
            {name: "设定集.md", kind: "file"},
            {name: "大纲链接", kind: "link"},
            {name: "设定丢了", kind: "missing"},
        ])).toEqual([
            {address: "project://大纲-第二卷.md", name: "大纲-第二卷.md", kind: "file"},
            {address: "project://大纲.md", name: "大纲.md", kind: "file"},
            {address: "project://设定", name: "设定", kind: "folder"},
            {address: "project://设定集.md", name: "设定集.md", kind: "file"},
        ]);
    });

    it("新建章节的名字：没有同名时用“新章节.md”，有了依次加 2、3", () => {
        expect(freeChapterName("新章节", new Set())).toBe("新章节.md");
        expect(freeChapterName("新章节", new Set(["新章节.md", "新章节 2.md"]))).toBe("新章节 3.md");
    });
});
