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

/** 内置敏感词替换档案，与 chatu8 默认规则对齐；正则部分不移植。 */
export const DEFAULT_WORD_REPLACEMENT_PROFILE: TextToImageWordReplacementProfile = {
    textReplacement: [
        "肉棒=🥒",
        "小穴=🌸",
        "女孩=♀👶🏻",
        "少女=♀🧒🏻",
        "男孩=♂👶🏻",
        "正太=♂👶🏻",
        "小孩子=👧🏻",
        "乱伦=⚠️💘",
        "色情=🔞",
        "岁=🎄",
        "小学=🏬",
        "小学生=🧒🏻",
        "女儿=👧🏼",
        "儿子=👦🏼",
        "萝莉=♀👶🏻",
        "幼女=♀👶🏻",
        "萝莉=♀👶🏻",
    ].join("\n"),
    aiReplacement: [
        "sf_=",
        "sāfe&=",
    ].join("\n"),
};

/** OpenAI 兼容 LLM Provider 的运行参数；凭据不进入该 schema。 */
export const TextToImageLlmProviderSettingsSchema = z.object({
    baseUrl: z.string().trim().min(1),
    model: z.string().trim().min(1),
    temperature: z.number().min(0).max(2).default(1),
    topP: z.number().min(0).max(1).default(1),
    maxTokens: z.number().int().min(1).max(30000).default(30000),
    stream: z.boolean().default(false),
    sendImages: z.boolean().default(false),
    mergeSystemUser: z.boolean().default(false),
    retryCount: z.number().int().min(0).max(5).default(0),
    tagthinkEcho: z.boolean().default(false),
});
export type TextToImageLlmProviderSettings = z.infer<typeof TextToImageLlmProviderSettingsSchema>;

export const TextToImageNovelAiVibeSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    imageId: z.string().trim().nullable().default(null),
    informationExtracted: z.number().min(0).max(1).default(0.3),
    referenceStrength: z.number().min(0).max(1).default(0.6),
});
export type TextToImageNovelAiVibeSettings = z.infer<typeof TextToImageNovelAiVibeSettingsSchema>;

export const TextToImageCharacterReferenceSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    groupId: z.string().trim().nullable().default(null),
    imageIds: z.array(z.string()).default([]),
    referenceStrength: z.number().min(0).max(1).default(0.6),
    informationExtracted: z.number().min(0).max(1).default(0.7),
});
export type TextToImageCharacterReferenceSettings = z.infer<typeof TextToImageCharacterReferenceSettingsSchema>;

export const TextToImageNovelAiVibeGroupSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    random: z.boolean().default(false),
    normalizeStrength: z.boolean().default(false),
    groupId: z.string().trim().nullable().default(null),
});
export type TextToImageNovelAiVibeGroupSettings = z.infer<typeof TextToImageNovelAiVibeGroupSettingsSchema>;

/** NovelAI 配置档案：模型/采样/参数快照，可独立读取、另存为、删除。 */
export const TextToImageNovelAiProfileSchema = z.object({
    model: z.string(),
    sampler: z.string(),
    noiseSchedule: z.string(),
    promptGuidance: z.number(),
    promptGuidanceRescale: z.number(),
    aiDefaultCharacterPosition: z.boolean(),
    smea: z.boolean(),
    smeaDyn: z.boolean(),
    variety: z.boolean(),
    decrisp: z.boolean(),
    width: z.number(),
    height: z.number(),
    steps: z.number(),
    seed: z.number(),
    positiveQualityPreset: z.boolean(),
    negativeQualityPreset: z.string(),
});
export type TextToImageNovelAiProfile = z.infer<typeof TextToImageNovelAiProfileSchema>;

const DEFAULT_NOVEL_AI_VIBE = TextToImageNovelAiVibeSettingsSchema.parse({});
const DEFAULT_CHARACTER_REFERENCE = TextToImageCharacterReferenceSettingsSchema.parse({});
const DEFAULT_NOVEL_AI_VIBE_GROUP = TextToImageNovelAiVibeGroupSettingsSchema.parse({});

