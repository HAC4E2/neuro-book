import {describe, expect, it} from "vitest";
import {createTagPatternSetHashes, TagPatternSetSchema, type TagPattern} from "nbook/shared/text-to-image-tag-pattern";
import {retrieveTagPatterns} from "nbook/server/text-to-image/tag-pattern-retrieval";

function pattern(input: {
    patternId: string;
    order: number;
    mode?: "always" | "trigger";
    any?: string[];
    andAny?: string[];
    scene?: string;
    characterMin?: number;
    characterMax?: number;
    canvasIntents?: Array<"portrait" | "landscape" | "square" | "character-showcase">;
    enabled?: boolean;
}): TagPattern {
    return {
        patternId: input.patternId,
        order: input.order,
        enabled: input.enabled ?? true,
        retrieval: {
            mode: input.mode ?? "trigger",
            any: input.any ?? [],
            andAny: input.andAny ?? [],
            characterCount: {min: input.characterMin ?? 0, max: input.characterMax ?? 4},
            canvasIntents: input.canvasIntents ?? [],
            ratingScopes: ["general"],
            providerKinds: ["novelai"],
            modelScopes: [{kind: "generic-novelai"}],
        },
        intent: {scene: input.scene ?? "harbor", composition: "wide", lighting: "dawn", action: "observe"},
        tagResolutions: {},
        policyApprovals: {},
        positive: {scene: [], composition: [], lighting: [], action: []},
        negative: {global: [], characters: []},
        providerSyntaxRefs: [],
        providerSyntaxNodes: {},
        confidence: 1,
    };
}

function retrieve(patterns: TagPattern[], query = "港口 dawn") {
    const set = TagPatternSetSchema.parse({
        schema: "nbook.tag-pattern-set/v1",
        patternSetId: "demo",
        presetId: "demo",
        packageId: "demo",
        resourceKey: "demo",
        title: "demo",
        enabled: true,
        source: {kind: "builtin", assetVersion: "test"},
        review: {status: "pending"},
        patterns,
        risks: [],
    });
    return retrieveTagPatterns({
        effectivePlanningHash: createTagPatternSetHashes(set).planningHash,
        patterns: set.patterns,
        provenance: set.patterns.map((item) => ({
            patternId: item.patternId,
            scope: "base" as const,
            operation: "base" as const,
            sourceEntryId: item.sourceEntryId ?? null,
        })),
        request: {
            query,
            intent: {scene: "harbor"},
            applicability: {
                characterCount: 1,
                canvasIntent: "landscape",
                ratingScope: "general",
                providerKind: "novelai",
                modelScope: {kind: "generic-novelai"},
            },
            limit: 8,
        },
    });
}

describe("deterministic Tag Pattern retrieval", () => {
    it("matches NFKC case-fold triggers and keeps stable score/order/id ranking", () => {
        const result = retrieve([
            pattern({patternId: "always", order: 1, mode: "always"}),
            pattern({patternId: "and", order: 30, andAny: ["港口", "DAWN"]}),
            pattern({patternId: "exact-b", order: 20, any: ["港口 dawn"]}),
            pattern({patternId: "exact-a", order: 10, any: ["港口 DAWN"]}),
        ]);

        expect(result.candidates.map((item) => item.patternId)).toEqual(["exact-a", "exact-b", "and", "always"]);
        expect(result.candidateSetHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });

    it("filters disabled and incompatible applicability before ranking", () => {
        const result = retrieve([
            pattern({patternId: "disabled", order: 1, any: ["港口"], enabled: false}),
            pattern({patternId: "too-many", order: 2, any: ["港口"], characterMin: 2}),
            pattern({patternId: "portrait", order: 3, any: ["港口"], canvasIntents: ["portrait"]}),
            pattern({patternId: "eligible", order: 4, any: ["港口"]}),
        ]);

        expect(result.candidates.map((item) => item.patternId)).toEqual(["eligible"]);
    });

    it("caps candidates and changes only request hash when query changes", () => {
        const patterns = Array.from({length: 12}, (_, index) => pattern({
            patternId: `candidate-${String(index).padStart(2, "0")}`,
            order: index,
            any: ["港口"],
        }));
        const first = retrieve(patterns);
        const second = retrieve(patterns, "港口 night");

        expect(first.candidates).toHaveLength(8);
        expect(first.requestHash).not.toBe(second.requestHash);
        expect(first.candidateSetHash).not.toBe(second.candidateSetHash);
    });

    it("keeps candidate identity stable when render-only fields change", () => {
        const base = pattern({patternId: "stable", order: 1, any: ["港口"]});
        const changed = {
            ...base,
            tagResolutions: {"tr-scene": terminal("harbor", 3001)},
            positive: {...base.positive, scene: ["tr-scene"]},
            providerSyntaxRefs: ["provider-node-1"],
            providerSyntaxNodes: {"provider-node-1": {kind: "novelai-tag-weight" as const, weight: 1.1, resolutionKeys: ["tr-scene"]}},
        };
        const first = retrieve([base]);
        const second = retrieve([changed]);

        expect(first.candidateSetHash).toBe(second.candidateSetHash);
    });
});

/** 构造 retrieval 测试使用的 generic terminal。 */
function terminal(sourceText: string, tagId: number) {
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
