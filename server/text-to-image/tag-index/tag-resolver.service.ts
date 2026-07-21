import {randomUUID} from "node:crypto";
import {z} from "zod";
import {
    createTagPolicyApprovalHash,
    ProjectTagPolicyConfigSchema,
    TagPolicyApprovalSchema,
    TagPolicyApprovalSubjectSchema,
    type ProjectTagPolicyConfig,
    type TagPolicyApproval,
    type TagPolicyDecisionEvidence,
} from "nbook/shared/text-to-image-tag-policy";
import {
    createTagPolicyReviewRequestHash,
    TagResolutionRunSchema,
    TagResolverCandidateSetSchema,
    TagPolicyReviewApprovalInputSchema,
    TagPolicyReviewRequestSchema,
    TagResolverExplicitResultSchema,
    TagResolverPolicyApprovalSchema,
    type TagResolutionRun,
    type TagResolverCandidate,
    type TagResolverCandidateSet,
    type TagPolicyReviewApprovalInput,
    type TagPolicyReviewRequest,
    type TagResolverExplicitResult,
    type TagResolverPolicyApproval,
} from "nbook/shared/text-to-image-tag-resolver";
import {
    SemanticTagResolutionSchema,
    TextToImageContractHashSchema,
    TextToImageModelScopeSchema,
    createProviderPassthroughValidationHash,
    createSemanticTagResolutionHash,
    sanitizeProviderPassthrough,
    type SemanticTagResolution,
} from "nbook/shared/text-to-image-tag-resolution";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import type {TagIndexManifest} from "nbook/shared/text-to-image-tag-index";
import {
    TagIndexReader,
    type TagIndexMainFact,
    type TagIndexSearchCandidate,
} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";

export const TAG_RESOLVER_VERSION = "nbook-tag-resolver-v1" as const;
export const TAG_RESOLVER_POLICY_VERSION = "nbook-tag-resolver-policy-v1" as const;

const RELIABLE_SCORE_THRESHOLD = 0.84;
const RELIABLE_CLUSTER_MARGIN = 0.04;
const MAX_CANDIDATES = 8;
const StableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/u);
const SourceTextSchema = z.string().min(1).max(500);
const ConceptQuerySchema = z.string().trim().min(1).max(120).regex(/^[\x20-\x7e]+$/u);
const ActorSchema = z.string().trim().min(1).max(160);
const ReasonSchema = z.string().trim().min(1).max(500);

type StoredResolution = {
    run: TagResolutionRun;
    projectPolicy: ProjectTagPolicyConfig;
    indexVersion: string;
    manifestHash: string;
    suggestionIdentityHash: string | null;
    candidateSet: TagResolverCandidateSet | null;
};

type CandidateDraft = {
    source: TagIndexSearchCandidate;
    semanticScore: number;
    relationEvidence: Set<"alias" | "implication" | "related_token">;
};

type ResolverActive = {
    manifest: TagIndexManifest;
    manifestHash: string;
};

type ReplacementDecisionProvenance = Extract<SemanticTagResolution, {kind: "replacement"}>["decisionProvenance"];

type ResolverServiceOptions = {
    reader: TagIndexReader;
    policyRegistry: TagPolicyRegistryService;
    capabilityVersion: string;
    resolveProjectPolicy(contextId: string): Promise<ProjectTagPolicyConfig>;
    now?: () => number;
    idFactory?: () => string;
};

/** run-scoped Tag Resolver；pending/candidate 只保存在本服务实例，不能进入长期 Markdown。 */
export class TagResolverService {
    private readonly reader: TagIndexReader;
    private readonly policyRegistry: TagPolicyRegistryService;
    private readonly capabilityVersion: string;
    private readonly resolveProjectPolicy: (contextId: string) => Promise<ProjectTagPolicyConfig>;
    private readonly now: () => number;
    private readonly idFactory: () => string;
    private readonly resolutions = new Map<string, StoredResolution>();
    private readonly resolutionTails = new Map<string, Promise<void>>();

    constructor(options: ResolverServiceOptions) {
        this.reader = options.reader;
        this.policyRegistry = options.policyRegistry;
        this.capabilityVersion = z.string().trim().min(1).max(160).parse(options.capabilityVersion);
        this.resolveProjectPolicy = options.resolveProjectPolicy;
        this.now = options.now ?? Date.now;
        this.idFactory = options.idFactory ?? (() => `tag-resolution-${randomUUID()}`);
    }

    /** 为 import/owner migration 冻结当前 active Resolver 版本；不暴露 index 文件或可变 policy。 */
    async readResolutionEvidence(input: {
        contextId: string;
        modelScope: z.input<typeof TextToImageModelScopeSchema>;
    }): Promise<{
        indexVersion: string;
        policyVersion: string;
        resolverVersion: string;
        resolverPolicyVersion: string;
        capabilityVersion: string;
        providerKind: "novelai";
        modelScope: z.output<typeof TextToImageModelScopeSchema>;
    }> {
        const contextId = parseStableId(input.contextId, "contextId");
        const modelScope = TextToImageModelScopeSchema.parse(input.modelScope);
        ProjectTagPolicyConfigSchema.parse(await this.resolveProjectPolicy(contextId));
        const active = await this.readCompatibleActive();
        return {
            indexVersion: active.manifest.indexVersion,
            policyVersion: this.policyRegistry.registry.policyVersion,
            resolverVersion: TAG_RESOLVER_VERSION,
            resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
            capabilityVersion: this.capabilityVersion,
            providerKind: "novelai",
            modelScope,
        };
    }

