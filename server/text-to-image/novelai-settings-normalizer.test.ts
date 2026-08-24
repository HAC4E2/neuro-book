import {describe, expect, it} from "vitest";
import {
    normalizeNovelAiGenerationSettings,
    resolveNovelAiGenerationSettings,
} from "nbook/server/text-to-image/novelai-settings-normalizer";

describe("resolveNovelAiGenerationSettings", () => {
    it("preserves V5 models at the root and in the active recipe", () => {
        const root = resolveNovelAiGenerationSettings({model: "nai-diffusion-5-full"});
        expect(root.model).toBe("nai-diffusion-5-full");
        expect(root.noiseSchedule).toBe("native");

        const recipe = resolveNovelAiGenerationSettings({
            activeGenerationRecipeId: "v5",
            generationRecipes: {
                v5: {
                    model: "nai-diffusion-5-curated", sampler: "k_euler_ancestral", noiseSchedule: "karras",
                    promptGuidance: 7, promptGuidanceRescale: 0, aiDefaultCharacterPosition: true,
                    variety: false, decrisp: false, width: 832, height: 1216, steps: 23, seed: 0,
                    positiveQualityPreset: true, negativeQualityPreset: "Heavy",
                    positive: "", positiveEnd: "", negative: "",
                },
            },
        });
        expect(recipe.model).toBe("nai-diffusion-5-curated");
        expect(recipe.noiseSchedule).toBe("karras");
    });

    it("applies the selected recipe as the generation snapshot", () => {
        const settings = resolveNovelAiGenerationSettings({
            model: "nai-diffusion-4-5-full",
            fixedPositivePrompt: "live prompt",
            activeGenerationRecipeId: "cinematic",
            generationRecipes: {
                cinematic: {
                    model: "nai-diffusion-4-5-curated",
                    sampler: "k_euler",
                    noiseSchedule: "karras",
                    promptGuidance: 8,
                    promptGuidanceRescale: 0.2,
                    aiDefaultCharacterPosition: true,
                    variety: true,
                    decrisp: false,
                    width: 832,
                    height: 1216,
                    steps: 24,
                    seed: 12,
                    positiveQualityPreset: true,
                    negativeQualityPreset: "Heavy",
                    positive: "recipe prompt",
                    positiveEnd: "recipe ending",
                    negative: "recipe negative",
                },
            },
        });

        expect(settings.model).toBe("nai-diffusion-4-5-curated");
        expect(settings.fixedPositivePrompt).toBe("recipe prompt");
        expect(settings.fixedPositivePromptEnd).toBe("recipe ending");
        expect(settings.fixedNegativePrompt).toBe("recipe negative");
        expect(settings.width).toBe(832);
    });

    it("keeps editable settings when the selected recipe no longer exists", () => {
        const settings = resolveNovelAiGenerationSettings({
            model: "nai-diffusion-4-5-full",
            activeGenerationRecipeId: "missing",
            fixedPositivePrompt: "live prompt",
        });

        expect(settings.model).toBe("nai-diffusion-4-5-full");
        expect(settings.fixedPositivePrompt).toBe("live prompt");
    });

    it("applies explicit request dimensions after the active recipe snapshot", () => {
        const settings = resolveNovelAiGenerationSettings({
            activeGenerationRecipeId: "default",
            width: 1216,
            height: 832,
            generationRecipes: {
                default: {
                    model: "nai-diffusion-4-5-curated",
                    sampler: "k_euler",
                    noiseSchedule: "karras",
                    promptGuidance: 8,
                    promptGuidanceRescale: 0.2,
                    aiDefaultCharacterPosition: true,
                    variety: true,
                    decrisp: false,
                    width: 1024,
                    height: 1024,
                    steps: 24,
                    seed: 12,
                    positiveQualityPreset: true,
                    negativeQualityPreset: "Heavy",
                    positive: "recipe prompt",
                    positiveEnd: "recipe ending",
                    negative: "recipe negative",
                },
            },
        }, {width: 1216, height: 832});

        expect(settings.width).toBe(1216);
        expect(settings.height).toBe(832);
    });

    it("migrates legacy profile and fixed prompt preset names into recipes", () => {
        const settings = normalizeNovelAiGenerationSettings({
            model: "nai-diffusion-4-5-full",
            fixedPositivePrompt: "live prompt",
            profiles: {
                cinematic: {
                    model: "nai-diffusion-4-5-curated",
                    sampler: "k_euler",
                    noiseSchedule: "karras",
                    promptGuidance: 8,
                    promptGuidanceRescale: 0.2,
                    aiDefaultCharacterPosition: true,
                    variety: true,
                    decrisp: false,
                    width: 832,
                    height: 1216,
                    steps: 24,
                    seed: 12,
                    positiveQualityPreset: true,
                    negativeQualityPreset: "Heavy",
                },
            },
            fixedPromptPresets: {
                cinematic: {positive: "cinematic", positiveEnd: "masterpiece", negative: "blurry"},
            },
        });

        expect(settings.activeGenerationRecipeId).toBe("style-cinematic");
        expect(settings.generationRecipes["style-cinematic"]?.model).toBe("nai-diffusion-4-5-curated");
        expect(settings.generationRecipes["style-cinematic"]?.positive).toBe("cinematic");
        expect(settings.generationRecipeMeta["style-cinematic"]).toEqual({name: "cinematic", groupId: "default"});
    });

    it("根全局规则优先于 Recipe，并删除全部 Recipe 规则字段", () => {
        const settings = normalizeNovelAiGenerationSettings({
            model: "nai-diffusion-4-5-full",
            promptReplaceText: "root=替换|global",
            generationRecipes: {
                style: {
                    model: "nai-diffusion-4-5-full", sampler: "k_euler", noiseSchedule: "karras",
                    promptGuidance: 8, promptGuidanceRescale: 0.2, aiDefaultCharacterPosition: true,
                    variety: true, decrisp: false, width: 1024, height: 1024, steps: 28, seed: 0,
                    positiveQualityPreset: true, negativeQualityPreset: "Heavy",
                    positive: "", positiveEnd: "", negative: "",
                    promptReplaceText: "recipe=替换|old",
                },
            },
        });

        expect(settings.promptReplaceText).toBe("root=替换|global");
        expect(settings.generationRecipes["style-style"]).not.toHaveProperty("promptReplaceText");
    });

    it("根缺失时取当前启用 Recipe 的旧规则，且显式空字符串不会被默认模板覆盖", () => {
        const fromRecipe = normalizeNovelAiGenerationSettings({
            model: "nai-diffusion-4-5-full",
            activeGenerationRecipeId: "style",
            generationRecipes: {
                style: {
                    model: "nai-diffusion-4-5-full", sampler: "k_euler", noiseSchedule: "karras",
                    promptGuidance: 8, promptGuidanceRescale: 0.2, aiDefaultCharacterPosition: true,
                    variety: true, decrisp: false, width: 1024, height: 1024, steps: 28, seed: 0,
                    positiveQualityPreset: true, negativeQualityPreset: "Heavy",
                    positive: "", positiveEnd: "", negative: "",
                    promptReplaceText: "recipe=替换|kept",
                },
            },
        });
        expect(fromRecipe.promptReplaceText).toBe("recipe=替换|kept");

        const explicitEmpty = normalizeNovelAiGenerationSettings({
            model: "nai-diffusion-4-5-full",
            promptReplaceText: "",
            generationRecipes: {},
        });
        expect(explicitEmpty.promptReplaceText).toBe("");
    });
});
