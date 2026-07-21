import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    CanvasIntentEffectSchema,
    CompositionEffectSchema,
    ConstraintEffectSchema,
    ContinuityEffectSchema,
    ShotDensityEffectSchema,
    ShotSelectionEffectSchema,
    StoryboardRuleProvenanceSchema,
    StoryboardSourceSchema,
    StoryboardStableIdSchema,
    StoryboardWhenSchema,
    TagPolicyEffectSchema,
} from "nbook/shared/text-to-image-storyboard-preset";
import {
    ImportDiagnosticSchema,
    PendingTagAtomSchema,
} from "nbook/shared/text-to-image-storyboard-import";
import {
    PatternIntentSchema,
    PatternProvenanceSchema,
    PatternRetrievalSchema,
} from "nbook/shared/text-to-image-tag-pattern";

export const PENDING_TAG_PATTERN_SET_SCHEMA = "nbook.pending-tag-pattern-set/v1" as const;

const RuleCandidateBaseShape = {
    sourceEntryId: StoryboardStableIdSchema,
    order: z.number().int().min(-1000000).max(1000000),
    enabled: z.boolean(),
    when: StoryboardWhenSchema,
    provenance: StoryboardRuleProvenanceSchema,
} as const;

const BeatSlotSchema = z.enum([
    "primary",
    "establishing",
    "action",
    "reaction",
    "reveal",
    "dialogue",
    "transition",
    "detail",
]);

/** Director 可输出的首版注册规则槽位；最终 ruleId 由服务端分配。 */
export const StoryboardRuleCandidateSchema = z.discriminatedUnion("kind", [
    z.object({
        ...RuleCandidateBaseShape,
        kind: z.literal("shot-selection"),
        semanticSlot: BeatSlotSchema,
        effect: ShotSelectionEffectSchema,
    }).strict(),
    z.object({
        ...RuleCandidateBaseShape,
        kind: z.literal("shot-density"),
        semanticSlot: z.enum(["primary", "minimum", "preferred", "maximum"]),
        effect: ShotDensityEffectSchema,
    }).strict(),
    z.object({
        ...RuleCandidateBaseShape,
        kind: z.literal("composition"),
        semanticSlot: BeatSlotSchema,
        effect: CompositionEffectSchema,
    }).strict(),
    z.object({
        ...RuleCandidateBaseShape,
        kind: z.literal("canvas-intent"),
        semanticSlot: z.enum(["primary", "character-showcase", "environment"]),
        effect: CanvasIntentEffectSchema,
    }).strict(),
    z.object({
        ...RuleCandidateBaseShape,
        kind: z.literal("continuity"),
        semanticSlot: z.enum(["primary", "character", "outfit", "palette", "spatial", "temporal"]),
        effect: ContinuityEffectSchema,
    }).strict(),
    z.object({
        ...RuleCandidateBaseShape,
        kind: z.literal("tag-policy"),
        semanticSlot: z.enum(["primary", "scene", "composition", "lighting", "action", "character", "rating", "provider"]),
        effect: TagPolicyEffectSchema.extend({
            /** terminal resolution 尚不存在时，Director 不得提前发明 resolution ref。 */
            resolutionRefs: z.array(StoryboardStableIdSchema).max(0),
        }).strict(),
    }).strict(),
    z.object({
        ...RuleCandidateBaseShape,
        kind: z.literal("constraint"),
        semanticSlot: z.enum(["primary", "subject-count", "beat-uniqueness", "anchor-validity"]),
        effect: ConstraintEffectSchema,
    }).strict(),
]);

export type StoryboardRuleCandidate = z.infer<typeof StoryboardRuleCandidateSchema>;

const PendingPatternTagTextSchema = z.array(z.string().trim().min(1).max(500)).max(512);

/** Director 的 Pattern proposal 只含待解析原子，不含最终 resolution 或最终 Prompt。 */
export const TagPatternCandidateSchema = z.object({
    patternKind: z.literal("scene-recipe"),
    semanticSlot: BeatSlotSchema,
    sourceEntryId: StoryboardStableIdSchema,
    sourcePath: z.string().startsWith("/").max(1000),
    order: z.number().int().min(-1000000).max(1000000),
    enabled: z.boolean(),
    retrieval: PatternRetrievalSchema,
    intent: PatternIntentSchema,
    tags: z.object({
        scene: PendingPatternTagTextSchema,
        composition: PendingPatternTagTextSchema,
        lighting: PendingPatternTagTextSchema,
        action: PendingPatternTagTextSchema,
        negativeGlobal: PendingPatternTagTextSchema,
        negativeCharacter: PendingPatternTagTextSchema,
    }).strict(),
    confidence: z.number().min(0).max(1),
    provenance: PatternProvenanceSchema,
}).strict();

export type TagPatternCandidate = z.infer<typeof TagPatternCandidateSchema>;

