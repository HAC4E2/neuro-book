import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {readChapterMarkdown, replacePromptPlaceholderWithAsset} from "nbook/server/text-to-image/chapter.service";
import {
    renderTextToImagePromptMarkdown,
    type TextToImagePromptPayload,
} from "nbook/shared/text-to-image-markdown";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

let root: string;

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "nbook-chapter-service-"));
});

afterEach(async () => {
    await rm(root, {recursive: true, force: true});
});

describe("chapter.service", () => {
    it("读取章节 Markdown", async () => {
        await writeFile(path.join(root, "chapter.md"), "# 第一章\n正文", "utf8");
        expect(await readChapterMarkdown(absoluteFsPath(root), "chapter.md")).toContain("第一章");
    });

    it("把占位符替换为资产图片引用", () => {
        const payload: TextToImagePromptPayload = {
            id: "tti-1",
            schema: "nbook.text-to-image-prompt/v1",
            prompt: "1girl",
            negativePrompt: "",
            anchor: "正文",
            title: "插图",
            size: "",
            tagThink: "",
        };
        const content = `正文\n${renderTextToImagePromptMarkdown(payload)}`;
        const asset: TextToImageAssetDto = {
            id: "asset-1",
            jobId: "job-1",
            relativePath: "assets/tti/asset-1.png",
            fileName: "asset-1.png",
            mimeType: "image/png",
            byteLength: 10,
            width: 832,
            height: 1216,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "1girl",
            negativePrompt: "",
            sourceKind: "body",
            sourcePath: "chapter.md",
            sourceAnchorId: "tti-1",
            createdAt: "2026-08-03T00:00:00.000Z",
        };
        const next = replacePromptPlaceholderWithAsset(content, "tti-1", asset);
        expect(next).toContain("![NovelAI 生成图片](assets/tti/asset-1.png");
        expect(next).not.toContain("<text-to-image-prompt");
    });
});
