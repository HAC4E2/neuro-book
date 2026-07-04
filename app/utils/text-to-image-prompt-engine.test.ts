import {describe, expect, it} from "vitest";
import {
    dedupeTextToImageTags,
    resolveTextToImagePrompt,
    type TextToImagePromptReplacementRule,
    type TextToImagePromptEngineCharacter,
    type TextToImagePromptEngineOutfit,
} from "nbook/app/utils/text-to-image-prompt-engine";

const himari: TextToImagePromptEngineCharacter = {
    id: "char-himari",
    cnName: "井上阳葵",
    enName: "Inoue Himari|Himari",
    profileTraits: "energetic, sporty girl",
    facialAppearance: "short brown hair, chestnut eyes",
    facialBack: "short brown hair, nape",
    upperSfw: "white sports tank top",
    upperBackSfw: "white sports tank top from behind",
    lowerSfw: "navy athletic shorts",
    lowerBackSfw: "navy athletic shorts from behind",
    upperNsfw: "bare breasts",
    upperBackNsfw: "bare back",
    lowerNsfw: "nude lower body",
    lowerBackNsfw: "bare butt",
};

const trackOutfit: TextToImagePromptEngineOutfit = {
    id: "outfit-track",
    nameCn: "运动服",
    nameEn: "track uniform|sportswear",
    aliases: "田径服|training outfit",
    enabled: true,
    upperFront: "white sleeveless track top",
    upperBack: "racerback track top",
    lowerFront: "navy running shorts",
    lowerBack: "navy running shorts from behind",
    negativePrompt: "wrong uniform",
};

describe("text-to-image prompt engine", () => {
    it("expands character and outfit trigger tags into NovelAI prompt fragments", () => {
        const resolved = resolveTextToImagePrompt({
            prompt: "sakura petals, $井上阳葵-sfw-upperbody$, $运动服-fullbody$",
            negativePrompt: "lowres",
            characters: [himari],
            outfits: [trackOutfit],
            promptRules: [],
        });

        expect(resolved.prompt).toContain("energetic, sporty girl");
        expect(resolved.prompt).toContain("short brown hair, chestnut eyes");
        expect(resolved.prompt).toContain("white sports tank top");
        expect(resolved.prompt).not.toContain("navy athletic shorts");
        expect(resolved.prompt).toContain("white sleeveless track top");
        expect(resolved.prompt).toContain("navy running shorts");
        expect(resolved.negativePrompt).toContain("wrong uniform");
        expect(resolved.characterPrompts).toHaveLength(1);
        expect(resolved.unresolvedTriggers).toEqual([]);
    });

    it("expands JSON character triggers with back view and sfw/nsfw body choices", () => {
        const trigger = JSON.stringify({
            name: "Himari",
            angle: "from behind",
            upperBody: "sfw",
            lowerBody: "nsfw",
        });

        const resolved = resolveTextToImagePrompt({
            prompt: `dynamic pose, $${trigger}$`,
            negativePrompt: "",
            characters: [himari],
            outfits: [],
            promptRules: [],
        });

        expect(resolved.prompt).toContain("short brown hair, nape");
        expect(resolved.prompt).toContain("white sports tank top from behind");
        expect(resolved.prompt).toContain("bare butt");
        expect(resolved.characterPrompts[0]?.prompt).toContain("bare butt");
    });

    it("applies dynamic replacement rules to positive and negative prompts", () => {
        const promptRules: TextToImagePromptReplacementRule[] = [
            {
                id: "rule-horse",
                name: "马 -> horse",
                enabled: true,
                target: "positive",
                matchMode: "plain",
                mode: "replace",
                trigger: "马",
                replacement: "horse",
            },
            {
                id: "rule-watermark",
                name: "追加水印负面",
                enabled: true,
                target: "negative",
                matchMode: "plain",
                mode: "append",
                trigger: "",
                replacement: "watermark, text",
            },
        ];

        const resolved = resolveTextToImagePrompt({
            prompt: "少女骑马, 马",
            negativePrompt: "lowres",
            characters: [],
            outfits: [],
            promptRules,
        });

        expect(resolved.prompt).toBe("少女骑horse, horse");
        expect(resolved.negativePrompt).toBe("lowres, watermark, text");
        expect(resolved.appliedRules.map((rule) => rule.id)).toEqual(["rule-horse", "rule-watermark"]);
    });

    it("dedupes comma-separated tags while preserving order", () => {
        expect(dedupeTextToImageTags("best quality, blue sky, best quality,  blue sky , smile")).toBe("best quality, blue sky, smile");
    });
});
