import {describe, expect, it} from "vitest";
import {
    findAllTextToImagePromptMarkdown,
    findTextToImagePromptMarkdown,
    hasTextToImageGenerationMarkdown,
    parseTextToImagePromptMarkdown,
    renderTextToImagePromptMarkdown,
    renderTextToImageAssetMarkdown,
    replaceTextToImageAssetMarkdown,
    stripTextToImageGenerationMarkdown,
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

    it("replace 按旧 relativePath 替换生成图片引用", () => {
        const asset = {
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
        };
        const nextAsset = {
            ...asset,
            id: "a2",
            relativePath: "assets/tti/a2.png",
            seed: 43,
            width: 1024,
            height: 1024,
        };
        const markdown = [
            "正文。",
            '![普通图片](assets/user/photo.png "相册")',
            renderTextToImageAssetMarkdown(asset),
            "结尾。",
        ].join("\n");

        const next = replaceTextToImageAssetMarkdown(markdown, "assets/tti/a1.png", nextAsset);
        expect(next).toContain('![NovelAI 生成图片](assets/tti/a2.png "seed 43 | 1024x1024")');
        expect(next).toContain('![普通图片](assets/user/photo.png "相册")');
        expect(next).not.toContain("assets/tti/a1.png");
    });

    it("replace 不命中不存在的旧图片路径", () => {
        const markdown = '![NovelAI 生成图片](assets/tti/a1.png "seed 42 | 832x1216")';
        expect(replaceTextToImageAssetMarkdown(
            markdown,
            "assets/tti/missing.png",
            {
                id: "a2",
                jobId: "j2",
                relativePath: "assets/tti/a2.png",
                fileName: "a2.png",
                mimeType: "image/png",
                byteLength: 1,
                width: 1024,
                height: 1024,
                model: "nai-diffusion-4-5-full",
                seed: 43,
                prompt: "",
                negativePrompt: "",
                sourceKind: "body",
                sourcePath: null,
                sourceAnchorId: null,
                createdAt: "2026-08-03T00:00:00.000Z",
            },
        )).toBe(markdown);
    });

    it("清理正文生图占位符与已生成图片，保留普通图片", () => {
        const markdown = [
            "正文第一段。",
            renderTextToImagePromptMarkdown(payload),
            '![普通图片](assets/user/photo.png "相册")',
            '![NovelAI 生成图片](assets/tti/a1.png "seed 42 | 832x1216")',
            "正文第二段。",
        ].join("\n");

        expect(stripTextToImageGenerationMarkdown(markdown)).toBe([
            "正文第一段。",
            '![普通图片](assets/user/photo.png "相册")',
            "正文第二段。",
        ].join("\n"));
    });

    it("清理 LLM 返回的原始<image>块", () => {
        const markdown = "正文。\n<image><regex>锚点</regex><prompts>1girl</prompts></image>\n结尾。";
        expect(stripTextToImageGenerationMarkdown(markdown)).toBe("正文。\n结尾。");
    });

    it("识别正文中已有的生图标记，普通图片不算", () => {
        expect(hasTextToImageGenerationMarkdown(renderTextToImagePromptMarkdown(payload))).toBe(true);
        expect(hasTextToImageGenerationMarkdown('![NovelAI 生成图片](assets/tti/a1.png "seed 42 | 832x1216")')).toBe(true);
        expect(hasTextToImageGenerationMarkdown("<image><prompts>1girl</prompts></image>")).toBe(true);
        expect(hasTextToImageGenerationMarkdown('![普通图片](assets/user/photo.png "相册")')).toBe(false);
    });
});
