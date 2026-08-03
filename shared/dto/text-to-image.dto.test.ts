import {describe, expect, it} from "vitest";
import {
    TextToImageContextProfileSchema,
    TextToImageGlobalConfigSchema,
    TextToImageLlmProviderSettingsSchema,
    TextToImageNovelAiSettingsSchema,
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

    it("全局配置默认给出空的上下文预设、绑定与替换词档案", () => {
        const config = TextToImageGlobalConfigSchema.parse({});
        expect(config.contextProfiles).toEqual({});
        expect(config.requestTypeBindings).toEqual({});
        expect(config.wordReplacementProfiles).toEqual({});
        expect(config.currentWordReplacementProfile).toBe("default");
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
            temperature: 0.7,
            topP: 1,
            maxTokens: 512,
            stream: false,
            sendImages: false,
            mergeSystemUser: false,
            retryCount: 0,
        });
    });

    it("NovelAI Provider 设置带 Vibe 与角色参考默认值", () => {
        const settings = TextToImageNovelAiSettingsSchema.parse({});
        expect(settings).toMatchObject({
            model: "nai-diffusion-4-5-full",
            sampler: "k_euler_ancestral",
            noiseSchedule: "karras",
            width: 832,
            height: 1216,
            steps: 28,
            seed: -1,
        });
        expect(settings.vibe.enabled).toBe(false);
        expect(settings.characterReference.enabled).toBe(false);
    });
});
