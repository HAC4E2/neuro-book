import {describe, expect, it} from "vitest";
import {
    characterDetailFieldGroups,
    characterDetailFieldLabels,
    characterWorkbenchSections,
    outfitDetailFields,
} from "nbook/app/components/novel-ide/text-to-image/character-workbench";

describe("character workbench layout contract", () => {
    it("keeps the chatu-8 navigation order and separates outfit details", () => {
        expect(characterWorkbenchSections.map((section) => section.id)).toEqual([
            "character",
            "outfit",
            "enabled",
        ]);
        expect(characterWorkbenchSections.map((section) => section.label)).toEqual([
            "角色详情",
            "服装详情",
            "当前启用角色",
        ]);
        expect(outfitDetailFields.map((field) => field.key)).toEqual([
            "cnName",
            "enName",
            "upper",
            "upperBack",
            "lower",
            "lowerBack",
        ]);
    });

    it("covers every visual character field once in explicit detail groups", () => {
        const keys = characterDetailFieldGroups.flatMap((group) => group.fields);

        expect(keys).toHaveLength(15);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toEqual(expect.arrayContaining([
            "cnName",
            "enName",
            "triggerWords",
            "profileTraits",
            "facialAppearance",
            "facialBack",
            "upperSfw",
            "upperBackSfw",
            "lowerSfw",
            "lowerBackSfw",
            "upperNsfw",
            "upperBackNsfw",
            "lowerNsfw",
            "lowerBackNsfw",
            "negativePrompt",
        ]));
        expect(characterDetailFieldLabels.lowerNsfw).toBe("下半身 NSFW 正面");
        expect(characterDetailFieldLabels.lowerBackNsfw).toBe("下半身 NSFW 背面");
    });
});
