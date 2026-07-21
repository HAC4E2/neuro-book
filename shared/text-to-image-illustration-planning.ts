import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {TagPatternCandidateSetSchema} from "nbook/shared/text-to-image-tag-pattern-retrieval";
import {SemanticTagResolutionSchema, TextToImageContractHashSchema, TextToImageModelScopeSchema} from "nbook/shared/text-to-image-tag-resolution";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {ProjectTagPolicyConfigSchema} from "nbook/shared/text-to-image-tag-policy";
import type {TextToImageRecipeSnapshot} from "nbook/shared/text-to-image-recipe";

export const ILLUSTRATION_CHAPTER_PARSER_VERSION = "nbook-illustration-chapter-parser-v1" as const;
export const ILLUSTRATION_PLAN_VALIDATOR_VERSION = "nbook-illustration-plan-validator-v1" as const;
export const ILLUSTRATION_MAX_PLANNING_SUBJECTS = 8 as const;

/** 从 RecipeSnapshot 派生 Planning 唯一约束摘要；Planning 与 Execution stale check 共用。 */
export function createIllustrationRecipePlanningConstraints(recipe: TextToImageRecipeSnapshot): {
    constraintsHash: string;
    allowedCanvasIntents: Array<"portrait" | "landscape" | "square">;
    maxSubjects: typeof ILLUSTRATION_MAX_PLANNING_SUBJECTS;
} {
    const allowedCanvasIntents: Array<"portrait" | "landscape" | "square"> = recipe.dimensions.mode === "byIntent"
        ? ["portrait", "landscape", "square"]
        : [recipe.dimensions.fixed.width === recipe.dimensions.fixed.height
            ? "square"
            : recipe.dimensions.fixed.width > recipe.dimensions.fixed.height ? "landscape" : "portrait"];
    return {
        constraintsHash: hashTextToImageContract({
            recipePlanningConstraintsHash: recipe.planningConstraintsHash,
            allowedCanvasIntents,
            maxSubjects: ILLUSTRATION_MAX_PLANNING_SUBJECTS,
        }),
        allowedCanvasIntents,
        maxSubjects: ILLUSTRATION_MAX_PLANNING_SUBJECTS,
    };
}

export const IllustrationPlanningOperationSchema = z.enum(["plan-chapter", "plan-selection", "review-candidates"]);
export type IllustrationPlanningOperation = z.infer<typeof IllustrationPlanningOperationSchema>;

export const IllustrationAnchorIdSchema = z.string().regex(/^[phlq]_[0-9]{4}_[a-f0-9]{8}$/u);

export const IllustrationSelectionInputSchema = z.object({
    selectedText: z.string().min(1).max(100000),
    lineRange: z.object({
        startLine: z.number().int().min(1).max(10000000),
        endLine: z.number().int().min(1).max(10000000),
    }).strict(),
    /** 仅用于服务端定位；不进入 selectionHash。 */
    textRange: z.object({
        startOffset: z.number().int().min(0).max(1000000000),
        endOffset: z.number().int().min(0).max(1000000000),
    }).strict().optional(),
    chapterFileHash: TextToImageContractHashSchema,
}).strict().superRefine((input, context) => {
    if (input.lineRange.startLine > input.lineRange.endLine) {
        context.addIssue({code: "custom", path: ["lineRange", "endLine"], message: "endLine 不能小于 startLine"});
    }
    if (input.textRange && input.textRange.startOffset >= input.textRange.endOffset) {
        context.addIssue({code: "custom", path: ["textRange", "endOffset"], message: "endOffset 必须大于 startOffset"});
    }
});

export type IllustrationSelectionInput = z.infer<typeof IllustrationSelectionInputSchema>;

const PlanningVersionSchema = z.string().trim().min(1).max(160);

/** Planning run 绑定的 immutable Tag index / Resolver 合同。 */
export const IllustrationPlanningTagQuerySnapshotSchema = z.object({
    indexVersion: PlanningVersionSchema,
    manifestHash: TextToImageContractHashSchema,
    policyVersion: PlanningVersionSchema,
    resolverVersion: PlanningVersionSchema,
    resolverPolicyVersion: PlanningVersionSchema,
    capabilityVersion: PlanningVersionSchema,
}).strict();
export type IllustrationPlanningTagQuerySnapshot = z.infer<typeof IllustrationPlanningTagQuerySnapshotSchema>;