    /** `resolve_tags`：exact/alias 直接终态；unknown 只创建 pending，不提前泄漏 candidate。 */
    async resolveTags(input: {
        runId: string;
        contextId: string;
        tags: string[];
        modelScope: z.input<typeof TextToImageModelScopeSchema>;
    }): Promise<TagResolutionRun[]> {
        const runId = parseStableId(input.runId, "runId");
        const contextId = parseStableId(input.contextId, "contextId");
        const modelScope = TextToImageModelScopeSchema.parse(input.modelScope);
        if (!Array.isArray(input.tags) || input.tags.length < 1 || input.tags.length > 64) {
            throw invalidResolution("resolve_tags 必须包含 1..64 个 Tag atom");
        }
        const sourceTexts = input.tags.map((sourceText) => SourceTextSchema.parse(sourceText));
        const projectPolicy = ProjectTagPolicyConfigSchema.parse(await this.resolveProjectPolicy(contextId));
        const active = await this.readCompatibleActive();
        const runs: TagResolutionRun[] = [];
        for (const sourceText of sourceTexts) {
            const resolutionId = parseStableId(this.idFactory(), "resolutionId");
            if (this.resolutions.has(resolutionId)) throw invalidResolution("resolutionId 重复");
            const timestamp = this.timestamp();
            const exact = await this.reader.findExact(sourceText);
            let run: TagResolutionRun;
            if (exact?.kind === "deprecated") {
                throw invalidResolution(`deprecated Tag 不能直接进入终态：${exact.canonical.canonicalName}`);
            }
            if (exact?.kind === "main") {
                assertSameActive(exact.evidence.indexVersion, exact.evidence.manifestHash, active);
                const policy = this.policyRegistry.decideCanonical(exact.canonical.canonicalName, projectPolicy);
                assertPolicyAllows(policy.decision, exact.canonical.canonicalName);
                run = TagResolutionRunSchema.parse({
                    schemaVersion: "nbook.tag-resolution-run/v1",
                    state: "terminal_canonical",
                    runId,
                    resolutionId,
                    contextId,
                    sourceText,
                    modelScope,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    terminal: createCanonicalTerminal({sourceText, exact, modelScope, active, policyVersion: policy.policyVersion, resolvedAt: timestamp}),
                });
            } else {
                run = TagResolutionRunSchema.parse({
                    schemaVersion: "nbook.tag-resolution-run/v1",
                    state: "pending_unknown",
                    runId,
                    resolutionId,
                    contextId,
                    sourceText,
                    modelScope,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                });
            }
            this.resolutions.set(resolutionId, {
                run,
                projectPolicy,
                indexVersion: active.manifest.indexVersion,
                manifestHash: active.manifestHash,
                suggestionIdentityHash: null,
                candidateSet: null,
            });
            runs.push(run);
        }
        return runs;
    }

    /**
     * 显式 import 专用的一次性解析边界。
     *
     * 调用方必须提供服务端派生的稳定 resolutionId；review approval 只解锁当前 request hash，
     * block/deprecated 不可通过 approval 绕过。该方法不属于 Agent 工具。
     */
    async resolveExplicitImportTag(input: {
        runId: string;
        contextId: string;
        resolutionId: string;
        sourceText: string;
        modelScope: z.input<typeof TextToImageModelScopeSchema>;
        approval: TagPolicyReviewApprovalInput | null;
    }): Promise<TagResolverExplicitResult> {
        const runId = parseStableId(input.runId, "runId");
        const contextId = parseStableId(input.contextId, "contextId");
        const resolutionId = parseStableId(input.resolutionId, "resolutionId");
        const sourceText = SourceTextSchema.parse(input.sourceText);
        const modelScope = TextToImageModelScopeSchema.parse(input.modelScope);
        const approval = input.approval === null ? null : TagPolicyReviewApprovalInputSchema.parse(input.approval);
        return this.withResolutionLock(resolutionId, async () => {
            const existing = this.resolutions.get(resolutionId);
            if (existing && (existing.run.runId !== runId
                || existing.run.contextId !== contextId
                || existing.run.sourceText !== sourceText
                || hashTextToImageContract(existing.run.modelScope) !== hashTextToImageContract(modelScope))) {
                throw staleCandidate("explicit import resolutionId 已属于其他 owner/run/context");
            }
            const projectPolicy = ProjectTagPolicyConfigSchema.parse(await this.resolveProjectPolicy(contextId));
            const active = await this.readCompatibleActive();
            const exact = await this.reader.findExact(sourceText);
            if (exact?.kind === "deprecated") {
                return TagResolverExplicitResultSchema.parse({
                    state: "blocked",
                    code: "TAG_DEPRECATED_NOT_EXECUTABLE",
                    resolutionId,
                    sourceText,
                    policy: null,
                    subject: {kind: "canonical", ...exact.canonical},
                });
            }
            if (exact?.kind === "main") {
                assertSameActive(exact.evidence.indexVersion, exact.evidence.manifestHash, active);
                const policy = this.policyRegistry.decideCanonical(exact.canonical.canonicalName, projectPolicy);
                const subject = {kind: "canonical" as const, ...exact.canonical};
                if (policy.decision === "block") {
                    return TagResolverExplicitResultSchema.parse({
                        state: "blocked",
                        code: "TAG_POLICY_BLOCKED",
                        resolutionId,
                        sourceText,
                        policy,
                        subject,
                    });
                }
                const reviewed = policy.decision === "review_required"
                    ? this.resolveExplicitReview({resolutionId, sourceText, policy, subject, approval})
                    : null;
                if (reviewed?.state === "review_required") return reviewed;
                if (policy.decision === "allow" && approval) throw staleCandidate("当前 exact Tag 不需要 review approval");
                const timestamp = this.timestamp();
                const terminal = createCanonicalTerminal({
                    sourceText,
                    exact,
                    modelScope,
                    active,
                    policyVersion: policy.policyVersion,
                    resolvedAt: timestamp,
                });
                const run = TagResolutionRunSchema.parse({
                    schemaVersion: "nbook.tag-resolution-run/v1",
                    state: "terminal_canonical",
                    runId,
                    resolutionId,
                    contextId,
                    sourceText,
                    modelScope,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    terminal,
                });
                this.resolutions.set(resolutionId, {
                    run,
                    projectPolicy,
                    indexVersion: active.manifest.indexVersion,
                    manifestHash: active.manifestHash,
                    suggestionIdentityHash: null,
                    candidateSet: null,
                });
                return TagResolverExplicitResultSchema.parse({
                    state: "terminal",
                    run,
                    reviewApproval: reviewed?.state === "approved" ? reviewed.approval : null,
                });
            }

            const timestamp = this.timestamp();
            const pendingRun = TagResolutionRunSchema.parse({
                schemaVersion: "nbook.tag-resolution-run/v1",
                state: "pending_unknown",
                runId,
                resolutionId,
                contextId,
                sourceText,
                modelScope,
                createdAt: timestamp,
                updatedAt: timestamp,
            });
            const stored: StoredResolution = {
                run: pendingRun,
                projectPolicy,
                indexVersion: active.manifest.indexVersion,
                manifestHash: active.manifestHash,
                suggestionIdentityHash: hashTextToImageContract({conceptQueries: [], limit: MAX_CANDIDATES}),
                candidateSet: null,
            };
            const candidateSet = await this.buildCandidateSet(stored, active, [], MAX_CANDIDATES);
            const candidateRun = TagResolutionRunSchema.parse({
                ...pendingRun,
                state: "candidates_ready",
                candidateSet,
            });
            const candidateStored = {...stored, run: candidateRun, candidateSet};
            this.resolutions.set(resolutionId, candidateStored);
            if (candidateSet.reliableTopTagId !== null) {
                if (approval) throw staleCandidate("当前 replacement 不需要 review approval");
                const terminal = createReplacementTerminal({
                    stored: candidateStored,
                    active,
                    candidate: requireCandidate(candidateSet, candidateSet.reliableTopTagId),
                    resolvedAt: this.timestamp(),
                    decisionProvenance: {selectedBy: "resolver_top", conceptQueriesHash: candidateSet.conceptQueriesHash},
                });
                const run = TagResolutionRunSchema.parse({
                    ...pendingRun,
                    state: "terminal_replacement",
                    updatedAt: this.timestamp(),
                    terminal,
                });
                this.resolutions.set(resolutionId, {...candidateStored, run});
                return TagResolverExplicitResultSchema.parse({state: "terminal", run, reviewApproval: null});
            }

            const policy = decidePassthroughPolicy(this.policyRegistry, sourceText, projectPolicy);
            const subject = {
                kind: "provider_passthrough" as const,
                validationTextHash: createProviderPassthroughValidationHash(sourceText),
            };
            if (policy.decision === "block") {
                return TagResolverExplicitResultSchema.parse({
                    state: "blocked",
                    code: "TAG_POLICY_BLOCKED",
                    resolutionId,
                    sourceText,
                    policy,
                    subject,
                });
            }
            assertPassthroughText(sourceText);
            const reviewed = policy.decision === "review_required"
                ? this.resolveExplicitReview({resolutionId, sourceText, policy, subject, approval})
                : null;
            if (reviewed?.state === "review_required") return reviewed;
            if (policy.decision === "allow" && approval) throw staleCandidate("当前 passthrough 不需要 review approval");
            const terminal = this.createPassthroughTerminal(candidateStored, active, policy.decision === "review_required");
            const run = TagResolutionRunSchema.parse({
                ...pendingRun,
                state: "terminal_passthrough",
                updatedAt: this.timestamp(),
                terminal,
            });
            this.resolutions.set(resolutionId, {...candidateStored, run});
            return TagResolverExplicitResultSchema.parse({
                state: "terminal",
                run,
                reviewApproval: reviewed?.state === "approved" ? reviewed.approval : null,
            });
        });
    }