/** Recipe 只读 proposal 的 Agent 输入；proposalId 同样由服务端分配。 */
export const RecipeStyleCandidateSchema = z.object({
    sourceEntryId: StoryboardStableIdSchema,
    sourcePath: z.string().startsWith("/").max(1000),
    positiveAtoms: PendingPatternTagTextSchema,
    negativeAtoms: PendingPatternTagTextSchema,
    ignoredProviderParameters: PendingPatternTagTextSchema,
    summary: z.string().trim().min(1).max(1000),
}).strict();

export type RecipeStyleCandidate = z.infer<typeof RecipeStyleCandidateSchema>;

const PendingTagGroupsSchema = z.object({
    scene: z.array(PendingTagAtomSchema).max(512),
    composition: z.array(PendingTagAtomSchema).max(512),
    lighting: z.array(PendingTagAtomSchema).max(512),
    action: z.array(PendingTagAtomSchema).max(512),
    negativeGlobal: z.array(PendingTagAtomSchema).max(512),
    negativeCharacter: z.array(PendingTagAtomSchema).max(512),
}).strict();

/** 尚未经过 active Tag index 的 Pattern；该结构不能作为最终 TagPatternSet 解析。 */
export const PendingTagPatternSchema = z.object({
    patternId: StoryboardStableIdSchema,
    patternKind: z.literal("scene-recipe"),
    semanticSlot: BeatSlotSchema,
    sourceEntryId: StoryboardStableIdSchema,
    order: z.number().int().min(-1000000).max(1000000),
    enabled: z.boolean(),
    retrieval: PatternRetrievalSchema,
    intent: PatternIntentSchema,
    pendingTags: PendingTagGroupsSchema,
    confidence: z.number().min(0).max(1),
    provenance: PatternProvenanceSchema,
}).strict();

export type PendingTagPattern = z.infer<typeof PendingTagPatternSchema>;

const PendingPatternRiskSchema = z.object({
    code: StoryboardStableIdSchema,
    severity: z.enum(["info", "warning", "blocking"]),
    path: z.string().trim().min(1).max(1000),
    message: z.string().trim().min(1).max(1000),
}).strict();

/** 与 Storyboard candidate 成对持久化的 pending Pattern companion。 */
export const PendingTagPatternSetSchema = z.object({
    schema: z.literal(PENDING_TAG_PATTERN_SET_SCHEMA),
    state: z.literal("pending_unresolved"),
    patternSetId: StoryboardStableIdSchema,
    presetId: StoryboardStableIdSchema,
    packageId: StoryboardStableIdSchema,
    resourceKey: StoryboardStableIdSchema,
    title: z.string().trim().min(1).max(160),
    enabled: z.boolean(),
    source: StoryboardSourceSchema,
    review: z.object({status: z.literal("pending_unresolved")}).strict(),
    patterns: z.array(PendingTagPatternSchema).max(10000),
    risks: z.array(PendingPatternRiskSchema).max(10000),
}).strict().superRefine((patternSet, context) => {
    if (patternSet.patternSetId !== patternSet.presetId) {
        context.addIssue({code: "custom", path: ["presetId"], message: "presetId 必须与 patternSetId 一致"});
    }
    const seen = new Set<string>();
    patternSet.patterns.forEach((pattern, index) => {
        if (seen.has(pattern.patternId)) {
            context.addIssue({code: "custom", path: ["patterns", index, "patternId"], message: "patternId 必须唯一"});
        }
        seen.add(pattern.patternId);
    });
});

export type PendingTagPatternSet = z.infer<typeof PendingTagPatternSetSchema>;

/** 计算 pending Pattern 的 planning/render hash；未解析 Tag 只进入 render 分域。 */
export function createPendingTagPatternHashes(input: PendingTagPatternSet): {planningHash: string; renderHash: string} {
    const patternSet = PendingTagPatternSetSchema.parse(input);
    const ordered = [...patternSet.patterns].sort(comparePendingPattern);
    return {
        planningHash: hashTextToImageContract({
            schema: patternSet.schema,
            patternSetId: patternSet.patternSetId,
            presetId: patternSet.presetId,
            enabled: patternSet.enabled,
            patterns: ordered.map((pattern) => ({
                patternId: pattern.patternId,
                order: pattern.order,
                enabled: pattern.enabled,
                retrieval: pattern.retrieval,
                intent: pattern.intent,
                confidence: pattern.confidence,
            })),
        }),
        renderHash: hashTextToImageContract({
            schema: patternSet.schema,
            patternSetId: patternSet.patternSetId,
            patterns: ordered.map((pattern) => ({
                patternId: pattern.patternId,
                enabled: pattern.enabled,
                pendingTags: pattern.pendingTags,
            })),
        }),
    };
}

/** Conversion output 的诊断也必须经过共享 strict schema。 */
export const StoryboardConversionDiagnosticSchema = ImportDiagnosticSchema;

function comparePendingPattern(left: PendingTagPattern, right: PendingTagPattern): number {
    return left.order - right.order || left.patternId.localeCompare(right.patternId);
}
