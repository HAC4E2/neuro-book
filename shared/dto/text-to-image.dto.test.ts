import {describe, expect, it} from "vitest";
import {
    DEFAULT_NOVEL_AI_PROMPT_REPLACE_TEXT,
    DEFAULT_WORD_REPLACEMENT_PROFILE,
    TextToImageContextProfileSchema,
    TextToImageGlobalConfigSchema,
    TextToImageLlmProviderSettingsSchema,
    TextToImageNovelAiSettingsSchema,
    TextToImageProjectSendDataSchema,
    TextToImageProviderKindSchema,
    TextToImageRequestTypeSchema,
    TextToImageWordReplacementProfileSchema,
} from "nbook/shared/dto/text-to-image.dto";

describe("text-to-image DTO", () => {
    it("只接受 novelai 与 openai_compatible 两种 Provider kind", () => {
        expect(TextToImageProviderKindSchema.parse("novelai")).toBe("novelai");
        expect(TextToImageProviderKindSchema.parse("openai_compatible")).toBe("openai_compatible");
        expect(TextToImageProviderKindSchema.safeParse("sd").success).toBe(false);
    });

    it("上下文预设条目带 triggerMode 与 andTriggerWords 默认值", () => {
        const profile = TextToImageContextProfileSchema.parse({
            id: "body",
            name: "正文生图",
            entries: [{
                id: "e1",
                role: "system",
                content: "{{正文}}",
                triggerMode: "trigger",
                triggerWords: "后入,口交",
            }],
        });
        expect(profile.entries[0]).toMatchObject({
            role: "system",
            enabled: true,
            triggerMode: "trigger",
            triggerWords: "后入,口交",
            andTriggerWords: "",
        });
    });

    it("请求类型只包含首版 5 类", () => {
        const types = TextToImageRequestTypeSchema.options;
        expect(types).toEqual([
            "image_gen",
            "char_design",
            "char_display",
            "char_modify",
            "tag_modify",
        ]);
    });

    it("全局配置默认给出空上下文、空绑定与内置替换词档案", () => {
        const config = TextToImageGlobalConfigSchema.parse({});
        expect(config.contextProfiles).toEqual({});
        expect(config.requestTypeBindings).toEqual({});
        expect(config.wordReplacementProfiles).toEqual({
            default: DEFAULT_WORD_REPLACEMENT_PROFILE,
        });
        expect(config.currentWordReplacementProfile).toBe("default");
        expect(config.historyPrefillDepth).toBe(1);
    });

    it("历史前文回填深度默认为 1 且限制在 0 到 20 章", () => {
        expect(TextToImageGlobalConfigSchema.parse({}).historyPrefillDepth).toBe(1);
        expect(TextToImageGlobalConfigSchema.safeParse({historyPrefillDepth: -1}).success).toBe(false);
        expect(TextToImageGlobalConfigSchema.safeParse({historyPrefillDepth: 21}).success).toBe(false);
        expect(TextToImageGlobalConfigSchema.parse({historyPrefillDepth: 0}).historyPrefillDepth).toBe(0);
    });

    it("敏感词替换档案包含正文与 AI 两套规则", () => {
        const profile = TextToImageWordReplacementProfileSchema.parse({
            textReplacement: "岁=🎄",
            aiReplacement: "sf_=safe_",
        });
        expect(profile).toMatchObject({
            textReplacement: "岁=🎄",
            aiReplacement: "sf_=safe_",
        });
    });

    it("LLM Provider 设置带流式、多模态与重试默认值", () => {
        const settings = TextToImageLlmProviderSettingsSchema.parse({
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4o",
        });
        expect(settings).toMatchObject({
            temperature: 1,
            topP: 1,
            maxTokens: 30000,
            stream: false,
            sendImages: false,
            mergeSystemUser: false,
            retryCount: 0,
        });
    });

    it("NovelAI Provider 设置带 Vibe 与角色参考默认值", () => {
        const settings = TextToImageNovelAiSettingsSchema.parse({});
        expect(settings).toMatchObject({
            requestIntervalMs: 15_000,
            model: "nai-diffusion-4-5-full",
            sampler: "k_euler",
            noiseSchedule: "karras",
            promptGuidance: 10,
            promptGuidanceRescale: 0.18,
            width: 1024,
            height: 1024,
            steps: 28,
            seed: 0,
            negativeQualityPreset: "Heavy",
        });
        expect(settings.vibe.enabled).toBe(false);
        expect(settings.vibe.informationExtracted).toBe(0.3);
        expect(settings.characterReference.enabled).toBe(false);
    });

    it("NovelAI 生图间隔最低为 15 秒并保留合法配置", () => {
        expect(TextToImageNovelAiSettingsSchema.safeParse({requestIntervalMs: 14_999}).success).toBe(false);
        expect(TextToImageNovelAiSettingsSchema.parse({requestIntervalMs: 20_000}).requestIntervalMs).toBe(20_000);
    });

    it("NovelAI Provider 接受 V5 Full 与 Curated 模型", () => {
        expect(TextToImageNovelAiSettingsSchema.parse({model: "nai-diffusion-5-full"}).model).toBe("nai-diffusion-5-full");
        expect(TextToImageNovelAiSettingsSchema.parse({model: "nai-diffusion-5-curated"}).model).toBe("nai-diffusion-5-curated");
    });

    it("stores a combined active generation recipe", () => {
        const parsed = TextToImageNovelAiSettingsSchema.parse({
            activeGenerationRecipeId: "cinematic",
            generationRecipes: {
                cinematic: {
                    model: "nai-diffusion-4-5-full",
                    sampler: "k_euler",
                    noiseSchedule: "karras",
                    promptGuidance: 10,
                    promptGuidanceRescale: 0.18,
                    aiDefaultCharacterPosition: true,
                    variety: true,
                    decrisp: true,
                    width: 1024,
                    height: 1024,
                    steps: 28,
                    seed: 0,
                    positiveQualityPreset: true,
                    negativeQualityPreset: "Heavy",
                    positive: "cinematic lighting",
                    positiveEnd: "masterpiece",
                    negative: "blurry",
                },
            },
            generationRecipeMeta: {cinematic: {name: "电影感", groupId: "default"}},
        });
        expect(parsed.activeGenerationRecipeId).toBe("cinematic");
        expect(parsed.generationRecipes.cinematic?.positive).toBe("cinematic lighting");
        expect(parsed.generationRecipeGroups.default?.name).toBe("默认");
        expect(parsed.generationRecipeMeta.cinematic).toEqual({name: "电影感", groupId: "default"});
    });

    it("keeps stable recipe IDs separate from custom names and groups", () => {
        const parsed = TextToImageNovelAiSettingsSchema.parse({
            generationRecipes: {
                "style-soft": {
                    model: "nai-diffusion-4-5-full",
                    sampler: "k_euler",
                    noiseSchedule: "karras",
                    promptGuidance: 10,
                    promptGuidanceRescale: 0.18,
                    aiDefaultCharacterPosition: true,
                    variety: true,
                    decrisp: true,
                    width: 1024,
                    height: 1024,
                    steps: 28,
                    seed: 0,
                    positiveQualityPreset: true,
                    negativeQualityPreset: "Heavy",
                },
            },
            generationRecipeGroups: {illustration: {name: "插画", sortOrder: 1}},
            generationRecipeMeta: {"style-soft": {name: "柔和厚涂", groupId: "illustration"}},
        });
        expect(parsed.generationRecipeMeta["style-soft"]).toEqual({name: "柔和厚涂", groupId: "illustration"});
        expect(parsed.generationRecipeGroups.illustration?.name).toBe("插画");
    });

    it("accepts project send-data IDs and rejects browser-supplied extra fields", () => {
        expect(TextToImageProjectSendDataSchema.parse({
            lorebookPaths: ["lorebook/world/setting/index.md"],
            characterIds: ["lin-yanzhou"],
            characterSelections: [{characterId: "lin-yanzhou", groupId: null}],
            outfitSelections: [{characterId: "lin-yanzhou", name: "校服"}],
        })).toEqual({
            lorebookPaths: ["lorebook/world/setting/index.md"],
            characterIds: ["lin-yanzhou"],
            characterSelections: [{characterId: "lin-yanzhou", groupId: null}],
            outfitSelections: [{characterId: "lin-yanzhou", name: "校服"}],
        });
        expect(() => TextToImageProjectSendDataSchema.parse({
            characterIds: ["hero"],
            projectRoot: "../../outside",
        })).toThrow();
    });

    it("内置八行替换规则是唯一默认常量，字段缺失时进入新 Provider 配置", () => {
        expect(DEFAULT_NOVEL_AI_PROMPT_REPLACE_TEXT).toBe([
            "触发词1=前置前|插入词1",
            "触发词2=前置后|插入词2",
            "触发词3=替换|替换词3",
            "触发词4=替换|",
            "触发词5=替换分角色|替换词5",
            "触发词6=后置前|插入词6",
            "触发词7=后置后|插入词7",
            "触发词8=最后置|插入词8",
        ].join("\n"));
        expect(TextToImageNovelAiSettingsSchema.parse({}).promptReplaceText).toBe(DEFAULT_NOVEL_AI_PROMPT_REPLACE_TEXT);
        expect(TextToImageNovelAiSettingsSchema.parse({promptReplaceText: ""}).promptReplaceText).toBe("");
    });
});
