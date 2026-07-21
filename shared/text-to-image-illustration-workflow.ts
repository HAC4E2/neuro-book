import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    CHARACTER_IMAGE_TAG_FIELDS,
    OUTFIT_TAG_FIELDS,
} from "nbook/shared/text-to-image-character-visual";
import {
    IllustrationAnchorIdSchema,
    IllustrationPlanningOperationSchema,
    IllustrationSelectionInputSchema,
    IllustrationPlanningTagPolicySnapshotSchema,
    IllustrationPlanningTagQuerySnapshotSchema,
    IllustrationPlanningToolContextSchema,
    ValidatedIllustrationPlanSchema,
} from "nbook/shared/text-to-image-illustration-planning";
import {TagPatternCandidateSetSchema} from "nbook/shared/text-to-image-tag-pattern-retrieval";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {StoryboardRuleSchema, StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";

const VersionSchema = z.string().trim().min(1).max(160);
const ChapterPathSchema = z.string().regex(/^manuscript\/.+\.md$/u).refine(
    (value) => !value.split("/").some((part) => part === "." || part === ".."),
    "chapterPath 不能越出 manuscript",
);
const ReplanSchema = z.object({
    reason: z.string().trim().min(1).max(500),
    nonce: StoryboardStableIdSchema,
}).strict();

const PlanningProjectPathSchema = z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u);
const PlanningStartCommonShape = {
    projectPath: PlanningProjectPathSchema,
    chapterPath: ChapterPathSchema,
    userIntent: z.string().trim().max(2000).default(""),
    replan: ReplanSchema.nullable().default(null),
} as const;

/** 浏览器可提交的完整 Planning 启动意图；所有事实、配置与 hash 均由服务端读取。 */
export const IllustrationPlanningStartRequestSchema = z.discriminatedUnion("operation", [
    z.object({
        ...PlanningStartCommonShape,
        operation: z.literal("plan-chapter"),
    }).strict(),
    z.object({
        ...PlanningStartCommonShape,
        operation: z.literal("plan-selection"),
        selection: IllustrationSelectionInputSchema,
    }).strict(),
    z.object({
        ...PlanningStartCommonShape,
        operation: z.literal("review-candidates"),
    }).strict(),
]);

export type IllustrationPlanningStartRequest = z.infer<typeof IllustrationPlanningStartRequestSchema>;

/** cancel/retry 只提交 Project 路径；workflowId 固定来自路由，hash 与配置均由服务端读取。 */
export const IllustrationPlanningWorkflowActionRequestSchema = z.object({
    projectPath: PlanningProjectPathSchema,
}).strict();

/** replan 只额外接收用户 revision 原因；nonce 由服务端生成。 */
export const IllustrationPlanningWorkflowReplanRequestSchema = IllustrationPlanningWorkflowActionRequestSchema.extend({
    reason: z.string().trim().min(1).max(500),
}).strict();

export type IllustrationPlanningWorkflowActionRequest = z.infer<typeof IllustrationPlanningWorkflowActionRequestSchema>;
export type IllustrationPlanningWorkflowReplanRequest = z.infer<typeof IllustrationPlanningWorkflowReplanRequestSchema>;

