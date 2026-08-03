import {describe, expect, it} from "vitest";
import {
    findAllTextToImagePromptMarkdown,
    findTextToImagePromptMarkdown,
    parseTextToImagePromptMarkdown,
    renderTextToImagePromptMarkdown,
    renderTextToImageAssetMarkdown,
} from "nbook/shared/text-to-image-markdown";

const payload = {
    id: "tti-1",
    schema: "nbook.text-to-image-prompt/v1" as const,
    prompt: "1girl, long black hair",
    negativePrompt: "blurry, lowres",
    anchor: "p_0001",
    title: "港口醒来",
    size: "832x1216",
    tagThink: "清晨港口",
};

describe("text-to-image-markdown", () => {
    it("render 后 parse 可以往返还原", () => {
        const markdown = renderTextToImagePromptMarkdown(payload);
        expect(parseTextToImagePromptMarkdown(markdown)).toEqual(payload);
    });

    it("find 按 id 返回 raw 与 payload", () => {
        const markdown = [
            "正文第一段。",
            "",
            renderTextToImagePromptMarkdown(payload),
            "",
            "正文第二段。",
        ].join("\n");
        expect(findTextToImagePromptMarkdown(markdown, "tti-1")?.payload).toMatchObject({
            id: "tti-1",
            prompt: "1girl, long black hair",
        });
    });

    it("findAll 只返回规范占位符", () => {
        const markdown = `${renderTextToImagePromptMarkdown(payload)}\n\n<text-to-image-prompt id="bad">not-json</text-to-image-prompt>`;
        expect(findAllTextToImagePromptMarkdown(markdown)).toHaveLength(1);
    });

    it("资产 Markdown 使用标准图片引用", () => {
        const markdown = renderTextToImageAssetMarkdown({
            id: "a1",
            jobId: "j1",
            relativePath: "assets/tti/a1.png",
            fileName: "a1.png",
            mimeType: "image/png",
            byteLength: 1,
            width: 832,
            height: 1216,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "",
            negativePrompt: "",
            sourceKind: "body",
            sourcePath: null,
            sourceAnchorId: null,
            createdAt: "2026-08-03T00:00:00.000Z",
        });
        expect(markdown).toBe('![NovelAI 生成图片](assets/tti/a1.png "seed 42 | 832x1216")');
    });
});
