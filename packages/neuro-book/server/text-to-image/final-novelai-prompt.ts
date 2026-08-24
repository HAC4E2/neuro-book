import {
    applyPromptReplacementToSegments,
    parsePromptReplacementRules,
} from "nbook/shared/text-to-image-prompt-replacement";
import {
    dedupeNovelAiPrompt,
    type FinalNovelAiPromptBundle,
} from "nbook/shared/text-to-image-novelai-prompt";
import {TextToImageNovelAiModelSchema, type TextToImageNovelAiModel} from "nbook/shared/dto/text-to-image.dto";
import {requireNovelAiModelCapabilities} from "nbook/shared/text-to-image-novelai-capabilities";
import {resolveNovelAiQualityPresets} from "nbook/server/text-to-image/novelai-quality";

export type BuildFinalNovelAiPromptInput = {
    model: TextToImageNovelAiModel;
    prompt: string;
    negativePrompt: string | null | undefined;
    fixedPositivePrompt: string;
    fixedPositivePromptEnd: string;
    fixedNegativePrompt: string;
    rulesText: string;
    furryDataset: boolean;
    positiveQualityPreset: boolean;
    negativeQualityPreset: string;
    characterPrompts?: Array<{prompt: string; negativePrompt: string; centerX?: number; centerY?: number}>;
};

/**
 * AQT/UCP 由本地组装器单一展开：拼进最终正/负向字符串后，
 * 队列必须关闭 NovelAI 的 qualityToggle 并发送 ucPreset=none，避免双重注入。
 */
export const NOVEL_AI_LOCAL_QUALITY_OWNERSHIP = {
    qualityToggle: false,
    ucPreset: "none",
} as const;

/**
 * 唯一最终 prompt 组装器：规则替换 → 逻辑段拼接 → 正向/负向/角色槽分别去重。
 * bundle.actualInput/actualNegativeInput 与生成器 payload 的 v4 基础 caption 一一映射。
 */
export function buildFinalNovelAiPromptBundle(input: BuildFinalNovelAiPromptInput): FinalNovelAiPromptBundle {
    const modelResult = TextToImageNovelAiModelSchema.safeParse(input.model);
    if (!modelResult.success) {
        throw new Error(`不支持的 NovelAI 模型：${input.model}`);
    }
    const model = modelResult.data;
    const capabilities = requireNovelAiModelCapabilities(model);
    const replacement = applyPromptReplacementToSegments({
        prompt: input.prompt,
        rulesText: input.rulesText,
        characterPrompts: input.characterPrompts,
    });
    if (parsePromptReplacementRules(input.rulesText).errors.length > 0) {
        throw new Error("提示词替换规则存在语法错误，请先修复后再生成");
    }
    const quality = resolveNovelAiQualityPresets({
        model,
        positiveEnabled: input.positiveQualityPreset,
        negativePreset: input.negativeQualityPreset,
    });
    const baseWithFurry = input.furryDataset ? "fur dataset" : "";
    const basePositive = joinPromptParts(
        replacement.segments.beforeFront,
        input.fixedPositivePrompt,
        replacement.segments.afterFront,
        baseWithFurry,
        replacement.basePositive,
        replacement.segments.beforeBack,
        input.fixedPositivePromptEnd,
        replacement.segments.afterBack,
        quality.aqt,
        replacement.segments.last,
    );
    const baseNegative = joinPromptParts(
        quality.ucp,
        input.negativePrompt ?? input.fixedNegativePrompt,
    );
    const characters = replacement.characterPrompts.map((item) => ({
        positive: dedupeNovelAiPrompt(item.positive),
        negative: dedupeNovelAiPrompt(item.negative),
        ...(item.centerX === undefined ? {} : {centerX: item.centerX}),
        ...(item.centerY === undefined ? {} : {centerY: item.centerY}),
    }));

    return {
        version: 2,
        modelFamily: capabilities.family,
        model,
        basePositive,
        baseNegative,
        characters,
        actualInput: dedupeNovelAiPrompt(basePositive),
        actualNegativeInput: dedupeNovelAiPrompt(baseNegative),
        appliedRuleLines: replacement.appliedRuleLines,
    };
}

export function joinPromptParts(...parts: Array<string | string[] | null | undefined>): string {
    return parts
        .flatMap((part) => (Array.isArray(part) ? part : [part]))
        .map((part) => (part ?? "").trim().replace(/^,+|,+$/gu, ""))
        .filter((part) => part !== "")
        .join(", ");
}