/** `planningRequestHash` 的完整稳定 canonical fields；不含 session、queue、secret、输出或工具 evidence。 */
export const IllustrationPlanningRequestIdentitySchema = z.object({
    schemaVersion: z.literal("nbook.illustration-planning-request/v1"),
    projectId: StoryboardStableIdSchema,
    chapterPath: ChapterPathSchema,
    operation: IllustrationPlanningOperationSchema,
    sourceChapterHash: TextToImageContractHashSchema,
    selectionHash: TextToImageContractHashSchema.nullable(),
    userIntent: z.string().trim().max(2000),
    replan: ReplanSchema.nullable(),
    effectivePresetSemanticHash: TextToImageContractHashSchema,
    effectivePatternPlanningHash: TextToImageContractHashSchema,
    visualPlanningFactsHash: TextToImageContractHashSchema,
    recipePlanningConstraintsHash: TextToImageContractHashSchema,
    continuityBaselineHash: TextToImageContractHashSchema,
    tagIndex: z.object({
        indexVersion: VersionSchema,
        manifestHash: TextToImageContractHashSchema,
    }).strict(),
    tagPolicy: z.object({
        policyVersion: VersionSchema,
        projectScopeHash: TextToImageContractHashSchema,
    }).strict(),
    resolverVersion: VersionSchema,
    resolverPolicyVersion: VersionSchema,
    patternRetrievalPolicyVersion: VersionSchema,
    planPolicyHash: TextToImageContractHashSchema,
    contentBlockParserVersion: VersionSchema,
    directorProfileVersion: VersionSchema,
    directorOperationVersion: VersionSchema,
    modelConfigFingerprint: TextToImageContractHashSchema,
    systemPolicyVersion: VersionSchema,
    planValidatorVersion: VersionSchema,
}).strict().superRefine((identity, context) => {
    if (identity.operation === "plan-selection" && identity.selectionHash === null) {
        context.addIssue({code: "custom", path: ["selectionHash"], message: "plan-selection 必须包含 selectionHash"});
    }
    if (identity.operation === "plan-chapter" && identity.selectionHash !== null) {
        context.addIssue({code: "custom", path: ["selectionHash"], message: "plan-chapter 的 selectionHash 必须为 null"});
    }
});

export type IllustrationPlanningRequestIdentity = z.infer<typeof IllustrationPlanningRequestIdentitySchema>;

const AnchorCandidateSchema = z.object({
    anchorId: IllustrationAnchorIdSchema,
    kind: z.enum(["paragraph", "heading", "list", "blockquote"]),
    normalizedText: z.string().trim().min(1).max(100000),
    textHash: TextToImageContractHashSchema,
}).strict();

const SelectionSnapshotSchema = z.object({
    selectedText: z.string().trim().min(1).max(100000),
    selectedTextHash: TextToImageContractHashSchema,
    selectionHash: TextToImageContractHashSchema,
    startAnchorId: IllustrationAnchorIdSchema,
    endAnchorId: IllustrationAnchorIdSchema,
    insertAfterAnchorId: IllustrationAnchorIdSchema,
    startBlockOffset: z.number().int().min(0).max(100000000),
    endBlockOffset: z.number().int().min(0).max(100000000),
    contextBefore: z.array(AnchorCandidateSchema).max(2),
    contextAfter: z.array(AnchorCandidateSchema).max(2),
}).strict();

const PlanningFactValueSchema = z.string().trim().min(1).max(240).refine(
    (value) => !/[\p{Cc}\p{Cs}]/u.test(value),
    "视觉规划事实不能包含控制字符",
);
const CharacterFactSchema = z.object({
    field: z.enum(CHARACTER_IMAGE_TAG_FIELDS),
    values: z.array(PlanningFactValueSchema).max(64),
}).strict();
const OutfitFactSchema = z.object({
    field: z.enum(OUTFIT_TAG_FIELDS),
    values: z.array(PlanningFactValueSchema).max(64),
}).strict();

const CharacterCandidateSchema = z.object({
    characterId: StoryboardStableIdSchema,
    names: z.array(z.string().trim().min(1).max(160)).min(1).max(66),
    visualPlanningFactsHash: TextToImageContractHashSchema,
    facts: z.array(CharacterFactSchema).max(CHARACTER_IMAGE_TAG_FIELDS.length),
    outfits: z.array(z.object({
        outfitRef: z.string().regex(/^lorebook\/character\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\/outfits\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.md$/u),
        names: z.array(z.string().trim().min(1).max(160)).min(1).max(2),
        visualPlanningFactsHash: TextToImageContractHashSchema,
        facts: z.array(OutfitFactSchema).max(OUTFIT_TAG_FIELDS.length),
    }).strict()).max(128),
}).strict();

export const IllustrationContinuityShotSchema = z.object({
    shotIntentHash: TextToImageContractHashSchema,
    origin: z.enum(["chapter-plan", "selection"]),
    selectionHash: TextToImageContractHashSchema.nullable(),
    characterIds: z.array(StoryboardStableIdSchema).max(8),
    composition: z.object({
        shotSize: z.enum(["close-up", "medium", "wide"]),
        cameraAngle: z.enum(["low", "eye-level", "high"]),
        viewpoint: z.enum(["first-person", "third-person"]),
        canvasIntent: z.enum(["portrait", "landscape", "square"]),
    }).strict(),
    continuity: z.object({timeOfDay: StoryboardStableIdSchema, palette: StoryboardStableIdSchema}).strict(),
}).strict();

