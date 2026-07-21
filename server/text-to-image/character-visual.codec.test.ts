import {describe, expect, it} from "vitest";
import {
    createCharacterImageTagsFileHash,
    parseCharacterImageTagsMarkdown,
    parseOutfitTagsMarkdown,
    renderCharacterImageTagsMarkdown,
    renderOutfitTagsMarkdown,
} from "nbook/server/text-to-image/character-visual.codec";

function resolution(sourceText: string, tagId: number) {
    return {
        schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
        kind: "canonical" as const,
        sourceText,
        indexVersion: "db3k-demo",
        policyVersion: "safe-demo",
        resolverVersion: "resolver-demo",
        resolverPolicyVersion: "resolver-policy-demo",
        capabilityVersion: "nai-cap-demo",
        providerKind: "novelai" as const,
        modelScope: {kind: "generic-novelai" as const},
        candidateSetHash: null,
        resolvedAt: "2026-07-17T00:00:00.000Z",
        matchedBy: "exact" as const,
        canonical: {tagId, canonicalName: sourceText},
        decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
    };
}

function character() {
    return {
        schema: "nbook.character-image-tags/v2" as const,
        characterId: "hero",
        names: {cn: "主角", aliasesCn: [], en: "hero"},
        resolutionScope: {providerKind: "novelai" as const, modelScope: {kind: "generic-novelai" as const}},
        fields: {
            profileTraits: ["tr-calm"], facialAppearance: [], facialBack: [],
            upperSfw: [], upperBackSfw: [], lowerSfw: [], lowerBackSfw: [],
            upperNsfw: [], upperBackNsfw: [], lowerNsfw: [], lowerBackNsfw: [], negativePrompt: [],
        },
        outfitRefs: ["outfits/travel.md"],
        fieldProviderSyntaxRefs: {},
        providerSyntaxNodes: {},
        tagResolutions: {"tr-calm": resolution("calm", 3001)},
        policyApprovals: {},
    };
}

function outfit() {
    return {
        schema: "nbook.outfit-tags/v2" as const,
        outfitId: "travel",
        ownerCharacterId: "hero",
        names: {cn: "旅行装", en: "travel outfit"},
        resolutionScope: {providerKind: "novelai" as const, modelScope: {kind: "generic-novelai" as const}},
        fields: {upper: ["tr-coat"], upperBack: [], lower: [], lowerBack: []},
        fieldProviderSyntaxRefs: {},
        providerSyntaxNodes: {},
        tagResolutions: {"tr-coat": resolution("coat", 3002)},
        policyApprovals: {},
    };
}

describe("Character / Outfit V2 Markdown codec", () => {
    it("character 规范 round-trip，正文只改变 fileHash", () => {
        const firstText = renderCharacterImageTagsMarkdown(character(), "# 角色 A\n");
        const first = parseCharacterImageTagsMarkdown(firstText);
        const second = parseCharacterImageTagsMarkdown(renderCharacterImageTagsMarkdown(character(), "# 角色 B\n"));
        expect(renderCharacterImageTagsMarkdown(first.character, first.body)).toBe(firstText);
        expect(first.hashes).toEqual(second.hashes);
        expect(first.fileHash).not.toBe(second.fileHash);
        expect(first.fileHash).toBe(createCharacterImageTagsFileHash(firstText));
    });

    it("outfit 规范 round-trip，拒绝旧 schema 与未知字段", () => {
        const markdown = renderOutfitTagsMarkdown(outfit(), "# 旅行装\n");
        const parsed = parseOutfitTagsMarkdown(markdown);
        expect(renderOutfitTagsMarkdown(parsed.outfit, parsed.body)).toBe(markdown);
        expect(() => parseOutfitTagsMarkdown(markdown.replace("nbook.outfit-tags/v2", "nbook.outfit-tags/v1"))).toThrow();
        expect(() => parseOutfitTagsMarkdown(markdown.replace("outfitId: travel", "outfitId: travel\nstyle: forbidden"))).toThrow();
    });

    it("renderer 对 fields、refs 与 map 使用固定顺序", () => {
        const reordered = {
            ...character(),
            names: {cn: "主角", aliasesCn: ["乙", "甲"], en: "hero"},
            outfitRefs: ["outfits/z.md", "outfits/a.md"],
            fields: {...character().fields, profileTraits: ["tr-z", "tr-a"]},
            tagResolutions: {"tr-z": resolution("z", 3003), "tr-a": resolution("a", 3004)},
        };
        const parsed = parseCharacterImageTagsMarkdown(renderCharacterImageTagsMarkdown(reordered));
        expect(parsed.character.names.aliasesCn).toEqual(["乙", "甲"]);
        expect(parsed.character.outfitRefs).toEqual(["outfits/a.md", "outfits/z.md"]);
        expect(parsed.character.fields.profileTraits).toEqual(["tr-a", "tr-z"]);
        expect(Object.keys(parsed.character.tagResolutions)).toEqual(["tr-a", "tr-z"]);
    });
});
