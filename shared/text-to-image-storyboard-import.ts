import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    SemanticTagResolutionSchema,
    TextToImageContractHashSchema,
    TextToImageModelScopeSchema,
} from "nbook/shared/text-to-image-tag-resolution";
import {
    TagPolicyApprovalSchema,
    TagPolicyApprovalSubjectSchema,
    TagPolicyDecisionEvidenceSchema,
} from "nbook/shared/text-to-image-tag-policy";
import {
    TagPolicyReviewRequestSchema,
    TagResolverPolicyApprovalSchema,
} from "nbook/shared/text-to-image-tag-resolver";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {
    CharacterImageTagFieldSchema,
    OutfitTagFieldSchema,
} from "nbook/shared/text-to-image-character-visual";

export const STORYBOARD_IMPORT_STATUS_SCHEMA_VERSION = "nbook.storyboard-import-status/v1" as const;
export const PENDING_TAG_ATOM_SCHEMA_VERSION = "nbook.pending-tag-atom/v1" as const;
export const STORYBOARD_IMPORT_REPORT_SCHEMA_VERSION = "nbook.storyboard-import-report/v1" as const;
export const STORYBOARD_IMPORT_PACKAGE_SCHEMA_VERSION = "nbook.storyboard-import-candidate-package/v1" as const;
export const STORYBOARD_TAG_RESOLUTION_DIFF_SCHEMA_VERSION = "nbook.storyboard-tag-resolution-diff/v1" as const;

const StableTextSchema = z.string().trim().min(1).max(500);
const SourceProjectPathSchema = z.string().trim().min(1).max(500);
export const SourceRelativeJsonPathSchema = z.string().regex(/^upload\/[^/\\]+\.json$/iu);
const JsonPointerSchema = z.string().startsWith("/").max(1000);
const CountSchema = z.number().int().nonnegative();
const EnabledCountsSchema = z.object({enabled: CountSchema, disabled: CountSchema}).strict();
const ClassificationCountsSchema = z.object({
    core_rule: CountSchema,
    atomic_group: CountSchema,
    scene_recipe: CountSchema,
    style_quality: CountSchema,
    negative_constraint: CountSchema,
    trigger_alias: CountSchema,
    macro: CountSchema,
}).strict();

/** Chatu8 inspect 与后续发布流程共享的冻结状态枚举。 */
export const StoryboardImportStageSchema = z.enum([
    "uploaded",
    "inspected",
    "converting",
    "pending_unresolved",
    "resolving_tags",
    "pending",
    "publishing",
    "applied",
    "failed",
    "rejected",
    "stale",
]);

export type StoryboardImportStage = z.infer<typeof StoryboardImportStageSchema>;

const ImportStatusBaseShape = {
    schemaVersion: z.literal(STORYBOARD_IMPORT_STATUS_SCHEMA_VERSION),
} as const;

/** 版本化 import 状态；failed/rejected 必须携带稳定退出证据。 */
export const StoryboardImportStatusSchema = z.discriminatedUnion("state", [
    z.object({...ImportStatusBaseShape, state: z.literal("uploaded")}).strict(),
    z.object({...ImportStatusBaseShape, state: z.literal("inspected")}).strict(),
    z.object({...ImportStatusBaseShape, state: z.literal("converting")}).strict(),
    z.object({...ImportStatusBaseShape, state: z.literal("pending_unresolved")}).strict(),
    z.object({...ImportStatusBaseShape, state: z.literal("resolving_tags")}).strict(),
    z.object({...ImportStatusBaseShape, state: z.literal("pending")}).strict(),
    z.object({...ImportStatusBaseShape, state: z.literal("publishing")}).strict(),
    z.object({...ImportStatusBaseShape, state: z.literal("applied")}).strict(),
    z.object({...ImportStatusBaseShape, state: z.literal("stale")}).strict(),
    z.object({
        ...ImportStatusBaseShape,
        state: z.literal("failed"),
        errorCode: z.string().regex(/^STORYBOARD_IMPORT_[A-Z0-9_]+$/u),
        message: StableTextSchema,
    }).strict(),
    z.object({
        ...ImportStatusBaseShape,
        state: z.literal("rejected"),
        rejectedReason: StableTextSchema,
    }).strict(),
]);

