import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const TAG_POLICY_REGISTRY_SCHEMA_VERSION = "nbook.tag-policy-registry/v1" as const;
export const TAG_POLICY_APPROVAL_SCHEMA_VERSION = "nbook.tag-policy-approval/v1" as const;

const StableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,159}$/u);
const CanonicalTagNameSchema = z.string().regex(/^[\x21-\x2b\x2d-\x7e]{1,170}$/u);
const IsoTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);

export const TagPolicyContentScopeSchema = z.enum(["general", "all"]);
export type TagPolicyContentScope = z.infer<typeof TagPolicyContentScopeSchema>;

export const UnknownTagPolicySchema = z.enum(["provider_passthrough", "review_required"]);
export type UnknownTagPolicy = z.infer<typeof UnknownTagPolicySchema>;

/** Project Config 中唯一可编辑的 Tag policy 选择。 */
export const ProjectTagPolicyConfigSchema = z.object({
    contentScope: TagPolicyContentScopeSchema,
    unknownTagPolicy: UnknownTagPolicySchema,
}).strict();
export type ProjectTagPolicyConfig = z.infer<typeof ProjectTagPolicyConfigSchema>;

/** 返回首版 Project 默认 policy；block 规则仍由内置 registry 强制。 */
export function createDefaultProjectTagPolicyConfig(): ProjectTagPolicyConfig {
    return {contentScope: "general", unknownTagPolicy: "provider_passthrough"};
}

export const TagPolicyDecisionSchema = z.enum(["allow", "review_required", "block"]);
export type TagPolicyDecision = z.infer<typeof TagPolicyDecisionSchema>;

const TagPolicySelectorSchema = z.discriminatedUnion("kind", [
    z.object({kind: z.literal("canonical"), canonicalName: CanonicalTagNameSchema}).strict(),
    z.object({
        kind: z.literal("pattern"),
        match: z.enum(["prefix", "suffix", "contains"]),
        value: z.string().regex(/^[\x21-\x2b\x2d-\x7e]{1,120}$/u),
    }).strict(),
]);

const TagPolicyRuleSchema = z.object({
    ruleId: StableIdSchema,
    selector: TagPolicySelectorSchema,
    contentScopes: z.array(TagPolicyContentScopeSchema).min(1).max(2),
    decision: TagPolicyDecisionSchema,
    provenance: z.object({
        sourceId: StableIdSchema,
        rationale: z.string().trim().min(1).max(500),
    }).strict(),
}).strict().superRefine((rule, context) => {
    if (new Set(rule.contentScopes).size !== rule.contentScopes.length) {
        context.addIssue({code: "custom", path: ["contentScopes"], message: "content scope 不能重复"});
    }
});

/** NeuroBook 自有的版本化安全事实；不含 Danbooru source rows 或 Project 自定义规则。 */
export const TagPolicyRegistrySchema = z.object({
    schemaVersion: z.literal(TAG_POLICY_REGISTRY_SCHEMA_VERSION),
    policyVersion: StableIdSchema,
    provenance: z.object({
        kind: z.literal("builtin"),
        sourceId: StableIdSchema,
        reviewedAt: IsoTimestampSchema,
    }).strict(),
    rules: z.array(TagPolicyRuleSchema).max(2000),
}).strict().superRefine((registry, context) => {
    const ruleIds = registry.rules.map((rule) => rule.ruleId);
    if (new Set(ruleIds).size !== ruleIds.length) {
        context.addIssue({code: "custom", path: ["rules"], message: "Tag policy ruleId 必须唯一"});
    }
});
export type TagPolicyRegistry = z.infer<typeof TagPolicyRegistrySchema>;

/** 一次 policy 判断的完整、可复验 evidence。 */
export const TagPolicyDecisionEvidenceSchema = z.object({
    policyVersion: StableIdSchema,
    contentScope: TagPolicyContentScopeSchema,
    decision: TagPolicyDecisionSchema,
    matchedRuleIds: z.array(StableIdSchema),
}).strict();
export type TagPolicyDecisionEvidence = z.infer<typeof TagPolicyDecisionEvidenceSchema>;

export const TagPolicyApprovalSubjectSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("canonical"),
        tagId: z.number().int().positive().safe(),
        canonicalName: CanonicalTagNameSchema,
    }).strict(),
    z.object({
        kind: z.literal("provider_passthrough"),
        validationTextHash: TextToImageContractHashSchema,
    }).strict(),
]);

/**
 * 用户对 `review_required` 的长期审计证据。
 *
 * 它必须随 owner Markdown 保存并绑定 resolution key、owner slot、来源和当前 policy subject；
 * UI/localStorage 不能保存第二份批准真相源。
 */
export const TagPolicyApprovalSchema = z.object({
    schemaVersion: z.literal(TAG_POLICY_APPROVAL_SCHEMA_VERSION),
    approvalId: StableIdSchema,
    actorId: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(500),
    policyVersion: StableIdSchema,
    contentScope: TagPolicyContentScopeSchema,
    matchedRuleIds: z.array(StableIdSchema).max(2000),
    resolutionKey: StableIdSchema,
    ownerIdentity: z.string().trim().min(1).max(500),
    ownerSlot: z.string().trim().min(1).max(160),
    sourcePath: z.string().trim().min(1).max(1000),
    sourceTextHash: TextToImageContractHashSchema,
    subject: TagPolicyApprovalSubjectSchema,
    approvedAt: IsoTimestampSchema,
}).strict().superRefine((approval, context) => {
    if (new Set(approval.matchedRuleIds).size !== approval.matchedRuleIds.length) {
        context.addIssue({code: "custom", path: ["matchedRuleIds"], message: "matchedRuleIds 不能重复"});
    }
});

export type TagPolicyApproval = z.infer<typeof TagPolicyApprovalSchema>;

/** approval 的审计时间不改变 Pattern 语义，其余绑定字段全部进入 hash。 */
export function createTagPolicyApprovalHash(input: TagPolicyApproval): string {
    const approval = TagPolicyApprovalSchema.parse(input);
    const {approvedAt: _approvedAt, ...semanticEvidence} = approval;
    return hashTextToImageContract(semanticEvidence);
}
