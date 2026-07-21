import {z} from "zod";
import {canonicalizeTextToImageContract, hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const STORYBOARD_PRESET_SCHEMA = "nbook.storyboard-preset/v1" as const;
export const STORYBOARD_OVERLAY_SCHEMA = "nbook.storyboard-overlay/v1" as const;

export const StoryboardStableIdSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const StoryboardSourceSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("chatu8"),
        importId: StoryboardStableIdSchema,
        rawSourceHash: TextToImageContractHashSchema,
        sanitizedSourceHash: TextToImageContractHashSchema,
        converterVersion: z.string().trim().min(1).max(80),
    }).strict(),
    z.object({
        kind: z.literal("builtin"),
        assetVersion: z.string().trim().min(1).max(80),
    }).strict(),
    z.object({
        kind: z.literal("manual"),
    }).strict(),
]);

const StoryboardReviewSchema = z.discriminatedUnion("status", [
    z.object({status: z.literal("pending")}).strict(),
    z.object({
        status: z.literal("approved"),
        approvedSemanticHash: TextToImageContractHashSchema,
        approvedDiagnosticHash: TextToImageContractHashSchema,
        /** Chatu8 来源冻结批准时的原始字节 hash；非 Chatu8 来源固定为 null。 */
        approvedRawSourceHash: TextToImageContractHashSchema.nullable(),
        /** Chatu8 来源冻结批准时的脱敏归档 hash；非 Chatu8 来源固定为 null。 */
        approvedSanitizedSourceHash: TextToImageContractHashSchema.nullable(),
    }).strict(),
    z.object({
        status: z.literal("rejected"),
        rejectedReason: z.string().trim().min(1).max(500),
    }).strict(),
]);

const StoryboardOverlayReviewSchema = z.discriminatedUnion("status", [
    z.object({status: z.literal("pending")}).strict(),
    z.object({status: z.literal("approved"), approvedSemanticHash: TextToImageContractHashSchema}).strict(),
    z.object({status: z.literal("rejected"), rejectedReason: z.string().trim().min(1).max(500)}).strict(),
]);

export const StoryboardWhenSchema = z.object({
    mode: z.enum(["always", "trigger"]),
    any: z.array(z.string().trim().min(1).max(160)).max(64),
    andAny: z.array(z.string().trim().min(1).max(160)).max(64),
}).strict().superRefine((when, context) => {
    if (when.mode === "always" && (when.any.length > 0 || when.andAny.length > 0)) {
        context.addIssue({code: "custom", message: "always trigger 不能携带匹配词"});
    }
    if (when.mode === "trigger" && when.any.length === 0 && when.andAny.length === 0) {
        context.addIssue({code: "custom", message: "trigger 至少需要一个匹配词"});
    }
});

export const StoryboardRuleProvenanceSchema = z.object({
    conversion: z.enum(["direct", "normalized", "derived"]),
    sourcePaths: z.array(z.string().trim().min(1).max(500)).min(1).max(128),
}).strict();

const RuleBaseShape = {
    ruleId: StoryboardStableIdSchema,
    sourceEntryId: StoryboardStableIdSchema.optional(),
    order: z.number().int().min(-1000000).max(1000000),
    enabled: z.boolean(),
    when: StoryboardWhenSchema,
    provenance: StoryboardRuleProvenanceSchema.optional(),
} as const;

export const ShotSelectionEffectSchema = z.object({
    operation: z.enum(["prefer", "require", "avoid"]),
    beatTypes: z.array(z.enum(["establishing", "action", "reaction", "reveal", "dialogue", "transition", "detail"])).min(1).max(16),
    distribution: z.enum(["even", "front-loaded", "back-loaded", "balanced"]),
    scoreDelta: z.number().int().min(-100).max(100),
    minimumGap: z.number().int().min(0).max(100).optional(),
}).strict();

const ShotSelectionRuleSchema = z.object({
    ...RuleBaseShape,
    kind: z.literal("shot-selection"),
    effect: ShotSelectionEffectSchema,
}).strict();

