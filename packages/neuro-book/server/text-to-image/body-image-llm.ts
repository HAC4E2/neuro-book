import {
    buildBodyImageSystemPrompt,
    buildBodyImageUserPrompt,
} from "nbook/server/text-to-image/body-image-prompt";
import {
    requestLlmCompletion,
} from "nbook/server/text-to-image/llm-chat";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {applyReplacementProfile} from "nbook/server/text-to-image/sensitive-word-replacement";
import {buildRequestMessages, type TextToImagePromptMode} from "nbook/server/text-to-image/llm-context";
import type {TextToImageContextEntry} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageCharacterPrompt} from "nbook/shared/text-to-image-markdown";
import type {TextToImageRuntimePlaceholderContext} from "nbook/server/text-to-image/runtime-placeholder";
import type {TextToImageLlmTraceHandle} from "nbook/server/text-to-image/llm-trace";
import {extractTemporaryCharacterRegistry} from "nbook/server/text-to-image/body-prompt-compiler";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";
import {IllustrationDirector} from "nbook/server/text-to-image/illustration-director";
import type {BodyImageDiagnostic} from "nbook/server/text-to-image/body-image-diagnostics";

/** L1 正文生图块：五要素契约，不落盘。 */
export type BodyImageBlock = {
    regex: string;
    title: string;
    tagThink: string;
    size: string;
    prompts: string;
    prompt?: string;
    characterPrompts?: TextToImageCharacterPrompt[];
    temporaryCharacters?: CharacterVisualFile[];
    /** LLM 回复中的 1-based 图片块序号，仅用于非致命诊断，不会落盘。 */
    sourceIndex?: number;
};

export type BodyImageHistoryPrefill = {
    path: string;
    content: string;
};

const IMAGE_TAG_PATTERN = /<\/?image>/giu;

export type BodyImageGenerationResult = {
    blocks: BodyImageBlock[];
    diagnostics: BodyImageDiagnostic[];
};

export class BodyImagePlanningBlockedError extends Error {
    readonly code = "no_usable_blocks" as const;
    readonly diagnostics: BodyImageDiagnostic[];

    constructor(diagnostics: BodyImageDiagnostic[]) {
        super("正文生图没有产出可用图片块，正文未修改");
        this.name = "BodyImagePlanningBlockedError";
        this.diagnostics = diagnostics;
    }
}

/**
 * 解析 LLM 返回的 `<image>...</image>` 块。
 * 支持外层 `<content>/<images>` 包裹与块内五要素子标签；有可用块即返回，全部无效才抛错。
 * 需要逐块诊断时使用 parseBodyImageBlocksWithDiagnostics。
 */
export function parseBodyImageBlocks(text: string): BodyImageBlock[] {
    const result = parseBodyImageBlocksWithDiagnostics(text);
    if (result.blocks.length === 0) {
        if (result.diagnostics.length > 0) {
            throw new Error(result.diagnostics[0]!.message);
        }
        throw new Error("未找到 <image> 块");
    }
    return result.blocks;
}

/** 宽容解析 LLM 回复；单个坏块只产生诊断，不影响其它完整块。 */
export function parseBodyImageBlocksWithDiagnostics(text: string): {
    blocks: BodyImageBlock[];
    diagnostics: BodyImageDiagnostic[];
} {
    const blocks: BodyImageBlock[] = [];
    const diagnostics: BodyImageDiagnostic[] = [];
    for (const candidate of extractImageBlockCandidates(text)) {
        if (!candidate.closed) {
            diagnostics.push({
                blockIndex: candidate.blockIndex,
                code: "block_truncated",
                action: "skipped",
                message: `第 ${candidate.blockIndex} 个图片块未闭合，已跳过`,
            });
            continue;
        }
        try {
            blocks.push({
                ...parseBodyImageBlock(candidate.body),
                sourceIndex: candidate.blockIndex,
            });
        } catch (error) {
            diagnostics.push({
                blockIndex: candidate.blockIndex,
                code: "block_invalid",
                action: "skipped",
                message: `第 ${candidate.blockIndex} 个图片块格式不完整，已跳过：${toError(error).message}`,
            });
        }
    }
    return {blocks, diagnostics};
}

