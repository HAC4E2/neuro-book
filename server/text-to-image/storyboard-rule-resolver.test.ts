import {describe, expect, it} from "vitest";
import {
    createStoryboardOverlaySemanticHash,
    createStoryboardPresetHashes,
    StoryboardOverlaySchema,
    StoryboardPresetSchema,
} from "nbook/shared/text-to-image-storyboard-preset";
import {resolveStoryboardRules} from "nbook/server/text-to-image/storyboard-rule-resolver";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function rule(ruleId: string, order: number, enabled = true) {
    return {
        ruleId,
        sourceEntryId: `source.${ruleId}`,
        order,
        enabled,
        kind: "continuity" as const,
        when: {mode: "always" as const, any: [], andAny: []},
        effect: {palette: ruleId},
        provenance: {conversion: "direct" as const, sourcePaths: [`entries.${ruleId}`]},
    };
}

function approvedPreset() {
    const pending = StoryboardPresetSchema.parse({
        schema: "nbook.storyboard-preset/v1",
        presetId: "cinematic",
        patternSetId: "cinematic",
        packageId: "package-one",
        resourceKey: "cinematic--one",
        title: "分镜",
        enabled: true,
        source: {kind: "manual"},
        review: {status: "pending"},
        matching: {normalization: "nfkc-casefold"},
        defaults: {preferredShotCount: {min: 2, max: 4}, minimumParagraphGap: 1},
        macros: {bindings: {}, unresolved: []},
        rules: [rule("base.a", 10), rule("base.b", 20)],
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

function approvedOverlay(operations: Array<object>, baseSemanticHash = createStoryboardPresetHashes(approvedPreset()).semanticHash) {
    const pending = StoryboardOverlaySchema.parse({
        schema: "nbook.storyboard-overlay/v1",
        overlayId: "project-overlay",
        presetId: "cinematic",
        enabled: true,
        baseSemanticHash,
        review: {status: "pending"},
        macroBindings: {},
        operations,
    });
    return StoryboardOverlaySchema.parse({
        ...pending,
        review: {status: "approved", approvedSemanticHash: createStoryboardOverlaySemanticHash(pending)},
    });
}

describe("Storyboard rule resolver", () => {
    it("整条 replace/disable/append 后按 order + ruleId 稳定排序并记录 provenance", () => {
        const overlay = approvedOverlay([
            {op: "replace", ruleId: "base.b", rule: rule("base.b", 5)},
            {op: "disable", ruleId: "base.a"},
            {op: "append", ruleId: "project.c", rule: rule("project.c", 15)},
        ]);
        const result = resolveStoryboardRules({base: approvedPreset(), overlay});

        expect(result.status).toBe("applied");
        expect(result.effectiveRules.map((item) => [item.ruleId, item.order, item.enabled])).toEqual([
            ["base.b", 5, true],
            ["base.a", 10, false],
            ["project.c", 15, true],
        ]);
        expect(result.provenance.map((item) => [item.ruleId, item.scope, item.operation])).toEqual([
            ["base.b", "project", "replace"],
            ["base.a", "project", "disable"],
            ["project.c", "project", "append"],
        ]);
        expect(result.effectivePresetHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });

    it("stale overlay 整份跳过，base 保持可运行；严格调用方显式阻断", () => {
        const overlay = approvedOverlay([{op: "disable", ruleId: "base.a"}], HASH_A);
        const permissive = resolveStoryboardRules({base: approvedPreset(), overlay, strictOverlay: false});
        const strict = resolveStoryboardRules({base: approvedPreset(), overlay, strictOverlay: true});

        expect(permissive.status).toBe("skipped_stale");
        expect(permissive.blocked).toBe(false);
        expect(permissive.effectiveRules).toEqual(approvedPreset().rules);
        expect(strict.blocked).toBe(true);
    });

    it("unknown target 或 append collision 时零部分应用", () => {
        const unknown = resolveStoryboardRules({
            base: approvedPreset(),
            overlay: approvedOverlay([
                {op: "replace", ruleId: "missing", rule: rule("missing", 1)},
                {op: "append", ruleId: "project.c", rule: rule("project.c", 2)},
            ]),
        });
        const collision = resolveStoryboardRules({
            base: approvedPreset(),
            overlay: approvedOverlay([{op: "append", ruleId: "base.a", rule: rule("base.a", 1)}]),
        });

        expect(unknown.status).toBe("rejected_conflict");
        expect(unknown.effectiveRules).toEqual(approvedPreset().rules);
        expect(collision.status).toBe("rejected_conflict");
        expect(collision.effectiveRules).toEqual(approvedPreset().rules);
    });

    it("effective hash 覆盖 defaults，fallback 也按业务顺序规范化", () => {
        const base = approvedPreset();
        const changedPending = StoryboardPresetSchema.parse({
            ...base,
            review: {status: "pending"},
            defaults: {...base.defaults, preferredShotCount: {min: 3, max: 5}},
            rules: [...base.rules].reverse(),
        });
        const hashes = createStoryboardPresetHashes(changedPending);
        const changed = StoryboardPresetSchema.parse({
            ...changedPending,
            review: {
                status: "approved",
                approvedSemanticHash: hashes.semanticHash,
                approvedDiagnosticHash: hashes.diagnosticHash,
                approvedRawSourceHash: null,
                approvedSanitizedSourceHash: null,
            },
        });
        const originalResult = resolveStoryboardRules({
            base,
            overlay: approvedOverlay([], createStoryboardPresetHashes(base).semanticHash),
        });
        const changedResult = resolveStoryboardRules({
            base: changed,
            overlay: approvedOverlay([], createStoryboardPresetHashes(changed).semanticHash),
        });

        expect(changedResult.effectiveRules.map((item) => item.ruleId)).toEqual(["base.a", "base.b"]);
        expect(changedResult.effectivePresetHash).not.toBe(originalResult.effectivePresetHash);
    });
});