export type StoryboardImportStatus = z.infer<typeof StoryboardImportStatusSchema>;

const STORYBOARD_IMPORT_TRANSITIONS = {
    uploaded: ["inspected", "failed"],
    inspected: ["converting", "pending", "failed"],
    converting: ["pending_unresolved", "pending", "failed"],
    pending_unresolved: ["resolving_tags"],
    resolving_tags: ["pending", "pending_unresolved"],
    pending: ["publishing", "rejected"],
    publishing: ["applied", "pending"],
    applied: ["stale"],
    stale: ["pending"],
    failed: [],
    rejected: [],
} satisfies {[TStage in StoryboardImportStage]: readonly StoryboardImportStage[]};

/**
 * 断言一次 import 状态迁移属于冻结状态机。
 *
 * `pending_unresolved` 不得直接进入 publishing，这是 Tag index 缺失时的核心发布边界。
 */
export function assertStoryboardImportTransition(from: StoryboardImportStage, to: StoryboardImportStage): void {
    const allowed: readonly StoryboardImportStage[] = STORYBOARD_IMPORT_TRANSITIONS[from];
    if (!allowed.includes(to)) {
        throw new Error(`STORYBOARD_IMPORT_TRANSITION_INVALID: ${from} -> ${to}`);
    }
}

/** inspect 只保留可稳定复现的 source entry 身份，不使用数组序号作为 identity。 */
export const Chatu8SourceIdentitySchema = z.object({
    sourcePresetKey: z.string().trim().min(1).max(500),
    sourceEntryId: StoryboardStableIdSchema,
    identityKind: z.enum(["explicit_id", "map_key", "canonical_hash"]),
    sourceOrder: CountSchema,
    jsonPointer: JsonPointerSchema,
}).strict();

/** 固定七类 Chatu8 内容路由；类别只影响 proposal 去向，不扩大权限。 */
export const Chatu8EntryClassificationSchema = z.enum([
    "core_rule",
    "atomic_group",
    "scene_recipe",
    "style_quality",
    "negative_constraint",
    "trigger_alias",
    "macro",
]);

export type Chatu8EntryClassification = z.infer<typeof Chatu8EntryClassificationSchema>;

/** 脱敏 inspect entry 的 allowlist DTO。 */
export const Chatu8InspectedEntrySchema = z.object({
    sourceIdentity: Chatu8SourceIdentitySchema,
    enabled: z.boolean(),
    role: z.enum(["system", "user", "assistant"]),
    triggerMode: z.enum(["always", "trigger"]),
    triggerWords: z.array(z.string().trim().min(1).max(160)).max(256),
    andTriggerWords: z.array(z.string().trim().min(1).max(160)).max(256),
    content: z.string().max(120000),
    unknownFields: z.array(z.string().trim().min(1).max(160)).max(256),
    classifications: z.array(Chatu8EntryClassificationSchema).max(7),
    flags: z.object({
        characterOrOutfit: z.boolean(),
        outputTemplate: z.boolean(),
        privilegeOrSafetyClaim: z.boolean(),
        irrelevant: z.boolean(),
    }).strict(),
}).strict().superRefine((entry, context) => {
    const seen = new Set<string>();
    entry.classifications.forEach((classification, index) => {
        if (seen.has(classification)) {
            context.addIssue({code: "custom", path: ["classifications", index], message: "classification 必须唯一"});
        }
        seen.add(classification);
    });
});

export type Chatu8InspectedEntry = z.infer<typeof Chatu8InspectedEntrySchema>;

export const PatternTagFieldSchema = z.enum([
    "scene",
    "composition",
    "lighting",
    "action",
    "negative_global",
    "negative_character",
]);

export type PatternTagField = z.infer<typeof PatternTagFieldSchema>;

/** 未解析 Tag 的稳定 owner slot；只允许出现在 pending proposal/report。 */
export const PendingTagOwnerSlotSchema = z.discriminatedUnion("kind", [
    z.object({kind: z.literal("pattern"), field: PatternTagFieldSchema}).strict(),
    z.object({kind: z.literal("character"), field: CharacterImageTagFieldSchema}).strict(),
    z.object({kind: z.literal("outfit"), field: OutfitTagFieldSchema}).strict(),
]);

