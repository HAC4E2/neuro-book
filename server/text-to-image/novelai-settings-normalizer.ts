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
/** 只保留 V4.5 Full/Curated；旧 Full 类模型规范化到 Full，Curated 类到 Curated，无法分类回退 Full。 */
export function normalizeNovelAiV45Model(model: unknown): "nai-diffusion-4-5-full" | "nai-diffusion-4-5-curated" {
    const value = typeof model === "string" ? model : "";
    if (value === "nai-diffusion-4-5-full" || value === "nai-diffusion-4-5-curated") {
        return value;
    }
    if (value.includes("curated")) return "nai-diffusion-4-5-curated";
    return "nai-diffusion-4-5-full";
}

function normalizeLegacyModelFields(input: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = {...input};
    if ("model" in next) next.model = normalizeNovelAiV45Model(next.model);
    const normalizeRecords = (key: "profiles" | "generationRecipes"): void => {
        const records = next[key];
        if (typeof records !== "object" || records === null) return;
        const entries = records as Record<string, Record<string, unknown>>;
        for (const [id, value] of Object.entries(entries)) {
            if (typeof value === "object" && value !== null) {
                entries[id] = {...value, model: normalizeNovelAiV45Model(value.model)};
            }
        }
    };
    normalizeRecords("profiles");
    normalizeRecords("generationRecipes");
    return next;
}

export type NovelAiPromptRuleOwnershipMigration = {
    source: "root" | "active-recipe" | "first-recipe" | "none";
    message: string;
    recipeRuleCount: number;
};

/**
 * 旧配置一次性所有权迁移：根字段存在（包括显式空串）时根就是全局真相源；
 * 根缺失时取当前启用 Recipe，再按稳定 ID 顺序回退到第一个合法值；
 * 迁移结果从全部 Recipe 删除 promptReplaceText，不让画风串继续携带规则。
 */
export function migrateNovelAiPromptReplaceRulesOwnership(input: Record<string, unknown>): {settings: Record<string, unknown>; migration: NovelAiPromptRuleOwnershipMigration} {
    const next: Record<string, unknown> = {...input};
    let recipeRuleCount = 0;
    const recipes = next.generationRecipes;
    const recipeValues: Array<{id: string; value: string}> = [];
    if (typeof recipes === "object" && recipes !== null) {
        for (const [id, value] of Object.entries(recipes as Record<string, Record<string, unknown>>)) {
            if (typeof value === "object" && value !== null && typeof value.promptReplaceText === "string") {
                recipeRuleCount += 1;
                recipeValues.push({id, value: value.promptReplaceText});
                delete value.promptReplaceText;
            }
        }
    }
    if (typeof next.promptReplaceText === "string") {
        return {
            settings: next,
            migration: {
                source: "root",
                message: recipeRuleCount > 0 ? "原画风串内规则已统一为当前全局规则" : "Provider 全局规则已存在",
                recipeRuleCount,
            },
        };
    }
    const activeId = typeof next.activeGenerationRecipeId === "string" ? next.activeGenerationRecipeId : "";
    const chosen = recipeValues.find((item) => item.id === activeId)
        ?? [...recipeValues].sort((left, right) => left.id.localeCompare(right.id))[0]
        ?? null;
    if (chosen) {
        next.promptReplaceText = chosen.value;
        return {
            settings: next,
            migration: {
                source: chosen.id === activeId ? "active-recipe" : "first-recipe",
                message: "原画风串内规则已迁移为 Provider 全局规则",
                recipeRuleCount,
            },
        };
    }
    return {
        settings: next,
        migration: {source: "none", message: "未发现画风串内规则，使用 Provider 默认规则", recipeRuleCount: 0},
    };
}

export function resolveNovelAiGenerationSettings(
    input: Record<string, unknown>,
    explicitOverrides: Partial<Pick<TextToImageNovelAiSettings, "width" | "height">> = {},
): TextToImageNovelAiSettings {
    const settings = normalizeNovelAiGenerationSettings(TextToImageNovelAiSettingsSchema.parse(normalizeLegacyModelFields(input)));
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
        // 替换规则是 Provider 级全局设置，不进入 Recipe；即使旧 Recipe 对象仍带该字段也不覆盖根设置。
                ...explicitOverrides,
    });
}

/** Convert the pre-recipe profile/preset shape into a deterministic default recipe. */
export function normalizeNovelAiGenerationSettings(
    input: TextToImageNovelAiSettings | Record<string, unknown>,
): TextToImageNovelAiSettings {
    const raw = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
    const ownership = migrateNovelAiPromptReplaceRulesOwnership(raw);
    const settings = TextToImageNovelAiSettingsSchema.parse(normalizeLegacyModelFields(ownership.settings));
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
