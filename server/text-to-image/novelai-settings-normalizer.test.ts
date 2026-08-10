import {describe, expect, it} from "vitest";
import {
    normalizeNovelAiGenerationSettings,
    resolveNovelAiGenerationSettings,
} from "nbook/server/text-to-image/novelai-settings-normalizer";

describe("resolveNovelAiGenerationSettings", () => {
    it("applies the selected recipe as the generation snapshot", () => {
        const settings = resolveNovelAiGenerationSettings({
            model: "live-model",
            fixedPositivePrompt: "live prompt",
            activeGenerationRecipeId: "cinematic",
            generationRecipes: {
                cinematic: {
                    model: "recipe-model",
                    sampler: "k_euler",
                    noiseSchedule: "karras",
                    promptGuidance: 8,
                    promptGuidanceRescale: 0.2,
                    aiDefaultCharacterPosition: true,
                    smea: true,
                    smeaDyn: false,
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

        expect(settings.model).toBe("recipe-model");
        expect(settings.fixedPositivePrompt).toBe("recipe prompt");
        expect(settings.fixedPositivePromptEnd).toBe("recipe ending");
        expect(settings.fixedNegativePrompt).toBe("recipe negative");
        expect(settings.width).toBe(832);
    });

    it("keeps editable settings when the selected recipe no longer exists", () => {
        const settings = resolveNovelAiGenerationSettings({
            model: "live-model",
            activeGenerationRecipeId: "missing",
            fixedPositivePrompt: "live prompt",
        });

        expect(settings.model).toBe("live-model");
        expect(settings.fixedPositivePrompt).toBe("live prompt");
    });

    it("migrates legacy profile and fixed prompt preset names into recipes", () => {
        const settings = normalizeNovelAiGenerationSettings({
            model: "live-model",
            fixedPositivePrompt: "live prompt",
            profiles: {
                cinematic: {
                    model: "profile-model",
                    sampler: "k_euler",
                    noiseSchedule: "karras",
                    promptGuidance: 8,
                    promptGuidanceRescale: 0.2,
                    aiDefaultCharacterPosition: true,
                    smea: true,
                    smeaDyn: false,
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

        expect(settings.activeGenerationRecipeId).toBe("cinematic");
        expect(settings.generationRecipes.cinematic?.model).toBe("profile-model");
        expect(settings.generationRecipes.cinematic?.positive).toBe("cinematic");
    });
});
