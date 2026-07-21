import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    DanbooruTagCategorySchema,
    TagUsageTierSchema,
} from "nbook/shared/text-to-image-tag-index";
import {TagPolicyDecisionSchema} from "nbook/shared/text-to-image-tag-policy";
import {
    TagPolicyApprovalSubjectSchema,
    TagPolicyDecisionEvidenceSchema,
} from "nbook/shared/text-to-image-tag-policy";
import {
    SemanticTagResolutionSchema,
    TextToImageContractHashSchema,
    TextToImageModelScopeSchema,
} from "nbook/shared/text-to-image-tag-resolution";

export const TAG_RESOLUTION_RUN_SCHEMA_VERSION = "nbook.tag-resolution-run/v1" as const;
export const TAG_RESOLVER_CANDIDATE_SET_SCHEMA_VERSION = "nbook.tag-resolver-candidate-set/v1" as const;
export const TAG_POLICY_REVIEW_REQUEST_SCHEMA_VERSION = "nbook.tag-policy-review-request/v1" as const;

const StableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/u);
const StableVersionSchema = z.string().trim().min(1).max(160);
const IsoTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);
const CanonicalTagRefSchema = z.object({
    tagId: z.number().int().positive().safe(),
    canonicalName: z.string().regex(/^[\x21-\x2b\x2d-\x7e]{1,170}$/u),
}).strict();

export const TagResolverMatchClassSchema = z.enum(["exact", "alias", "token", "prefix", "fts", "relation"]);
export const TagResolverRelationEvidenceSchema = z.enum(["alias", "implication", "related_token"]);

/** 一个只来自 active main set 的有限 replacement 候选。 */
export const TagResolverCandidateSchema = z.object({
    rank: z.number().int().positive().max(8),
    canonical: CanonicalTagRefSchema,
    category: DanbooruTagCategorySchema,
    postCount: z.number().int().min(3000).safe(),
    usageTier: TagUsageTierSchema,
    matchClass: TagResolverMatchClassSchema,
    normalizedMatchScore: z.number().min(0).max(1),
    semanticScore: z.number().min(0).max(1),
    semanticClusterHash: TextToImageContractHashSchema,
    compatibility: z.number().min(0).max(1),
    relationEvidence: z.array(TagResolverRelationEvidenceSchema).max(3),
    eligible: z.boolean(),
    policyDecision: TagPolicyDecisionSchema.default("allow"),
}).strict();
export type TagResolverCandidate = z.infer<typeof TagResolverCandidateSchema>;

/** 候选顺序、eligible 集和 top 决策的不可变 evidence。 */
export const TagResolverCandidateSetSchema = z.object({
    schemaVersion: z.literal(TAG_RESOLVER_CANDIDATE_SET_SCHEMA_VERSION),
    resolutionId: StableIdSchema,
    indexVersion: StableVersionSchema,
    policyVersion: StableVersionSchema,
    resolverVersion: StableVersionSchema,
    resolverPolicyVersion: StableVersionSchema,
    capabilityVersion: StableVersionSchema,
    providerKind: z.literal("novelai"),
    modelScope: TextToImageModelScopeSchema,
    conceptQueriesHash: TextToImageContractHashSchema.nullable(),
    candidateSetHash: TextToImageContractHashSchema,
    candidates: z.array(TagResolverCandidateSchema).max(8),
    eligibleCandidateTagIds: z.array(z.number().int().positive().safe()).max(8),
    reliableTopTagId: z.number().int().positive().safe().nullable(),
    queriedTiers: z.array(TagUsageTierSchema).max(4),
}).strict().superRefine((set, context) => {
    const ids = set.candidates.map((candidate) => candidate.canonical.tagId);
    if (new Set(ids).size !== ids.length) {
        context.addIssue({code: "custom", path: ["candidates"], message: "candidate tagId 必须唯一"});
    }
    if (set.candidates.some((candidate, index) => candidate.rank !== index + 1)) {
        context.addIssue({code: "custom", path: ["candidates"], message: "candidate rank 必须连续且与数组顺序一致"});
    }
    const eligibleIds = set.candidates.filter((candidate) => candidate.eligible).map((candidate) => candidate.canonical.tagId);
    if (eligibleIds.length !== set.eligibleCandidateTagIds.length
        || eligibleIds.some((id, index) => id !== set.eligibleCandidateTagIds[index])) {
        context.addIssue({code: "custom", path: ["eligibleCandidateTagIds"], message: "eligible 集必须与候选 evidence 一致"});
    }
    if (set.reliableTopTagId !== null && set.reliableTopTagId !== eligibleIds[0]) {
        context.addIssue({code: "custom", path: ["reliableTopTagId"], message: "reliable top 必须是排名第一的 eligible candidate"});
    }
    if (new Set(set.queriedTiers).size !== set.queriedTiers.length) {
        context.addIssue({code: "custom", path: ["queriedTiers"], message: "queried tier 不能重复"});
    }
});
export type TagResolverCandidateSet = z.infer<typeof TagResolverCandidateSetSchema>;

