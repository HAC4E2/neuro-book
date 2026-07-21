import {describe, expect, it} from "vitest";
import {
    inspectTextToImageRecipeMigration,
    parseTextToImageRecipeMigration,
    removeTextToImageRecipeMigrationKeys,
} from "nbook/app/utils/text-to-image-recipe-migration";

describe("text-to-image Recipe local draft migration", () => {
    it("只把上一版本地生成参数转换为未保存 Recipe 草稿", () => {
        const raw = JSON.stringify({
            novelAi: {
                model: "nai-diffusion-4-full",
                sampler: "k_dpmpp_2m",
                noiseSchedule: "exponential",
                promptGuidance: 6,
                promptGuidanceRescale: 0.2,
                width: 1024,
                height: 1536,
                steps: 32,
                seed: 42,
                smeaMode: "on",
                smeaDyn: true,
                decrisper: true,
                aiDefaultCharacterPosition: false,
                variety: true,
                token: "must-not-migrate",
            },
            stylePresets: [{
                id: "style-1",
                name: "电影感",
                positivePrefix: "cinematic",
                positiveSuffix: "rim light",
                negativePrefix: "lowres",
                negativeSuffix: "watermark",
                useFurryDataset: false,
                positiveQualityPreset: true,
                negativeQualityPreset: "humanFocus",
                vibeReferences: [{imageDataUrl: "data:image/png;base64,secret"}],
            }],
            activeStyleId: "style-1",
        });

        const source = parseTextToImageRecipeMigration(raw);

        expect(source).toMatchObject({
            model: "nai-diffusion-4-full",
            sampler: "k_dpmpp_2m",
            dimensions: {fixed: {width: 1024, height: 1536}},
            seed: {policy: "fixed", fixed: 42},
            advanced: {smeaMode: "on", smeaDyn: true, decrisper: true},
            style: {positivePrefix: "cinematic", negativeQualityPreset: "humanFocus"},
        });
        expect(JSON.stringify(source)).not.toContain("must-not-migrate");
        expect(JSON.stringify(source)).not.toContain("data:image");
    });

    it("成功保存后只删除迁移来源字段，保留同 key 下其它本地偏好", () => {
        const raw = JSON.stringify({
            novelAi: {model: "old"},
            stylePresets: [],
            activeStyleId: "old",
            lastNovelAiExchange: {request: {model: "stale-provider-model"}},
            generationDraft: {prompt: "keep me"},
            currentProjectPath: "workspace/book",
        });

        expect(JSON.parse(removeTextToImageRecipeMigrationKeys(raw) ?? "{}")).toEqual({
            generationDraft: {prompt: "keep me"},
            currentProjectPath: "workspace/book",
        });
    });

    it("localStorage 缺少模型时使用服务端保存的旧实际 Provider 模型", () => {
        const result = inspectTextToImageRecipeMigration(
            null,
            [{providerId: 7, model: "nai-diffusion-3"}],
        );

        expect(result?.source.model).toBe("nai-diffusion-3");
        expect(result?.modelConflict).toBeNull();
    });

    it("浏览器草稿模型与旧 Provider 实际模型不一致时要求显式选择", () => {
        const result = inspectTextToImageRecipeMigration(
            JSON.stringify({novelAi: {model: "nai-diffusion-4-5-full"}}),
            [{providerId: 7, model: "nai-diffusion-3"}],
        );

        expect(result).toMatchObject({
            source: {model: "nai-diffusion-4-5-full"},
            modelConflict: {
                browserModel: "nai-diffusion-4-5-full",
                providerModels: ["nai-diffusion-3"],
            },
        });
    });
});