/** 画风串与模型参数的联合配置；选中后整组参数同时生效。 */
export const TextToImageNovelAiGenerationRecipeSchema = TextToImageNovelAiProfileSchema.extend({
    positive: z.string().default(""),
    positiveEnd: z.string().default(""),
    negative: z.string().default(""),
    promptReplaceText: z.string().default(""),
    furryDataset: z.boolean().default(false),
    vibe: TextToImageNovelAiVibeSettingsSchema.default(DEFAULT_NOVEL_AI_VIBE),
    characterReference: TextToImageCharacterReferenceSettingsSchema.default(DEFAULT_CHARACTER_REFERENCE),
    vibeGroup: TextToImageNovelAiVibeGroupSettingsSchema.default(DEFAULT_NOVEL_AI_VIBE_GROUP),
});
export type TextToImageNovelAiGenerationRecipe = z.infer<typeof TextToImageNovelAiGenerationRecipeSchema>;

/** NovelAI Provider 的运行参数；凭据不进入该 schema。 */
export const TextToImageNovelAiSettingsSchema = z.object({
    baseUrl: z.string().trim().default("https://image.novelai.net"),
    requestIntervalMs: z.number().int().min(15_000).default(15_000),
    model: z.string().default("nai-diffusion-4-5-full"),
    sampler: z.string().default("k_euler"),
    noiseSchedule: z.string().default("karras"),
    promptGuidance: z.number().default(10),
    promptGuidanceRescale: z.number().default(0.18),
    aiDefaultCharacterPosition: z.boolean().default(true),
    smea: z.boolean().default(true),
    smeaDyn: z.boolean().default(true),
    variety: z.boolean().default(true),
    decrisp: z.boolean().default(true),
    width: z.number().int().min(64).max(4096).default(1024),
    height: z.number().int().min(64).max(4096).default(1024),
    steps: z.number().int().min(1).max(50).default(28),
    seed: z.number().int().min(-1).default(0),
    fixedPositivePrompt: z.string().default(""),
    fixedPositivePromptEnd: z.string().default(""),
    fixedNegativePrompt: z.string().default(""),
    promptReplaceText: z.string().default(""),
    furryDataset: z.boolean().default(false),
    positiveQualityPreset: z.boolean().default(true),
    negativeQualityPreset: z.string().default("Heavy"),
    profiles: z.record(z.string(), TextToImageNovelAiProfileSchema).default({}),
    generationRecipes: z.record(z.string(), TextToImageNovelAiGenerationRecipeSchema).default({}),
    activeGenerationRecipeId: z.string().default(""),
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
    wordReplacementProfiles: z.record(z.string(), TextToImageWordReplacementProfileSchema).default(() => ({
        default: {...DEFAULT_WORD_REPLACEMENT_PROFILE},
    })),
    currentWordReplacementProfile: z.string().default("default"),
    historyPrefillDepth: z.number().int().min(0).max(20).default(1),
});
export type TextToImageGlobalConfig = z.infer<typeof TextToImageGlobalConfigSchema>;

/** Project 鐨勫彂閫佹暟鎹繚瀛樻牱寮忥細鍓嶇鍙彂 ID 鍜?Project 鐩稿璺緞銆?*/
export const TextToImageProjectOutfitSelectionSchema = z.object({
    characterId: z.string().trim().min(1),
    groupId: z.string().trim().nullable().optional(),
    name: z.string().trim().min(1),
}).strict();
export type TextToImageProjectOutfitSelection = z.infer<typeof TextToImageProjectOutfitSelectionSchema>;

export const TextToImageProjectCharacterSelectionSchema = z.object({
    characterId: z.string().trim().min(1),
    groupId: z.string().trim().nullable().default(null),
}).strict();
export type TextToImageProjectCharacterSelection = z.infer<typeof TextToImageProjectCharacterSelectionSchema>;

export const TextToImageProjectSendDataSchema = z.object({
    lorebookPaths: z.array(z.string().trim().min(1)).max(512).default([]),
    characterIds: z.array(z.string().trim().min(1)).max(512).default([]),
    characterSelections: z.array(TextToImageProjectCharacterSelectionSchema).max(512).default([]),
    outfitSelections: z.array(TextToImageProjectOutfitSelectionSchema).max(512).default([]),
}).strict();
export type TextToImageProjectSendData = z.infer<typeof TextToImageProjectSendDataSchema>;
