import {describe, expect, it} from "vitest";
import {
    createTagPatternOverlayHashes,
    createTagPatternSetHashes,
    TagPatternOverlaySchema,
    TagPatternSetSchema,
} from "nbook/shared/text-to-image-tag-pattern";
import {createStoryboardPresetHashes, StoryboardPresetSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {
    assertStoryboardPatternPair,
    resolveTagPatterns,
} from "nbook/server/text-to-image/tag-pattern-resolver";

const HASH_A = `sha256:${"a".repeat(64)}`;

function pattern(patternId: string, order: number, enabled = true) {
    return {
        patternId,
        sourceEntryId: `source.${patternId}`,
        order,
        enabled,
        retrieval: {
            mode: "always" as const,
            any: [],
            andAny: [],
            characterCount: {min: 0, max: 4},
            canvasIntents: [],
            ratingScopes: ["general" as const],
            providerKinds: ["novelai" as const],
            modelScopes: [],
        },
        intent: {scene: "scene", composition: "composition", lighting: "lighting", action: "action"},
        tagResolutions: {},
        policyApprovals: {},
        positive: {scene: [], composition: [], lighting: [], action: []},
        negative: {global: [], characters: []},
        providerSyntaxRefs: [],
        providerSyntaxNodes: {},
        confidence: 1,
        provenance: {conversion: "direct" as const, sourcePaths: [`entries.${patternId}`]},
    };
}

function approvedPatternSet() {
    const pending = TagPatternSetSchema.parse({
        schema: "nbook.tag-pattern-set/v1",
        patternSetId: "cinematic",
        presetId: "cinematic",
        packageId: "package-one",
        resourceKey: "cinematic--one",
        title: "Patterns",
        enabled: true,
        source: {kind: "manual"},
        review: {status: "pending"},
        patterns: [pattern("base.a", 10), pattern("base.b", 20)],
        risks: [],
    });
    const hashes = createTagPatternSetHashes(pending);
    return TagPatternSetSchema.parse({
        ...pending,
        review: {
            status: "approved",
            approvedPlanningHash: hashes.planningHash,
            approvedRenderHash: hashes.renderHash,
            approvedRawSourceHash: null,
            approvedSanitizedSourceHash: null,
        },
    });
}

function approvedPreset() {
    const pending = StoryboardPresetSchema.parse({
        schema: "nbook.storyboard-preset/v1",
        presetId: "cinematic",
        patternSetId: "cinematic",
        packageId: "package-one",
        resourceKey: "cinematic--one",
        title: "Preset",
        enabled: true,
        source: {kind: "manual"},
        review: {status: "pending"},
        matching: {normalization: "nfkc-casefold"},
        defaults: {preferredShotCount: {min: 2, max: 4}, minimumParagraphGap: 1},
        macros: {bindings: {}, unresolved: []},
        rules: [],
        risks: [],
    });
    const hashes = createStoryboardPresetHashes(pending);
    return StoryboardPresetSchema.parse({
        ...pending,
        review: {
            status: "approved",
            approvedSemanticHash: hashes.semanticHash,
            approvedDiagnosticHash: hashes.diagnosticHash,
            approvedRawSourceHash: null,
            approvedSanitizedSourceHash: null,
        },
    });
}

function approvedOverlay(operations: Array<object>, basePlanningHash = createTagPatternSetHashes(approvedPatternSet()).planningHash) {
    const baseHashes = createTagPatternSetHashes(approvedPatternSet());
    const pending = TagPatternOverlaySchema.parse({
        schema: "nbook.tag-pattern-overlay/v1",
        overlayId: "project-patterns",
        patternSetId: "cinematic",
        enabled: true,
        basePlanningHash,
        baseRenderHash: baseHashes.renderHash,
        review: {status: "pending"},
        operations,
    });
    const hashes = createTagPatternOverlayHashes(pending);
    return TagPatternOverlaySchema.parse({
        ...pending,
        review: {status: "approved", approvedPlanningHash: hashes.planningHash, approvedRenderHash: hashes.renderHash},
    });
}

describe("Tag Pattern resolver", () => {
    it("整条合并、禁用过滤和 planning/render effective hash 稳定", () => {
        const result = resolveTagPatterns({
            base: approvedPatternSet(),
            overlay: approvedOverlay([
                {op: "replace", patternId: "base.b", pattern: pattern("base.b", 5)},
                {op: "disable", patternId: "base.a"},
                {op: "append", patternId: "project.c", pattern: pattern("project.c", 15)},
            ]),
        });
        expect(result.status).toBe("applied");
        expect(result.effectivePatterns.map((item) => [item.patternId, item.order, item.enabled])).toEqual([
            ["base.b", 5, true],
            ["base.a", 10, false],
            ["project.c", 15, true],
        ]);
        expect(result.candidates.map((item) => item.patternId)).toEqual(["base.b", "project.c"]);
        expect(result.provenance.map((item) => [item.patternId, item.scope, item.operation, item.sourceEntryId])).toEqual([
            ["base.b", "project", "replace", "source.base.b"],
            ["base.a", "project", "disable", "source.base.a"],
            ["project.c", "project", "append", "source.project.c"],
        ]);
        expect(result.effectivePlanningHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(result.effectiveRenderHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });

    it("任一 stale/conflict 都整份跳过", () => {
        const stale = resolveTagPatterns({
            base: approvedPatternSet(),
            overlay: approvedOverlay([{op: "disable", patternId: "base.a"}], HASH_A),
        });
        const conflict = resolveTagPatterns({
            base: approvedPatternSet(),
            overlay: approvedOverlay([{op: "replace", patternId: "missing", pattern: pattern("missing", 1)}]),
        });
        expect(stale.status).toBe("skipped_stale");
        expect(stale.effectivePatterns).toEqual(approvedPatternSet().patterns);
        expect(conflict.status).toBe("rejected_conflict");
        expect(conflict.effectivePatterns).toEqual(approvedPatternSet().patterns);
    });

    it("companion 缺失或 preset/package/resource identity 不一致时 fail-closed", () => {
        expect(() => assertStoryboardPatternPair({preset: approvedPreset(), patternSet: null})).toThrow();
        expect(() => assertStoryboardPatternPair({
            preset: approvedPreset(),
            patternSet: TagPatternSetSchema.parse({...approvedPatternSet(), packageId: "package-two"}),
        })).toThrow();
        expect(() => assertStoryboardPatternPair({
            preset: approvedPreset(),
            patternSet: TagPatternSetSchema.parse({...approvedPatternSet(), resourceKey: "cinematic--two"}),
        })).toThrow();
        expect(assertStoryboardPatternPair({preset: approvedPreset(), patternSet: approvedPatternSet()})).toEqual({
            presetId: "cinematic",
            packageId: "package-one",
            resourceKey: "cinematic--one",
        });
    });
});