const TagResolutionRunBaseShape = {
    schemaVersion: z.literal(TAG_RESOLUTION_RUN_SCHEMA_VERSION),
    runId: StableIdSchema,
    resolutionId: StableIdSchema,
    contextId: StableIdSchema,
    sourceText: z.string().min(1).max(500),
    modelScope: TextToImageModelScopeSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
} as const;

const CreatedRunSchema = z.object({...TagResolutionRunBaseShape, state: z.literal("created")}).strict();
const PendingRunSchema = z.object({...TagResolutionRunBaseShape, state: z.literal("pending_unknown")}).strict();
const CandidatesRunSchema = z.object({
    ...TagResolutionRunBaseShape,
    state: z.literal("candidates_ready"),
    candidateSet: TagResolverCandidateSetSchema,
}).strict();
const CanonicalRunSchema = z.object({
    ...TagResolutionRunBaseShape,
    state: z.literal("terminal_canonical"),
    terminal: SemanticTagResolutionSchema,
}).strict();
const ReplacementRunSchema = z.object({
    ...TagResolutionRunBaseShape,
    state: z.literal("terminal_replacement"),
    terminal: SemanticTagResolutionSchema,
}).strict();
const PassthroughRunSchema = z.object({
    ...TagResolutionRunBaseShape,
    state: z.literal("terminal_passthrough"),
    terminal: SemanticTagResolutionSchema,
}).strict();

/** Resolver 的 run-scoped 有限状态；只有 terminal 分支携带可持久 snapshot。 */
export const TagResolutionRunSchema = z.discriminatedUnion("state", [
    CreatedRunSchema,
    PendingRunSchema,
    CandidatesRunSchema,
    CanonicalRunSchema,
    ReplacementRunSchema,
    PassthroughRunSchema,
]).superRefine((run, context) => {
    if (run.state === "candidates_ready" && run.candidateSet.resolutionId !== run.resolutionId) {
        context.addIssue({code: "custom", path: ["candidateSet", "resolutionId"], message: "candidate set 必须属于当前 resolution"});
    }
    if (run.state === "terminal_canonical" && run.terminal.kind !== "canonical") {
        context.addIssue({code: "custom", path: ["terminal", "kind"], message: "terminal_canonical 只能携带 canonical snapshot"});
    }
    if (run.state === "terminal_replacement" && run.terminal.kind !== "replacement") {
        context.addIssue({code: "custom", path: ["terminal", "kind"], message: "terminal_replacement 只能携带 replacement snapshot"});
    }
    if (run.state === "terminal_passthrough" && run.terminal.kind !== "provider_passthrough") {
        context.addIssue({code: "custom", path: ["terminal", "kind"], message: "terminal_passthrough 只能携带 passthrough snapshot"});
    }
    if ("terminal" in run && run.terminal.sourceText !== run.sourceText) {
        context.addIssue({code: "custom", path: ["terminal", "sourceText"], message: "terminal sourceText 必须来自当前 resolution"});
    }
});
export type TagResolutionRun = z.infer<typeof TagResolutionRunSchema>;

/** 有界 search_tags 输入；上游 URL 与 Provider 参数不属于该 DTO。 */
export const TagResolverSearchRequestSchema = z.object({
    query: z.string().trim().min(1).max(240),
    category: DanbooruTagCategorySchema.optional(),
    modelScope: TextToImageModelScopeSchema,
    limit: z.number().int().min(1).max(30),
}).strict();
export type TagResolverSearchRequest = z.infer<typeof TagResolverSearchRequestSchema>;

/** exact/alias 批量解析输入；每项仍在服务端分配 resolutionId。 */
export const TagResolverResolveRequestSchema = z.object({
    tags: z.array(z.string().min(1).max(500)).min(1).max(64),
    modelScope: TextToImageModelScopeSchema,
    contextId: StableIdSchema,
}).strict();
export type TagResolverResolveRequest = z.infer<typeof TagResolverResolveRequestSchema>;