/** Tag index 未就绪时的唯一未解析节点；它不是运行时 SemanticTagResolution 分支。 */
export const PendingTagAtomSchema = z.object({
    schemaVersion: z.literal(PENDING_TAG_ATOM_SCHEMA_VERSION),
    state: z.literal("unresolved"),
    sourceText: z.string().min(1).max(500),
    sourcePath: JsonPointerSchema,
    ownerSlot: PendingTagOwnerSlotSchema,
}).strict();

export type PendingTagAtom = z.infer<typeof PendingTagAtomSchema>;

/** import journal 可冻结的单 atom 终态；resolution key/owner approval 仍由 companion builder 生成。 */
export const StoryboardResolvedTagSchema = z.object({
    patternId: StoryboardStableIdSchema,
    atom: PendingTagAtomSchema,
    terminal: SemanticTagResolutionSchema,
    reviewApproval: TagResolverPolicyApprovalSchema.nullable(),
}).strict().superRefine((resolved, context) => {
    if (resolved.atom.ownerSlot.kind !== "pattern") {
        context.addIssue({code: "custom", path: ["atom", "ownerSlot"], message: "Storyboard resolution 只接受 Pattern atom"});
    }
    if (resolved.terminal.sourceText !== resolved.atom.sourceText) {
        context.addIssue({code: "custom", path: ["terminal", "sourceText"], message: "terminal 必须绑定 pending atom sourceText"});
    }
    if (resolved.terminal.modelScope.kind !== "generic-novelai") {
        context.addIssue({code: "custom", path: ["terminal", "modelScope"], message: "全局 Pattern 只接受 generic-novelai terminal"});
    }
    if (resolved.reviewApproval && resolved.reviewApproval.policyVersion !== resolved.terminal.policyVersion) {
        context.addIssue({code: "custom", path: ["reviewApproval", "policyVersion"], message: "review approval 必须绑定 terminal policyVersion"});
    }
});

export type StoryboardResolvedTag = z.infer<typeof StoryboardResolvedTagSchema>;

/** inspect/convert 识别出的宏证据；unknown/stochastic 默认 blocking。 */
export const StoryboardImportMacroTokenSchema = z.object({
    token: z.string().min(1).max(500),
    path: JsonPointerSchema,
    classification: z.enum([
        "registered_binding",
        "identity",
        "stochastic",
        "tag_fragment",
        "ambiguous_double_brace",
        "unknown",
    ]),
    blocking: z.boolean(),
}).strict();

export type StoryboardImportMacroToken = z.infer<typeof StoryboardImportMacroTokenSchema>;

/** style_quality 的只读迁移 proposal；只能在文生图分页另行批准。 */
export const RecipeStyleProposalSchema = z.object({
    schemaVersion: z.literal("nbook.recipe-style-proposal/v1"),
    proposalId: StoryboardStableIdSchema,
    sourceEntryId: StoryboardStableIdSchema,
    sourcePath: JsonPointerSchema,
    positiveAtoms: z.array(z.string().trim().min(1).max(500)).max(512),
    negativeAtoms: z.array(z.string().trim().min(1).max(500)).max(512),
    ignoredProviderParameters: z.array(z.string().trim().min(1).max(500)).max(128),
    summary: z.string().trim().min(1).max(1000),
}).strict();

export type RecipeStyleProposal = z.infer<typeof RecipeStyleProposalSchema>;

/** Recipe proposal 属于只读迁移提议，使用独立 hash 检测同 converterVersion 漂移。 */
export function createRecipeProposalHash(proposals: RecipeStyleProposal[]): string {
    return hashTextToImageContract({
        recipeProposals: proposals.map((proposal) => RecipeStyleProposalSchema.parse(proposal)),
    });
}

export const ImportDiagnosticSchema = z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u),
    severity: z.enum(["info", "warning", "blocking"]),
    path: z.string().trim().min(1).max(1000),
    message: z.string().trim().min(1).max(1000),
}).strict();

export type ImportDiagnostic = z.infer<typeof ImportDiagnosticSchema>;

