import {z} from "zod";
import type {TextToImageProviderKind} from "nbook/shared/dto/text-to-image.dto";

export const TEXT_TO_IMAGE_NOVELAI_BASE_URL = "https://image.novelai.net";

export const TextToImageProviderKindSchema = z.enum(["novelai", "openai_compatible"]);

export const TextToImageProviderSettingsSchema = z.object({
    allowPrivateNetwork: z.boolean().default(false),
    requestIntervalMs: z.number().int().min(0).default(0),
}).strict();

export const TextToImageProviderCreateSchema = z.object({
    kind: TextToImageProviderKindSchema,
    name: z.string().trim().min(1),
    baseUrl: z.string().trim().min(1),
    model: z.string().trim().min(1),
    settings: TextToImageProviderSettingsSchema.default({
        allowPrivateNetwork: false,
        requestIntervalMs: 0,
    }),
    credential: z.string().trim().min(1),
}).strict();

export const TextToImageProviderPatchSchema = z.object({
    kind: TextToImageProviderKindSchema.optional(),
    name: z.string().trim().min(1).optional(),
    baseUrl: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    settings: TextToImageProviderSettingsSchema.optional(),
    credential: z.string().trim().min(1).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
    message: "至少需要更新一个 Provider 字段",
});

export const TextToImageProviderIdSchema = z.coerce.number().int().positive();

export type TextToImageProviderCreateInput = z.infer<typeof TextToImageProviderCreateSchema> & {
    kind: TextToImageProviderKind;
};
export type TextToImageProviderPatchInput = z.infer<typeof TextToImageProviderPatchSchema> & {
    kind?: TextToImageProviderKind;
};

export const TextToImageJobCreateSchema = z.object({
    projectPath: z.string().trim().min(1),
    providerId: z.number().int().positive(),
    kind: z.enum(["manual", "body", "character", "reroll"]),
    prompt: z.string().trim().min(1),
    negativePrompt: z.string().default(""),
    sourcePath: z.string().trim().min(1).nullable().optional(),
    sourceAnchorId: z.string().trim().min(1).nullable().optional(),
    novelAi: z.object({
        model: z.string().trim().min(1),
        sampler: z.string().trim().min(1),
        noiseSchedule: z.string().trim().min(1),
        promptGuidance: z.number(),
        promptGuidanceRescale: z.number(),
        width: z.number().int().min(64).max(4096),
        height: z.number().int().min(64).max(4096),
        steps: z.number().int().min(1).max(50),
        seed: z.number().int().min(-1),
        count: z.number().int().min(1).max(4),
    }).strict(),
}).strict();
