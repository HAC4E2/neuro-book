import {
    applyTextToImagePromptRules,
    dedupeTextToImageTags,
    mergeTextToImageTags,
    type TextToImagePromptReplacementRule,
} from "nbook/shared/text-to-image-prompt";
import type {
    TextToImageCharacterImageTag,
    TextToImageCharacterImageTagOutfit,
} from "nbook/app/utils/text-to-image-character-tags";

export type BodyImagePromptResolution = {
    promptId: string;
    afterParagraphId: string;
    characterIds: string[];
    view: "front" | "back";
    framing: "face" | "upper" | "lower" | "full";
    rating: "sfw" | "nsfw";
    outfitName: string;
    reason: string;
    confidence: number;
};

export type CompiledTextToImagePrompt = {
    prompt: string;
    negativePrompt: string;
    characterPrompts: Array<{characterId: string; prompt: string; negativePrompt: string}>;
    appliedRuleIds: string[];
    warnings: string[];
};

/** 将受解析器约束的角色与构图信息确定性编译为 NovelAI tag。 */
export function compileTextToImagePrompt(input: {
    basePrompt: string;
    baseNegativePrompt: string;
    resolution: BodyImagePromptResolution;
    characters: TextToImageCharacterImageTag[];
    promptRules: TextToImagePromptReplacementRule[];
}): CompiledTextToImagePrompt {
    const warnings: string[] = [];
    const characterPrompts: CompiledTextToImagePrompt["characterPrompts"] = [];
    let prompt = input.basePrompt;
    let negativePrompt = input.baseNegativePrompt;
    const selectedIds = new Set<string>();
    for (const characterId of input.resolution.characterIds) {
        if (selectedIds.has(characterId)) {
            continue;
        }
        selectedIds.add(characterId);
        const character = input.characters.find((candidate) => candidate.id === characterId);
        if (!character) {
            warnings.push(`未找到角色 image-tags：${characterId}`);
            continue;
        }
        const characterPrompt = buildCharacterPrompt(character, input.resolution, warnings);
        prompt = mergeTextToImageTags(prompt, characterPrompt);
        negativePrompt = mergeTextToImageTags(negativePrompt, character.negativePrompt);
        characterPrompts.push({characterId: character.id, prompt: characterPrompt, negativePrompt: character.negativePrompt});
    }
    const rules = applyTextToImagePromptRules({prompt, negativePrompt, promptRules: input.promptRules});
    return {
        prompt: dedupeTextToImageTags(rules.prompt),
        negativePrompt: dedupeTextToImageTags(rules.negativePrompt),
        characterPrompts: characterPrompts.map((item) => ({
            ...item,
            prompt: dedupeTextToImageTags(item.prompt),
            negativePrompt: dedupeTextToImageTags(item.negativePrompt),
        })),
        appliedRuleIds: rules.appliedRuleIds,
        warnings,
    };
}

function buildCharacterPrompt(character: TextToImageCharacterImageTag, resolution: BodyImagePromptResolution, warnings: string[]): string {
    const front = resolution.view === "front";
    const face = front ? character.facialAppearance : character.facialBack;
    const upper = resolution.rating === "sfw"
        ? front ? character.upperSfw : character.upperBackSfw
        : front ? character.upperNsfw : character.upperBackNsfw;
    const lower = resolution.rating === "sfw"
        ? front ? character.lowerSfw : character.lowerBackSfw
        : front ? character.lowerNsfw : character.lowerBackNsfw;
    const body = resolution.framing === "face" ? []
        : resolution.framing === "upper" ? [upper]
        : resolution.framing === "lower" ? [lower]
        : [upper, lower];
    const outfit = resolveOutfit(character, resolution.outfitName);
    if (resolution.outfitName.trim() && !outfit) {
        warnings.push(`角色 ${character.id} 未声明服装：${resolution.outfitName.trim()}`);
    }
    const outfitBody = !outfit ? []
        : resolution.framing === "face" || resolution.framing === "upper"
            ? [front ? outfit.upper : outfit.upperBack]
            : resolution.framing === "lower"
                ? [front ? outfit.lower : outfit.lowerBack]
                : front
                    ? [outfit.upper, outfit.lower]
                    : [outfit.upperBack, outfit.lowerBack];
    return mergeTextToImageTags(firstAlias(character.enName), character.profileTraits, face, ...body, ...outfitBody);
}

function resolveOutfit(character: TextToImageCharacterImageTag, outfitName: string): TextToImageCharacterImageTagOutfit | null {
    const target = normalizeOutfitName(outfitName);
    if (!target) {
        return null;
    }
    return character.outfits.find((outfit) => (
        normalizeOutfitName(outfit.nameCn) === target || normalizeOutfitName(outfit.nameEn) === target
    )) ?? null;
}

function firstAlias(value: string): string {
    return value.split("|")[0]?.trim() ?? "";
}

function normalizeOutfitName(value: string): string {
    return value.trim().toLocaleLowerCase();
}