/** 用户可审查、不会复制完整外部 Prompt 的 import report。 */
export const StoryboardImportReportSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_IMPORT_REPORT_SCHEMA_VERSION),
    importId: StoryboardStableIdSchema,
    sourceProjectPath: SourceProjectPathSchema,
    sourceRelativePath: SourceRelativeJsonPathSchema,
    sourceShape: z.enum(["direct_entries", "wrapped_entries"]),
    sourcePresetKey: z.string().trim().min(1).max(500),
    rawSourceHash: TextToImageContractHashSchema,
    sanitizedSourceHash: TextToImageContractHashSchema,
    converterVersion: z.string().trim().min(1).max(80),
    entryCount: CountSchema,
    roleCounts: z.object({system: CountSchema, user: CountSchema, assistant: CountSchema}).strict(),
    triggerModeCounts: z.object({always: CountSchema, trigger: CountSchema}).strict(),
    enabledCounts: EnabledCountsSchema,
    classificationCounts: ClassificationCountsSchema,
    candidateCounts: z.object({
        rules: CountSchema,
        patterns: CountSchema,
        recipeProposals: CountSchema,
        disabled: CountSchema,
        ignored: CountSchema,
        reportOnly: CountSchema,
    }).strict(),
    macroTokens: z.array(StoryboardImportMacroTokenSchema).max(10000),
    secretPaths: z.array(JsonPointerSchema).max(10000),
    diagnostics: z.array(ImportDiagnosticSchema).max(10000),
    compatibilityStatement: z.string().trim().min(1).max(1000),
}).strict();

export type StoryboardImportReport = z.infer<typeof StoryboardImportReportSchema>;

/** 无 active Tag index 时可持久化、但不可批准的 companion package。 */
export const PendingStoryboardPackageSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_IMPORT_PACKAGE_SCHEMA_VERSION),
    state: z.literal("pending_unresolved"),
    importId: StoryboardStableIdSchema,
    presetId: StoryboardStableIdSchema,
    patternSetId: StoryboardStableIdSchema,
    packageId: StoryboardStableIdSchema,
    resourceKey: StoryboardStableIdSchema,
    source: z.object({
        projectPath: SourceProjectPathSchema,
        relativePath: SourceRelativeJsonPathSchema,
        rawSourceHash: TextToImageContractHashSchema,
        sanitizedSourceHash: TextToImageContractHashSchema,
        converterVersion: z.string().trim().min(1).max(80),
    }).strict(),
    storyboard: z.object({
        candidatePath: z.literal("candidate.storyboard.md"),
        semanticHash: TextToImageContractHashSchema,
        ruleCount: CountSchema,
    }).strict(),
    patterns: z.object({
        candidatePath: z.literal("candidate.tag-patterns.md"),
        planningHash: TextToImageContractHashSchema,
        renderHash: TextToImageContractHashSchema,
        patternCount: CountSchema,
        unresolvedAtoms: z.array(PendingTagAtomSchema).max(100000),
    }).strict(),
    recipeProposals: z.array(RecipeStyleProposalSchema).max(10000),
    recipeProposalHash: TextToImageContractHashSchema,
    diagnosticHash: TextToImageContractHashSchema,
    candidatePackageHash: TextToImageContractHashSchema,
    report: StoryboardImportReportSchema,
}).strict().superRefine((candidate, context) => {
    if (candidate.presetId !== candidate.patternSetId) {
        context.addIssue({code: "custom", path: ["patternSetId"], message: "patternSetId 必须与 presetId 一致"});
    }
    if (candidate.importId !== candidate.report.importId
        || candidate.source.projectPath !== candidate.report.sourceProjectPath
        || candidate.source.relativePath !== candidate.report.sourceRelativePath
        || candidate.source.rawSourceHash !== candidate.report.rawSourceHash
        || candidate.source.sanitizedSourceHash !== candidate.report.sanitizedSourceHash
        || candidate.source.converterVersion !== candidate.report.converterVersion) {
        context.addIssue({code: "custom", path: ["report"], message: "report 必须绑定同一 import/source provenance"});
    }
    if (candidate.recipeProposalHash !== createRecipeProposalHash(candidate.recipeProposals)) {
        context.addIssue({code: "custom", path: ["recipeProposalHash"], message: "recipeProposalHash 与只读提议不一致"});
    }
});

export type PendingStoryboardPackage = z.infer<typeof PendingStoryboardPackageSchema>;

