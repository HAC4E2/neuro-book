import {z} from "zod";
import {escapeAttribute, unescapeAttribute} from "nbook/shared/markdown-workbench";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {IllustrationAnchorIdSchema} from "nbook/shared/text-to-image-illustration-planning";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

/** 正文占位符只保存 Storyboard 引用，最终 prompt 与生成参数永不进入正文。 */
export const TextToImagePromptV2PayloadSchema = z.object({
    schema: z.literal("nbook.text-to-image-prompt/v2"),
    shotId: StoryboardStableIdSchema,
    shotIntentHash: TextToImageContractHashSchema,
    sourceChapterHash: TextToImageContractHashSchema,
    anchorId: IllustrationAnchorIdSchema,
    origin: z.enum(["chapter-plan", "selection"]),
}).strict();

const TEXT_TO_IMAGE_PROMPT_PATTERN = /^<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*)\n<\/text-to-image-prompt>$/u;

export type TextToImagePromptPayload = z.infer<typeof TextToImagePromptV2PayloadSchema> & {
    id: string;
};

/** 渲染可由服务端精确定位的 V2 正文占位符。 */
export function renderTextToImagePromptMarkdown(payload: TextToImagePromptPayload): string {
    const id = StoryboardStableIdSchema.parse(payload.id);
    const data = TextToImagePromptV2PayloadSchema.parse({
        schema: payload.schema,
        shotId: payload.shotId,
        shotIntentHash: payload.shotIntentHash,
        sourceChapterHash: payload.sourceChapterHash,
        anchorId: payload.anchorId,
        origin: payload.origin,
    });
    return `<text-to-image-prompt id="${escapeAttribute(id)}">\n${JSON.stringify(data)}\n</text-to-image-prompt>`;
}

/** 解析单个完整 V2 占位符；V1、未知字段或非规范内容一律拒绝。 */
export function parseTextToImagePromptMarkdown(markdown: string): TextToImagePromptPayload | null {
    const matched = TEXT_TO_IMAGE_PROMPT_PATTERN.exec(markdown.trim());
    if (!matched) return null;
    const id = unescapeAttribute(matched[1] ?? "").trim();
    if (!StoryboardStableIdSchema.safeParse(id).success) return null;
    try {
        const raw: unknown = JSON.parse(matched[2] ?? "");
        return {id, ...TextToImagePromptV2PayloadSchema.parse(raw)};
    } catch {
        return null;
    }
}

/** 从完整 Markdown 中查找指定 ID 的规范 V2 占位符。 */
export function findTextToImagePromptMarkdown(markdown: string, id: string): {raw: string; payload: TextToImagePromptPayload} | null {
    const normalizedId = id.trim();
    if (!StoryboardStableIdSchema.safeParse(normalizedId).success) return null;
    const pattern = /<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*?)\n<\/text-to-image-prompt>/gu;
    for (const match of markdown.matchAll(pattern)) {
        const raw = match[0] ?? "";
        const payload = parseTextToImagePromptMarkdown(raw);
        if (payload?.id === normalizedId) return {raw, payload};
    }
    return null;
}

/** P6：枚举章节中所有规范 V2 占位符，返回 raw + payload 对。 */
export function findAllTextToImagePromptMarkdown(markdown: string): Array<{raw: string; payload: TextToImagePromptPayload}> {
    const results: Array<{raw: string; payload: TextToImagePromptPayload}> = [];
    const pattern = /<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*?)\n<\/text-to-image-prompt>/gu;
    for (const match of markdown.matchAll(pattern)) {
        const raw = match[0] ?? "";
        const payload = parseTextToImagePromptMarkdown(raw);
        if (payload) results.push({raw, payload});
    }
    return results;
}

/** 渲染最终写回正文的标准 Markdown 图片引用。 */
export function renderTextToImageAssetMarkdown(asset: TextToImageAssetDto): string {
    const destination = escapeMarkdownDestination(asset.relativePath);
    const title = escapeMarkdownTitle(`seed ${asset.seed} | ${asset.width}x${asset.height}`);
    return `![NovelAI 生成图片](${destination} "${title}")`;
}

/** 转义 Markdown destination 中会改变解析边界的字符。 */
function escapeMarkdownDestination(value: string): string {
    return value.trim()
        .replace(/\\/gu, "\\\\")
        .replace(/[()\s]/gu, (character) => character === " " ? "%20" : `\\${character}`);
}

/** 转义 Markdown title。 */
function escapeMarkdownTitle(value: string): string {
    return value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"");
}