/** 调用 LLM 生成正文生图块；有可用块即部分成功，无可用块立即报告阻塞。 */
export async function generateBodyImageBlocks(input: {
    provider: {
        baseUrl: string;
        credential: string;
        settings: Record<string, unknown>;
    };
    chapterContent: string;
    characterSummary: string;
    textReplacementRules?: string;
    aiReplacementRules?: string;
    contextEntries?: TextToImageContextEntry[];
    promptMode?: TextToImagePromptMode;
    runtime?: TextToImageRuntimePlaceholderContext;
    trace?: TextToImageLlmTraceHandle;
    historyPrefill?: BodyImageHistoryPrefill[];
    complete?: typeof requestLlmCompletion;
}): Promise<BodyImageGenerationResult> {
    const settings = TextToImageLlmProviderSettingsSchema.parse(input.provider.settings);
    const complete = input.complete ?? requestLlmCompletion;
    const systemPrompt = buildBodyImageSystemPrompt();
    const userPrompt = buildBodyImageUserPrompt({
        chapterContent: applyReplacementProfile({
            text: input.chapterContent,
            rulesText: input.textReplacementRules ?? "",
            kind: "text",
        }),
        characterSummary: input.characterSummary,
    });
    const director = new IllustrationDirector();

    const content = await complete({
        baseUrl: input.provider.baseUrl,
        credential: input.provider.credential,
        model: settings.model,
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
        stream: settings.stream,
        sendImages: settings.sendImages,
        mergeSystemUser: settings.mergeSystemUser,
        retryCount: settings.retryCount,
        runtime: input.runtime,
        trace: input.trace,
        messages: buildRequestMessages(input.contextEntries ?? [], input.runtime ?? {}, [
            ...buildHistoryPrefillMessages(input.historyPrefill ?? []),
            {role: "system", content: systemPrompt},
            {role: "user", content: userPrompt},
        ], input.promptMode),
    });
    const parsed = parseBodyImageBlocksWithDiagnostics(applyReplacementProfile({
        text: content,
        rulesText: input.aiReplacementRules ?? "",
        kind: "ai",
    }));
    const diagnostics = [...parsed.diagnostics];
    const blocks: BodyImageBlock[] = [];
    for (const block of parsed.blocks) {
        try {
            const normalized = director.normalize([block]).blocks[0]!;
            blocks.push({
                ...normalized,
                sourceIndex: block.sourceIndex,
                temporaryCharacters: mergeTemporaryCharacters([
                    ...extractTemporaryCharacterRegistry(normalized.prompt ?? normalized.prompts),
                    ...(normalized.characterPrompts ?? []).flatMap((item) => extractTemporaryCharacterRegistry(item.prompt)),
                ]),
            });
        } catch (error) {
            const blockIndex = block.sourceIndex ?? blocks.length + 1;
            diagnostics.push({
                blockIndex,
                code: "call_invalid",
                action: "skipped",
                message: `第 ${blockIndex} 个图片块的角色调用格式无效，已跳过：${toError(error).message}`,
            });
        }
    }

    if (blocks.length === 0) {
        throw new BodyImagePlanningBlockedError(diagnostics);
    }
    return {blocks, diagnostics};
}

