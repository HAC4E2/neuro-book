import {z} from "zod";
import {
    hashTextToImageContract,
    type TextToImageContractValue,
} from "nbook/shared/text-to-image-contract-hash";
import {
    createSemanticTagResolutionHash,
    SemanticTagResolutionSchema,
    TextToImageContractHashSchema,
    TextToImageModelScopeSchema,
} from "nbook/shared/text-to-image-tag-resolution";
import {
    createTagPolicyApprovalHash,
    TagPolicyApprovalSchema,
} from "nbook/shared/text-to-image-tag-policy";
import {ProviderSyntaxNodeSchema} from "nbook/shared/text-to-image-provider-registry";
import {StoryboardSourceSchema, StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";

export const TAG_PATTERN_SET_SCHEMA = "nbook.tag-pattern-set/v1" as const;

const PatternReviewSchema = z.discriminatedUnion("status", [
    z.object({status: z.literal("pending")}).strict(),
    z.object({
        status: z.literal("approved"),
        approvedPlanningHash: TextToImageContractHashSchema,
        approvedRenderHash: TextToImageContractHashSchema,
        /** TTP 来源冻结批准时的原始字节 hash；非 TTP 来源固定为 null。 */
        approvedRawSourceHash: TextToImageContractHashSchema.nullable(),
        /** TTP 来源冻结批准时的脱敏归档 hash；非 TTP 来源固定为 null。 */
        approvedSanitizedSourceHash: TextToImageContractHashSchema.nullable(),
    }).strict(),
    z.object({status: z.literal("rejected"), rejectedReason: z.string().trim().min(1).max(500)}).strict(),
]);

export const PatternRetrievalSchema = z.object({
    mode: z.enum(["always", "trigger"]),
    any: z.array(z.string().trim().min(1).max(160)).max(64),
    andAny: z.array(z.string().trim().min(1).max(160)).max(64),
    characterCount: z.object({
        min: z.number().int().min(0).max(32),
        max: z.number().int().min(0).max(32),
    }).strict(),
    canvasIntents: z.array(z.enum(["portrait", "landscape", "square", "character-showcase"])).max(8),
    ratingScopes: z.array(z.enum(["general", "sensitive", "questionable", "explicit"])).min(1).max(4),
    providerKinds: z.tuple([z.literal("novelai")]),
    modelScopes: z.array(TextToImageModelScopeSchema).max(32),
}).strict().superRefine((retrieval, context) => {
    if (retrieval.characterCount.min > retrieval.characterCount.max) {
        context.addIssue({code: "custom", path: ["characterCount", "max"], message: "characterCount.max 不能小于 min"});
    }
    if (retrieval.mode === "always" && (retrieval.any.length > 0 || retrieval.andAny.length > 0)) {
        context.addIssue({code: "custom", message: "always retrieval 不能携带 trigger"});
    }
    if (retrieval.mode === "trigger" && retrieval.any.length === 0 && retrieval.andAny.length === 0) {
        context.addIssue({code: "custom", message: "trigger retrieval 至少需要一个匹配词"});
    }
});

export const PatternIntentSchema = z.object({
    scene: StoryboardStableIdSchema,
    composition: StoryboardStableIdSchema,
    lighting: StoryboardStableIdSchema,
    action: StoryboardStableIdSchema,
}).strict();

export const PatternProvenanceSchema = z.object({
    conversion: z.enum(["direct", "normalized", "derived"]),
    sourcePaths: z.array(z.string().trim().min(1).max(500)).min(1).max(128),
}).strict();

const ResolutionRefArraySchema = z.array(StoryboardStableIdSchema).max(256);

/** 单个可检索组合 Pattern；只持有 scene/composition/lighting/action。 */
export const TagPatternSchema = z.object({
    patternId: StoryboardStableIdSchema,
    sourceEntryId: StoryboardStableIdSchema.optional(),
    order: z.number().int().min(-1000000).max(1000000),
    enabled: z.boolean(),
    retrieval: PatternRetrievalSchema,
    intent: PatternIntentSchema,
    tagResolutions: z.record(StoryboardStableIdSchema, SemanticTagResolutionSchema),
    /** `review_required` 的逐项批准证据；key 必须与当前 Pattern 的 resolution key 相同。 */
    policyApprovals: z.record(StoryboardStableIdSchema, TagPolicyApprovalSchema),
    positive: z.object({
        scene: ResolutionRefArraySchema,
        composition: ResolutionRefArraySchema,
        lighting: ResolutionRefArraySchema,
        action: ResolutionRefArraySchema,
    }).strict(),
    negative: z.object({
        global: ResolutionRefArraySchema,
        characters: ResolutionRefArraySchema,
    }).strict(),
    providerSyntaxRefs: z.array(StoryboardStableIdSchema).max(128),
    providerSyntaxNodes: z.record(StoryboardStableIdSchema, ProviderSyntaxNodeSchema),
    confidence: z.number().min(0).max(1),
    provenance: PatternProvenanceSchema.optional(),
}).strict().superRefine((pattern, context) => {
    const executableRefs = [
        ...pattern.positive.scene,
        ...pattern.positive.composition,
        ...pattern.positive.lighting,
        ...pattern.positive.action,
        ...pattern.negative.global,
        ...pattern.negative.characters,
    ];
    const seen = new Set<string>();
    executableRefs.forEach((key, index) => {
        if (seen.has(key)) {
            context.addIssue({code: "custom", path: ["positive", index], message: `resolution ref ${key} 只能使用一次`});
        }
        seen.add(key);
        if (!(key in pattern.tagResolutions)) {
            context.addIssue({code: "custom", path: ["positive", index], message: `未知 resolution ref：${key}`});
        }
    });
    Object.entries(pattern.tagResolutions).forEach(([key, resolution]) => {
        if (!seen.has(key)) {
            context.addIssue({code: "custom", path: ["tagResolutions", key], message: `可执行 resolution ${key} 未被任何分组引用`});
        }
        if (resolution.modelScope.kind !== "generic-novelai") {
            context.addIssue({code: "custom", path: ["tagResolutions", key, "modelScope"], message: "全局 Pattern 只能保存 generic-novelai resolution"});
        }
    });
    addUniqueIssues(pattern.providerSyntaxRefs, ["providerSyntaxRefs"], "providerSyntaxRef", context);
    const syntaxRefs = new Set(pattern.providerSyntaxRefs);
    pattern.providerSyntaxRefs.forEach((syntaxRef, index) => {
        if (!pattern.providerSyntaxNodes[syntaxRef]) {
            context.addIssue({code: "custom", path: ["providerSyntaxRefs", index], message: `未知 Provider syntax node：${syntaxRef}`});
        }
    });
    Object.entries(pattern.providerSyntaxNodes).forEach(([syntaxKey, node]) => {
        if (!syntaxRefs.has(syntaxKey)) {
            context.addIssue({code: "custom", path: ["providerSyntaxNodes", syntaxKey], message: `Provider syntax node ${syntaxKey} 未被引用`});
        }
        node.resolutionKeys.forEach((resolutionKey, index) => {
            if (!(resolutionKey in pattern.tagResolutions)) {
                context.addIssue({
                    code: "custom",
                    path: ["providerSyntaxNodes", syntaxKey, "resolutionKeys", index],
                    message: `Provider syntax node 引用了未知 resolution：${resolutionKey}`,
                });
            }
        });
    });
});

export type TagPattern = z.infer<typeof TagPatternSchema>;

const PatternRiskSchema = z.object({
    code: StoryboardStableIdSchema,
    severity: z.enum(["info", "warning", "blocking"]),
    path: z.string().trim().min(1).max(500),
    message: z.string().trim().min(1).max(1000),
}).strict();

/** Storyboard companion 的严格 Tag Pattern Set。 */
export const TagPatternSetSchema = z.object({
    schema: z.literal(TAG_PATTERN_SET_SCHEMA),
    patternSetId: StoryboardStableIdSchema,
    presetId: StoryboardStableIdSchema,
    packageId: StoryboardStableIdSchema,
    resourceKey: StoryboardStableIdSchema,
    title: z.string().trim().min(1).max(160),
    enabled: z.boolean(),
    source: StoryboardSourceSchema,
    review: PatternReviewSchema,
    patterns: z.array(TagPatternSchema).max(10000),
    risks: z.array(PatternRiskSchema).max(10000),
}).strict().superRefine((patternSet, context) => {
    if (patternSet.patternSetId !== patternSet.presetId) {
        context.addIssue({code: "custom", path: ["presetId"], message: "presetId 必须与 patternSetId 一致"});
    }
    addUniqueIssues(patternSet.patterns.map((pattern) => pattern.patternId), ["patterns"], "patternId", context);
    patternSet.patterns.forEach((pattern, patternIndex) => {
        const ownerIdentity = `${patternSet.patternSetId}/${pattern.patternId}`;
        const refSlots = createPatternRefSlots(pattern);
        Object.entries(pattern.policyApprovals).forEach(([key, approval]) => {
            const resolution = pattern.tagResolutions[key];
            if (!resolution) {
                context.addIssue({
                    code: "custom",
                    path: ["patterns", patternIndex, "policyApprovals", key],
                    message: `approval 引用了未知 resolution：${key}`,
                });
                return;
            }
            if (approval.resolutionKey !== key) {
                context.addIssue({
                    code: "custom",
                    path: ["patterns", patternIndex, "policyApprovals", key, "resolutionKey"],
                    message: "approval resolutionKey 必须与 map key 一致",
                });
            }
            if (approval.ownerIdentity !== ownerIdentity) {
                context.addIssue({
                    code: "custom",
                    path: ["patterns", patternIndex, "policyApprovals", key, "ownerIdentity"],
                    message: "approval ownerIdentity 必须属于当前 Pattern",
                });
            }
            if (approval.ownerSlot !== refSlots.get(key)) {
                context.addIssue({
                    code: "custom",
                    path: ["patterns", patternIndex, "policyApprovals", key, "ownerSlot"],
                    message: "approval ownerSlot 必须匹配 resolution 所在分组",
                });
            }
            if (approval.policyVersion !== resolution.policyVersion) {
                context.addIssue({
                    code: "custom",
                    path: ["patterns", patternIndex, "policyApprovals", key, "policyVersion"],
                    message: "approval policyVersion 必须匹配 terminal resolution",
                });
            }
            if (approval.sourceTextHash !== hashTextToImageContract({sourceText: resolution.sourceText})) {
                context.addIssue({
                    code: "custom",
                    path: ["patterns", patternIndex, "policyApprovals", key, "sourceTextHash"],
                    message: "approval sourceTextHash 必须绑定 terminal sourceText",
                });
            }
            if (!approvalSubjectMatches(approval.subject, resolution)) {
                context.addIssue({
                    code: "custom",
                    path: ["patterns", patternIndex, "policyApprovals", key, "subject"],
                    message: "approval subject 必须匹配 terminal resolution",
                });
            }
        });
    });
});

export type TagPatternSet = z.infer<typeof TagPatternSetSchema>;
export type TagPatternReviewState = "pending" | "approved" | "stale" | "rejected";

/** 计算 Pattern planning/render 两个独立 hash。 */
export function createTagPatternSetHashes(input: TagPatternSet): {planningHash: string; renderHash: string} {
    const patternSet = TagPatternSetSchema.parse(input);
    const planningPatterns = patternSet.patterns.map(createPatternPlanningValue);
    const renderPatterns = patternSet.patterns.map(createPatternRenderValue);
    return {
        planningHash: hashTextToImageContract({
            schema: patternSet.schema,
            patternSetId: patternSet.patternSetId,
            presetId: patternSet.presetId,
            enabled: patternSet.enabled,
            patterns: planningPatterns,
        }),
        renderHash: hashTextToImageContract({
            schema: patternSet.schema,
            patterns: renderPatterns,
        }),
    };
}

/** 只返回可召回的 enabled Pattern，并使用稳定业务顺序。 */
export function listEnabledTagPatterns(input: TagPatternSet): TagPattern[] {
    return TagPatternSetSchema.parse(input).patterns
        .filter((pattern) => pattern.enabled)
        .sort((left, right) => left.order - right.order || left.patternId.localeCompare(right.patternId));
}

/** 根据当前 planning/render hash 派生批准状态。 */
export function resolveTagPatternReviewState(input: TagPatternSet): TagPatternReviewState {
    const patternSet = TagPatternSetSchema.parse(input);
    if (patternSet.review.status === "pending" || patternSet.review.status === "rejected") {
        return patternSet.review.status;
    }
    if (patternSet.risks.some((risk) => risk.severity === "blocking")) {
        return "pending";
    }
    const sourceMatches = patternSet.source.kind === "ttp"
        ? patternSet.review.approvedRawSourceHash === patternSet.source.rawSourceHash
            && patternSet.review.approvedSanitizedSourceHash === patternSet.source.sanitizedSourceHash
        : patternSet.review.approvedRawSourceHash === null
            && patternSet.review.approvedSanitizedSourceHash === null;
    const hashes = createTagPatternSetHashes(patternSet);
    return sourceMatches
        && patternSet.review.approvedPlanningHash === hashes.planningHash
        && patternSet.review.approvedRenderHash === hashes.renderHash
        ? "approved"
        : "stale";
}

function createPatternPlanningValue(pattern: TagPattern): TextToImageContractValue {
    return {
        patternId: pattern.patternId,
        sourceEntryId: pattern.sourceEntryId ?? null,
        order: pattern.order,
        enabled: pattern.enabled,
        retrieval: {
            mode: pattern.retrieval.mode,
            any: [...pattern.retrieval.any],
            andAny: [...pattern.retrieval.andAny],
            characterCount: {...pattern.retrieval.characterCount},
            canvasIntents: [...pattern.retrieval.canvasIntents],
            ratingScopes: [...pattern.retrieval.ratingScopes],
            providerKinds: [...pattern.retrieval.providerKinds],
            modelScopes: pattern.retrieval.modelScopes.map((scope): TextToImageContractValue => scope.kind === "generic-novelai"
                ? {kind: scope.kind}
                : {kind: scope.kind, modelId: scope.modelId}),
        },
        intent: {...pattern.intent},
    };
}

function createPatternRenderValue(pattern: TagPattern): TextToImageContractValue {
    return {
        positive: {
            scene: [...pattern.positive.scene],
            composition: [...pattern.positive.composition],
            lighting: [...pattern.positive.lighting],
            action: [...pattern.positive.action],
        },
        negative: {
            global: [...pattern.negative.global],
            characters: [...pattern.negative.characters],
        },
        tagResolutionHashes: Object.fromEntries(Object.entries(pattern.tagResolutions).map(([key, resolution]) => [
            key,
            createSemanticTagResolutionHash(resolution),
        ])),
        policyApprovalHashes: Object.fromEntries(Object.entries(pattern.policyApprovals).map(([key, approval]) => [
            key,
            createTagPolicyApprovalHash(approval),
        ])),
        providerSyntaxRefs: [...pattern.providerSyntaxRefs],
        providerSyntaxNodes: pattern.providerSyntaxNodes,
    };
}

/** 单个 Pattern 的执行 render hash；Compiler 只冻结 shot 实际引用的 Pattern。 */
export function createTagPatternRenderHash(input: TagPattern): string {
    return hashTextToImageContract(createPatternRenderValue(TagPatternSchema.parse(input)));
}

/** resolution key 在一个 Pattern 内只能属于一个 canonical owner slot。 */
function createPatternRefSlots(pattern: TagPattern): Map<string, string> {
    return new Map([
        ...pattern.positive.scene.map((key) => [key, "pattern:scene"] as const),
        ...pattern.positive.composition.map((key) => [key, "pattern:composition"] as const),
        ...pattern.positive.lighting.map((key) => [key, "pattern:lighting"] as const),
        ...pattern.positive.action.map((key) => [key, "pattern:action"] as const),
        ...pattern.negative.global.map((key) => [key, "pattern:negative_global"] as const),
        ...pattern.negative.characters.map((key) => [key, "pattern:negative_character"] as const),
    ]);
}

/** approval subject 不能借 canonical/passthrough 形态变化复用。 */
function approvalSubjectMatches(
    subject: z.infer<typeof TagPolicyApprovalSchema>["subject"],
    resolution: z.infer<typeof SemanticTagResolutionSchema>,
): boolean {
    if (subject.kind === "provider_passthrough") {
        return resolution.kind === "provider_passthrough"
            && subject.validationTextHash === resolution.validationTextHash;
    }
    return resolution.kind !== "provider_passthrough"
        && subject.tagId === resolution.canonical.tagId
        && subject.canonicalName === resolution.canonical.canonicalName;
}

function addUniqueIssues(values: string[], path: Array<string | number>, label: string, context: z.RefinementCtx): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (seen.has(value)) {
            context.addIssue({code: "custom", path: [...path, index], message: `${label} 必须唯一`});
        }
        seen.add(value);
    });
}