    /** 将当前 review request 与用户命令做 exact hash 绑定，生成不含 owner 的复验 grant。 */
    private resolveExplicitReview(input: {
        resolutionId: string;
        sourceText: string;
        policy: TagPolicyDecisionEvidence;
        subject: z.output<typeof TagPolicyApprovalSubjectSchema>;
        approval: TagPolicyReviewApprovalInput | null;
    }): {state: "review_required"; review: TagPolicyReviewRequest} | {state: "approved"; approval: TagResolverPolicyApproval} {
        if (input.policy.decision !== "review_required") {
            throw invalidResolution("explicit review 只接受 review_required policy evidence");
        }
        const policy = {...input.policy, decision: "review_required" as const};
        const requestBase = {
            schemaVersion: "nbook.tag-policy-review-request/v1" as const,
            resolutionId: input.resolutionId,
            sourceText: input.sourceText,
            policy,
            subject: input.subject,
        };
        const review = TagPolicyReviewRequestSchema.parse({
            ...requestBase,
            reviewRequestHash: createTagPolicyReviewRequestHash(requestBase),
        });
        if (!input.approval) return {state: "review_required", review};
        if (input.approval.reviewRequestHash !== review.reviewRequestHash) {
            throw staleCandidate("reviewRequestHash 已失效");
        }
        return {
            state: "approved",
            approval: TagResolverPolicyApprovalSchema.parse({
                approvalId: input.approval.approvalId,
                actorId: input.approval.actorId,
                reason: input.approval.reason,
                policyVersion: policy.policyVersion,
                contentScope: policy.contentScope,
                matchedRuleIds: policy.matchedRuleIds,
                subject: input.subject,
                approvedAt: this.timestamp(),
            }),
        };
    }

    /** `suggest_tag_replacements`：只返回 active main set、policy allow、兼容 scope 的最多八项。 */
    async suggestTagReplacements(input: {
        runId: string;
        contextId: string;
        resolutionId: string;
        conceptQueries: string[];
        limit: number;
    }): Promise<TagResolutionRun> {
        const runId = parseStableId(input.runId, "runId");
        const contextId = parseStableId(input.contextId, "contextId");
        const resolutionId = parseStableId(input.resolutionId, "resolutionId");
        const conceptQueries = normalizeConceptQueries(input.conceptQueries);
        const limit = parseCandidateLimit(input.limit);
        const suggestionIdentityHash = hashTextToImageContract({conceptQueries, limit});
        return this.withResolutionLock(resolutionId, async () => {
            const stored = this.requireOwnedResolution(resolutionId, runId, contextId);
            if (stored.run.state === "candidates_ready") {
                if (stored.suggestionIdentityHash !== suggestionIdentityHash) throw staleCandidate("candidate query 已冻结");
                return stored.run;
            }
            if (stored.run.state !== "pending_unknown") throw staleCandidate("只有 pending_unknown 可以请求候选");
            const active = await this.assertCurrentContext(stored);
            const candidateSet = await this.buildCandidateSet(stored, active, conceptQueries, limit);
            const run = TagResolutionRunSchema.parse({
                ...stored.run,
                state: "candidates_ready",
                updatedAt: this.timestamp(),
                candidateSet,
            });
            this.resolutions.set(resolutionId, {
                ...stored,
                run,
                suggestionIdentityHash,
                candidateSet,
            });
            return run;
        });
    }