export const StoryboardTagResolutionCountsSchema = z.object({
    canonical: CountSchema,
    replacement: CountSchema,
    providerPassthrough: CountSchema,
    policyApprovals: CountSchema,
}).strict();

export const StoryboardTagResolutionEvidenceSchema = z.object({
    indexVersion: z.string().trim().min(1).max(160),
    policyVersion: z.string().trim().min(1).max(160),
    resolverVersion: z.string().trim().min(1).max(160),
    resolverPolicyVersion: z.string().trim().min(1).max(160),
    capabilityVersion: z.string().trim().min(1).max(160),
    providerKind: z.literal("novelai"),
    modelScope: TextToImageModelScopeSchema,
}).strict();

const ResolvedStoryboardPackageBaseSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_IMPORT_PACKAGE_SCHEMA_VERSION),
    state: z.literal("pending"),
    importId: StoryboardStableIdSchema,
    presetId: StoryboardStableIdSchema,
    patternSetId: StoryboardStableIdSchema,
    packageId: StoryboardStableIdSchema,
    resourceKey: StoryboardStableIdSchema,
    previousCandidatePackageHash: TextToImageContractHashSchema,
    source: z.object({
        projectPath: SourceProjectPathSchema,
        relativePath: SourceRelativeJsonPathSchema,
        rawSourceHash: TextToImageContractHashSchema,
        sanitizedSourceHash: TextToImageContractHashSchema,
        converterVersion: z.string().trim().min(1).max(80),
    }).strict(),
    storyboard: z.object({
        candidatePath: z.literal("resolved.storyboard.md"),
        semanticHash: TextToImageContractHashSchema,
        ruleCount: CountSchema,
    }).strict(),
    patterns: z.object({
        candidatePath: z.literal("resolved.tag-patterns.md"),
        planningHash: TextToImageContractHashSchema,
        renderHash: TextToImageContractHashSchema,
        patternCount: CountSchema,
        resolutionCount: CountSchema,
    }).strict(),
    resolutionEvidence: StoryboardTagResolutionEvidenceSchema,
    resolutionCounts: StoryboardTagResolutionCountsSchema,
    recipeProposals: z.array(RecipeStyleProposalSchema).max(10000),
    recipeProposalHash: TextToImageContractHashSchema,
    diagnosticHash: TextToImageContractHashSchema,
    candidatePackageHash: TextToImageContractHashSchema,
    report: StoryboardImportReportSchema,
}).strict();

/** resolved candidate 的预览 token；即使传入旧 token，也先剥离且绝不参与自身计算。 */
export function createStoryboardImportPreviewToken(
    input: z.input<typeof ResolvedStoryboardPackageBaseSchema> & {previewToken?: string},
): string {
    const {previewToken: _previewToken, ...packageInput} = input;
    const candidate = ResolvedStoryboardPackageBaseSchema.parse(packageInput);
    return hashTextToImageContract({
        schemaVersion: "nbook.storyboard-import-preview-token/v1",
        state: candidate.state,
        importId: candidate.importId,
        packageId: candidate.packageId,
        resourceKey: candidate.resourceKey,
        previousCandidatePackageHash: candidate.previousCandidatePackageHash,
        candidatePackageHash: candidate.candidatePackageHash,
        source: candidate.source,
        resolutionEvidence: candidate.resolutionEvidence,
        resolutionCounts: candidate.resolutionCounts,
    });
}

