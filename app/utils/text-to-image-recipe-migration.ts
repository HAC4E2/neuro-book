import {z} from "zod";
import {
    createDefaultTextToImageRecipeSource,
    TextToImageRecipeSourceSchema,
    type TextToImageRecipeSource,
} from "nbook/shared/text-to-image-recipe";

const PreviousNovelAiDraftSchema = z.object({
    model: z.string().trim().min(1).optional(),
    sampler: z.string().trim().min(1).optional(),
    noiseSchedule: z.string().trim().min(1).optional(),
    promptGuidance: z.number().min(0).max(20).optional(),
    promptGuidanceRescale: z.number().min(0).max(1).optional(),
    aiDefaultCharacterPosition: z.boolean().optional(),
    variety: z.boolean().optional(),
    smeaMode: z.enum(["auto", "off", "on"]).optional(),
    smeaDyn: z.boolean().optional(),
    decrisper: z.boolean().optional(),
    width: z.number().int().min(64).max(4096).optional(),
    height: z.number().int().min(64).max(4096).optional(),
    steps: z.number().int().min(1).max(50).optional(),
    seed: z.number().int().min(-1).max(4294967295).optional(),
}).passthrough();

const PreviousStyleDraftSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    positivePrefix: z.string().optional(),
    positiveSuffix: z.string().optional(),
    negativePrefix: z.string().optional(),
    negativeSuffix: z.string().optional(),
    useFurryDataset: z.boolean().optional(),
    positiveQualityPreset: z.boolean().optional(),
    negativeQualityPreset: z.enum(["none", "heavy", "light", "humanFocus", "furryFocus"]).optional(),
}).passthrough();

const PreviousLocalDraftSchema = z.object({
    novelAi: PreviousNovelAiDraftSchema.optional(),
    stylePresets: z.array(PreviousStyleDraftSchema).optional(),
    activeStyleId: z.string().optional(),
}).passthrough();

export type TextToImageRecipeMigrationModel = {
    providerId: number;
    model: string;
};

export type TextToImageRecipeMigrationInspection = {
    source: TextToImageRecipeSource;
    /** 非空表示浏览器草稿与旧运行时真相冲突，保存前必须由用户显式选择。 */
    modelConflict: {
        browserModel: string | null;
        providerModels: string[];
    } | null;
};

/**
 * 一次性读取上一版本地草稿中的可迁移字段。
 * token、URL、Vibe、图片 Data URL 与任何未列出的字段都不会进入 Recipe。
 */
export function parseTextToImageRecipeMigration(raw: string | null): TextToImageRecipeSource | null {
    return inspectTextToImageRecipeMigration(raw, [])?.source ?? null;
}

/**
 * 合并浏览器旧草稿与服务端保留的旧实际 Provider model，冲突只报告、不猜选。
 * Provider model 仅形成一次性 proposal，不会成为运行时配置来源。
 */
export function inspectTextToImageRecipeMigration(
    raw: string | null,
    recipeMigrationModels: TextToImageRecipeMigrationModel[],
): TextToImageRecipeMigrationInspection | null {
    try {
        const json: unknown = raw?.trim() ? JSON.parse(raw) : {};
        const parsed = PreviousLocalDraftSchema.safeParse(json);
        const providerModels = [...new Set(recipeMigrationModels
            .map((candidate) => candidate.model.trim())
            .filter(Boolean))];
        if (!parsed.success || (!parsed.data.novelAi && !parsed.data.stylePresets && providerModels.length === 0)) {
            return null;
        }
        const defaults = createDefaultTextToImageRecipeSource();
        const novelAi = parsed.data.novelAi ?? {};
        const style = parsed.data.stylePresets?.find((item) => item.id === parsed.data.activeStyleId)
            ?? parsed.data.stylePresets?.[0]
            ?? {};
        const width = novelAi.width ?? defaults.dimensions.fixed.width;
        const height = novelAi.height ?? defaults.dimensions.fixed.height;
        const seed = novelAi.seed ?? -1;
        const browserModel = novelAi.model?.trim() || null;
        const source = TextToImageRecipeSourceSchema.parse({
            ...defaults,
            title: style.name?.trim() || defaults.title,
            model: browserModel ?? (providerModels.length === 1 ? providerModels[0] : defaults.model),
            sampler: novelAi.sampler ?? defaults.sampler,
            noiseSchedule: novelAi.noiseSchedule ?? defaults.noiseSchedule,
            promptGuidance: novelAi.promptGuidance ?? defaults.promptGuidance,
            promptGuidanceRescale: novelAi.promptGuidanceRescale ?? defaults.promptGuidanceRescale,
            steps: novelAi.steps ?? defaults.steps,
            dimensions: {
                ...defaults.dimensions,
                fixed: {width, height},
            },
            seed: seed < 0 ? {policy: "random", fixed: 0} : {policy: "fixed", fixed: seed},
            advanced: {
                aiDefaultCharacterPosition: novelAi.aiDefaultCharacterPosition ?? defaults.advanced.aiDefaultCharacterPosition,
                variety: novelAi.variety ?? defaults.advanced.variety,
                smeaMode: novelAi.smeaMode ?? defaults.advanced.smeaMode,
                smeaDyn: novelAi.smeaDyn ?? defaults.advanced.smeaDyn,
                decrisper: novelAi.decrisper ?? defaults.advanced.decrisper,
            },
            style: {
                positivePrefix: style.positivePrefix ?? defaults.style.positivePrefix,
                positiveSuffix: style.positiveSuffix ?? defaults.style.positiveSuffix,
                negativePrefix: style.negativePrefix ?? defaults.style.negativePrefix,
                negativeSuffix: style.negativeSuffix ?? defaults.style.negativeSuffix,
                useFurryDataset: style.useFurryDataset ?? defaults.style.useFurryDataset,
                positiveQualityPreset: style.positiveQualityPreset ?? defaults.style.positiveQualityPreset,
                negativeQualityPreset: style.negativeQualityPreset ?? defaults.style.negativeQualityPreset,
            },
        });
        const modelConflict = providerModels.length > 0 && (
            browserModel === null
                ? providerModels.length > 1
                : providerModels.some((model) => model !== browserModel)
        ) ? {browserModel, providerModels} : null;
        return {source, modelConflict};
    } catch {
        return null;
    }
}

/** 成功保存 Project Recipe 后，删除旧配置字段与不再更新的浏览器 NovelAI debug snapshot。 */
export function removeTextToImageRecipeMigrationKeys(raw: string | null): string | null {
    if (!raw?.trim()) {
        return raw;
    }
    try {
        const json: unknown = JSON.parse(raw);
        if (!isPlainObject(json)) {
            return raw;
        }
        const next = {...json};
        delete next.novelAi;
        delete next.stylePresets;
        delete next.activeStyleId;
        delete next.lastNovelAiExchange;
        return Object.keys(next).length === 0 ? null : JSON.stringify(next);
    } catch {
        return raw;
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