/** Agent finalize 只能确认当前 candidateSetHash，不能提交 candidateTagId。 */
export const TagResolverFinalizeRequestSchema = z.object({
    resolutionId: StableIdSchema,
    candidateSetHash: TextToImageContractHashSchema,
}).strict();
export type TagResolverFinalizeRequest = z.infer<typeof TagResolverFinalizeRequestSchema>;

const TagPolicyReviewRequestBaseSchema = z.object({
    schemaVersion: z.literal(TAG_POLICY_REVIEW_REQUEST_SCHEMA_VERSION),
    resolutionId: StableIdSchema,
    sourceText: z.string().min(1).max(500),
    policy: TagPolicyDecisionEvidenceSchema.extend({decision: z.literal("review_required")}).strict(),
    subject: TagPolicyApprovalSubjectSchema,
}).strict();

/** review request hash 排除自身，只绑定 resolution/source/current policy/subject。 */
export function createTagPolicyReviewRequestHash(
    input: z.input<typeof TagPolicyReviewRequestBaseSchema> & {reviewRequestHash?: string},
): string {
    const {reviewRequestHash: _reviewRequestHash, ...requestInput} = input;
    return hashTextToImageContract(TagPolicyReviewRequestBaseSchema.parse(requestInput));
}

export const TagPolicyReviewRequestSchema = TagPolicyReviewRequestBaseSchema.extend({
    reviewRequestHash: TextToImageContractHashSchema,
}).strict().superRefine((request, context) => {
    if (request.reviewRequestHash !== createTagPolicyReviewRequestHash(request)) {
        context.addIssue({code: "custom", path: ["reviewRequestHash"], message: "reviewRequestHash 与当前 policy subject 不一致"});
    }
});

export type TagPolicyReviewRequest = z.infer<typeof TagPolicyReviewRequestSchema>;

/** 用户提交给 explicit import operation 的窄批准命令。 */
export const TagPolicyReviewApprovalInputSchema = z.object({
    reviewRequestHash: TextToImageContractHashSchema,
    approvalId: StableIdSchema,
    actorId: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(500),
}).strict();

export type TagPolicyReviewApprovalInput = z.infer<typeof TagPolicyReviewApprovalInputSchema>;

/** Resolver 返回给 owner builder 的已复验 review grant；不含 owner/key/source path。 */
export const TagResolverPolicyApprovalSchema = z.object({
    approvalId: StableIdSchema,
    actorId: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(500),
    policyVersion: StableVersionSchema,
    contentScope: z.enum(["general", "all"]),
    matchedRuleIds: z.array(StableIdSchema).max(2000),
    subject: TagPolicyApprovalSubjectSchema,
    approvedAt: IsoTimestampSchema,
}).strict();

export type TagResolverPolicyApproval = z.infer<typeof TagResolverPolicyApprovalSchema>;

const ExplicitTerminalResultSchema = z.object({
    state: z.literal("terminal"),
    run: TagResolutionRunSchema,
    reviewApproval: TagResolverPolicyApprovalSchema.nullable(),
}).strict().superRefine((result, context) => {
    if (!result.run.state.startsWith("terminal_")) {
        context.addIssue({code: "custom", path: ["run", "state"], message: "explicit terminal result 必须携带 terminal run"});
    }
});

const ExplicitReviewResultSchema = z.object({
    state: z.literal("review_required"),
    review: TagPolicyReviewRequestSchema,
}).strict();

const ExplicitBlockedResultSchema = z.object({
    state: z.literal("blocked"),
    code: z.enum(["TAG_POLICY_BLOCKED", "TAG_DEPRECATED_NOT_EXECUTABLE"]),
    resolutionId: StableIdSchema,
    sourceText: z.string().min(1).max(500),
    policy: TagPolicyDecisionEvidenceSchema.nullable(),
    subject: TagPolicyApprovalSubjectSchema,
}).strict().superRefine((result, context) => {
    if (result.code === "TAG_POLICY_BLOCKED" && result.policy?.decision !== "block") {
        context.addIssue({code: "custom", path: ["policy"], message: "policy block 结果必须携带 block evidence"});
    }
    if (result.code === "TAG_DEPRECATED_NOT_EXECUTABLE" && result.policy !== null) {
        context.addIssue({code: "custom", path: ["policy"], message: "deprecated block 不伪造 policy evidence"});
    }
});

/** explicit import 专用结果；review/block 永远不能伪装成 terminal snapshot。 */
export const TagResolverExplicitResultSchema = z.discriminatedUnion("state", [
    ExplicitTerminalResultSchema,
    ExplicitReviewResultSchema,
    ExplicitBlockedResultSchema,
]);

export type TagResolverExplicitResult = z.infer<typeof TagResolverExplicitResultSchema>;