/** 所有 PendingTagAtom 已转为 terminal snapshot 后的可审查 package。 */
export const ResolvedStoryboardPackageSchema = ResolvedStoryboardPackageBaseSchema.extend({
    previewToken: TextToImageContractHashSchema,
}).strict().superRefine((candidate, context) => {
    if (candidate.presetId !== candidate.patternSetId) {
        context.addIssue({code: "custom", path: ["patternSetId"], message: "patternSetId 必须与 presetId 一致"});
    }
    if (candidate.importId !== candidate.report.importId
        || candidate.source.projectPath !== candidate.report.sourceProjectPath
        || candidate.source.relativePath !== candidate.report.sourceRelativePath
        || candidate.source.rawSourceHash !== candidate.report.rawSourceHash
        || candidate.source.sanitizedSourceHash !== candidate.report.sanitizedSourceHash
        || candidate.source.converterVersion !== candidate.report.converterVersion) {
        context.addIssue({code: "custom", path: ["report"], message: "report 必须绑定同一 import/source provenance"});
    }
    if (candidate.recipeProposalHash !== createRecipeProposalHash(candidate.recipeProposals)) {
        context.addIssue({code: "custom", path: ["recipeProposalHash"], message: "recipeProposalHash 与只读提议不一致"});
    }
    const resolutionCount = candidate.resolutionCounts.canonical
        + candidate.resolutionCounts.replacement
        + candidate.resolutionCounts.providerPassthrough;
    if (candidate.patterns.resolutionCount !== resolutionCount) {
        context.addIssue({code: "custom", path: ["patterns", "resolutionCount"], message: "resolutionCount 与分类计数不一致"});
    }
    if (candidate.resolutionCounts.policyApprovals > resolutionCount) {
        context.addIssue({code: "custom", path: ["resolutionCounts", "policyApprovals"], message: "policy approval 数不能超过 resolution 数"});
    }
    if (candidate.previewToken !== createStoryboardImportPreviewToken(candidate)) {
        context.addIssue({code: "custom", path: ["previewToken"], message: "previewToken 与 resolved package 不一致"});
    }
});

export type ResolvedStoryboardPackage = z.infer<typeof ResolvedStoryboardPackageSchema>;

/** resolved preview 中逐 atom 展示的终态 diff；不接受 pending/candidate ref 或自由 Prompt。 */
export const StoryboardTagResolutionDiffEntrySchema = z.object({
    resolutionKey: StoryboardStableIdSchema,
    patternId: StoryboardStableIdSchema,
    ownerSlot: z.object({kind: z.literal("pattern"), field: PatternTagFieldSchema}).strict(),
    sourceText: z.string().min(1).max(500),
    sourcePath: JsonPointerSchema,
    terminal: SemanticTagResolutionSchema,
    policyApproval: TagPolicyApprovalSchema.nullable(),
}).strict().superRefine((entry, context) => {
    if (entry.terminal.sourceText !== entry.sourceText) {
        context.addIssue({code: "custom", path: ["terminal", "sourceText"], message: "terminal 必须绑定 diff sourceText"});
    }
    if (entry.policyApproval && entry.policyApproval.resolutionKey !== entry.resolutionKey) {
        context.addIssue({code: "custom", path: ["policyApproval", "resolutionKey"], message: "approval 必须绑定 diff resolutionKey"});
    }
});

export const StoryboardTagResolutionDiffSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_TAG_RESOLUTION_DIFF_SCHEMA_VERSION),
    counts: StoryboardTagResolutionCountsSchema,
    entries: z.array(StoryboardTagResolutionDiffEntrySchema).max(100000),
}).strict().superRefine((diff, context) => {
    const counts = {
        canonical: diff.entries.filter((entry) => entry.terminal.kind === "canonical").length,
        replacement: diff.entries.filter((entry) => entry.terminal.kind === "replacement").length,
        providerPassthrough: diff.entries.filter((entry) => entry.terminal.kind === "provider_passthrough").length,
        policyApprovals: diff.entries.filter((entry) => entry.policyApproval !== null).length,
    };
    if (hashTextToImageContract(counts) !== hashTextToImageContract(diff.counts)) {
        context.addIssue({code: "custom", path: ["counts"], message: "diff counts 与 entries 不一致"});
    }
});

export type StoryboardTagResolutionDiff = z.infer<typeof StoryboardTagResolutionDiffSchema>;

/** 文生图分页可选择的当前 Project 顶层 upload JSON。 */
export const StoryboardImportSourceListSchema = z.object({
    schemaVersion: z.literal("nbook.storyboard-import-source-list/v1"),
    sources: z.array(z.object({
        relativePath: SourceRelativeJsonPathSchema,
        sizeBytes: z.number().int().nonnegative().max(16 * 1024 * 1024 * 1024),
    }).strict()).max(10000),
}).strict();

export type StoryboardImportSourceList = z.infer<typeof StoryboardImportSourceListSchema>;

