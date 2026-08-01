import {describe, expect, it} from "vitest";
import {
    CharacterImageTagsSchema,
    createCharacterImageTagHashes,
    createOutfitTagHashes,
    OutfitTagsSchema,
    VisualStableIdSchema,
} from "nbook/shared/text-to-image-character-visual";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

const HASH_A = `sha256:${"a".repeat(64)}`;

function resolution(sourceText = "calm", tagId = 3001) {
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
        names: {cn: "主角", aliasesCn: ["少年"], en: "hero"},
        resolutionScope: {providerKind: "novelai" as const, modelScope: {kind: "generic-novelai" as const}},
        fields: {
            profileTraits: ["tr-calm"],
            facialAppearance: [],
            facialBack: [],
            upperSfw: [],
            upperBackSfw: [],
            lowerSfw: [],
            lowerBackSfw: [],
            upperNsfw: [],
            upperBackNsfw: [],
            lowerNsfw: [],
            lowerBackNsfw: [],
            negativePrompt: [],
        },
        outfitRefs: ["outfits/travel.md"],
        fieldProviderSyntaxRefs: {},
        providerSyntaxNodes: {},
        tagResolutions: {"tr-calm": resolution()},
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

describe("Character / Outfit V2 contracts", () => {
    it("VisualStableId accepts Chinese and ASCII stable IDs but rejects path/control syntax", () => {
        expect(VisualStableIdSchema.parse("林雪-01")).toBe("林雪-01");
        expect(VisualStableIdSchema.parse("hero_01.v2")).toBe("hero_01.v2");
        expect(() => VisualStableIdSchema.parse("../hero")).toThrow();
        expect(() => VisualStableIdSchema.parse("hero/01")).toThrow();
        expect(() => VisualStableIdSchema.parse("hero\n01")).toThrow();
    });

    it("接受完整固定字段，并拒绝 missing/unknown 字段", () => {
        expect(CharacterImageTagsSchema.parse(character()).characterId).toBe("hero");
        expect(OutfitTagsSchema.parse(outfit()).outfitId).toBe("travel");

        const missing = character();
        const {facialBack: _facialBack, ...missingFields} = missing.fields;
        expect(() => CharacterImageTagsSchema.parse({...missing, fields: missingFields})).toThrow();
        expect(() => CharacterImageTagsSchema.parse({
            ...character(),
            fields: {...character().fields, style: ["tr-calm"]},
        })).toThrow();
        expect(() => OutfitTagsSchema.parse({
            ...outfit(),
            fields: {...outfit().fields, negativePrompt: []},
        })).toThrow();
    });

    it("同文件 resolution 必须恰好归属一个字段，且只能保存 generic NovelAI snapshot", () => {
        expect(() => CharacterImageTagsSchema.parse({
            ...character(),
            fields: {...character().fields, facialAppearance: ["tr-missing"]},
        })).toThrow(/未知 resolution/u);
        expect(() => CharacterImageTagsSchema.parse({
            ...character(),
            tagResolutions: {...character().tagResolutions, "tr-unused": resolution("unused", 3003)},
        })).toThrow(/未被任何字段引用/u);
        expect(() => CharacterImageTagsSchema.parse({
            ...character(),
            fields: {...character().fields, facialAppearance: ["tr-calm"]},
        })).toThrow(/只能使用一次/u);
        expect(() => CharacterImageTagsSchema.parse({
            ...character(),
            tagResolutions: {
                "tr-calm": {...resolution(), modelScope: {kind: "novelai-model", modelId: "nai-diffusion-4-5-full"}},
            },
        })).toThrow(/generic-novelai/u);
    });

    it("Provider syntax node 只能被一个字段引用，并只能绑定该字段内的 resolution", () => {
        const weighted = {
            ...character(),
            fieldProviderSyntaxRefs: {profileTraits: ["syntax-calm"]},
            providerSyntaxNodes: {
                "syntax-calm": {kind: "novelai-tag-weight" as const, weight: 1.25, resolutionKeys: ["tr-calm"]},
            },
        };
        expect(CharacterImageTagsSchema.parse(weighted).providerSyntaxNodes["syntax-calm"]?.weight).toBe(1.25);
        expect(() => CharacterImageTagsSchema.parse({
            ...weighted,
            fieldProviderSyntaxRefs: {profileTraits: ["syntax-calm"], facialAppearance: ["syntax-calm"]},
        })).toThrow(/只能引用一次/u);
        expect(() => CharacterImageTagsSchema.parse({
            ...weighted,
            providerSyntaxNodes: {
                "syntax-calm": {kind: "novelai-tag-weight", weight: 1.25, resolutionKeys: ["tr-other"]},
            },
        })).toThrow(/同字段/u);
        expect(() => CharacterImageTagsSchema.parse({
            ...character(),
            providerSyntaxNodes: {
                "syntax-unused": {kind: "novelai-tag-weight", weight: 1.25, resolutionKeys: ["tr-calm"]},
            },
        })).toThrow(/未被任何字段引用/u);
    });

    it("把 review-required 批准证据绑定到同文件 resolution 与字段 owner", () => {
        const reviewed = {
            ...character(),
            policyApprovals: {
                "tr-calm": {
                    schemaVersion: "nbook.tag-policy-approval/v1" as const,
                    approvalId: "approval-calm",
                    actorId: "user-1",
                    reason: "确认角色视觉事实",
                    policyVersion: "safe-demo",
                    contentScope: "general" as const,
                    matchedRuleIds: ["review-calm"],
                    resolutionKey: "tr-calm",
                    ownerIdentity: "character:hero",
                    ownerSlot: "character:profileTraits",
                    sourcePath: "/character/lorebook~1character~1hero~1image-tags.md/fields/profileTraits/0",
                    sourceTextHash: hashTextToImageContract({sourceText: "calm"}),
                    subject: {kind: "canonical" as const, tagId: 3001, canonicalName: "calm"},
                    approvedAt: "2026-07-17T00:00:00.000Z",
                },
            },
        };

        expect(CharacterImageTagsSchema.parse(reviewed).policyApprovals).toHaveProperty("tr-calm");
        expect(() => CharacterImageTagsSchema.parse({
            ...reviewed,
            policyApprovals: {"tr-calm": {...reviewed.policyApprovals["tr-calm"], ownerSlot: "character:facialAppearance"}},
        })).toThrow(/ownerSlot/u);
    });

    it("planning hash 使用身份与 sourceText，render hash 使用字段、snapshot 与 syntax", () => {
        const base = character();
        const baseHashes = createCharacterImageTagHashes(base);
        const renamed = createCharacterImageTagHashes({...base, names: {...base.names, cn: "英雄"}});
        expect(renamed.visualPlanningFactsHash).not.toBe(baseHashes.visualPlanningFactsHash);
        expect(renamed.renderTagFactsHash).toBe(baseHashes.renderTagFactsHash);

        const refreshedEvidence = createCharacterImageTagHashes({
            ...base,
            tagResolutions: {"tr-calm": {...resolution(), resolvedAt: "2026-07-18T00:00:00.000Z"}},
        });
        expect(refreshedEvidence).toEqual(baseHashes);

        const changedEvidence = createCharacterImageTagHashes({
            ...base,
            tagResolutions: {"tr-calm": {...resolution(), policyVersion: "safe-next"}},
        });
        expect(changedEvidence.visualPlanningFactsHash).toBe(baseHashes.visualPlanningFactsHash);
        expect(changedEvidence.renderTagFactsHash).not.toBe(baseHashes.renderTagFactsHash);

        const changedMeaning = createCharacterImageTagHashes({
            ...base,
            tagResolutions: {"tr-calm": resolution("serious", 3004)},
        });
        expect(changedMeaning.visualPlanningFactsHash).not.toBe(baseHashes.visualPlanningFactsHash);
        expect(changedMeaning.renderTagFactsHash).not.toBe(baseHashes.renderTagFactsHash);
        expect(baseHashes.renderTagFactsHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(baseHashes.visualPlanningFactsHash).not.toBe(HASH_A);
    });

    it("outfit 同样分离 planning/render hash，显示名称不进入 render", () => {
        const base = outfit();
        const baseHashes = createOutfitTagHashes(base);
        const renamed = createOutfitTagHashes({...base, names: {...base.names, cn: "远行装"}});
        expect(renamed.visualPlanningFactsHash).not.toBe(baseHashes.visualPlanningFactsHash);
        expect(renamed.renderTagFactsHash).toBe(baseHashes.renderTagFactsHash);
    });
});