function extractImageBlockCandidates(text: string): Array<{
    body: string;
    blockIndex: number;
    closed: boolean;
}> {
    const candidates: Array<{body: string; blockIndex: number; closed: boolean}> = [];
    let openStart: number | null = null;
    let blockIndex = 0;
    for (const match of text.matchAll(IMAGE_TAG_PATTERN)) {
        const token = match[0] ?? "";
        const tokenStart = match.index ?? 0;
        if (token.toLowerCase() === "<image>") {
            if (openStart !== null) {
                candidates.push({
                    body: text.slice(openStart + "<image>".length, tokenStart),
                    blockIndex,
                    closed: false,
                });
            }
            openStart = tokenStart;
            blockIndex += 1;
            continue;
        }
        if (openStart === null) continue;
        candidates.push({
            body: text.slice(openStart + "<image>".length, tokenStart),
            blockIndex,
            closed: true,
        });
        openStart = null;
    }
    if (openStart !== null) {
        candidates.push({
            body: text.slice(openStart + "<image>".length),
            blockIndex,
            closed: false,
        });
    }
    return candidates;
}

function buildHistoryPrefillMessages(history: BodyImageHistoryPrefill[]): Array<{role: "system"; content: string}> {
    if (history.length === 0) {
        return [];
    }
    const content = history
        .map((entry) => `<history path="${entry.path}">\n${entry.content}\n</history>`)
        .join("\n\n");
    return [{
        role: "system",
        content: `以下是同一卷的历史前文，仅用于保持上下文连续性，不要为其中的 <image> 占位块生成图片：\n${content}`,
    }];
}

function parseBodyImageBlock(block: string): BodyImageBlock {
    const regex = extractTag(block, "regex");
    const prompts = normalizeCertifiedPromptText(extractTag(block, "prompts"));
    if (regex === "" || prompts === "") {
        throw new Error("image 块必须包含非空的 <regex> 与 <prompts>");
    }
    return {
        regex,
        title: extractTag(block, "title_styled"),
        tagThink: extractTag(block, "Tag_think"),
        size: extractTag(block, "size"),
        prompts,
        prompt: normalizeBodyPromptText(prompts),
        characterPrompts: extractCharacterPrompts(prompts),
    };
}

function extractCharacterPrompts(prompts: string): TextToImageCharacterPrompt[] {
    const result: TextToImageCharacterPrompt[] = [];
    const matches = [...prompts.matchAll(/<character_\d+>([\s\S]*?)<\/character_\d+>/giu)];
    if (matches.length > 4) {
        throw new Error("分角色结构最多支持 4 个 character 槽位");
    }
    for (const match of matches) {
        const block = match[1] ?? "";
        const rawPrompt = extractTag(block, "prompt");
        const inlineCenterMatch = /\|centers\s*:\s*([^;|]+)\s*;?/iu.exec(rawPrompt);
        const inlineCenterValue = inlineCenterMatch?.[1]?.trim() ?? "";
        const prompt = rawPrompt.replace(inlineCenterMatch?.[0] ?? "", "").trim();
        if (prompt === "") {
            continue;
        }
        const gridCenterValue = extractTag(block, "centers");
        const centerValue = extractTag(block, "center") || extractTag(block, "position");
        const center = gridCenterValue !== ""
            ? parseCharacterCenterValue(gridCenterValue)
            : centerValue !== ""
                ? parseCharacterCenterValue(centerValue)
                : parseCharacterCenterValue(inlineCenterValue);
        if ((gridCenterValue !== "" || centerValue !== "" || inlineCenterValue !== "") && center === null) {
            throw new Error(`分角色 ${result.length + 1} 的 center 必须是 0 到 1 之间的两个数字、A1-E5 网格坐标或方位词`);
        }
        result.push({
            prompt,
            negativePrompt: extractTag(block, "uc") || extractTag(block, "negative_prompt"),
            ...(center ? {centerX: center.x, centerY: center.y} : {}),
        });
        if (result.length >= 4) {
            break;
        }
    }
    return result;
}

function mergeTemporaryCharacters(characters: CharacterVisualFile[]): CharacterVisualFile[] {
    return [...new Map(characters.map((item) => [item.characterId, item])).values()];
}

