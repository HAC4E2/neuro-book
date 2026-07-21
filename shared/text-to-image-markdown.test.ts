import {describe, expect, it} from "vitest";
import {
    parseTextToImagePromptMarkdown,
    renderTextToImageAssetMarkdown,
    renderTextToImagePromptMarkdown,
} from "nbook/shared/text-to-image-markdown";

describe("text-to-image Markdown contract", () => {
    it("round-trips a V2 reference-only prompt placeholder", () => {
        const markdown = renderTextToImagePromptMarkdown({
            id: "image_prompt_01",
            schema: "nbook.text-to-image-prompt/v2",
            shotId: "shot_01",
            shotIntentHash: `sha256:${"a".repeat(64)}`,
            sourceChapterHash: `sha256:${"b".repeat(64)}`,
            anchorId: "p_0001_abcdef12",
            origin: "selection",
        });

        expect(markdown).toBe(`<text-to-image-prompt id="image_prompt_01">\n{"schema":"nbook.text-to-image-prompt/v2","shotId":"shot_01","shotIntentHash":"sha256:${"a".repeat(64)}","sourceChapterHash":"sha256:${"b".repeat(64)}","anchorId":"p_0001_abcdef12","origin":"selection"}\n</text-to-image-prompt>`);
        expect(parseTextToImagePromptMarkdown(markdown)).toEqual({
            id: "image_prompt_01",
            schema: "nbook.text-to-image-prompt/v2",
            shotId: "shot_01",
            shotIntentHash: `sha256:${"a".repeat(64)}`,
            sourceChapterHash: `sha256:${"b".repeat(64)}`,
            anchorId: "p_0001_abcdef12",
            origin: "selection",
        });
    });

    it("rejects V1/final-prompt payloads and renders a safe standard image", () => {
        expect(parseTextToImagePromptMarkdown("<text-to-image-prompt id=\"tti-1\">not-json</text-to-image-prompt>")).toBeNull();
        expect(parseTextToImagePromptMarkdown(`<text-to-image-prompt id="tti-1">\n${JSON.stringify({
            prompt: "1girl, rain",
            negativePrompt: "lowres",
            characterIds: ["alice"],
            sourceChapterHash: "a".repeat(64),
        })}\n</text-to-image-prompt>`)).toBeNull();
        expect(parseTextToImagePromptMarkdown(`<text-to-image-prompt id="tti-1">\n${JSON.stringify({
            schema: "nbook.text-to-image-prompt/v2",
            shotId: "shot_01",
            shotIntentHash: `sha256:${"a".repeat(64)}`,
            sourceChapterHash: `sha256:${"b".repeat(64)}`,
            anchorId: "p_0001_abcdef12",
            origin: "selection",
            prompt: "forbidden final prompt",
        })}\n</text-to-image-prompt>`)).toBeNull();
        expect(renderTextToImageAssetMarkdown({
            id: "asset-1",
            jobId: "job-1",
            relativePath: "assets/text-to-image/2026/07/asset-1.png",
            fileName: "asset-1.png",
            mimeType: "image/png",
            byteLength: 1024,
            width: 832,
            height: 1216,
            model: "nai",
            seed: 123456,
            prompt: "ignored",
            negativePrompt: "ignored",
            sourceKind: "body",
            sourcePath: "manuscript/001.md",
            sourceAnchorId: "p-1",
            createdAt: "2026-07-11T00:00:00.000Z",
        })).toBe("![NovelAI 生成图片](assets/text-to-image/2026/07/asset-1.png \"seed 123456 | 832x1216\")");
    });
});