    /** `finalize_tag_resolution`：只能接受 candidateSetHash，服务端选择 reliable top 或 passthrough。 */
    async finalizeTagResolution(input: {
        runId: string;
        contextId: string;
        resolutionId: string;
        candidateSetHash: string;
    }): Promise<TagResolutionRun> {
        const runId = parseStableId(input.runId, "runId");
        const contextId = parseStableId(input.contextId, "contextId");
        const resolutionId = parseStableId(input.resolutionId, "resolutionId");
        const candidateSetHash = TextToImageContractHashSchema.parse(input.candidateSetHash);
        return this.withResolutionLock(resolutionId, async () => {
            const stored = this.requireOwnedResolution(resolutionId, runId, contextId);
            if (stored.run.state === "terminal_replacement" || stored.run.state === "terminal_passthrough") {
                if (stored.run.terminal.candidateSetHash !== candidateSetHash) throw staleCandidate("terminal candidateSetHash 不一致");
                return stored.run;
            }
            if (stored.run.state !== "candidates_ready" || !stored.candidateSet) {
                throw staleCandidate("resolution 尚无可 finalize 的 candidate set");
            }
            if (stored.candidateSet.candidateSetHash !== candidateSetHash) throw staleCandidate("candidateSetHash 已失效");
            const active = await this.assertCurrentContext(stored);
            const terminal = stored.candidateSet.reliableTopTagId === null
                ? this.createPassthroughTerminal(stored, active)
                : createReplacementTerminal({
                    stored,
                    active,
                    candidate: requireCandidate(stored.candidateSet, stored.candidateSet.reliableTopTagId),
                    resolvedAt: this.timestamp(),
                    decisionProvenance: {
                        selectedBy: "resolver_top",
                        conceptQueriesHash: stored.candidateSet.conceptQueriesHash,
                    },
                });
            const state = terminal.kind === "replacement" ? "terminal_replacement" : "terminal_passthrough";
            const {candidateSet: _candidateSet, ...runBase} = stored.run;
            const run = TagResolutionRunSchema.parse({...runBase, state, updatedAt: this.timestamp(), terminal});
            this.resolutions.set(resolutionId, {...stored, run});
            return run;
        });
    }

    /** 用户覆盖不是 Agent 工具；调用方必须先提供可信的当前 package hash。 */
    async overrideRunTagResolution(input: {
        runId: string;
        contextId: string;
        resolutionId: string;
        candidateSetHash: string;
        candidateTagId: number;
        expectedPackageHash: string;
        currentPackageHash: string;
        actorId: string;
        reason: string;
        approvalId: string;
    }): Promise<TagResolutionRun> {
        const runId = parseStableId(input.runId, "runId");
        const contextId = parseStableId(input.contextId, "contextId");
        const resolutionId = parseStableId(input.resolutionId, "resolutionId");
        const candidateSetHash = TextToImageContractHashSchema.parse(input.candidateSetHash);
        const expectedPackageHash = TextToImageContractHashSchema.parse(input.expectedPackageHash);
        const currentPackageHash = TextToImageContractHashSchema.parse(input.currentPackageHash);
        const candidateTagId = parsePositiveId(input.candidateTagId, "candidateTagId");
        const actorId = ActorSchema.parse(input.actorId);
        const reason = ReasonSchema.parse(input.reason);
        const approvalId = ActorSchema.parse(input.approvalId);
        return this.withResolutionLock(resolutionId, async () => {
            if (expectedPackageHash !== currentPackageHash) throw staleCandidate("package hash 已变化");
            const stored = this.requireOwnedResolution(resolutionId, runId, contextId);
            const currentRun = stored.run;
            if (currentRun.state !== "terminal_replacement"
                || currentRun.terminal.kind !== "replacement"
                || !stored.candidateSet) {
                throw staleCandidate("用户覆盖只接受 terminal replacement");
            }
            const currentTerminal = currentRun.terminal;
            if (stored.candidateSet.candidateSetHash !== candidateSetHash) throw staleCandidate("candidateSetHash 已失效");
            await this.assertCurrentContext(stored);
            const candidate = requireCandidate(stored.candidateSet, candidateTagId);
            if (!candidate.eligible || !stored.candidateSet.eligibleCandidateTagIds.includes(candidateTagId)) {
                throw staleCandidate("所选 Tag 不在 eligible 集");
            }
            const originalTopTagId = stored.candidateSet.reliableTopTagId;
            if (originalTopTagId === null) throw staleCandidate("当前 candidate set 没有可靠原始 top");
            if (currentTerminal.decisionProvenance.selectedBy === "user_override") {
                const provenance = currentTerminal.decisionProvenance;
                if (currentTerminal.canonical.tagId === candidateTagId && provenance.approvalId === approvalId) return currentRun;
                throw staleCandidate("terminal replacement 已被其他用户覆盖");
            }
            const active = await this.assertCurrentContext(stored);
            const terminal = createReplacementTerminal({
                stored,
                active,
                candidate,
                resolvedAt: this.timestamp(),
                decisionProvenance: {
                    selectedBy: "user_override",
                    conceptQueriesHash: stored.candidateSet.conceptQueriesHash,
                    originalTopTagId,
                    originalTopCandidateRank: 1,
                    selectedCandidateRank: candidate.rank,
                    actorId,
                    reason,
                    approvalId,
                },
            });
            const run = TagResolutionRunSchema.parse({...currentRun, updatedAt: this.timestamp(), terminal});
            this.resolutions.set(resolutionId, {...stored, run});
            return run;
        });
    }

