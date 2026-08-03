import {z} from "zod";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

/** 正文占位符只保存定位与提示词，最终生成参数在队列编译时展开。 */
export const TextToImagePromptPayloadSchema = z.object({
    schema: z.literal("nbook.text-to-image-prompt/v1"),
    prompt: z.string(),
    negativePrompt: z.string().default(""),
    anchor: z.string().default(""),
    title: z.string().default(""),
    size: z.string().default(""),
    tagThink: z.string().default(""),
}).strict();

export type TextToImagePromptPayload = z.infer<typeof TextToImagePromptPayloadSchema> & {
    id: string;
};

const SINGLE_PATTERN = /^<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*)\n<\/text-to-image-prompt>$/u;
const ALL_PATTERN = /<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*?)\n<\/text-to-image-prompt>/gu;

/** 渲染可由服务端精确定位的正文占位符。 */
export function renderTextToImagePromptMarkdown(payload: TextToImagePromptPayload): string {
    const id = escapeAttribute(payload.id);
    const {id: _id, ...data} = payload;
    const parsed = TextToImagePromptPayloadSchema.parse(data);
    return `<text-to-image-prompt id="${id}">\n${JSON.stringify(parsed)}\n</text-to-image-prompt>`;
}

/** 解析单个完整占位符；格式不合法返回 null。 */
export function parseTextToImagePromptMarkdown(markdown: string): TextToImagePromptPayload | null {
    const matched = SINGLE_PATTERN.exec(markdown.trim());
    if (!matched) return null;
    const id = unescapeAttribute(matched[1] ?? "").trim();
    try {
        const raw: unknown = JSON.parse(matched[2] ?? "");
        return {id, ...TextToImagePromptPayloadSchema.parse(raw)};
    } catch {
        return null;
    }
}

/** 从完整 Markdown 中查找指定 ID 的占位符。 */
export function findTextToImagePromptMarkdown(markdown: string, id: string): {raw: string; payload: TextToImagePromptPayload} | null {
    for (const match of markdown.matchAll(ALL_PATTERN)) {
        const raw = match[0] ?? "";
        const payload = parseTextToImagePromptMarkdown(raw);
        if (payload?.id === id.trim()) return {raw, payload};
    }
    return null;
}

/** 枚举章节中所有规范占位符。 */
export function findAllTextToImagePromptMarkdown(markdown: string): Array<{raw: string; payload: TextToImagePromptPayload}> {
    const results: Array<{raw: string; payload: TextToImagePromptPayload}> = [];
    for (const match of markdown.matchAll(ALL_PATTERN)) {
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

function escapeAttribute(value: string): string {
    return value.replace(/"/gu, "&quot;");
}

function unescapeAttribute(value: string): string {
    return value.replace(/&quot;/gu, "\"");
}

function escapeMarkdownDestination(value: string): string {
    return value.trim()
        .replace(/\\/gu, "\\\\")
        .replace(/[()\s]/gu, (character) => character === " " ? "%20" : `\\${character}`);
}

function escapeMarkdownTitle(value: string): string {
    return value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"");
}
