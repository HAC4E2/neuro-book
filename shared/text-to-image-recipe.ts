import {z} from "zod";
import {TextToImageReferenceSelectionSchema} from "nbook/shared/text-to-image-reference-asset";

export const TEXT_TO_IMAGE_RECIPE_SCHEMA_VERSION = 2 as const;
export const DEFAULT_TEXT_TO_IMAGE_RECIPE_ID = "default" as const;

export const TextToImageRecipeDimensionsSchema = z.object({
    mode: z.enum(["fixed", "byIntent"]),
    fixed: z.object({
        width: z.number().int().min(64).max(4096),
        height: z.number().int().min(64).max(4096),
    }).strict(),
    portrait: z.object({
        width: z.number().int().min(64).max(4096),
        height: z.number().int().min(64).max(4096),
    }).strict(),
    landscape: z.object({
        width: z.number().int().min(64).max(4096),
        height: z.number().int().min(64).max(4096),
    }).strict(),
    square: z.object({
        width: z.number().int().min(64).max(4096),
        height: z.number().int().min(64).max(4096),
    }).strict(),
}).strict();

export const TextToImageRecipeSeedSchema = z.object({
    policy: z.enum(["fixed", "random"]),
    fixed: z.number().int().min(0).max(4294967295),
}).strict();

export const TextToImageRecipeStyleSchema = z.object({
    positivePrefix: z.string(),
    positiveSuffix: z.string(),
    negativePrefix: z.string(),
    negativeSuffix: z.string(),
    useFurryDataset: z.boolean(),
    positiveQualityPreset: z.boolean(),
    negativeQualityPreset: z.enum(["none", "heavy", "light", "humanFocus", "furryFocus"]),
}).strict();

export const TextToImageRecipeAdvancedSchema = z.object({
    aiDefaultCharacterPosition: z.boolean(),
    variety: z.boolean(),
    smeaMode: z.enum(["auto", "off", "on"]),
    smeaDyn: z.boolean(),
    decrisper: z.boolean(),
}).strict();

/**
 * Project Recipe 的严格源合同。
 *
 * Provider/API、凭据、最终 Prompt、Data URL 与 Job 状态均不属于 Recipe，未知字段整份拒绝。
 */
export const TextToImageRecipeSourceSchema = z.object({
    schemaVersion: z.literal(TEXT_TO_IMAGE_RECIPE_SCHEMA_VERSION),
    recipeId: z.literal(DEFAULT_TEXT_TO_IMAGE_RECIPE_ID),
    title: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(160),
    sampler: z.string().trim().min(1).max(80),
    noiseSchedule: z.string().trim().min(1).max(80),
    steps: z.number().int().min(1).max(50),
    promptGuidance: z.number().min(0).max(20),
    promptGuidanceRescale: z.number().min(0).max(1),
    dimensions: TextToImageRecipeDimensionsSchema,
    seed: TextToImageRecipeSeedSchema,
    advanced: TextToImageRecipeAdvancedSchema,
    style: TextToImageRecipeStyleSchema,
    /** P5 参考资源区：Compiler 冻结 contentHash + strength；不存 bytes/Data URL。 */
    references: z.object({
        /** NovelAI 归一化 Vibe 权重开关。 */
        normalizeVibeStrengths: z.boolean(),
        vibeReferences: z.array(TextToImageReferenceSelectionSchema).max(16),
        characterReferences: z.array(TextToImageReferenceSelectionSchema).max(1),
        inpaint: TextToImageReferenceSelectionSchema.nullable(),
    }).strict(),
}).strict();

export type TextToImageRecipeSource = z.infer<typeof TextToImageRecipeSourceSchema>;

export const TextToImageRecipeSnapshotSchema = TextToImageRecipeSourceSchema.extend({
    /** 只覆盖画幅与尺寸规划约束；画风或采样参数变化不触发重新规划。 */
    planningConstraintsHash: z.string().regex(/^[a-f0-9]{64}$/u),
    /** 覆盖完整规范化 Recipe source；任意执行字段变化都会失效旧 preview。 */
    recipeSourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type TextToImageRecipeSnapshot = z.infer<typeof TextToImageRecipeSnapshotSchema>;

/**
 * 按 Recipe 合同把一个画风通道拆成有序 Tag atoms。
 * 逗号、中文逗号与换行是唯一分隔符；空项表示配置不完整并直接拒绝。
 */
export function splitTextToImageRecipeStyleAtoms(valueInput: string): string[] {
    const value = z.string().parse(valueInput);
    if (!value.trim()) return [];
    const atoms = value.split(/[,，\n]/u).map((item) => item.trim());
    if (atoms.some((item) => item.length === 0)) {
        throw new Error("TEXT_TO_IMAGE_RECIPE_STYLE_INVALID: Recipe 画风串不能包含空 Tag 项");
    }
    return atoms;
}

/** 创建未写盘的默认 Recipe 草稿；调用方必须显式保存后才成为 Project 真相。 */
export function createDefaultTextToImageRecipeSource(): TextToImageRecipeSource {
    return {
        schemaVersion: TEXT_TO_IMAGE_RECIPE_SCHEMA_VERSION,
        recipeId: DEFAULT_TEXT_TO_IMAGE_RECIPE_ID,
        title: "默认 NovelAI Recipe",
        model: "nai-diffusion-4-5-full",
        sampler: "k_euler_ancestral",
        noiseSchedule: "karras",
        steps: 28,
        promptGuidance: 5,
        promptGuidanceRescale: 0,
        dimensions: {
            mode: "fixed",
            fixed: {width: 832, height: 1216},
            portrait: {width: 832, height: 1216},
            landscape: {width: 1216, height: 832},
            square: {width: 1024, height: 1024},
        },
        seed: {policy: "random", fixed: 0},
        advanced: {
            aiDefaultCharacterPosition: true,
            variety: false,
            smeaMode: "auto",
            smeaDyn: false,
            decrisper: false,
        },
        style: {
            positivePrefix: "",
            positiveSuffix: "",
            negativePrefix: "",
            negativeSuffix: "",
            useFurryDataset: false,
            positiveQualityPreset: true,
            negativeQualityPreset: "none",
        },
        references: {
            normalizeVibeStrengths: true,
            vibeReferences: [],
            characterReferences: [],
            inpaint: null,
        },
    };
}