export const ShotDensityEffectSchema = z.object({
    preferredMin: z.number().int().min(0).max(100),
    preferredMax: z.number().int().min(0).max(100),
    charactersPerShot: z.object({
        min: z.number().int().min(0).max(32),
        max: z.number().int().min(0).max(32),
    }).strict(),
}).strict().superRefine((effect, context) => {
    if (effect.preferredMin > effect.preferredMax) {
        context.addIssue({code: "custom", path: ["preferredMax"], message: "preferredMax 不能小于 preferredMin"});
    }
    if (effect.charactersPerShot.min > effect.charactersPerShot.max) {
        context.addIssue({code: "custom", path: ["charactersPerShot", "max"], message: "角色数 max 不能小于 min"});
    }
});

const ShotDensityRuleSchema = z.object({
    ...RuleBaseShape,
    kind: z.literal("shot-density"),
    effect: ShotDensityEffectSchema,
}).strict();

export const CompositionEffectSchema = z.object({
    shotSize: z.enum(["extreme-wide", "wide", "medium", "close-up", "extreme-close-up"]).optional(),
    cameraAngle: z.enum(["eye-level", "high", "low", "bird-eye", "dutch"]).optional(),
    viewpoint: z.enum(["objective", "subjective", "over-shoulder"]).optional(),
    subjectPlacement: z.enum(["center", "rule-of-thirds", "symmetrical", "dynamic"]).optional(),
    depth: z.enum(["flat", "layered", "deep"]).optional(),
    lighting: z.enum(["natural", "soft", "hard", "backlit", "rim", "low-key", "high-key"]).optional(),
    temporalMode: z.literal("single-instant").optional(),
    maxSubjects: z.number().int().min(1).max(32).optional(),
    avoidCompoundActions: z.boolean().optional(),
}).strict();

const CompositionRuleSchema = z.object({
    ...RuleBaseShape,
    kind: z.literal("composition"),
    effect: CompositionEffectSchema,
}).strict();

export const CanvasIntentEffectSchema = z.object({
    canvasIntent: z.enum(["portrait", "landscape", "square", "character-showcase"]),
}).strict();

const CanvasIntentRuleSchema = z.object({
    ...RuleBaseShape,
    kind: z.literal("canvas-intent"),
    effect: CanvasIntentEffectSchema,
}).strict();

export const ContinuityEffectSchema = z.object({
    lockCharacterTraits: z.boolean().optional(),
    lockOutfit: z.boolean().optional(),
    palette: z.string().trim().min(1).max(160).optional(),
    timeOfDay: z.string().trim().min(1).max(160).optional(),
    axisPolicy: z.enum(["preserve", "allow-crossing", "not-applicable"]).optional(),
}).strict();

const ContinuityRuleSchema = z.object({
    ...RuleBaseShape,
    kind: z.literal("continuity"),
    effect: ContinuityEffectSchema,
}).strict();

export const TagPolicyEffectSchema = z.object({
    operation: z.enum(["require", "prefer", "avoid", "forbid"]),
    category: z.enum(["scene", "composition", "lighting", "action", "character", "rating", "provider"]).optional(),
    resolutionRefs: z.array(StoryboardStableIdSchema).max(128),
}).strict();

const TagPolicyRuleSchema = z.object({
    ...RuleBaseShape,
    kind: z.literal("tag-policy"),
    effect: TagPolicyEffectSchema,
}).strict();

export const ConstraintEffectSchema = z.object({
    maxSubjects: z.number().int().min(1).max(32).optional(),
    forbidDuplicateBeat: z.boolean().optional(),
    requireValidAnchor: z.boolean().optional(),
}).strict();

const ConstraintRuleSchema = z.object({
    ...RuleBaseShape,
    kind: z.literal("constraint"),
    effect: ConstraintEffectSchema,
}).strict();

/** Storyboard 首版七类严格规则；生成参数不属于任一 effect。 */
export const StoryboardRuleSchema = z.discriminatedUnion("kind", [
    ShotSelectionRuleSchema,
    ShotDensityRuleSchema,
    CompositionRuleSchema,
    CanvasIntentRuleSchema,
    ContinuityRuleSchema,
    TagPolicyRuleSchema,
    ConstraintRuleSchema,
]);

export type StoryboardRule = z.infer<typeof StoryboardRuleSchema>;

