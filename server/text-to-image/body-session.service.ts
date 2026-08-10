import {generateBodyImageBlocks} from "nbook/server/text-to-image/body-image-llm";
import type {BodyImageBlock} from "nbook/server/text-to-image/body-image-llm";
import type {BodyImageHistoryPrefill} from "nbook/server/text-to-image/body-image-llm";
import {insertBodyImagePlaceholders} from "nbook/server/text-to-image/body-image-insert.service";
import {buildBodyCharacterSummary} from "nbook/server/text-to-image/body-character-scanner";
import type {BodyCharacterMatch} from "nbook/server/text-to-image/body-character-scanner";
import type {TextToImageContextEntry} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageRuntimePlaceholderContext} from "nbook/server/text-to-image/runtime-placeholder";

export type BodySessionServiceInput = {
    provider: {
        baseUrl: string;
        credential: string;
        settings: Record<string, unknown>;
    };
    chapterContent: string;
    characterMatches?: BodyCharacterMatch[];
    /** 兼容旧调用方的字段；正文生图始终以本次后端扫描结果为准。 */
    characterSummary?: string;
    textReplacementRules?: string;
    aiReplacementRules?: string;
    contextEntries?: TextToImageContextEntry[];
    runtime?: TextToImageRuntimePlaceholderContext;
    historyPrefill?: BodyImageHistoryPrefill[];
    generate?: typeof generateBodyImageBlocks;
};

export type BodySessionResult = {
    blocks: BodyImageBlock[];
    content: string;
    placeholders: Awaited<ReturnType<typeof insertBodyImagePlaceholders>>["placeholders"];
    characterSummary: string;
    matchedCharacters: BodyCharacterMatch[];
};

/**
 * 正文生图的机械编排：后端扫描摘要 → LLM L1 块 → L2 占位符。
 * 角色触发扫描与摘要组装都在工作台后端完成，不经过 Agent。
 */
export async function generateBodyPrompts(input: BodySessionServiceInput): Promise<BodySessionResult> {
    const characterSummary = buildBodyCharacterSummary(input.characterMatches ?? []);
    const blocks = await (input.generate ?? generateBodyImageBlocks)({
        provider: input.provider,
        chapterContent: input.chapterContent,
        characterSummary,
        textReplacementRules: input.textReplacementRules,
        aiReplacementRules: input.aiReplacementRules,
        contextEntries: input.contextEntries,
        runtime: input.runtime,
        historyPrefill: input.historyPrefill,
    });
    const inserted = insertBodyImagePlaceholders({
        chapterContent: input.chapterContent,
        blocks,
    });
    return {
        blocks,
        content: inserted.content,
        placeholders: inserted.placeholders,
        characterSummary,
        matchedCharacters: input.characterMatches ?? [],
    };
}
