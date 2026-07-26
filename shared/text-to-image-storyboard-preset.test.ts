import {describe, expect, it} from "vitest";
import {
    createStoryboardPresetHashes,
    resolveStoryboardReviewState,
    StoryboardOverlaySchema,
    StoryboardPresetSchema,
} from "nbook/shared/text-to-image-storyboard-preset";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function when() {
    return {mode: "always" as const, any: [], andAny: []};
}

function provenance(path: string) {
    return {conversion: "normalized" as const, sourcePaths: [path]};
}

function rules() {
    return [
        {
            ruleId: "rule.shot-selection",
            sourceEntryId: "entry-1",
            order: 10,
            enabled: true,
            kind: "shot-selection" as const,
            when: when(),
            effect: {operation: "prefer" as const, beatTypes: ["action" as const], distribution: "even" as const, scoreDelta: 20},
            provenance: provenance("entries.1.content"),
        },
        {
            ruleId: "rule.shot-density",
            sourceEntryId: "entry-2",
            order: 20,
            enabled: true,
            kind: "shot-density" as const,
            when: when(),
            effect: {preferredMin: 3, preferredMax: 6, charactersPerShot: {min: 1, max: 3}},
            provenance: provenance("entries.2.content"),
        },
        {
            ruleId: "rule.composition",
            sourceEntryId: "entry-3",
            order: 30,
            enabled: true,
            kind: "composition" as const,
            when: when(),
            effect: {shotSize: "wide" as const, temporalMode: "single-instant" as const, maxSubjects: 4, avoidCompoundActions: true},
            provenance: provenance("entries.3.content"),
        },
        {
            ruleId: "rule.canvas",
            sourceEntryId: "entry-4",
            order: 40,
            enabled: true,
            kind: "canvas-intent" as const,
            when: when(),
            effect: {canvasIntent: "landscape" as const},
            provenance: provenance("entries.4.content"),
        },
        {
            ruleId: "rule.continuity",
            sourceEntryId: "entry-5",
            order: 50,
            enabled: true,
            kind: "continuity" as const,
            when: when(),
            effect: {lockCharacterTraits: true, lockOutfit: true, palette: "silver-blue", timeOfDay: "night", axisPolicy: "preserve" as const},
            provenance: provenance("entries.5.content"),
        },
        {
            ruleId: "rule.tag-policy",
            sourceEntryId: "entry-6",
            order: 60,
            enabled: true,
            kind: "tag-policy" as const,
            when: when(),
            effect: {operation: "avoid" as const, category: "composition" as const, resolutionRefs: ["resolution-1"]},
            provenance: provenance("entries.6.content"),
        },
        {
            ruleId: "rule.constraint",
            sourceEntryId: "entry-7",
            order: 70,
            enabled: true,
            kind: "constraint" as const,
            when: when(),
            effect: {maxSubjects: 4, forbidDuplicateBeat: true, requireValidAnchor: true},
            provenance: provenance("entries.7.content"),
        },
    ];
}

function preset() {
    return {
        schema: "nbook.storyboard-preset/v1" as const,
        presetId: "cinematic-chapter",
        patternSetId: "cinematic-chapter",
        packageId: "ttppkg_01JDEMO",
        resourceKey: "cinematic-chapter--demo",
        title: "章节电影化分镜",
        enabled: true,
        source: {
            kind: "ttp" as const,
            importId: "ttps_01JDEMO",
            rawSourceHash: HASH_A,
            sanitizedSourceHash: HASH_B,
            converterVersion: "1",
        },
        review: {status: "pending" as const},
        matching: {normalization: "nfkc-casefold" as const},
        defaults: {preferredShotCount: {min: 5, max: 7}, minimumParagraphGap: 2},
        macros: {
            bindings: {正文: "chapter.markdown" as const},
            unresolved: [],
        },
        rules: rules(),
        risks: [
            {code: "review-a", severity: "warning" as const, path: "rules.0", message: "风险 A"},
        ],
    };
}

