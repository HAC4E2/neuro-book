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
};

export type BodyImageHistoryPrefill = {
    path: string;
    content: string;
};

const IMAGE_PATTERN = /<image>([\s\S]*?)<\/image>/giu;

/**
 * 解析 LLM 返回的 `<image>...</image>` 块。
 * 支持外层 `<content>/<images>` 包裹与块内五要素子标签；解析失败抛错。
 */
export function parseBodyImageBlocks(text: string): BodyImageBlock[] {
    const blocks: BodyImageBlock[] = [];
    for (const match of text.matchAll(IMAGE_PATTERN)) {
        blocks.push(parseBodyImageBlock(match[1] ?? ""));
    }
    if (blocks.length === 0) {
        throw new Error("未找到 <image> 块");
    }
    return blocks;
}

/** 调用 LLM 生成正文生图块；解析失败最多重试 2 次，仍失败抛错。 */
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
}): Promise<BodyImageBlock[]> {
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
    let lastError: Error | null = null;
    const director = new IllustrationDirector();

    for (let attempt = 0; attempt < 3; attempt += 1) {
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
        try {
            const parsedBlocks = parseBodyImageBlocks(applyReplacementProfile({
                text: content,
                rulesText: input.aiReplacementRules ?? "",
                kind: "ai",
            }));
            const blocks = director.normalize(parsedBlocks).blocks;
            return blocks.map((block) => ({
                ...block,
                temporaryCharacters: mergeTemporaryCharacters([
                    ...extractTemporaryCharacterRegistry(block.prompt ?? block.prompts),
                    ...(block.characterPrompts ?? []).flatMap((item) => extractTemporaryCharacterRegistry(item.prompt)),
                ]),
            }));
        } catch (error) {
            lastError = toError(error);
        }
    }

    throw new Error(`正文生图块解析失败：重试 2 次后仍未成功；最后原因：${lastError?.message ?? "未知"}`);
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
    const prompts = extractTag(block, "prompts");
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
            ? parseCharacterGridCenter(gridCenterValue)
            : centerValue !== ""
                ? parseCharacterCenter(centerValue)
                : parseCharacterGridCenter(inlineCenterValue);
        if ((gridCenterValue !== "" || centerValue !== "" || inlineCenterValue !== "") && center === null) {
            throw new Error(`分角色 ${result.length + 1} 的 center 必须是 0 到 1 之间的两个数字或 A1-E5 网格坐标`);
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
