import {describe, expect, it} from "vitest";
import {
    buildGeneratedImageMarkdown,
    extractImagineBlocks,
    insertTextToImagePromptPlaceholdersIntoMarkdown,
    replaceTextToImagePromptPlaceholder,
} from "nbook/app/utils/text-to-image-llm";

function readPlaceholderIds(markdown: string): string[] {
    return [...markdown.matchAll(/<text-to-image-prompt\s+id="([^"]+)">/gu)].map((match) => match[1] ?? "");
}

describe("text-to-image LLM markdown placeholders", () => {
    it("keeps multiple returned image prompts at their matching chapter positions", () => {
        const markdown = [
            "第一段文字。",
            "",
            "第二段文字。",
            "",
            "第三段文字。",
        ].join("\n");
        const reply = [
            "第一段文字。",
            "<image>wide shot, school gate, morning light</image>",
            "第二段文字。",
            "<image>close-up, classroom window, soft light</image>",
            "第三段文字。",
        ].join("\n\n");

        const result = insertTextToImagePromptPlaceholdersIntoMarkdown(markdown, extractImagineBlocks(reply));

        expect(result.inserted).toBe(2);
        expect(result.matched).toBe(2);
        expect(result.appended).toBe(0);
        expect(result.markdown.indexOf("wide shot, school gate")).toBeGreaterThan(result.markdown.indexOf("第一段文字。"));
        expect(result.markdown.indexOf("wide shot, school gate")).toBeLessThan(result.markdown.indexOf("第二段文字。"));
        expect(result.markdown.indexOf("close-up, classroom window")).toBeGreaterThan(result.markdown.indexOf("第二段文字。"));
        expect(result.markdown.indexOf("close-up, classroom window")).toBeLessThan(result.markdown.indexOf("第三段文字。"));
    });


    it("maps normalized response context back to CRLF markdown positions", () => {
        const markdown = ["甲段。", "", "乙段。"].join("\r\n");
        const reply = ["甲段。", "<image>rainy street, reflection</image>", "乙段。"].join("\n\n");

        const result = insertTextToImagePromptPlaceholdersIntoMarkdown(markdown, extractImagineBlocks(reply));

        expect(result.matched).toBe(1);
        expect(result.appended).toBe(0);
        expect(result.markdown.indexOf("rainy street")).toBeGreaterThan(result.markdown.indexOf("甲段。"));
        expect(result.markdown.indexOf("rainy street")).toBeLessThan(result.markdown.indexOf("乙段。"));
    });
    it("replaces only the clicked placeholder id with the generated image markdown", () => {
        const markdown = [
            "开头。",
            "",
            "<text-to-image-prompt id=\"first\">",
            "tag one",
            "</text-to-image-prompt>",
            "",
            "中段。",
            "",
            "<text-to-image-prompt id=\"second\">",
            "tag two",
            "</text-to-image-prompt>",
        ].join("\n");
        expect(readPlaceholderIds(markdown)).toEqual(["first", "second"]);

        const imageMarkdown = buildGeneratedImageMarkdown({
            id: "img-1",
            fileName: "novelai.png",
            savedPath: "C:\\Images\\novelai.png",
            dataUrl: "data:image/png;base64,abc",
            width: 832,
            height: 1216,
            seed: 42,
        });
        const result = replaceTextToImagePromptPlaceholder(markdown, "second", imageMarkdown);

        expect(result.replaced).toBe(true);
        expect(result.markdown).toContain("tag one");
        expect(result.markdown).not.toContain("tag two");
        expect(result.markdown).toContain("/api/text-to-image/image?path=");
        expect(readPlaceholderIds(result.markdown)).toEqual(["first"]);
    });
});