const TagIndexNotReadySchema = z.object({
    ready: z.literal(false),
    code: z.literal("TAG_INDEX_NOT_READY"),
    message: z.string().trim().min(1).max(500),
}).strict();

/** inspect API 的有界预览；不包含 entry content 或任何 secret value。 */
export const StoryboardImportInspectPreviewSchema = z.object({
    schemaVersion: z.literal("nbook.storyboard-import-inspect-preview/v1"),
    state: z.literal("inspected"),
    importId: StoryboardStableIdSchema,
    presetId: StoryboardStableIdSchema,
    sourceRelativePath: SourceRelativeJsonPathSchema,
    sourcePresetKey: z.string().trim().min(1).max(500),
    entryCount: CountSchema,
    enabledCounts: EnabledCountsSchema,
    classificationCounts: ClassificationCountsSchema,
    macroTokens: z.array(StoryboardImportMacroTokenSchema).max(10000),
    secretPaths: z.array(JsonPointerSchema).max(10000),
    chunkCount: CountSchema,
    tagResolution: TagIndexNotReadySchema,
}).strict();

export type StoryboardImportInspectPreview = z.infer<typeof StoryboardImportInspectPreviewSchema>;

/** pending preview token 只绑定不可变 pending package，resolved package 必然得到另一个 token。 */
export function createPendingStoryboardPreviewToken(candidatePackage: PendingStoryboardPackage): string {
    const parsed = PendingStoryboardPackageSchema.parse(candidatePackage);
    return hashTextToImageContract({
        schemaVersion: "nbook.storyboard-import-preview-token/v1",
        state: parsed.state,
        importId: parsed.importId,
        packageId: parsed.packageId,
        resourceKey: parsed.resourceKey,
        candidatePackageHash: parsed.candidatePackageHash,
    });
}

/** 转换完成后的只读 pending companion 预览；首版没有批准能力。 */
export const StoryboardImportPendingPreviewSchema = z.object({
    schemaVersion: z.literal("nbook.storyboard-import-pending-preview/v1"),
    state: z.literal("pending_unresolved"),
    package: PendingStoryboardPackageSchema,
    previewToken: TextToImageContractHashSchema,
    storyboardMarkdown: z.string().min(1).max(32 * 1024 * 1024),
    patternMarkdown: z.string().min(1).max(32 * 1024 * 1024),
    approval: z.object({
        enabled: z.literal(false),
        code: z.literal("TAG_INDEX_NOT_READY"),
        message: z.string().trim().min(1).max(500),
    }).strict(),
}).strict().superRefine((preview, context) => {
    if (preview.previewToken !== createPendingStoryboardPreviewToken(preview.package)) {
        context.addIssue({code: "custom", path: ["previewToken"], message: "pending previewToken 与 package 不一致"});
    }
});

export type StoryboardImportPendingPreview = z.infer<typeof StoryboardImportPendingPreviewSchema>;

const StoryboardResolutionGateEntrySchema = z.discriminatedUnion("outcome", [
    z.object({
        outcome: z.literal("review_required"),
        patternId: StoryboardStableIdSchema,
        atom: PendingTagAtomSchema,
        resolutionId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/u),
        review: TagPolicyReviewRequestSchema,
    }).strict(),
    z.object({
        outcome: z.literal("blocked"),
        patternId: StoryboardStableIdSchema,
        atom: PendingTagAtomSchema,
        resolutionId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/u),
        code: z.enum(["TAG_POLICY_BLOCKED", "TAG_DEPRECATED_NOT_EXECUTABLE"]),
        policy: TagPolicyDecisionEvidenceSchema.nullable(),
        subject: TagPolicyApprovalSubjectSchema,
    }).strict(),
]);

const StoryboardImportResolutionGateBaseSchema = z.object({
    schemaVersion: z.literal("nbook.storyboard-import-resolution-gate/v1"),
    state: z.enum(["review_required", "blocked"]),
    importId: StoryboardStableIdSchema,
    pendingCandidatePackageHash: TextToImageContractHashSchema,
    entries: z.array(StoryboardResolutionGateEntrySchema).min(1).max(100000),
}).strict().superRefine((gate, context) => {
    const hasBlock = gate.entries.some((entry) => entry.outcome === "blocked");
    if ((gate.state === "blocked") !== hasBlock) {
        context.addIssue({code: "custom", path: ["state"], message: "gate state 必须反映是否存在 blocked atom"});
    }
});

