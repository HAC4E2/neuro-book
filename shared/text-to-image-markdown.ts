import {z} from "zod";
import {escapeAttribute, unescapeAttribute} from "nbook/shared/markdown-workbench";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

const TextToImagePromptPayloadSchema = z.object({
    prompt: z.string().trim().min(1),
    negativePrompt: z.string(),
    characterIds: z.array(z.string().trim().min(1)),
    sourceChapterHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const TEXT_TO_IMAGE_PROMPT_PATTERN = /^<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*)\n<\/text-to-image-prompt>$/u;

export type TextToImagePromptPayload = z.infer<typeof TextToImagePromptPayloadSchema> & {
    id: string;
};

/** 渲染可由服务端精确替换的正文文生图占位符。 */
export function renderTextToImagePromptMarkdown(payload: TextToImagePromptPayload): string {
    const id = payload.id.trim();
    const data = TextToImagePromptPayloadSchema.parse({
        prompt: payload.prompt,
        negativePrompt: payload.negativePrompt,
        characterIds: payload.characterIds,
        sourceChapterHash: payload.sourceChapterHash,
    });
    if (!id) {
        throw new Error("文生图占位符 ID 不能为空");
    }
    return `<text-to-image-prompt id="${escapeAttribute(id)}">\n${JSON.stringify(data)}\n</text-to-image-prompt>`;
}

/** 解析单个完整占位符；任何非规范内容都不可用于生成或替换。 */
export function parseTextToImagePromptMarkdown(markdown: string): TextToImagePromptPayload | null {
    const matched = TEXT_TO_IMAGE_PROMPT_PATTERN.exec(markdown.trim());
    if (!matched) {
        return null;
    }
    const id = unescapeAttribute(matched[1] ?? "").trim();
    if (!id) {
        return null;
    }
    try {
        const raw: unknown = JSON.parse(matched[2] ?? "");
        const payload = TextToImagePromptPayloadSchema.parse(raw);
        return {id, ...payload};
    } catch {
        return null;
    }
}

/** 从完整 Markdown 中寻找指定 ID 的规范占位符。 */
export function findTextToImagePromptMarkdown(markdown: string, id: string): {raw: string; payload: TextToImagePromptPayload} | null {
    const normalizedId = id.trim();
    if (!normalizedId) {
        return null;
    }
    const pattern = /<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*?)\n<\/text-to-image-prompt>/gu;
    for (const match of markdown.matchAll(pattern)) {
        const raw = match[0] ?? "";
        const payload = parseTextToImagePromptMarkdown(raw);
        if (payload?.id === normalizedId) {
            return {raw, payload};
        }
    }
    return null;
}

/** 渲染最终写回正文的标准 Markdown 图片引用。 */
export function renderTextToImageAssetMarkdown(asset: TextToImageAssetDto): string {
    const destination = escapeMarkdownDestination(asset.relativePath);
    const title = escapeMarkdownTitle(`seed ${asset.seed} | ${asset.width}x${asset.height}`);
    return `![NovelAI 生成图片](${destination} "${title}")`;
}

function escapeMarkdownDestination(value: string): string {
    return value.trim()
        .replace(/\\/gu, "\\\\")
        .replace(/[()\s]/gu, (character) => character === " " ? "%20" : `\\${character}`);
}

function escapeMarkdownTitle(value: string): string {
    return value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"");
}