/** Project Tag policy 的冻结副本；Agent 工具不得在排队后重新读取最新配置。 */
export const IllustrationPlanningTagPolicySnapshotSchema = z.object({
    config: ProjectTagPolicyConfigSchema,
    projectScopeHash: TextToImageContractHashSchema,
}).strict().superRefine((snapshot, context) => {
    if (snapshot.projectScopeHash !== hashTextToImageContract(snapshot.config)) {
        context.addIssue({code: "custom", path: ["projectScopeHash"], message: "projectScopeHash 与冻结 Tag policy 不一致"});
    }
});
export type IllustrationPlanningTagPolicySnapshot = z.infer<typeof IllustrationPlanningTagPolicySnapshotSchema>;

/** Planning Agent 工具从 session initial 读取的冻结上下文；Provider/model 由服务端写入，Agent 不能修改。 */
export const IllustrationPlanningToolContextSchema = z.object({
    operation: IllustrationPlanningOperationSchema,
    runId: StoryboardStableIdSchema,
    contextId: StoryboardStableIdSchema,
    modelScope: TextToImageModelScopeSchema,
    patternCandidates: TagPatternCandidateSetSchema,
    tagQuerySnapshot: IllustrationPlanningTagQuerySnapshotSchema,
    tagPolicySnapshot: IllustrationPlanningTagPolicySnapshotSchema,
}).strict();

export type IllustrationPlanningToolContext = z.infer<typeof IllustrationPlanningToolContextSchema>;

const ControlledConceptSchema = StoryboardStableIdSchema;
const OutfitRefSchema = z.string().regex(/^lorebook\/character\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\/outfits\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.md$/u);
const TerminalRunTagResolutionRefSchema = z.object({resolutionId: StoryboardStableIdSchema}).strict();

/** Agent 可提交的唯一镜头语义；不含任何服务端 identity、最终 Prompt 或生成参数。 */
export const ShotIntentCoreSchema = z.object({
    purpose: z.string().trim().min(1).max(500),
    characterIds: z.array(StoryboardStableIdSchema).max(8),
    outfitRefs: z.array(OutfitRefSchema).max(16),
    action: z.record(StoryboardStableIdSchema, ControlledConceptSchema),
    composition: z.object({
        shotSize: z.enum(["close-up", "medium", "wide"]),
        cameraAngle: z.enum(["low", "eye-level", "high"]),
        viewpoint: z.enum(["first-person", "third-person"]),
        canvasIntent: z.enum(["portrait", "landscape", "square"]),
        subjectPlacement: ControlledConceptSchema,
    }).strict(),
    continuity: z.object({
        timeOfDay: ControlledConceptSchema,
        palette: ControlledConceptSchema,
    }).strict(),
    tagPatternRefs: z.array(StoryboardStableIdSchema).max(3),
    tagDelta: z.object({
        prefer: z.array(TerminalRunTagResolutionRefSchema).max(8),
        avoid: z.array(TerminalRunTagResolutionRefSchema).max(8),
    }).strict(),
}).strict().superRefine((shot, context) => {
    addUniqueIssues(shot.characterIds, ["characterIds"], "characterId", context);
    addUniqueIssues(shot.outfitRefs, ["outfitRefs"], "outfitRef", context);
    addUniqueIssues(shot.tagPatternRefs, ["tagPatternRefs"], "tagPatternRef", context);
    const tagRefs = [...shot.tagDelta.prefer, ...shot.tagDelta.avoid].map((item) => item.resolutionId);
    addUniqueIssues(tagRefs, ["tagDelta"], "resolutionId", context);
});

export type ShotIntentCore = z.infer<typeof ShotIntentCoreSchema>;

export const ChapterIllustrationProposalSchema = z.object({
    operation: z.literal("plan-chapter"),
    shots: z.array(ShotIntentCoreSchema.extend({anchorCandidateId: IllustrationAnchorIdSchema}).strict()).min(1).max(12),
    continuityReview: z.object({
        status: z.literal("passed"),
        summary: z.string().trim().min(1).max(2000),
    }).strict(),
}).strict();