export type IllustrationContinuityShot = z.infer<typeof IllustrationContinuityShotSchema>;

const PlanningInputBundleBaseSchema = z.object({
    schemaVersion: z.literal("nbook.illustration-planning-input/v1"),
    requestIdentity: IllustrationPlanningRequestIdentitySchema,
    planningRequestHash: TextToImageContractHashSchema,
    chapter: z.object({
        chapterFileHash: TextToImageContractHashSchema,
        sourceChapterHash: TextToImageContractHashSchema,
        blocks: z.array(AnchorCandidateSchema).min(1).max(10000),
        selection: SelectionSnapshotSchema.nullable(),
    }).strict(),
    characters: z.array(CharacterCandidateSchema).max(256),
    continuityBaseline: z.array(IllustrationContinuityShotSchema).max(1000),
    effectivePreset: z.object({
        presetId: StoryboardStableIdSchema,
        semanticHash: TextToImageContractHashSchema,
        rules: z.array(StoryboardRuleSchema).max(10000),
    }).strict(),
    patternCandidates: TagPatternCandidateSetSchema,
    recipePlanningConstraints: z.object({
        constraintsHash: TextToImageContractHashSchema,
        allowedCanvasIntents: z.array(z.enum(["portrait", "landscape", "square"])).min(1).max(3),
        maxSubjects: z.number().int().min(1).max(32),
    }).strict(),
    tagQuerySnapshot: IllustrationPlanningTagQuerySnapshotSchema,
    tagPolicySnapshot: IllustrationPlanningTagPolicySnapshotSchema,
    userRequest: z.object({intent: z.string().trim().max(2000), replan: ReplanSchema.nullable()}).strict(),
    toolContext: IllustrationPlanningToolContextSchema,
}).strict();

/** 完整 Planning Input Bundle；所有重复 identity/hash 在进入 Agent 前自校验。 */
export const IllustrationPlanningInputBundleSchema = PlanningInputBundleBaseSchema.extend({
    planningInputHash: TextToImageContractHashSchema,
}).strict().superRefine((bundle, context) => {
    if (bundle.planningRequestHash !== createIllustrationPlanningRequestHash(bundle.requestIdentity)) {
        context.addIssue({code: "custom", path: ["planningRequestHash"], message: "planningRequestHash 与 requestIdentity 不一致"});
    }
    if (bundle.planningInputHash !== createIllustrationPlanningInputHash(bundle)) {
        context.addIssue({code: "custom", path: ["planningInputHash"], message: "planningInputHash 与完整输入不一致"});
    }
    if (bundle.chapter.sourceChapterHash !== bundle.requestIdentity.sourceChapterHash
        || bundle.effectivePreset.semanticHash !== bundle.requestIdentity.effectivePresetSemanticHash
        || bundle.patternCandidates.effectivePlanningHash !== bundle.requestIdentity.effectivePatternPlanningHash
        || bundle.recipePlanningConstraints.constraintsHash !== bundle.requestIdentity.recipePlanningConstraintsHash) {
        context.addIssue({code: "custom", message: "Planning Input 与 request identity 的稳定依赖不一致"});
    }
    if (bundle.userRequest.intent !== bundle.requestIdentity.userIntent
        || JSON.stringify(bundle.userRequest.replan) !== JSON.stringify(bundle.requestIdentity.replan)) {
        context.addIssue({code: "custom", path: ["userRequest"], message: "用户请求与 request identity 不一致"});
    }
    if (bundle.toolContext.operation !== bundle.requestIdentity.operation
        || bundle.toolContext.contextId !== bundle.requestIdentity.projectId
        || bundle.toolContext.patternCandidates.candidateSetHash !== bundle.patternCandidates.candidateSetHash
        || JSON.stringify(bundle.toolContext.tagQuerySnapshot) !== JSON.stringify(bundle.tagQuerySnapshot)
        || JSON.stringify(bundle.toolContext.tagPolicySnapshot) !== JSON.stringify(bundle.tagPolicySnapshot)) {
        context.addIssue({code: "custom", path: ["toolContext"], message: "Agent tool context 与冻结输入闭集不一致"});
    }
    if (bundle.tagPolicySnapshot.projectScopeHash !== bundle.requestIdentity.tagPolicy.projectScopeHash
        || bundle.tagQuerySnapshot.policyVersion !== bundle.requestIdentity.tagPolicy.policyVersion
        || bundle.tagQuerySnapshot.indexVersion !== bundle.requestIdentity.tagIndex.indexVersion
        || bundle.tagQuerySnapshot.manifestHash !== bundle.requestIdentity.tagIndex.manifestHash) {
        context.addIssue({code: "custom", path: ["tagPolicySnapshot"], message: "Tag query/policy snapshot 与 request identity 不一致"});
    }
    if (bundle.requestIdentity.operation === "plan-selection") {
        if (!bundle.chapter.selection || bundle.chapter.selection.selectionHash !== bundle.requestIdentity.selectionHash) {
            context.addIssue({code: "custom", path: ["chapter", "selection"], message: "plan-selection 缺少匹配的 selection snapshot"});
        }
    } else if (bundle.chapter.selection !== null) {
        context.addIssue({code: "custom", path: ["chapter", "selection"], message: "plan-chapter 不携带 selection snapshot"});
    }
});