    /**
     * Execution Preview 专用派生复验。
     *
     * 长期 owner snapshot 可以是 generic NovelAI scope；本方法只读当前 active index/policy，
     * 派生 exact model-scoped terminal，并保留 replacement/passthrough 的原始决策 provenance。
     * 派生结果不写回 Pattern、角色、服装或 Storyboard。
     */
    async revalidateForExecution(input: {
        contextId: string;
        targetScope: {kind: "novelai-model"; modelId: string};
        resolutions: SemanticTagResolution[];
        policyApprovals: Array<TagPolicyApproval | null>;
    }): Promise<{validationHash: string; resolutions: SemanticTagResolution[]}> {
        const contextId = parseStableId(input.contextId, "contextId");
        const parsedScope = TextToImageModelScopeSchema.parse(input.targetScope);
        if (parsedScope.kind !== "novelai-model") throw invalidResolution("Execution targetScope 必须绑定具体 NovelAI model");
        if (!Array.isArray(input.resolutions) || input.resolutions.length > 256) {
            throw invalidResolution("execution resolution 复验最多接受 256 个终态");
        }
        const resolutions = input.resolutions.map((resolution) => SemanticTagResolutionSchema.parse(resolution));
        if (!Array.isArray(input.policyApprovals) || input.policyApprovals.length !== resolutions.length) {
            throw invalidResolution("policyApprovals 必须与 execution resolutions 一一对应");
        }
        const approvals = input.policyApprovals.map((approval) => approval === null ? null : TagPolicyApprovalSchema.parse(approval));
        const active = await this.readCompatibleActive();
        const projectPolicy = ProjectTagPolicyConfigSchema.parse(await this.resolveProjectPolicy(contextId));
        const derived: SemanticTagResolution[] = [];
        for (const [index, source] of resolutions.entries()) {
            const exact = await this.reader.findExact(source.sourceText);
            if (exact?.kind === "deprecated") {
                throw invalidResolution(`deprecated Tag 不能进入 Execution：${exact.canonical.canonicalName}`);
            }
            let resolution: SemanticTagResolution;
            let decision: TagPolicyDecisionEvidence;
            if (exact?.kind === "main") {
                assertSameActive(exact.evidence.indexVersion, exact.evidence.manifestHash, active);
                decision = this.policyRegistry.decideCanonical(exact.canonical.canonicalName, projectPolicy);
                resolution = createCanonicalTerminal({
                    sourceText: source.sourceText,
                    exact,
                    modelScope: parsedScope,
                    active,
                    policyVersion: decision.policyVersion,
                    resolvedAt: this.timestamp(),
                });
            } else if (source.kind === "replacement") {
                const target = await this.reader.findExact(source.canonical.canonicalName);
                if (target?.kind !== "main"
                    || target.matchedBy !== "exact"
                    || target.canonical.tagId !== source.canonical.tagId) {
                    throw invalidResolution("replacement target 已不属于 active main set");
                }
                assertSameActive(target.evidence.indexVersion, target.evidence.manifestHash, active);
                decision = this.policyRegistry.decideCanonical(target.canonical.canonicalName, projectPolicy);
                resolution = SemanticTagResolutionSchema.parse({
                    ...source,
                    indexVersion: active.manifest.indexVersion,
                    policyVersion: decision.policyVersion,
                    resolverVersion: TAG_RESOLVER_VERSION,
                    resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
                    capabilityVersion: this.capabilityVersion,
                    modelScope: parsedScope,
                    canonical: target.canonical,
                    resolvedAt: this.timestamp(),
                });
            } else if (source.kind === "provider_passthrough") {
                decision = decidePassthroughPolicy(this.policyRegistry, source.sourceText, projectPolicy);
                resolution = SemanticTagResolutionSchema.parse({
                    ...source,
                    indexVersion: active.manifest.indexVersion,
                    policyVersion: decision.policyVersion,
                    resolverVersion: TAG_RESOLVER_VERSION,
                    resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
                    capabilityVersion: this.capabilityVersion,
                    modelScope: parsedScope,
                    wireText: assertPassthroughText(source.sourceText),
                    validationTextHash: createProviderPassthroughValidationHash(source.sourceText),
                    resolvedAt: this.timestamp(),
                });
            } else {
                throw invalidResolution("canonical source 已不再由 active index exact/alias 解析");
            }
            assertValidatedPolicyDecision(decision, resolution, approvals[index] ?? null);
            derived.push(resolution);
        }
        return {
            resolutions: derived,
            validationHash: hashTextToImageContract({
                schemaVersion: "nbook.tag-resolution-execution-validation/v1",
                contextId,
                targetScope: parsedScope,
                indexVersion: active.manifest.indexVersion,
                manifestHash: active.manifestHash,
                policyVersion: this.policyRegistry.registry.policyVersion,
                resolverVersion: TAG_RESOLVER_VERSION,
                resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
                capabilityVersion: this.capabilityVersion,
                sourceResolutionHashes: resolutions.map(createSemanticTagResolutionHash),
                derivedResolutionHashes: derived.map(createSemanticTagResolutionHash),
                policyApprovalHashes: approvals.map((approval) => approval ? createTagPolicyApprovalHash(approval) : null),
            }),
        };
    }

    /** 发布/Compiler 共用的终态复验；不依赖 run-scoped pending repository。 */
    async validateTagResolutions(input: {
        contextId: string;
        targetScope: z.input<typeof TextToImageModelScopeSchema>;
        resolutions: SemanticTagResolution[];
        policyApprovals: Array<TagPolicyApproval | null>;
        indexVersion: string;
        policyVersion: string;
        resolverPolicyVersion: string;
        capabilityVersion: string;
    }): Promise<{validationHash: string; resolutions: SemanticTagResolution[]}> {
        const contextId = parseStableId(input.contextId, "contextId");
        const targetScope = TextToImageModelScopeSchema.parse(input.targetScope);
        const indexVersion = z.string().trim().min(1).max(160).parse(input.indexVersion);
        const policyVersion = z.string().trim().min(1).max(160).parse(input.policyVersion);
        const resolverPolicyVersion = z.string().trim().min(1).max(160).parse(input.resolverPolicyVersion);
        const capabilityVersion = z.string().trim().min(1).max(160).parse(input.capabilityVersion);
        if (!Array.isArray(input.resolutions) || input.resolutions.length > 256) {
            throw invalidResolution("validate_tag_resolutions 最多接受 256 个终态");
        }
        const resolutions = input.resolutions.map((resolution) => SemanticTagResolutionSchema.parse(resolution));
        if (!Array.isArray(input.policyApprovals) || input.policyApprovals.length !== resolutions.length) {
            throw invalidResolution("policyApprovals 必须与 resolutions 一一对应");
        }
        const policyApprovals = input.policyApprovals.map((approval) => approval === null ? null : TagPolicyApprovalSchema.parse(approval));
        const active = await this.readCompatibleActive();
        const projectPolicy = ProjectTagPolicyConfigSchema.parse(await this.resolveProjectPolicy(contextId));
        if (indexVersion !== active.manifest.indexVersion
            || policyVersion !== this.policyRegistry.registry.policyVersion
            || resolverPolicyVersion !== TAG_RESOLVER_POLICY_VERSION
            || capabilityVersion !== this.capabilityVersion) {
            throw invalidResolution("终态复验版本已漂移");
        }
        for (const [index, resolution] of resolutions.entries()) {
            if (resolution.indexVersion !== indexVersion
                || resolution.policyVersion !== policyVersion
                || resolution.resolverVersion !== TAG_RESOLVER_VERSION
                || resolution.resolverPolicyVersion !== resolverPolicyVersion
                || resolution.capabilityVersion !== capabilityVersion) {
                throw invalidResolution("SemanticTagResolution evidence 版本不一致");
            }
            if (resolution.kind === "provider_passthrough") {
                const decision = decidePassthroughPolicy(this.policyRegistry, resolution.sourceText, projectPolicy);
                assertValidatedPolicyDecision(decision, resolution, policyApprovals[index] ?? null);
                continue;
            }
            const exact = await this.reader.findExact(resolution.canonical.canonicalName);
            if (exact?.kind !== "main" || exact.matchedBy !== "exact"
                || exact.canonical.tagId !== resolution.canonical.tagId) {
                throw invalidResolution("持久 canonical Tag 已不属于 active main set");
            }
            assertSameActive(exact.evidence.indexVersion, exact.evidence.manifestHash, active);
            const decision = this.policyRegistry.decideCanonical(resolution.canonical.canonicalName, projectPolicy);
            assertValidatedPolicyDecision(decision, resolution, policyApprovals[index] ?? null);
        }
        return {
            resolutions,
            validationHash: hashTextToImageContract({
                schemaVersion: "nbook.tag-resolution-validation/v1",
                contextId,
                targetScope,
                indexVersion,
                policyVersion,
                resolverVersion: TAG_RESOLVER_VERSION,
                resolverPolicyVersion,
                capabilityVersion,
                resolutionHashes: resolutions.map(createSemanticTagResolutionHash),
                policyApprovalHashes: policyApprovals.map((approval) => approval ? createTagPolicyApprovalHash(approval) : null),
            }),
        };
    }

