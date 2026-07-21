import {z} from "zod";
import type {TextToImageProviderSnapshotDto} from "nbook/shared/dto/text-to-image.dto";

export const TEXT_TO_IMAGE_NOVELAI_BASE_URL = "https://image.novelai.net";

export const TextToImageProviderSettingsSchema = z.object({
    allowPrivateNetwork: z.boolean().default(false),
    requestIntervalMs: z.number().int().min(0).default(0),
}).strict();

export const TextToImageNovelAiProviderPutSchema = z.object({
    name: z.string().trim().min(1).max(120),
    /** 首次保存或现有记录缺少完整密钥时必填；仅已有完整密钥时可省略以保留。 */
    credential: z.string().trim().min(1).optional(),
    requestIntervalMs: z.number().int().min(0).max(3_600_000),
}).strict();

export type TextToImageNovelAiProviderPutInput = z.infer<typeof TextToImageNovelAiProviderPutSchema>;

export const TextToImageNovelAiReconcileSchema = z.object({
    keepProviderId: z.number().int().positive(),
    selectionToken: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type TextToImageNovelAiReconcileInput = z.infer<typeof TextToImageNovelAiReconcileSchema>;

export const TextToImageProviderSnapshotSchema: z.ZodType<TextToImageProviderSnapshotDto> = z.object({
    ownerUserId: z.number().int().positive(),
    providerId: z.number().int().positive(),
    credentialRevision: z.number().int().positive().safe(),
    kind: z.literal("novelai"),
    name: z.string().min(1),
    baseUrl: z.literal(TEXT_TO_IMAGE_NOVELAI_BASE_URL),
    settings: z.object({
        allowPrivateNetwork: z.literal(false),
        requestIntervalMs: z.number().int().min(0),
    }).strict(),
    updatedAt: z.string().datetime(),
}).strict();

export const TextToImageProviderSnapshotsSchema = z.array(TextToImageProviderSnapshotSchema).min(1);

export const TextToImageJobCreateSchema = z.object({
    projectPath: z.string().trim().min(1),
    providerId: z.number().int().positive(),
    kind: z.literal("manual"),
    prompt: z.string().trim().min(1),
    negativePrompt: z.string().default(""),
    count: z.number().int().min(1).max(4),
    recipeId: z.literal("default"),
    expectedRecipeSourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
