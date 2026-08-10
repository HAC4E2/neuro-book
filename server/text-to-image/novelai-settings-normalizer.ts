import {
    TextToImageNovelAiSettingsSchema,
    type TextToImageNovelAiSettings,
} from "nbook/shared/dto/text-to-image.dto";

/**
 * Resolve the one active NovelAI generation recipe before a queued request is built.
 * The persisted settings remain editable as individual fields, but the selected
 * recipe is the authoritative snapshot at generation time.
 */
export function resolveNovelAiGenerationSettings(input: Record<string, unknown>): TextToImageNovelAiSettings {
    const settings = normalizeNovelAiGenerationSettings(TextToImageNovelAiSettingsSchema.parse(input));
    const activeId = settings.activeGenerationRecipeId.trim();
    const recipeId = activeId || Object.keys(settings.generationRecipes).sort()[0] || "";
    const recipe = recipeId === "" ? undefined : settings.generationRecipes[recipeId];
    if (!recipe) return settings;

    return TextToImageNovelAiSettingsSchema.parse({
        ...settings,
        ...recipe,
        fixedPositivePrompt: recipe.positive,
        fixedPositivePromptEnd: recipe.positiveEnd,
        fixedNegativePrompt: recipe.negative,
    });
}

/** Convert the pre-recipe profile/preset shape into a deterministic default recipe. */
export function normalizeNovelAiGenerationSettings(
    input: TextToImageNovelAiSettings | Record<string, unknown>,
): TextToImageNovelAiSettings {
    const settings = TextToImageNovelAiSettingsSchema.parse(input);
    const existingNames = Object.keys(settings.generationRecipes);
    if (existingNames.length > 0) {
        return settings.activeGenerationRecipeId === ""
            ? {...settings, activeGenerationRecipeId: existingNames.sort()[0] ?? ""}
            : settings;
    }

    const legacyNames = new Set([
        ...Object.keys(settings.profiles),
        ...Object.keys(settings.fixedPromptPresets),
    ]);
    const names = legacyNames.size > 0 ? [...legacyNames].sort() : ["default"];
    const generationRecipes = Object.fromEntries(names.map((name) => {
        const profile = settings.profiles[name];
        const promptPreset = settings.fixedPromptPresets[name];
        return [name, {
            model: profile?.model ?? settings.model,
            sampler: profile?.sampler ?? settings.sampler,
            noiseSchedule: profile?.noiseSchedule ?? settings.noiseSchedule,
            promptGuidance: profile?.promptGuidance ?? settings.promptGuidance,
            promptGuidanceRescale: profile?.promptGuidanceRescale ?? settings.promptGuidanceRescale,
            aiDefaultCharacterPosition: profile?.aiDefaultCharacterPosition ?? settings.aiDefaultCharacterPosition,
            smea: profile?.smea ?? settings.smea,
            smeaDyn: profile?.smeaDyn ?? settings.smeaDyn,
            variety: profile?.variety ?? settings.variety,
            decrisp: profile?.decrisp ?? settings.decrisp,
            width: profile?.width ?? settings.width,
            height: profile?.height ?? settings.height,
            steps: profile?.steps ?? settings.steps,
            seed: profile?.seed ?? settings.seed,
            positiveQualityPreset: profile?.positiveQualityPreset ?? settings.positiveQualityPreset,
            negativeQualityPreset: profile?.negativeQualityPreset ?? settings.negativeQualityPreset,
            positive: promptPreset?.positive ?? settings.fixedPositivePrompt,
            positiveEnd: promptPreset?.positiveEnd ?? settings.fixedPositivePromptEnd,
            negative: promptPreset?.negative ?? settings.fixedNegativePrompt,
            promptReplaceText: settings.promptReplaceText,
            furryDataset: settings.furryDataset,
            vibe: settings.vibe,
            characterReference: settings.characterReference,
            vibeGroup: settings.vibeGroup,
        }];
    }));
    return TextToImageNovelAiSettingsSchema.parse({
        ...settings,
        generationRecipes,
        activeGenerationRecipeId: settings.activeGenerationRecipeId || names[0],
    });
}
