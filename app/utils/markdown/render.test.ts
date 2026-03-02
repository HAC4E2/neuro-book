import {describe, expect, it} from "vitest";
import {renderMarkdown} from "nbook/app/utils/markdown/render";

describe("renderMarkdown", () => {
    it("会把 skill 文本按普通 Markdown 渲染", () => {
        expect(() => renderMarkdown("$小说初始化流程")).not.toThrow();
        expect(renderMarkdown("$小说初始化流程")).toContain("$小说初始化流程");
    });

    it("会把模板 skill 按普通 Markdown 渲染", () => {
        expect(() => renderMarkdown("${小说初始化流程}")).not.toThrow();
        expect(renderMarkdown("${小说初始化流程}")).toContain("${小说初始化流程}");
    });
});