const StoryboardRiskSchema = z.object({
    code: StoryboardStableIdSchema,
    severity: z.enum(["info", "warning", "blocking"]),
    path: z.string().trim().min(1).max(500),
    message: z.string().trim().min(1).max(1000),
}).strict();

const StoryboardUnresolvedMacroSchema = z.object({
    token: z.string().min(1).max(500),
    path: z.string().trim().min(1).max(500),
    classification: z.enum(["stochastic", "tag-fragment", "identity", "ambiguous", "unknown"]),
    blocking: z.boolean(),
}).strict();

const MacroBindingSchema = z.enum([
    "chapter.markdown",
    "chapter.compiledContext",
    "invocation.request",
    "actor.displayName",
]);

/** 可发布的 Storyboard Preset frontmatter 合同。 */
export const StoryboardPresetSchema = z.object({
    schema: z.literal(STORYBOARD_PRESET_SCHEMA),
    presetId: StoryboardStableIdSchema,
    patternSetId: StoryboardStableIdSchema,
    packageId: StoryboardStableIdSchema,
    resourceKey: StoryboardStableIdSchema,
    title: z.string().trim().min(1).max(160),
    enabled: z.boolean(),
    source: StoryboardSourceSchema,
    review: StoryboardReviewSchema,
    matching: z.object({normalization: z.literal("nfkc-casefold")}).strict(),
    defaults: z.object({
        preferredShotCount: z.object({
            min: z.number().int().min(0).max(100),
            max: z.number().int().min(0).max(100),
        }).strict(),
        minimumParagraphGap: z.number().int().min(0).max(100),
    }).strict(),
    macros: z.object({
        bindings: z.record(z.string().trim().min(1).max(160), MacroBindingSchema),
        unresolved: z.array(StoryboardUnresolvedMacroSchema).max(256),
    }).strict(),
    rules: z.array(StoryboardRuleSchema).max(10000),
    risks: z.array(StoryboardRiskSchema).max(10000),
}).strict().superRefine((preset, context) => {
    if (preset.presetId !== preset.patternSetId) {
        context.addIssue({code: "custom", path: ["patternSetId"], message: "patternSetId 必须与 presetId 一致"});
    }
    if (preset.defaults.preferredShotCount.min > preset.defaults.preferredShotCount.max) {
        context.addIssue({code: "custom", path: ["defaults", "preferredShotCount", "max"], message: "镜头数 max 不能小于 min"});
    }
    addDuplicateIssues(preset.rules.map((rule) => rule.ruleId), ["rules"], "ruleId", context);
});

export type StoryboardPreset = z.infer<typeof StoryboardPresetSchema>;

const StoryboardOverlayOperationSchema = z.discriminatedUnion("op", [
    z.object({op: z.literal("replace"), ruleId: StoryboardStableIdSchema, rule: StoryboardRuleSchema}).strict(),
    z.object({op: z.literal("disable"), ruleId: StoryboardStableIdSchema}).strict(),
    z.object({op: z.literal("append"), ruleId: StoryboardStableIdSchema, rule: StoryboardRuleSchema}).strict(),
]);

/** Project Storyboard 增量覆盖合同。 */
export const StoryboardOverlaySchema = z.object({
    schema: z.literal(STORYBOARD_OVERLAY_SCHEMA),
    overlayId: StoryboardStableIdSchema,
    presetId: StoryboardStableIdSchema,
    enabled: z.boolean(),
    baseSemanticHash: TextToImageContractHashSchema,
    review: StoryboardOverlayReviewSchema,
    macroBindings: z.record(z.string().trim().min(1).max(160), MacroBindingSchema),
    operations: z.array(StoryboardOverlayOperationSchema).max(10000),
}).strict().superRefine((overlay, context) => {
    addDuplicateIssues(overlay.operations.map((operation) => operation.ruleId), ["operations"], "operation ruleId", context);
    overlay.operations.forEach((operation, index) => {
        if (operation.op !== "disable" && operation.rule.ruleId !== operation.ruleId) {
            context.addIssue({
                code: "custom",
                path: ["operations", index, "rule", "ruleId"],
                message: "内嵌 ruleId 必须与 operation ruleId 一致",
            });
        }
    });
});