    /** 构建融合 source/concept/official relation evidence 的 deterministic candidate set。 */
    private async buildCandidateSet(
        stored: StoredResolution,
        active: ResolverActive,
        conceptQueries: string[],
        limit: number,
    ): Promise<TagResolverCandidateSet> {
        const candidates = new Map<number, CandidateDraft>();
        const queriedTiers = new Set<TagResolverCandidateSet["queriedTiers"][number]>();
        const queries = [stored.run.sourceText, ...conceptQueries];
        for (const [queryIndex, query] of queries.entries()) {
            const result = await this.reader.search({query, limit});
            assertSameActive(result.evidence.indexVersion, result.evidence.manifestHash, active);
            for (const tier of result.evidence.queriedTiers) queriedTiers.add(tier);
            for (const candidate of result.candidates) {
                const semanticScore = roundScore(candidate.normalizedMatchScore * (queryIndex === 0 ? 1 : 0.98));
                mergeCandidate(candidates, candidate, semanticScore, []);
            }
        }
        const relationName = normalizeRelationName(stored.run.sourceText);
        if (relationName) {
            const related = await this.reader.findRelated(relationName, 30);
            assertSameActive(related.evidence.indexVersion, related.evidence.manifestHash, active);
            for (const relation of related.relations) {
                if (relation.otherEndpoint.endpointKind !== "main") continue;
                const exact = await this.reader.findExact(relation.otherEndpoint.canonicalName);
                if (exact?.kind !== "main") continue;
                assertSameActive(exact.evidence.indexVersion, exact.evidence.manifestHash, active);
                mergeCandidate(candidates, mainFactToCandidate(exact), 0.96, ["implication"]);
            }
        }

        const drafts = [...candidates.values()]
            .filter((draft) => this.policyRegistry.decideCanonical(draft.source.canonical.canonicalName, stored.projectPolicy).decision === "allow")
            .sort(compareCandidateDrafts)
            .slice(0, limit);
        const candidateRows: TagResolverCandidate[] = drafts.map((draft, index) => {
            const policy = this.policyRegistry.decideCanonical(draft.source.canonical.canonicalName, stored.projectPolicy);
            return {
                rank: index + 1,
                canonical: draft.source.canonical,
                category: draft.source.category,
                postCount: draft.source.postCount,
                usageTier: draft.source.usageTier,
                matchClass: draft.relationEvidence.has("implication") ? "relation" : draft.source.matchClass,
                normalizedMatchScore: draft.source.normalizedMatchScore,
                semanticScore: draft.semanticScore,
                semanticClusterHash: hashTextToImageContract({
                    resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
                    canonical: draft.source.canonical,
                    relationEvidence: [...draft.relationEvidence].sort(),
                }),
                compatibility: 1,
                relationEvidence: [...draft.relationEvidence].sort(),
                eligible: draft.semanticScore >= RELIABLE_SCORE_THRESHOLD,
                policyDecision: policy.decision,
            };
        });
        const eligible = candidateRows.filter((candidate) => candidate.eligible);
        const reliableTop = eligible[0]
            && (eligible[1] === undefined || eligible[0].semanticScore - eligible[1].semanticScore >= RELIABLE_CLUSTER_MARGIN)
            ? eligible[0]
            : null;
        const conceptQueriesHash = conceptQueries.length === 0 ? null : hashTextToImageContract({conceptQueries});
        const queriedTierList = ["core", "high", "common", "tail"].filter((tier) => queriedTiers.has(tier as "core")) as TagResolverCandidateSet["queriedTiers"];
        const candidateContract = {
            schemaVersion: "nbook.tag-resolver-candidate-set/v1" as const,
            resolutionId: stored.run.resolutionId,
            indexVersion: active.manifest.indexVersion,
            policyVersion: this.policyRegistry.registry.policyVersion,
            resolverVersion: TAG_RESOLVER_VERSION,
            resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
            capabilityVersion: this.capabilityVersion,
            providerKind: "novelai" as const,
            modelScope: stored.run.modelScope,
            conceptQueriesHash,
            candidates: candidateRows,
            eligibleCandidateTagIds: eligible.map((candidate) => candidate.canonical.tagId),
            reliableTopTagId: reliableTop?.canonical.tagId ?? null,
            queriedTiers: queriedTierList,
        };
        return TagResolverCandidateSetSchema.parse({
            ...candidateContract,
            candidateSetHash: hashTextToImageContract({
                ...candidateContract,
                projectPolicy: stored.projectPolicy,
                manifestHash: active.manifestHash,
            }),
        });
    }