function parseCharacterCenter(value: string): {x: number; y: number} | null {
    const numbers = value.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
    if (numbers.length < 2 || numbers.some((number) => !Number.isFinite(number))) {
        return null;
    }
    const [x, y] = numbers;
    if (x === undefined || y === undefined || x < 0 || x > 1 || y < 0 || y > 1) {
        return null;
    }
    return {x, y};
}

function parseCharacterCenterValue(value: string): {x: number; y: number} | null {
    const normalized = normalizeCertifiedPromptText(value).trim();
    if (normalized === "") {
        return null;
    }
    return parseCharacterGridCenter(normalized)
        ?? parseCharacterCenter(normalized)
        ?? parseCharacterSemanticCenter(normalized);
}

function parseCharacterGridCenter(value: string): {x: number; y: number} | null {
    const match = /^([A-E])\s*([1-5])\s*;?$/iu.exec(value.trim());
    if (!match) {
        return null;
    }
    const column = match[1]!.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
    const row = Number(match[2]) - 1;
    return {
        x: 0.1 + column * 0.2,
        y: 0.1 + row * 0.2,
    };
}

/**
 * 新版 chatu-8 预设会使用左右位置与前中后景，而 NovelAI 只接收二维归一化坐标。
 * 这里映射到五格坐标的 B/C/D 行列，避免把一般方位推到画面边缘。
 */
function parseCharacterSemanticCenter(value: string): {x: number; y: number} | null {
    const tokens = value
        .toLowerCase()
        .replace(/\bfore\s+ground\b/gu, "foreground")
        .replace(/\bmid(?:dle)?\s+ground\b/gu, "middleground")
        .replace(/\bback\s+ground\b/gu, "background")
        .replace(/\b(left|right)\s+side\b/gu, "$1")
        .split(/[^\p{L}]+/gu)
        .filter((token) => token !== "");
    const horizontal = tokens
        .map(resolveHorizontalSemanticCoordinate)
        .find((coordinate) => coordinate !== null) ?? null;
    const depth = tokens
        .map(resolveDepthSemanticCoordinate)
        .find((coordinate) => coordinate !== null) ?? null;
    if (horizontal === null && depth === null) {
        return null;
    }
    return {
        x: horizontal ?? 0.5,
        y: depth ?? 0.5,
    };
}

function resolveHorizontalSemanticCoordinate(token: string): number | null {
    if (["left", "左", "左侧", "左边"].includes(token)) return 0.3;
    if (["center", "centre", "central", "middle", "中", "中间", "中央"].includes(token)) return 0.5;
    if (["right", "右", "右侧", "右边"].includes(token)) return 0.7;
    return null;
}

function resolveDepthSemanticCoordinate(token: string): number | null {
    if (["background", "backdrop", "top", "upper", "背景", "后景", "上", "上方", "顶部"].includes(token)) return 0.3;
    if (["middleground", "midground", "中景"].includes(token)) return 0.5;
    if (["foreground", "bottom", "lower", "前景", "下", "下方", "底部"].includes(token)) return 0.7;
    return null;
}

/** 新版预设的安全认证标记不是 NovelAI tag，进入结构解析前只从绘图提示字段中移除。 */
function normalizeCertifiedPromptText(value: string): string {
    return value.replace(/(^|[^\p{L}\p{N}_])s(?:a|ā)fe\s*[&＆]\s*/giu, "$1");
}

function normalizeBodyPromptText(prompts: string): string {
    const scene = extractTag(prompts, "scene_composition");
    const withoutCharacters = prompts.replace(/<character_\d+>[\s\S]*?<\/character_\d+>/giu, "");
    const withoutTags = withoutCharacters
        .replace(/<scene_composition>[\s\S]*?<\/scene_composition>/giu, "")
        .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/gu, "");
    return [scene, withoutTags]
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .join(", ");
}

function extractTag(block: string, tag: string): string {
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "iu");
    return pattern.exec(block)?.[1]?.trim() ?? "";
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