export type StoryboardOverlay = z.infer<typeof StoryboardOverlaySchema>;
export type StoryboardReviewState = "pending" | "approved" | "stale" | "rejected";

/** 计算分镜语义与诊断分域 hash。 */
export function createStoryboardPresetHashes(input: StoryboardPreset): {semanticHash: string; diagnosticHash: string} {
    const preset = StoryboardPresetSchema.parse(input);
    const semanticRules = preset.rules.map(({provenance: _provenance, ...rule}) => rule);
    const diagnosticRisks = [...preset.risks].sort(compareCanonical);
    const unresolvedMacros = [...preset.macros.unresolved].sort(compareCanonical);
    const conversions = preset.rules.flatMap((rule) => rule.provenance ? [{
        ruleId: rule.ruleId,
        conversion: rule.provenance.conversion,
        sourcePaths: [...rule.provenance.sourcePaths].sort(),
    }] : []).sort(compareCanonical);
    return {
        semanticHash: hashTextToImageContract({
            schema: preset.schema,
            presetId: preset.presetId,
            patternSetId: preset.patternSetId,
            enabled: preset.enabled,
            matching: preset.matching,
            defaults: preset.defaults,
            macroBindings: preset.macros.bindings,
            rules: semanticRules,
        }),
        diagnosticHash: hashTextToImageContract({
            risks: diagnosticRisks,
            unresolvedMacros,
            conversions,
        }),
    };
}

/** 根据当前内容 hash 派生审批状态；approved 内容漂移时一律 stale。 */
export function resolveStoryboardReviewState(input: StoryboardPreset): StoryboardReviewState {
    const preset = StoryboardPresetSchema.parse(input);
    if (preset.review.status === "pending" || preset.review.status === "rejected") {
        return preset.review.status;
    }
    if (preset.risks.some((risk) => risk.severity === "blocking")
        || preset.macros.unresolved.some((macro) => macro.blocking)) {
        return "pending";
    }
    const sourceMatches = preset.source.kind === "chatu8"
        ? preset.review.approvedRawSourceHash === preset.source.rawSourceHash
            && preset.review.approvedSanitizedSourceHash === preset.source.sanitizedSourceHash
        : preset.review.approvedRawSourceHash === null
            && preset.review.approvedSanitizedSourceHash === null;
    const hashes = createStoryboardPresetHashes(preset);
    return sourceMatches
        && preset.review.approvedSemanticHash === hashes.semanticHash
        && preset.review.approvedDiagnosticHash === hashes.diagnosticHash
        ? "approved"
        : "stale";
}

/** 计算 Project Storyboard overlay 的可批准语义 hash。 */
export function createStoryboardOverlaySemanticHash(input: StoryboardOverlay): string {
    const overlay = StoryboardOverlaySchema.parse(input);
    const operations = overlay.operations.map((operation) => {
        if (operation.op === "disable") {
            return operation;
        }
        const {provenance: _provenance, ...rule} = operation.rule;
        return {...operation, rule};
    });
    return hashTextToImageContract({
        schema: overlay.schema,
        overlayId: overlay.overlayId,
        presetId: overlay.presetId,
        enabled: overlay.enabled,
        baseSemanticHash: overlay.baseSemanticHash,
        macroBindings: overlay.macroBindings,
        operations,
    });
}

/** Overlay 的 approved hash 漂移时返回 stale。 */
export function resolveStoryboardOverlayReviewState(input: StoryboardOverlay): StoryboardReviewState {
    const overlay = StoryboardOverlaySchema.parse(input);
    if (overlay.review.status === "pending" || overlay.review.status === "rejected") {
        return overlay.review.status;
    }
    return overlay.review.approvedSemanticHash === createStoryboardOverlaySemanticHash(overlay) ? "approved" : "stale";
}

function compareCanonical(left: object, right: object): number {
    return canonicalizeTextToImageContract({...left}).localeCompare(canonicalizeTextToImageContract({...right}));
}

function addDuplicateIssues(
    values: string[],
    path: Array<string | number>,
    label: string,
    context: z.RefinementCtx,
): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (seen.has(value)) {
            context.addIssue({code: "custom", path: [...path, index], message: `${label} 必须唯一`});
        }
        seen.add(value);
    });
}
