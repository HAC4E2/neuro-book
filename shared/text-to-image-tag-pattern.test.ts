import {describe, expect, it} from "vitest";
import {
    createTagPatternOverlayHashes,
    createTagPatternSetHashes,
    listEnabledTagPatterns,
    resolveTagPatternReviewState,
    TagPatternOverlaySchema,
    TagPatternSetSchema,
} from "nbook/shared/text-to-image-tag-pattern";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import type {TagPolicyApproval} from "nbook/shared/text-to-image-tag-policy";
import {createProviderPassthroughValidationHash} from "nbook/shared/text-to-image-tag-resolution";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function canonical(sourceText: string, tagId: number) {
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

function replacement() {
    return {
        ...canonical("rain", 1002),
        kind: "replacement" as const,
        sourceText: "rainfall",
        candidateSetHash: HASH_A,
        matchedBy: undefined,
        semanticScore: 0.96,
        semanticClusterHash: HASH_B,
        candidateRank: 1,
        decisionProvenance: {selectedBy: "resolver_top" as const, conceptQueriesHash: HASH_A},
    };
}

function passthrough() {
    const base = canonical("haze", 1004);
    const {matchedBy: _matchedBy, canonical: _canonical, ...envelope} = base;
    return {
        ...envelope,
        kind: "provider_passthrough" as const,
        sourceText: "silver-blue atmospheric haze",
        wireText: "silver-blue atmospheric haze",
        validationTextHash: createProviderPassthroughValidationHash("silver-blue atmospheric haze"),
        candidateSetHash: HASH_B,
        reason: "no_reliable_candidate" as const,
        decisionProvenance: {selectedBy: "passthrough_fallback" as const, conceptQueriesHash: HASH_A},
    };
}

function pattern(patternId = "pattern.rainy-night") {
    const replacementValue = replacement();
    const {matchedBy: _matchedBy, ...replacementWithoutUnknown} = replacementValue;
    return {
        patternId,
        sourceEntryId: "entry-rain",
        order: 100,
        enabled: true,
        retrieval: {
            mode: "trigger" as const,
            any: ["雨夜", "夜雨"],
            andAny: ["小巷"],
            characterCount: {min: 1, max: 2},
            canvasIntents: ["portrait" as const, "landscape" as const],
            ratingScopes: ["general" as const],
            providerKinds: ["novelai" as const],
            modelScopes: [],
        },
        intent: {
            scene: "rainy-night-alley",
            composition: "cinematic-depth",
            lighting: "backlit-rain",
            action: "still-tension",
        },
        tagResolutions: {
            "tr-night": canonical("night", 1001),
            "tr-rain": replacementWithoutUnknown,
            "tr-wide": canonical("wide_shot", 1003),
            "tr-haze": passthrough(),
        },
        policyApprovals: {} as Record<string, TagPolicyApproval>,
        positive: {
            scene: ["tr-night", "tr-rain"],
            composition: ["tr-wide"],
            lighting: ["tr-haze"],
            action: [],
        },
        negative: {global: [], characters: []},
        providerSyntaxRefs: [],
        providerSyntaxNodes: {},
        confidence: 0.92,
        provenance: {conversion: "normalized" as const, sourcePaths: ["entries.18.content"]},
    };
}

function patternSet() {
    return {
        schema: "nbook.tag-pattern-set/v1" as const,
        patternSetId: "cinematic-chapter",
        presetId: "cinematic-chapter",
        packageId: "ttppkg_01JDEMO",
        resourceKey: "cinematic-chapter--demo",
        title: "章节电影化场景组合",
        enabled: true,
        source: {
            kind: "ttp" as const,
            importId: "ttps_01JDEMO",
            rawSourceHash: HASH_A,
            sanitizedSourceHash: HASH_B,
            converterVersion: "1",
        },
        review: {status: "pending" as const},
        patterns: [pattern(), {...pattern("pattern.disabled"), enabled: false, order: 200}],
        risks: [],
    };
}

describe("Tag Pattern strict contract", () => {
    it("严格往返 canonical/replacement/passthrough refs，并只召回 enabled Pattern", () => {
        const parsed = TagPatternSetSchema.parse(patternSet());
        expect(parsed.patterns[0]!.tagResolutions["tr-night"]?.kind).toBe("canonical");
        expect(parsed.patterns[0]!.tagResolutions["tr-rain"]?.kind).toBe("replacement");
        expect(parsed.patterns[0]!.tagResolutions["tr-haze"]?.kind).toBe("provider_passthrough");
        expect(listEnabledTagPatterns(parsed).map((item) => item.patternId)).toEqual(["pattern.rainy-night"]);
    });

    it("把 Pattern 权重保存为同 owner 的 typed Provider syntax node", () => {
        const weighted = {
            ...pattern(),
            providerSyntaxRefs: ["syntax-night"],
            providerSyntaxNodes: {
                "syntax-night": {kind: "novelai-tag-weight" as const, weight: 1.25, resolutionKeys: ["tr-night"]},
            },
        };

        expect(TagPatternSetSchema.parse({...patternSet(), patterns: [weighted]}).patterns[0]?.providerSyntaxNodes)
            .toEqual(weighted.providerSyntaxNodes);
        expect(() => TagPatternSetSchema.parse({
            ...patternSet(),
            patterns: [{...weighted, providerSyntaxNodes: {
                "syntax-night": {...weighted.providerSyntaxNodes["syntax-night"], resolutionKeys: ["tr-missing"]},
            }}],
        })).toThrow(/resolution/u);
    });

    it("拒绝 unknown/unused/duplicate/cross-pattern resolution ref", () => {
        expect(() => TagPatternSetSchema.parse({
            ...patternSet(),
            patterns: [{...pattern(), positive: {...pattern().positive, scene: ["tr-missing"]}}],
        })).toThrow();
        expect(() => TagPatternSetSchema.parse({
            ...patternSet(),
            patterns: [{...pattern(), tagResolutions: {...pattern().tagResolutions, "tr-unused": canonical("unused", 9999)}}],
        })).toThrow();
        expect(() => TagPatternSetSchema.parse({
            ...patternSet(),
            patterns: [{...pattern(), positive: {...pattern().positive, action: ["tr-night"]}}],
        })).toThrow();
        expect(() => TagPatternSetSchema.parse({
            ...patternSet(),
            patterns: [{...pattern(), positive: {...pattern().positive, scene: ["tr-night", "other-pattern-ref"]}}],
        })).toThrow();
    });

    it("review approval 必须绑定本 Pattern 的 resolution、slot、来源与 terminal subject", () => {
        const reviewed = pattern();
        reviewed.policyApprovals = {
            "tr-night": {
                schemaVersion: "nbook.tag-policy-approval/v1" as const,
                approvalId: "approval.import.1",
                actorId: "user-1",
                reason: "确认该标签适用于当前 Pattern",
                policyVersion: "safe-demo",
                contentScope: "general" as const,
                matchedRuleIds: ["review-general-night"],
                resolutionKey: "tr-night",
                ownerIdentity: "cinematic-chapter/pattern.rainy-night",
                ownerSlot: "pattern:scene",
                sourcePath: "/entries/18/content",
                sourceTextHash: hashTextToImageContract({sourceText: "night"}),
                subject: {kind: "canonical" as const, tagId: 1001, canonicalName: "night"},
                approvedAt: "2026-07-20T00:00:00.000Z",
            },
        };
        const parsed = TagPatternSetSchema.parse({...patternSet(), patterns: [reviewed]});
        expect(parsed.patterns[0]!.policyApprovals["tr-night"]?.approvalId).toBe("approval.import.1");

        for (const invalid of [
            {...reviewed, policyApprovals: {"tr-night": {...reviewed.policyApprovals["tr-night"]!, ownerSlot: "pattern:action"}}},
            {...reviewed, policyApprovals: {"tr-night": {...reviewed.policyApprovals["tr-night"]!, ownerIdentity: "other/pattern"}}},
            {...reviewed, policyApprovals: {"tr-night": {...reviewed.policyApprovals["tr-night"]!, sourceTextHash: HASH_A}}},
            {...reviewed, policyApprovals: {"tr-night": {...reviewed.policyApprovals["tr-night"]!, subject: {kind: "canonical", tagId: 9, canonicalName: "other"}}}},
            {...reviewed, policyApprovals: {"tr-missing": {...reviewed.policyApprovals["tr-night"]!, resolutionKey: "tr-missing"}}},
        ]) {
            expect(() => TagPatternSetSchema.parse({...patternSet(), patterns: [invalid]})).toThrow();
        }
    });

    it("planning/render hash 严格按字段域独立变化", () => {
        const base = TagPatternSetSchema.parse(patternSet());
        const metadata = TagPatternSetSchema.parse({
            ...patternSet(),
            title: "另一标题",
            patterns: patternSet().patterns.map((item) => ({...item, confidence: 0.1, provenance: {conversion: "direct", sourcePaths: ["other"]}})),
        });
        const planningChange = TagPatternSetSchema.parse({
            ...patternSet(),
            patterns: [{...pattern(), retrieval: {...pattern().retrieval, any: ["暴雨"]}}, patternSet().patterns[1]],
        });
        const renderChangePattern = pattern();
        renderChangePattern.tagResolutions["tr-night"] = canonical("night_scene", 1001);
        const renderChange = TagPatternSetSchema.parse({...patternSet(), patterns: [renderChangePattern, patternSet().patterns[1]]});

        const approvalChangePattern = pattern();
        approvalChangePattern.policyApprovals = {
            "tr-night": {
                schemaVersion: "nbook.tag-policy-approval/v1" as const,
                approvalId: "approval.import.1",
                actorId: "user-1",
                reason: "确认该标签适用于当前 Pattern",
                policyVersion: "safe-demo",
                contentScope: "general" as const,
                matchedRuleIds: ["review-general-night"],
                resolutionKey: "tr-night",
                ownerIdentity: "cinematic-chapter/pattern.rainy-night",
                ownerSlot: "pattern:scene",
                sourcePath: "/entries/18/content",
                sourceTextHash: hashTextToImageContract({sourceText: "night"}),
                subject: {kind: "canonical" as const, tagId: 1001, canonicalName: "night"},
                approvedAt: "2026-07-20T00:00:00.000Z",
            },
        };
        const approvalChange = TagPatternSetSchema.parse({...patternSet(), patterns: [approvalChangePattern, patternSet().patterns[1]]});

        expect(createTagPatternSetHashes(base)).toEqual(createTagPatternSetHashes(metadata));
        expect(createTagPatternSetHashes(base).planningHash).not.toBe(createTagPatternSetHashes(planningChange).planningHash);
        expect(createTagPatternSetHashes(base).renderHash).toBe(createTagPatternSetHashes(planningChange).renderHash);
        expect(createTagPatternSetHashes(base).planningHash).toBe(createTagPatternSetHashes(renderChange).planningHash);
        expect(createTagPatternSetHashes(base).renderHash).not.toBe(createTagPatternSetHashes(renderChange).renderHash);
        expect(createTagPatternSetHashes(base).planningHash).toBe(createTagPatternSetHashes(approvalChange).planningHash);
        expect(createTagPatternSetHashes(base).renderHash).not.toBe(createTagPatternSetHashes(approvalChange).renderHash);
    });

    it("拒绝 Pattern 越权保存 Recipe/Provider/Prompt 字段", () => {
        for (const field of ["style", "model", "sampler", "steps", "seed", "secret", "finalPrompt", "instruction", "tool"] as const) {
            expect(() => TagPatternSetSchema.parse({
                ...patternSet(),
                patterns: [{...pattern(), [field]: field === "steps" || field === "seed" ? 28 : "forbidden"}],
            }), field).toThrow();
        }
    });

    it("批准 hash 漂移派生 stale", () => {
        const current = TagPatternSetSchema.parse(patternSet());
        const hashes = createTagPatternSetHashes(current);
        const approvedReview = {
            status: "approved" as const,
            approvedPlanningHash: hashes.planningHash,
            approvedRenderHash: hashes.renderHash,
            approvedRawSourceHash: HASH_A,
            approvedSanitizedSourceHash: HASH_B,
        };
        expect(resolveTagPatternReviewState(current)).toBe("pending");
        expect(resolveTagPatternReviewState(TagPatternSetSchema.parse({
            ...patternSet(),
            review: approvedReview,
        }))).toBe("approved");
        expect(resolveTagPatternReviewState(TagPatternSetSchema.parse({
            ...patternSet(),
            review: {...approvedReview, approvedPlanningHash: HASH_A},
        }))).toBe("stale");
        expect(resolveTagPatternReviewState(TagPatternSetSchema.parse({
            ...patternSet(),
            source: {...patternSet().source, sanitizedSourceHash: HASH_A},
            review: approvedReview,
        }))).toBe("stale");
        const blocked = TagPatternSetSchema.parse({
            ...patternSet(),
            risks: [{code: "unsafe-pattern", severity: "blocking", path: "patterns.0", message: "阻断风险"}],
        });
        const blockedHashes = createTagPatternSetHashes(blocked);
        expect(resolveTagPatternReviewState(TagPatternSetSchema.parse({
            ...blocked,
            review: {...approvedReview, approvedPlanningHash: blockedHashes.planningHash, approvedRenderHash: blockedHashes.renderHash},
        }))).toBe("pending");
    });
});

describe("Tag Pattern Overlay strict contract", () => {
    function overlay() {
        return {
            schema: "nbook.tag-pattern-overlay/v1" as const,
            overlayId: "project-patterns",
            patternSetId: "cinematic-chapter",
            enabled: true,
            basePlanningHash: HASH_A,
            baseRenderHash: HASH_B,
            review: {status: "pending" as const},
            operations: [
                {op: "replace" as const, patternId: "pattern.rainy-night", pattern: pattern()},
                {op: "disable" as const, patternId: "pattern.disabled"},
            ],
        };
    }

    it("拒绝错配 patternId、重复 operation 与 NovelAI 字段", () => {
        expect(TagPatternOverlaySchema.parse(overlay()).operations).toHaveLength(2);
        expect(() => TagPatternOverlaySchema.parse({
            ...overlay(),
            operations: [{op: "append", patternId: "outer", pattern: pattern("inner")}],
        })).toThrow();
        expect(() => TagPatternOverlaySchema.parse({...overlay(), operations: [overlay().operations[0], overlay().operations[0]]})).toThrow();
        expect(() => TagPatternOverlaySchema.parse({...overlay(), guidance: 5})).toThrow();
    });

    it("disable、operation kind 与 identity 只改变 planning hash，不污染 render hash", () => {
        const base = TagPatternOverlaySchema.parse(overlay());
        const withoutDisable = TagPatternOverlaySchema.parse({...overlay(), operations: [overlay().operations[0]]});
        const appendInstead = TagPatternOverlaySchema.parse({
            ...overlay(),
            operations: [{op: "append", patternId: "project.same-render", pattern: pattern("project.same-render")}],
        });
        const replaceOnly = TagPatternOverlaySchema.parse({...overlay(), operations: [overlay().operations[0]]});

        expect(createTagPatternOverlayHashes(base).planningHash).not.toBe(createTagPatternOverlayHashes(withoutDisable).planningHash);
        expect(createTagPatternOverlayHashes(base).renderHash).toBe(createTagPatternOverlayHashes(withoutDisable).renderHash);
        expect(createTagPatternOverlayHashes(appendInstead).planningHash).not.toBe(createTagPatternOverlayHashes(replaceOnly).planningHash);
        expect(createTagPatternOverlayHashes(appendInstead).renderHash).toBe(createTagPatternOverlayHashes(replaceOnly).renderHash);
    });

    it("互不影响的 operation 交换物理顺序不改变 render hash", () => {
        const firstPattern = {
            ...pattern("project.first"),
            providerSyntaxRefs: ["syntax.first"],
            providerSyntaxNodes: {"syntax.first": {kind: "novelai-tag-weight" as const, weight: 1.1, resolutionKeys: ["tr-night"]}},
        };
        const secondPattern = {
            ...pattern("project.second"),
            providerSyntaxRefs: ["syntax.second"],
            providerSyntaxNodes: {"syntax.second": {kind: "novelai-tag-weight" as const, weight: 1.1, resolutionKeys: ["tr-night"]}},
        };
        const first = TagPatternOverlaySchema.parse({
            ...overlay(),
            operations: [
                {op: "append", patternId: firstPattern.patternId, pattern: firstPattern},
                {op: "append", patternId: secondPattern.patternId, pattern: secondPattern},
            ],
        });
        const reversed = TagPatternOverlaySchema.parse({...first, operations: [...first.operations].reverse()});

        expect(createTagPatternOverlayHashes(first).renderHash).toBe(createTagPatternOverlayHashes(reversed).renderHash);
    });
});
