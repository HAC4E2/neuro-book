import {z} from "zod";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

export const TextToImageCharacterPromptSchema = z.object({
    prompt: z.string(),
    negativePrompt: z.string().default(""),
    centerX: z.number().min(0).max(1).optional(),
    centerY: z.number().min(0).max(1).optional(),
}).strict();

export type TextToImageCharacterPrompt = z.infer<typeof TextToImageCharacterPromptSchema>;

/** Batch-scoped inline character DNA; it is stored in the placeholder only and never written to lorebook. */
export const TextToImageTemporaryCharacterSchema = z.object({
    schema: z.literal("nbook.character-visual/v1"),
    characterId: z.string().trim().min(1),
    character: z.record(z.string(), z.string()),
    outfits: z.array(z.record(z.string(), z.string())).default([]),
    photos: z.array(z.string()).default([]),
}).strict();
export type TextToImageTemporaryCharacter = z.infer<typeof TextToImageTemporaryCharacterSchema>;

/** 正文占位符只保存定位与提示词，最终生成参数在队列编译时展开。 */
export const TextToImagePromptPayloadSchema = z.object({
    schema: z.literal("nbook.text-to-image-prompt/v1"),
    prompt: z.string(),
    negativePrompt: z.string().default(""),
    anchor: z.string().default(""),
    title: z.string().default(""),
    size: z.string().default(""),
    tagThink: z.string().default(""),
    characterPrompts: z.array(TextToImageCharacterPromptSchema).max(4).optional(),
    temporaryCharacters: z.array(TextToImageTemporaryCharacterSchema).max(32).optional(),
}).strict();

export type TextToImagePromptPayload = z.infer<typeof TextToImagePromptPayloadSchema> & {
    id: string;
};

/** 正文编辑器中可双击的生成图片引用。 */
export type TextToImageAssetActionTarget = {
    relativePath: string;
};

const SINGLE_PATTERN = /^<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*)\n<\/text-to-image-prompt>$/u;
const ALL_PATTERN = /<text-to-image-prompt\s+id="([^"]+)">\n([\s\S]*?)\n<\/text-to-image-prompt>/gu;
const NOVEL_AI_IMAGE_PATTERN = /!\[NovelAI 生成图片\]\([^)]*\)(?:\s+"[^"]*")?/gu;
const NOVEL_AI_IMAGE_REFERENCE_PATTERN = /!\[NovelAI 生成图片\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
const RAW_IMAGE_BLOCK_PATTERN = /<image>[\s\S]*?<\/image>/giu;
const GENERATION_MARKER_PATTERNS = [
    /<text-to-image-prompt\s+id=/u,
    /!\[NovelAI 生成图片\]\(/u,
    /<image>/iu,
];

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

/** 整体重roll前清理正文里的生图占位符、已生成图片和原始 `<image>` 块；普通图片保留。 */
export function stripTextToImageGenerationMarkdown(markdown: string): string {
    return markdown
        .replace(ALL_PATTERN, "")
        .replace(NOVEL_AI_IMAGE_PATTERN, "")
        .replace(RAW_IMAGE_BLOCK_PATTERN, "")
        .replace(/[ \t]+\n/gu, "\n")
        .replace(/\n{2,}/gu, "\n")
        .trim();
}

/** 判断正文中是否已有生图占位符、已生成图片或原始 `<image>` 块。 */
export function hasTextToImageGenerationMarkdown(markdown: string): boolean {
    return GENERATION_MARKER_PATTERNS.some((pattern) => pattern.test(markdown));
}

/** 渲染最终写回正文的标准 Markdown 图片引用。 */
export function renderTextToImageAssetMarkdown(asset: TextToImageAssetDto): string {
    const destination = escapeMarkdownDestination(asset.relativePath);
    const title = escapeMarkdownTitle(`seed ${asset.seed} | ${asset.width}x${asset.height}`);
    return `![NovelAI 生成图片](${destination} "${title}")`;
}

/** 用后处理后的新资产替换正文中指定旧图片引用，只命中 NovelAI 生成图片。 */
export function replaceTextToImageAssetMarkdown(
    markdown: string,
    relativePath: string,
    nextAsset: TextToImageAssetDto,
): string {
    const target = normalizeMarkdownImageDestination(relativePath);
    return markdown.replace(NOVEL_AI_IMAGE_REFERENCE_PATTERN, (raw, destination: string) => {
        return normalizeMarkdownImageDestination(destination) === target
            ? renderTextToImageAssetMarkdown(nextAsset)
            : raw;
    });
}

function normalizeMarkdownImageDestination(value: string): string {
    const unescaped = value
        .replace(/\\\(/gu, "(")
        .replace(/\\\)/gu, ")")
        .replace(/\\\\/gu, "\\");
    try {
        return decodeURIComponent(unescaped);
    } catch {
        return unescaped;
    }
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
