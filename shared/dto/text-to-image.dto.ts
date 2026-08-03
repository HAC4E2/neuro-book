import {z} from "zod";

/** 文生图 Provider 类型；首版只支持 NovelAI 与 OpenAI 兼容 LLM。 */
export const TextToImageProviderKindSchema = z.enum(["novelai", "openai_compatible"]);
export type TextToImageProviderKind = z.infer<typeof TextToImageProviderKindSchema>;

/** 首版 LLM 请求类型：正文生图、角色设计、角色展示、角色/服装修改、Tag 修改。 */
export const TextToImageRequestTypeSchema = z.enum([
    "image_gen",
    "char_design",
    "char_display",
    "char_modify",
    "tag_modify",
]);
export type TextToImageRequestType = z.infer<typeof TextToImageRequestTypeSchema>;

/** 上下文预设条目，与 chatu8 `test_context_profiles` 条目对齐。 */
export const TextToImageContextEntrySchema = z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().default(""),
    role: z.enum(["system", "user", "assistant"]).default("user"),
    content: z.string().default(""),
    enabled: z.boolean().default(true),
    triggerMode: z.enum(["always", "trigger"]).default("always"),
    triggerWords: z.string().default(""),
    andTriggerWords: z.string().default(""),
});
export type TextToImageContextEntry = z.infer<typeof TextToImageContextEntrySchema>;

/** 一组上下文条目，按名称在全局配置中保存。 */
export const TextToImageContextProfileSchema = z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    entries: z.array(TextToImageContextEntrySchema).default([]),
});
export type TextToImageContextProfile = z.infer<typeof TextToImageContextProfileSchema>;

/** 请求类型绑定：Provider 记录在 App SQLite，配置只保存引用。 */
export const TextToImageRequestBindingSchema = z.object({
    providerId: z.number().int().nullable().default(null),
    contextProfileId: z.string().trim().default("default"),
});
export type TextToImageRequestBinding = z.infer<typeof TextToImageRequestBindingSchema>;

/** 敏感词替换档案；`textReplacement` 作用于发送正文前，`aiReplacement` 作用于解析 LLM 回复前。 */
export const TextToImageWordReplacementProfileSchema = z.object({
    textReplacement: z.string().default(""),
    aiReplacement: z.string().default(""),
});
export type TextToImageWordReplacementProfile = z.infer<typeof TextToImageWordReplacementProfileSchema>;

/** OpenAI 兼容 LLM Provider 的运行参数；凭据不进入该 schema。 */
export const TextToImageLlmProviderSettingsSchema = z.object({
    baseUrl: z.string().trim().min(1),
    model: z.string().trim().min(1),
    temperature: z.number().min(0).max(2).default(0.7),
    topP: z.number().min(0).max(1).default(1),
    maxTokens: z.number().int().min(1).max(30000).default(512),
    stream: z.boolean().default(false),
    sendImages: z.boolean().default(false),
    mergeSystemUser: z.boolean().default(false),
    retryCount: z.number().int().min(0).max(5).default(0),
    historyDepth: z.number().int().min(0).max(20).default(2),
    tagthinkEcho: z.boolean().default(false),
    historyKeepImageTag: z.boolean().default(false),
});
export type TextToImageLlmProviderSettings = z.infer<typeof TextToImageLlmProviderSettingsSchema>;

export const TextToImageNovelAiVibeSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    imageId: z.string().trim().nullable().default(null),
    informationExtracted: z.number().min(0).max(1).default(0.7),
    referenceStrength: z.number().min(0).max(1).default(0.6),
});
export type TextToImageNovelAiVibeSettings = z.infer<typeof TextToImageNovelAiVibeSettingsSchema>;

export const TextToImageCharacterReferenceSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    groupId: z.string().trim().nullable().default(null),
});
export type TextToImageCharacterReferenceSettings = z.infer<typeof TextToImageCharacterReferenceSettingsSchema>;

export const TextToImageNovelAiVibeGroupSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    random: z.boolean().default(false),
    normalizeStrength: z.boolean().default(false),
    groupId: z.string().trim().nullable().default(null),
});
export type TextToImageNovelAiVibeGroupSettings = z.infer<typeof TextToImageNovelAiVibeGroupSettingsSchema>;

