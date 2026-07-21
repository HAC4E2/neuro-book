import {z} from "zod";
import {TextToImageContractHashSchema, TextToImageModelScopeSchema} from "nbook/shared/text-to-image-tag-resolution";
import {PatternIntentSchema} from "nbook/shared/text-to-image-tag-pattern";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";

export const TAG_PATTERN_RETRIEVAL_POLICY_VERSION = "nbook-pattern-retrieval-v1" as const;

const PatternIntentFilterSchema = PatternIntentSchema.partial().strict().refine(
    (value) => Object.keys(value).length > 0,
    "intent 至少包含一个已注册维度",
);

/** Director 可请求的有限 Pattern 检索上下文。 */
export const TagPatternSearchRequestSchema = z.object({
    query: z.string().trim().min(1).max(500),
    intent: PatternIntentFilterSchema.optional(),
    applicability: z.object({
        characterCount: z.number().int().min(0).max(32),
        /** null 表示规划前尚未决定画幅，只应用其它硬过滤。 */
        canvasIntent: z.enum(["portrait", "landscape", "square", "character-showcase"]).nullable(),
        ratingScope: z.enum(["general", "sensitive", "questionable", "explicit"]),
        providerKind: z.literal("novelai"),
        modelScope: TextToImageModelScopeSchema,
    }).strict(),
    limit: z.number().int().min(1).max(8),
}).strict();

export type TagPatternSearchRequest = z.infer<typeof TagPatternSearchRequestSchema>;

const ResolutionRefsSchema = z.object({
    positive: z.object({
        scene: z.array(StoryboardStableIdSchema).max(256),
        composition: z.array(StoryboardStableIdSchema).max(256),
        lighting: z.array(StoryboardStableIdSchema).max(256),
        action: z.array(StoryboardStableIdSchema).max(256),
    }).strict(),
    negative: z.object({
        global: z.array(StoryboardStableIdSchema).max(256),
        characters: z.array(StoryboardStableIdSchema).max(256),
    }).strict(),
}).strict();

export const TagPatternCandidateProvenanceSchema = z.object({
    scope: z.enum(["base", "project"]),
    operation: z.enum(["base", "replace", "disable", "append"]),
    /** Pattern 没有来源 entry 时固定为 null。 */
    sourceEntryId: StoryboardStableIdSchema.nullable(),
}).strict();

/** Agent 只读的 planning candidate；不含自由 Prompt、权重语法或生成参数。 */
export const TagPatternCandidateSummarySchema = z.object({
    patternId: StoryboardStableIdSchema,
    sourceEntryId: StoryboardStableIdSchema.nullable(),
    order: z.number().int().min(-1000000).max(1000000),
    intent: PatternIntentSchema,
    applicability: z.object({
        characterCount: z.object({min: z.number().int().min(0).max(32), max: z.number().int().min(0).max(32)}).strict(),
        canvasIntents: z.array(z.enum(["portrait", "landscape", "square", "character-showcase"])).max(8),
        ratingScopes: z.array(z.enum(["general", "sensitive", "questionable", "explicit"])).max(4),
        providerKinds: z.tuple([z.literal("novelai")]),
        modelScopes: z.array(TextToImageModelScopeSchema).max(32),
    }).strict(),
    resolutionRefs: ResolutionRefsSchema,
    provenance: TagPatternCandidateProvenanceSchema,
    match: z.object({
        score: z.number().int().min(0).max(1000),
        reasons: z.array(z.enum([
            "always",
            "trigger_exact",
            "trigger_any",
            "trigger_all",
            "intent",
        ])).min(1).max(8),
    }).strict(),
}).strict();

export type TagPatternCandidateSummary = z.infer<typeof TagPatternCandidateSummarySchema>;

/** 一次检索冻结的闭集；candidateSetHash 不吸收 render-only resolution 内容。 */
export const TagPatternCandidateSetSchema = z.object({
    schemaVersion: z.literal("nbook.tag-pattern-candidate-set/v1"),
    retrievalPolicyVersion: z.literal(TAG_PATTERN_RETRIEVAL_POLICY_VERSION),
    effectivePlanningHash: TextToImageContractHashSchema,
    requestHash: TextToImageContractHashSchema,
    candidateSetHash: TextToImageContractHashSchema,
    candidates: z.array(TagPatternCandidateSummarySchema).max(8),
}).strict();

export type TagPatternCandidateSet = z.infer<typeof TagPatternCandidateSetSchema>;