describe("Storyboard Preset strict contract", () => {
    it("解析七类注册规则并拒绝未知 kind/effect 与 NovelAI 标量", () => {
        const parsed = StoryboardPresetSchema.parse(preset());
        expect(parsed.rules.map((rule) => rule.kind)).toEqual([
            "shot-selection",
            "shot-density",
            "composition",
            "canvas-intent",
            "continuity",
            "tag-policy",
            "constraint",
        ]);
        expect(() => StoryboardPresetSchema.parse({...preset(), sampler: "k_euler"})).toThrow();
        expect(() => StoryboardPresetSchema.parse({...preset(), rules: [{...rules()[0]!, kind: "unknown"}]})).toThrow();
        expect(() => StoryboardPresetSchema.parse({
            ...preset(),
            rules: [{...rules()[2]!, effect: {...rules()[2]!.effect, seed: 42}}],
        })).toThrow();
    });

    it("semantic hash 排除显示、来源、批准、provenance 与 risks，但保留规则数组顺序", () => {
        const base = StoryboardPresetSchema.parse(preset());
        const changedMetadata = StoryboardPresetSchema.parse({
            ...preset(),
            title: "另一标题",
            source: {...preset().source, rawSourceHash: HASH_B},
            review: {status: "rejected", rejectedReason: "重新审核"},
            rules: rules().map((rule, index) => ({...rule, provenance: provenance(`other.${String(index)}`)})),
            risks: [...preset().risks].reverse(),
        });
        const reordered = StoryboardPresetSchema.parse({...preset(), rules: [...rules()].reverse()});

        expect(createStoryboardPresetHashes(base).semanticHash).toBe(createStoryboardPresetHashes(changedMetadata).semanticHash);
        expect(createStoryboardPresetHashes(base).semanticHash).not.toBe(createStoryboardPresetHashes(reordered).semanticHash);
    });

    it("diagnostic hash 对风险顺序稳定，但风险内容和 unresolved macro 会改变 hash", () => {
        const base = StoryboardPresetSchema.parse(preset());
        const reordered = StoryboardPresetSchema.parse({...preset(), risks: [...preset().risks].reverse()});
        const changed = StoryboardPresetSchema.parse({
            ...preset(),
            macros: {
                ...preset().macros,
                unresolved: [{token: "{{roll 1d4}}", path: "entries.3", classification: "stochastic", blocking: true}],
            },
        });
        expect(createStoryboardPresetHashes(base).diagnosticHash).toBe(createStoryboardPresetHashes(reordered).diagnosticHash);
        expect(createStoryboardPresetHashes(base).diagnosticHash).not.toBe(createStoryboardPresetHashes(changed).diagnosticHash);
    });

    it("从当前 semantic/diagnostic hash 派生 pending/approved/stale/rejected", () => {
        const current = StoryboardPresetSchema.parse(preset());
        const hashes = createStoryboardPresetHashes(current);
        const approvedReview = {
            status: "approved" as const,
            approvedSemanticHash: hashes.semanticHash,
            approvedDiagnosticHash: hashes.diagnosticHash,
            approvedRawSourceHash: HASH_A,
            approvedSanitizedSourceHash: HASH_B,
        };
        expect(resolveStoryboardReviewState(current)).toBe("pending");
        expect(resolveStoryboardReviewState(StoryboardPresetSchema.parse({
            ...preset(),
            review: approvedReview,
        }))).toBe("approved");
        expect(resolveStoryboardReviewState(StoryboardPresetSchema.parse({
            ...preset(),
            review: {...approvedReview, approvedSemanticHash: HASH_A},
        }))).toBe("stale");
        expect(resolveStoryboardReviewState(StoryboardPresetSchema.parse({
            ...preset(),
            source: {...preset().source, rawSourceHash: HASH_B},
            review: approvedReview,
        }))).toBe("stale");
        expect(resolveStoryboardReviewState(StoryboardPresetSchema.parse({
            ...preset(),
            risks: [{code: "review-b", severity: "blocking", path: "rules.1", message: "风险 B"}],
            review: {...approvedReview, approvedDiagnosticHash: createStoryboardPresetHashes(StoryboardPresetSchema.parse({
                ...preset(),
                risks: [{code: "review-b", severity: "blocking", path: "rules.1", message: "风险 B"}],
            })).diagnosticHash},
        }))).toBe("pending");
        expect(resolveStoryboardReviewState(StoryboardPresetSchema.parse({
            ...preset(),
            macros: {...preset().macros, unresolved: [{token: "{{roll}}", path: "entries.1", classification: "stochastic", blocking: true}]},
            review: approvedReview,
        }))).toBe("pending");
        expect(resolveStoryboardReviewState(StoryboardPresetSchema.parse({
            ...preset(),
            review: {status: "rejected", rejectedReason: "不采用"},
        }))).toBe("rejected");
    });
});

describe("Storyboard Overlay strict contract", () => {
    function overlay() {
        return {
            schema: "nbook.storyboard-overlay/v1" as const,
            overlayId: "project-cinematic",
            presetId: "cinematic-chapter",
            enabled: true,
            baseSemanticHash: HASH_A,
            review: {status: "pending" as const},
            macroBindings: {},
            operations: [
                {op: "replace" as const, ruleId: "rule.shot-selection", rule: rules()[0]!},
                {op: "disable" as const, ruleId: "rule.composition"},
                {op: "append" as const, ruleId: "project.palette", rule: {...rules()[4]!, ruleId: "project.palette"}},
            ],
        };
    }

    it("拒绝内外 ruleId 不一致、重复 operation 和未知字段", () => {
        expect(StoryboardOverlaySchema.parse(overlay()).operations).toHaveLength(3);
        expect(() => StoryboardOverlaySchema.parse({
            ...overlay(),
            operations: [{op: "append", ruleId: "outer", rule: {...rules()[4]!, ruleId: "inner"}}],
        })).toThrow();
        expect(() => StoryboardOverlaySchema.parse({
            ...overlay(),
            operations: [overlay().operations[0], overlay().operations[0]],
        })).toThrow();
        expect(() => StoryboardOverlaySchema.parse({...overlay(), model: "nai-diffusion"})).toThrow();
    });
});