const DEFAULT_NOVEL_AI_VIBE = TextToImageNovelAiVibeSettingsSchema.parse({});
const DEFAULT_CHARACTER_REFERENCE = TextToImageCharacterReferenceSettingsSchema.parse({});
const DEFAULT_NOVEL_AI_VIBE_GROUP = TextToImageNovelAiVibeGroupSettingsSchema.parse({});

/** NovelAI Provider 的运行参数；凭据不进入该 schema。 */
export const TextToImageNovelAiSettingsSchema = z.object({
    baseUrl: z.string().trim().default("https://image.novelai.net"),
    model: z.string().default("nai-diffusion-4-5-full"),
    sampler: z.string().default("k_euler_ancestral"),
    noiseSchedule: z.string().default("karras"),
    promptGuidance: z.number().default(5),
    promptGuidanceRescale: z.number().default(0),
    aiDefaultCharacterPosition: z.boolean().default(true),
    smea: z.boolean().default(false),
    smeaDyn: z.boolean().default(false),
    variety: z.boolean().default(false),
    decrisp: z.boolean().default(false),
    width: z.number().int().min(64).max(4096).default(832),
    height: z.number().int().min(64).max(4096).default(1216),
    steps: z.number().int().min(1).max(50).default(28),
    seed: z.number().int().min(-1).default(-1),
    fixedPositivePrompt: z.string().default(""),
    fixedPositivePromptEnd: z.string().default(""),
    fixedNegativePrompt: z.string().default(""),
    promptReplaceText: z.string().default(""),
    furryDataset: z.boolean().default(false),
    positiveQualityPreset: z.boolean().default(true),
    negativeQualityPreset: z.string().default("none"),
    fixedPromptPresets: z.record(z.string(), z.object({
        positive: z.string().default(""),
        positiveEnd: z.string().default(""),
        negative: z.string().default(""),
    })).default({}),
    vibeGroups: z.record(z.string(), z.array(z.string())).default({}),
    characterGroups: z.record(z.string(), z.array(z.string())).default({}),
    vibe: TextToImageNovelAiVibeSettingsSchema.default(DEFAULT_NOVEL_AI_VIBE),
    characterReference: TextToImageCharacterReferenceSettingsSchema.default(DEFAULT_CHARACTER_REFERENCE),
    vibeGroup: TextToImageNovelAiVibeGroupSettingsSchema.default(DEFAULT_NOVEL_AI_VIBE_GROUP),
});
export type TextToImageNovelAiSettings = z.infer<typeof TextToImageNovelAiSettingsSchema>;

/** 前端可读的 Provider 快照；不包含凭据密文。 */
export const TextToImageProviderDtoSchema = z.object({
    id: z.number().int(),
    kind: TextToImageProviderKindSchema,
    name: z.string(),
    baseUrl: z.string(),
    model: z.string().nullable(),
    hasCredential: z.boolean(),
    credentialRevision: z.number().int(),
    settings: z.record(z.string(), z.unknown()).default({}),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type TextToImageProviderDto = z.infer<typeof TextToImageProviderDtoSchema>;

/** 历史图片资产快照。 */
export type TextToImageAssetDto = {
    id: string;
    jobId: string;
    relativePath: string;
    fileName: string;
    mimeType: string;
    byteLength: number;
    width: number;
    height: number;
    model: string;
    seed: number;
    prompt: string;
    negativePrompt: string;
    sourceKind: string;
    sourcePath: string | null;
    sourceAnchorId: string | null;
    createdAt: string;
};

/** `StoredGlobalConfig["textToImage"]` 的非敏感配置面。 */
export const TextToImageGlobalConfigSchema = z.object({
    contextProfiles: z.record(z.string(), TextToImageContextProfileSchema).default({}),
    requestTypeBindings: z.record(z.string(), TextToImageRequestBindingSchema).default({}),
    wordReplacementProfiles: z.record(z.string(), TextToImageWordReplacementProfileSchema).default({}),
    currentWordReplacementProfile: z.string().default("default"),
});
export type TextToImageGlobalConfig = z.infer<typeof TextToImageGlobalConfigSchema>;