/** gate token 绑定全部 review/block evidence；旧 review request 不能批准新 gate。 */
export function createStoryboardResolutionGateToken(
    input: z.input<typeof StoryboardImportResolutionGateBaseSchema> & {previewToken?: string; approval?: object},
): string {
    const {previewToken: _previewToken, approval: _approval, ...gateInput} = input;
    return hashTextToImageContract(StoryboardImportResolutionGateBaseSchema.parse(gateInput));
}

export const StoryboardImportResolutionGatePreviewSchema = z.object({
    schemaVersion: z.literal("nbook.storyboard-import-resolution-gate/v1"),
    state: z.enum(["review_required", "blocked"]),
    importId: StoryboardStableIdSchema,
    pendingCandidatePackageHash: TextToImageContractHashSchema,
    entries: z.array(StoryboardResolutionGateEntrySchema).min(1).max(100000),
    previewToken: TextToImageContractHashSchema,
    approval: z.object({
        enabled: z.literal(false),
        code: z.enum(["TAG_POLICY_REVIEW_REQUIRED", "TAG_POLICY_BLOCKED"]),
        message: StableTextSchema,
    }).strict(),
}).strict().superRefine((gate, context) => {
    const hasBlock = gate.entries.some((entry) => entry.outcome === "blocked");
    if ((gate.state === "blocked") !== hasBlock) {
        context.addIssue({code: "custom", path: ["state"], message: "gate state 必须反映是否存在 blocked atom"});
    }
    if (gate.approval.code !== (hasBlock ? "TAG_POLICY_BLOCKED" : "TAG_POLICY_REVIEW_REQUIRED")) {
        context.addIssue({code: "custom", path: ["approval", "code"], message: "approval code 与 gate state 不一致"});
    }
    if (gate.previewToken !== createStoryboardResolutionGateToken(gate)) {
        context.addIssue({code: "custom", path: ["previewToken"], message: "resolution gate previewToken 已失效"});
    }
});

export type StoryboardImportResolutionGatePreview = z.infer<typeof StoryboardImportResolutionGatePreviewSchema>;

const ResolvedApprovalSchema = z.discriminatedUnion("enabled", [
    z.object({enabled: z.literal(true), previewToken: TextToImageContractHashSchema}).strict(),
    z.object({
        enabled: z.literal(false),
        code: z.literal("BLOCKING_DIAGNOSTIC"),
        message: StableTextSchema,
        previewToken: TextToImageContractHashSchema,
    }).strict(),
]);

/** terminal resolution 已落入正式 TagPatternSet 后的 resolved candidate 预览。 */
export const StoryboardImportResolvedPreviewSchema = z.object({
    schemaVersion: z.literal("nbook.storyboard-import-resolved-preview/v1"),
    state: z.literal("pending"),
    package: ResolvedStoryboardPackageSchema,
    storyboardMarkdown: z.string().min(1).max(32 * 1024 * 1024),
    patternMarkdown: z.string().min(1).max(32 * 1024 * 1024),
    diff: StoryboardTagResolutionDiffSchema,
    approval: ResolvedApprovalSchema,
}).strict().superRefine((preview, context) => {
    if (preview.approval.previewToken !== preview.package.previewToken) {
        context.addIssue({code: "custom", path: ["approval", "previewToken"], message: "approval previewToken 已失效"});
    }
    if (hashTextToImageContract(preview.diff.counts) !== hashTextToImageContract(preview.package.resolutionCounts)) {
        context.addIssue({code: "custom", path: ["diff", "counts"], message: "diff 必须绑定 resolved package 计数"});
    }
});

export type StoryboardImportResolvedPreview = z.infer<typeof StoryboardImportResolvedPreviewSchema>;

/** 导入预览的完整有限状态；前端不得只假设 pending_unresolved。 */
export const StoryboardImportPreviewSchema = z.union([
    StoryboardImportPendingPreviewSchema,
    StoryboardImportResolutionGatePreviewSchema,
    StoryboardImportResolvedPreviewSchema,
]);
export type StoryboardImportPreview = z.infer<typeof StoryboardImportPreviewSchema>;