    /** passthrough 前复验 Project unknown policy 与 canonical-pattern block。 */
    private createPassthroughTerminal(
        stored: StoredResolution,
        active: ResolverActive,
        allowReviewRequired = false,
    ): SemanticTagResolution {
        const policy = decidePassthroughPolicy(this.policyRegistry, stored.run.sourceText, stored.projectPolicy);
        if (policy.decision === "block" || (policy.decision === "review_required" && !allowReviewRequired)) {
            assertPolicyAllows(policy.decision, stored.run.sourceText);
        }
        const wireText = assertPassthroughText(stored.run.sourceText);
        return SemanticTagResolutionSchema.parse({
            schemaVersion: "nbook.semantic-tag-resolution/v1",
            kind: "provider_passthrough",
            sourceText: stored.run.sourceText,
            indexVersion: active.manifest.indexVersion,
            policyVersion: this.policyRegistry.registry.policyVersion,
            resolverVersion: TAG_RESOLVER_VERSION,
            resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
            capabilityVersion: this.capabilityVersion,
            providerKind: "novelai",
            modelScope: stored.run.modelScope,
            candidateSetHash: stored.candidateSet!.candidateSetHash,
            resolvedAt: this.timestamp(),
            wireText,
            validationTextHash: createProviderPassthroughValidationHash(stored.run.sourceText),
            reason: "no_reliable_candidate",
            decisionProvenance: {
                selectedBy: "passthrough_fallback",
                conceptQueriesHash: stored.candidateSet!.conceptQueriesHash,
            },
        });
    }

    /** active/policy/capability 任一漂移都使 pending/candidate ref 失效。 */
    private async assertCurrentContext(stored: StoredResolution): Promise<ResolverActive> {
        const active = await this.readCompatibleActive();
        if (stored.indexVersion !== active.manifest.indexVersion || stored.manifestHash !== active.manifestHash) {
            throw staleCandidate("active Tag index 已变化");
        }
        const projectPolicy = ProjectTagPolicyConfigSchema.parse(await this.resolveProjectPolicy(stored.run.contextId));
        if (hashTextToImageContract(projectPolicy) !== hashTextToImageContract(stored.projectPolicy)) {
            throw staleCandidate("Project Tag policy 已变化");
        }
        return active;
    }

    /** active manifest 必须匹配本 Resolver capability。 */
    private async readCompatibleActive(): Promise<ResolverActive> {
        const context = await this.reader.readActiveContext();
        if (context.manifest.capabilityVersion !== this.capabilityVersion) {
            throw staleCandidate("Tag index capabilityVersion 与 Resolver 不一致");
        }
        return {manifest: context.manifest, manifestHash: context.manifestHash};
    }

    /** 要求 resolution 属于当前 run/context。 */
    private requireOwnedResolution(resolutionId: string, runId: string, contextId: string): StoredResolution {
        const stored = this.resolutions.get(resolutionId);
        if (!stored || stored.run.runId !== runId || stored.run.contextId !== contextId) {
            throw staleCandidate("resolution 不属于当前 run/context");
        }
        return stored;
    }

    /** 同一 resolution 的 suggest/finalize/override 串行化，保证幂等终态。 */
    private async withResolutionLock<TResult>(resolutionId: string, task: () => Promise<TResult>): Promise<TResult> {
        const previous = this.resolutionTails.get(resolutionId) ?? Promise.resolve();
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const tail = previous.then(() => gate);
        this.resolutionTails.set(resolutionId, tail);
        await previous;
        try {
            return await task();
        } finally {
            release();
            if (this.resolutionTails.get(resolutionId) === tail) this.resolutionTails.delete(resolutionId);
        }
    }

    /** 注入时钟的规范 UTC 时间。 */
    private timestamp(): string {
        return new Date(this.now()).toISOString();
    }
}

/** exact/alias 生成 candidateSetHash=null 的 canonical terminal。 */
function createCanonicalTerminal(input: {
    sourceText: string;
    exact: TagIndexMainFact;
    modelScope: z.output<typeof TextToImageModelScopeSchema>;
    active: ResolverActive;
    policyVersion: string;
    resolvedAt: string;
}): SemanticTagResolution {
    return SemanticTagResolutionSchema.parse({
        schemaVersion: "nbook.semantic-tag-resolution/v1",
        kind: "canonical",
        sourceText: input.sourceText,
        indexVersion: input.active.manifest.indexVersion,
        policyVersion: input.policyVersion,
        resolverVersion: TAG_RESOLVER_VERSION,
        resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
        capabilityVersion: input.active.manifest.capabilityVersion,
        providerKind: "novelai",
        modelScope: input.modelScope,
        candidateSetHash: null,
        resolvedAt: input.resolvedAt,
        matchedBy: input.exact.matchedBy,
        canonical: input.exact.canonical,
        decisionProvenance: {
            selectedBy: input.exact.matchedBy,
            conceptQueriesHash: null,
        },
    });
}

/** candidate 与审计 provenance 生成 replacement terminal。 */
function createReplacementTerminal(input: {
    stored: StoredResolution;
    active: ResolverActive;
    candidate: TagResolverCandidate;
    resolvedAt: string;
    decisionProvenance: ReplacementDecisionProvenance;
}): SemanticTagResolution {
    return SemanticTagResolutionSchema.parse({
        schemaVersion: "nbook.semantic-tag-resolution/v1",
        kind: "replacement",
        sourceText: input.stored.run.sourceText,
        indexVersion: input.active.manifest.indexVersion,
        policyVersion: input.stored.candidateSet!.policyVersion,
        resolverVersion: TAG_RESOLVER_VERSION,
        resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
        capabilityVersion: input.stored.candidateSet!.capabilityVersion,
        providerKind: "novelai",
        modelScope: input.stored.run.modelScope,
        candidateSetHash: input.stored.candidateSet!.candidateSetHash,
        resolvedAt: input.resolvedAt,
        canonical: input.candidate.canonical,
        semanticScore: input.candidate.semanticScore,
        semanticClusterHash: input.candidate.semanticClusterHash,
        candidateRank: input.candidate.rank,
        decisionProvenance: input.decisionProvenance,
    });
}

/** 同 tagId 合并多路召回并保留最高语义分/关系证据。 */
function mergeCandidate(
    candidates: Map<number, CandidateDraft>,
    candidate: TagIndexSearchCandidate,
    semanticScore: number,
    relationEvidence: Array<"alias" | "implication" | "related_token">,
): void {
    const existing = candidates.get(candidate.canonical.tagId);
    if (!existing) {
        candidates.set(candidate.canonical.tagId, {source: candidate, semanticScore, relationEvidence: new Set(relationEvidence)});
        return;
    }
    for (const evidence of relationEvidence) existing.relationEvidence.add(evidence);
    if (semanticScore > existing.semanticScore) {
        existing.source = candidate;
        existing.semanticScore = semanticScore;
    }
}

