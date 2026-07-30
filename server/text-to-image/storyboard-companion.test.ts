import {describe, expect, it} from "vitest";
import {createTagPatternSetHashes, TagPatternSetSchema} from "nbook/shared/text-to-image-tag-pattern";
import {createStoryboardPresetHashes, StoryboardPresetSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {assertStoryboardPatternPair} from "nbook/server/text-to-image/storyboard-companion";

function createApprovedPreset() {
    const pending = StoryboardPresetSchema.parse({
        schema: "nbook.storyboard-preset/v1",
        presetId: "default",
        patternSetId: "default",
        packageId: "default",
        resourceKey: "default",
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

function createPatternSet(input: {presetId?: string; enabled?: boolean; reviewStatus?: "pending"} = {}) {
    const presetId = input.presetId ?? "default";
    const pending = TagPatternSetSchema.parse({
        schema: "nbook.tag-pattern-set/v1",
        patternSetId: presetId,
        presetId,
        packageId: "default",
        resourceKey: "default",
        title: "Patterns",
        enabled: input.enabled ?? true,
        source: {kind: "manual"},
        review: {status: input.reviewStatus ?? "pending"},
        patterns: [],
        risks: [],
    });
    if (input.reviewStatus === "pending") return pending;
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

describe("assertStoryboardPatternPair", () => {
    it("accepts one enabled and approved companion with matching identity", () => {
        expect(assertStoryboardPatternPair({
            preset: createApprovedPreset(),
            patternSet: createPatternSet(),
        })).toEqual({presetId: "default", packageId: "default", resourceKey: "default"});
    });

    it("rejects a disabled, pending, missing, or identity-mismatched companion", () => {
        expect(() => assertStoryboardPatternPair({
            preset: createApprovedPreset(),
            patternSet: createPatternSet({enabled: false}),
        })).toThrow("TAG_PATTERN_SET_STALE");
        expect(() => assertStoryboardPatternPair({
            preset: createApprovedPreset(),
            patternSet: createPatternSet({reviewStatus: "pending"}),
        })).toThrow("TAG_PATTERN_SET_STALE");
        expect(() => assertStoryboardPatternPair({preset: createApprovedPreset(), patternSet: null})).toThrow("TAG_PATTERN_SET_STALE");
        expect(() => assertStoryboardPatternPair({
            preset: createApprovedPreset(),
            patternSet: createPatternSet({presetId: "other"}),
        })).toThrow("TAG_PATTERN_SET_STALE");
        expect(() => assertStoryboardPatternPair({
            preset: createApprovedPreset(),
            patternSet: TagPatternSetSchema.parse({...createPatternSet(), packageId: "other"}),
        })).toThrow("TAG_PATTERN_SET_STALE");
        expect(() => assertStoryboardPatternPair({
            preset: createApprovedPreset(),
            patternSet: TagPatternSetSchema.parse({...createPatternSet(), resourceKey: "other"}),
        })).toThrow("TAG_PATTERN_SET_STALE");
    });
});