export type IllustrationPlanningInputBundle = z.infer<typeof IllustrationPlanningInputBundleSchema>;

export const IllustrationPlanningWorkflowStatusSchema = z.enum([
    "queued", "running", "validating", "applying", "ready", "failed", "canceled", "stale",
]);
export const IllustrationPlanningAttemptStatusSchema = z.enum(["created", "running", "succeeded", "failed", "interrupted", "canceled"]);

/** UI/API 的 plan-only Workflow 投影；不暴露完整输入、工具 evidence 或任何配置明文。 */
export const IllustrationPlanningWorkflowDtoSchema = z.object({
    id: z.string().trim().min(1).max(200),
    chapterPath: ChapterPathSchema,
    operation: IllustrationPlanningOperationSchema,
    planningRequestHash: TextToImageContractHashSchema,
    planningInputHash: TextToImageContractHashSchema,
    status: IllustrationPlanningWorkflowStatusSchema,
    activeAttemptId: z.string().trim().min(1).max(200).nullable(),
    retryable: z.boolean(),
    staleReason: z.string().max(1000).nullable(),
    errorCode: z.string().max(200).nullable(),
    errorMessage: z.string().max(4000).nullable(),
    queuePosition: z.number().int().positive().nullable(),
    validatedPlan: ValidatedIllustrationPlanSchema.nullable(),
    /** 只有 Planning Apply Journal completed 后包含本 workflow 发布的 placeholder IDs。 */
    publishedPlaceholderIds: z.array(z.string().trim().min(1).max(200)).max(32),
    attempts: z.array(z.object({
        id: z.string().trim().min(1).max(200),
        status: IllustrationPlanningAttemptStatusSchema,
        sessionId: z.number().int().positive().nullable(),
        invocationId: z.string().trim().min(1).max(200).nullable(),
        planningEvidenceHash: TextToImageContractHashSchema.nullable(),
        errorCode: z.string().max(200).nullable(),
        errorMessage: z.string().max(4000).nullable(),
        createdAt: z.string().datetime(),
        startedAt: z.string().datetime().nullable(),
        finishedAt: z.string().datetime().nullable(),
    }).strict()).max(100),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
}).strict();

export type IllustrationPlanningWorkflowDto = z.infer<typeof IllustrationPlanningWorkflowDtoSchema>;

/** 计算稳定 Workflow 幂等身份。 */
export function createIllustrationPlanningRequestHash(input: IllustrationPlanningRequestIdentity): string {
    return hashTextToImageContract(IllustrationPlanningRequestIdentitySchema.parse(input));
}

/** 计算完整运行输入证据；接受带旧 planningInputHash 的对象但显式排除该自引用字段。 */
export function createIllustrationPlanningInputHash(
    input: z.input<typeof PlanningInputBundleBaseSchema> & {planningInputHash?: string},
): string {
    const {planningInputHash: _planningInputHash, ...draft} = input;
    return hashTextToImageContract(PlanningInputBundleBaseSchema.parse(draft));
}
