import {describe, expect, it} from "vitest";
import {
    TagPatternCandidateProvenanceSchema,
    TagPatternCandidateSetSchema,
    TagPatternSearchRequestSchema,
} from "nbook/shared/text-to-image-tag-pattern-retrieval";

const HASH = `sha256:${"a".repeat(64)}`;

describe("Tag Pattern retrieval contracts", () => {
    it("normalizes a strict bounded search request", () => {
        const parsed = TagPatternSearchRequestSchema.parse({
            query: " 港口  Dawn ",
            intent: {scene: "harbor"},
            applicability: {
                characterCount: 1,
                canvasIntent: "landscape",
                ratingScope: "general",
                providerKind: "novelai",
                modelScope: {kind: "generic-novelai"},
            },
            limit: 8,
        });

        expect(parsed.query).toBe("港口  Dawn");
        expect(() => TagPatternSearchRequestSchema.parse({...parsed, prompt: "masterpiece"})).toThrow();
        expect(() => TagPatternSearchRequestSchema.parse({...parsed, limit: 9})).toThrow();
    });

    it("keeps candidate summaries planning-only and closed by hash", () => {
        const candidate = {
            patternId: "harbor-dawn",
            sourceEntryId: "entry-1",
            order: 10,
            intent: {scene: "harbor", composition: "wide", lighting: "dawn", action: "observe"},
            applicability: {
                characterCount: {min: 0, max: 3},
                canvasIntents: ["landscape"],
                ratingScopes: ["general"],
                providerKinds: ["novelai"],
                modelScopes: [{kind: "generic-novelai"}],
            },
            resolutionRefs: {
                positive: {scene: ["r-scene"], composition: [], lighting: [], action: []},
                negative: {global: [], characters: []},
            },
            provenance: {scope: "base", operation: "base", sourceEntryId: "entry-1"},
            match: {score: 120, reasons: ["trigger_exact"]},
        } as const;
        const parsed = TagPatternCandidateSetSchema.parse({
            schemaVersion: "nbook.tag-pattern-candidate-set/v1",
            retrievalPolicyVersion: "nbook-pattern-retrieval-v1",
            effectivePlanningHash: HASH,
            requestHash: HASH,
            candidateSetHash: HASH,
            candidates: [candidate],
        });

        expect(parsed.candidates[0]?.patternId).toBe("harbor-dawn");
        expect(() => TagPatternCandidateSetSchema.parse({
            ...parsed,
            candidates: [{...candidate, finalPrompt: "forbidden"}],
        })).toThrow();
    });

    it("rejects Project overlay provenance", () => {
        expect(() => TagPatternCandidateProvenanceSchema.parse({
            scope: "project",
            operation: "replace",
            sourceEntryId: "entry-1",
        })).toThrow();
    });
});
