import {
    TextToImageNovelAiSettingsSchema,
    type TextToImageNovelAiSettings,
} from "nbook/shared/dto/text-to-image.dto";

/**
 * Resolve the one active NovelAI generation recipe before a queued request is built.
 * The persisted settings remain editable as individual fields, but the selected
 * recipe is the authoritative snapshot at generation time; explicit request dimensions
 * remain authoritative so body `<size>` overrides are not lost.
 */
export function resolveNovelAiGenerationSettings(
    input: Record<string, unknown>,
    explicitOverrides: Partial<Pick<TextToImageNovelAiSettings, "width" | "height">> = {},
): TextToImageNovelAiSettings {
    const settings = normalizeNovelAiGenerationSettings(TextToImageNovelAiSettingsSchema.parse(input));
    const activeId = settings.activeGenerationRecipeId.trim();
    const recipeId = activeId || Object.keys(settings.generationRecipes).sort()[0] || "";
    const recipe = recipeId === "" ? undefined : settings.generationRecipes[recipeId];
    if (!recipe) {
        return TextToImageNovelAiSettingsSchema.parse({...settings, ...explicitOverrides});
    }

    return TextToImageNovelAiSettingsSchema.parse({
        ...settings,
        ...recipe,
        fixedPositivePrompt: recipe.positive,
        fixedPositivePromptEnd: recipe.positiveEnd,
        fixedNegativePrompt: recipe.negative,
        ...explicitOverrides,
    });
}

/** Convert the pre-recipe profile/preset shape into a deterministic default recipe. */
export function normalizeNovelAiGenerationSettings(
    input: TextToImageNovelAiSettings | Record<string, unknown>,
): TextToImageNovelAiSettings {
    const settings = TextToImageNovelAiSettingsSchema.parse(input);
    const groups = normalizeRecipeGroups(settings);
    const meta = normalizeRecipeMeta(settings);
    const existingNames = Object.keys(settings.generationRecipes);
    if (existingNames.length > 0) {
        const hasLegacyEntries = existingNames.some((id) => !settings.generationRecipeMeta[id]);
        if (hasLegacyEntries) {
            const migrated = migrateRecipeIds(settings, groups);
            return {...settings, ...migrated};
        }
        const activeId = settings.activeGenerationRecipeId !== "" && settings.generationRecipes[settings.activeGenerationRecipeId]
            ? settings.activeGenerationRecipeId
            : existingNames.sort()[0] ?? "";
        return {...settings, generationRecipeGroups: groups, generationRecipeMeta: meta, activeGenerationRecipeId: activeId};
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
    const generated = TextToImageNovelAiSettingsSchema.parse({
        ...settings,
        generationRecipes,
        generationRecipeGroups: groups,
        generationRecipeMeta: {},
        activeGenerationRecipeId: settings.activeGenerationRecipeId || names[0],
    });
    return TextToImageNovelAiSettingsSchema.parse({
        ...generated,
        ...migrateRecipeIds(generated, groups),
    });
}

function migrateRecipeIds(
    settings: TextToImageNovelAiSettings,
    groups: TextToImageNovelAiSettings["generationRecipeGroups"],
): Pick<TextToImageNovelAiSettings, "generationRecipes" | "generationRecipeGroups" | "generationRecipeMeta" | "activeGenerationRecipeId"> {
    const recipes: TextToImageNovelAiSettings["generationRecipes"] = {};
    const nextMeta: TextToImageNovelAiSettings["generationRecipeMeta"] = {};
    const used = new Set<string>();
    const idMap = new Map<string, string>();
    for (const [legacyId, recipe] of Object.entries(settings.generationRecipes)) {
        const legacyMeta = settings.generationRecipeMeta[legacyId];
        const nextId = legacyMeta ? uniqueRecipeId(legacyId, used) : uniqueRecipeId(`style-${slugifyRecipeName(legacyId)}`, used);
        used.add(nextId);
        idMap.set(legacyId, nextId);
        recipes[nextId] = recipe;
        nextMeta[nextId] = legacyMeta ?? {name: legacyId, groupId: "default"};
    }
    const activeGenerationRecipeId = idMap.get(settings.activeGenerationRecipeId)
        ?? Object.keys(recipes)[0]
        ?? "";
    return {
        generationRecipes: recipes,
        generationRecipeGroups: groups,
        generationRecipeMeta: nextMeta,
        activeGenerationRecipeId,
    };
}

function slugifyRecipeName(value: string): string {
    return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "style";
}

function uniqueRecipeId(candidate: string, used: Set<string>): string {
    let id = candidate || "style";
    let index = 2;
    while (used.has(id)) id = `${candidate}-${index++}`;
    return id;
}

function normalizeRecipeGroups(settings: TextToImageNovelAiSettings): TextToImageNovelAiSettings["generationRecipeGroups"] {
    const groups = {...settings.generationRecipeGroups};
    if (!groups.default) groups.default = {name: "默认", sortOrder: 0};
    return groups;
}

function normalizeRecipeMeta(settings: TextToImageNovelAiSettings): TextToImageNovelAiSettings["generationRecipeMeta"] {
    const meta = {...settings.generationRecipeMeta};
    for (const id of Object.keys(settings.generationRecipes)) {
        if (!meta[id]) meta[id] = {name: id, groupId: "default"};
    }
    return meta;
}