export const SelectionIllustrationProposalSchema = z.object({
    operation: z.literal("plan-selection"),
    shot: ShotIntentCoreSchema,
}).strict();

const ReviewCandidateResultSchema = z.object({
    /** 目标 placeholder ID（已发布并通过校验）。 */
    placeholderId: z.string().trim().min(1).max(200),
    assessment: z.enum(["approved", "needs_improvement", "rejected"]),
    reason: z.string().trim().min(1).max(500),
    suggestedAdjustments: z.string().trim().max(500).nullable(),
}).strict();

/** P6：插图审查候选建议；不得自动生图、改正文或 reroll。 */
export const ReviewCandidatesProposalSchema = z.object({
    operation: z.literal("review-candidates"),
    reviews: z.array(ReviewCandidateResultSchema).min(1).max(32),
    summary: z.string().trim().min(1).max(2000),
}).strict();

export const IllustrationPlanningProposalSchema = z.discriminatedUnion("operation", [
    ChapterIllustrationProposalSchema,
    SelectionIllustrationProposalSchema,
    ReviewCandidatesProposalSchema,
]);

export type ChapterIllustrationProposal = z.infer<typeof ChapterIllustrationProposalSchema>;
export type SelectionIllustrationProposal = z.infer<typeof SelectionIllustrationProposalSchema>;
export type ReviewCandidatesProposal = z.infer<typeof ReviewCandidatesProposalSchema>;
export type IllustrationPlanningProposal = z.infer<typeof IllustrationPlanningProposalSchema>;
export type ValidatedReviewEntry = z.infer<typeof ValidatedReviewEntrySchema>;

/** P6：单条审查结果含服务端校验后的 metadata。 */
const ValidatedReviewEntrySchema = z.object({
    placeholderId: z.string().trim().min(1).max(200),
    assessment: z.enum(["approved", "needs_improvement", "rejected"]),
    reason: z.string().trim().min(1).max(500),
    suggestedAdjustments: z.string().trim().max(500).nullable(),
}).strict();

/** 服务端闭集校验后的 plan-only 结果；P4 发布前不包含 placeholder 或 Job identity。 */
export const ValidatedIllustrationPlanSchema = z.object({
    schemaVersion: z.literal("nbook.validated-illustration-plan/v1"),
    validatorVersion: z.literal(ILLUSTRATION_PLAN_VALIDATOR_VERSION),
    operation: IllustrationPlanningOperationSchema,
    shots: z.array(ShotIntentCoreSchema.extend({
        anchorId: IllustrationAnchorIdSchema,
        insertAfterAnchorId: IllustrationAnchorIdSchema,
        tagResolutions: z.record(StoryboardStableIdSchema, SemanticTagResolutionSchema),
        shotIntentHash: TextToImageContractHashSchema,
    }).strict()).max(12),
    reviews: z.array(ValidatedReviewEntrySchema).max(32).optional(),
    reviewSummary: z.string().trim().min(1).max(2000).optional(),
}).strict().superRefine((plan, context) => {
    if (plan.operation === "plan-selection" && plan.shots.length !== 1) {
        context.addIssue({code: "custom", path: ["shots"], message: "plan-selection 必须恰好一条 shot"});
    }
    if (plan.operation === "review-candidates") {
        if (plan.shots.length > 0) {
            context.addIssue({code: "custom", path: ["shots"], message: "review-candidates 不能携带 shot"});
        }
        if (!plan.reviews || plan.reviews.length === 0) {
            context.addIssue({code: "custom", path: ["reviews"], message: "review-candidates 必须包含至少一条审查"});
        }
        if (plan.reviewSummary === undefined) {
            context.addIssue({code: "custom", path: ["reviewSummary"], message: "review-candidates 必须包含 summary"});
        }
    }
});

export type ValidatedIllustrationPlan = z.infer<typeof ValidatedIllustrationPlanSchema>;

function addUniqueIssues(values: string[], path: Array<string | number>, label: string, context: z.RefinementCtx): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (seen.has(value)) context.addIssue({code: "custom", path: [...path, index], message: `${label} 不能重复`});
        seen.add(value);
    });
}