/** exact main fact 投影为 relation recall candidate。 */
function mainFactToCandidate(fact: TagIndexMainFact): TagIndexSearchCandidate {
    return {
        canonical: fact.canonical,
        category: fact.category,
        postCount: fact.postCount,
        usageTier: fact.usageTier,
        providerCompatibility: fact.providerCompatibility,
        matchClass: "fts",
        normalizedMatchScore: 0.96,
    };
}

/** 语义分优先；兼容度相同时 tier/热度只作 tie-break。 */
function compareCandidateDrafts(left: CandidateDraft, right: CandidateDraft): number {
    const tierPriority = {core: 4, high: 3, common: 2, tail: 1};
    return right.semanticScore - left.semanticScore
        || tierPriority[right.source.usageTier] - tierPriority[left.source.usageTier]
        || right.source.postCount - left.source.postCount
        || compareText(left.source.canonical.canonicalName, right.source.canonical.canonicalName);
}

/** 要求 candidateSet 中存在指定 Tag。 */
function requireCandidate(candidateSet: TagResolverCandidateSet, tagId: number): TagResolverCandidate {
    const candidate = candidateSet.candidates.find((item) => item.canonical.tagId === tagId);
    if (!candidate) throw staleCandidate("candidateTagId 不属于当前 candidate set");
    return candidate;
}

/** normalizer official name 形态，用于 relation/policy pattern 查询。 */
function normalizeRelationName(sourceText: string): string | null {
    const normalized = sourceText.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, "_");
    return /^[\x21-\x2b\x2d-\x7e]{1,170}$/u.test(normalized) ? normalized : null;
}

/** passthrough 同时受显式 registry pattern 与 Project unknown policy 约束。 */
function decidePassthroughPolicy(
    registry: TagPolicyRegistryService,
    sourceText: string,
    projectPolicy: ProjectTagPolicyConfig,
): TagPolicyDecisionEvidence {
    const relationName = normalizeRelationName(sourceText);
    const canonicalPolicy = relationName ? registry.decideCanonical(relationName, projectPolicy) : null;
    return canonicalPolicy && canonicalPolicy.matchedRuleIds.length > 0
        ? canonicalPolicy
        : registry.decideUnknown(projectPolicy);
}

/** 把 sanitizer 失败统一映射为稳定 Resolver 领域错误。 */
function assertPassthroughText(sourceText: string): string {
    try {
        return sanitizeProviderPassthrough(sourceText);
    } catch (error) {
        throw new TagIndexError({
            code: "TAG_PASSTHROUGH_INVALID",
            message: error instanceof Error ? error.message : "provider passthrough 非法",
            ...(error instanceof Error ? {cause: error} : {}),
        });
    }
}

/** Director concept query 必须是最多四个去重英文 ASCII 短语。 */
function normalizeConceptQueries(input: string[]): string[] {
    if (!Array.isArray(input) || input.length > 4) throw invalidResolution("conceptQueries 最多 4 项");
    const normalized = input.map((query) => ConceptQuerySchema.parse(query).normalize("NFKC").trim().toLowerCase());
    if (new Set(normalized).size !== normalized.length) throw invalidResolution("conceptQueries 不能重复");
    return normalized;
}

/** 解析 candidate limit。 */
function parseCandidateLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CANDIDATES) {
        throw invalidResolution("replacement candidate limit 必须是 1..8");
    }
    return value;
}

/** 解析稳定 run/context/resolution ID。 */
function parseStableId(value: string, name: string): string {
    const parsed = StableIdSchema.safeParse(value);
    if (!parsed.success) throw invalidResolution(`${name} 非法`);
    return parsed.data;
}

/** 解析正安全整数 ID。 */
function parsePositiveId(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) throw invalidResolution(`${name} 非法`);
    return value;
}

/** active evidence 必须来自同一 manifest。 */
function assertSameActive(indexVersion: string, manifestHash: string, active: ResolverActive): void {
    if (indexVersion !== active.manifest.indexVersion || manifestHash !== active.manifestHash) {
        throw staleCandidate("Tag query 跨越 active index 切换");
    }
}

/** block/review 使用不同稳定错误出口。 */
function assertPolicyAllows(decision: "allow" | "review_required" | "block", source: string): void {
    if (decision === "allow") return;
    throw new TagIndexError({
        code: decision === "block" ? "TAG_POLICY_BLOCKED" : "TAG_POLICY_REVIEW_REQUIRED",
        message: `${source} 被当前 Tag policy 判定为 ${decision}`,
    });
}

/** 发布/Compiler 复验 review approval；block 永不接受批准绕过。 */
function assertValidatedPolicyDecision(
    decision: TagPolicyDecisionEvidence,
    resolution: SemanticTagResolution,
    approval: TagPolicyApproval | null,
): void {
    if (decision.decision === "block") assertPolicyAllows("block", resolution.sourceText);
    if (decision.decision === "review_required" && !approval) {
        assertPolicyAllows("review_required", resolution.sourceText);
    }
    if (!approval) return;
    const subjectMatches = approval.subject.kind === "provider_passthrough"
        ? resolution.kind === "provider_passthrough"
            && approval.subject.validationTextHash === resolution.validationTextHash
        : resolution.kind !== "provider_passthrough"
            && approval.subject.tagId === resolution.canonical.tagId
            && approval.subject.canonicalName === resolution.canonical.canonicalName;
    if (approval.policyVersion !== decision.policyVersion
        || approval.contentScope !== decision.contentScope
        || hashTextToImageContract(approval.matchedRuleIds) !== hashTextToImageContract(decision.matchedRuleIds)
        || approval.sourceTextHash !== hashTextToImageContract({sourceText: resolution.sourceText})
        || !subjectMatches) {
        throw invalidResolution("Tag policy approval 与当前 resolution/policy evidence 不一致");
    }
    if (decision.decision !== "review_required") {
        throw invalidResolution("当前 policy 不再要求该 review approval");
    }
}

/** 分数冻结到六位，避免浮点微差进入 hash。 */
function roundScore(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
}

/** 不依赖 locale 的稳定排序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** 稳定 invalid input 错误。 */
function invalidResolution(message: string): TagIndexError {
    return new TagIndexError({code: "TAG_RESOLUTION_INVALID", message});
}

/** 稳定 stale candidate 错误。 */
function staleCandidate(message: string): TagIndexError {
    return new TagIndexError({code: "TAG_REPLACEMENT_CANDIDATE_STALE", message});
}
