import {hashTextToImageContract, type TextToImageContractValue} from "nbook/shared/text-to-image-contract-hash";
import {
    TAG_PATTERN_RETRIEVAL_POLICY_VERSION,
    TagPatternCandidateSetSchema,
    TagPatternSearchRequestSchema,
    type TagPatternCandidateSet,
    type TagPatternCandidateSummary,
    type TagPatternSearchRequest,
} from "nbook/shared/text-to-image-tag-pattern-retrieval";
import {TextToImageContractHashSchema, type TextToImageModelScope} from "nbook/shared/text-to-image-tag-resolution";
import {type TagPattern} from "nbook/shared/text-to-image-tag-pattern";

type RetrievalInput = {
    effectivePlanningHash: string;
    patterns: TagPattern[];
    provenance: Array<{
        patternId: string;
        scope: "base";
        operation: "base";
        sourceEntryId: string | null;
    }>;
    request: TagPatternSearchRequest;
};

/**
 * 对 Effective Pattern Set 做确定性 applicability / trigger 预筛和稳定排序。
 *
 * 输出只包含 planning 摘要与 resolution key；最终 Tag 展开仍属于 P4 Compiler。
 */
export function retrieveTagPatterns(input: RetrievalInput): TagPatternCandidateSet {
    const effectivePlanningHash = TextToImageContractHashSchema.parse(input.effectivePlanningHash);
    const request = TagPatternSearchRequestSchema.parse(input.request);
    const normalizedQuery = normalizeSearchText(request.query);
    const provenance = new Map(input.provenance.map((item) => [item.patternId, item]));
    const requestHash = hashTextToImageContract({
        schemaVersion: "nbook.tag-pattern-search-request/v1",
        retrievalPolicyVersion: TAG_PATTERN_RETRIEVAL_POLICY_VERSION,
        effectivePlanningHash,
        query: normalizedQuery,
        intent: request.intent ?? null,
        applicability: request.applicability,
        limit: request.limit,
    });
    const candidates = input.patterns.flatMap((pattern) => {
        if (!pattern.enabled || !matchesApplicability(pattern, request)) return [];
        const match = scorePattern(pattern, normalizedQuery, request);
        if (!match) return [];
        const source = provenance.get(pattern.patternId);
        if (!source) return [];
        return [{
            patternId: pattern.patternId,
            sourceEntryId: pattern.sourceEntryId ?? null,
            order: pattern.order,
            intent: {...pattern.intent},
            applicability: {
                characterCount: {...pattern.retrieval.characterCount},
                canvasIntents: [...pattern.retrieval.canvasIntents],
                ratingScopes: [...pattern.retrieval.ratingScopes],
                providerKinds: [...pattern.retrieval.providerKinds] as ["novelai"],
                modelScopes: pattern.retrieval.modelScopes.map((scope) => ({...scope})),
            },
            resolutionRefs: {
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
            },
            provenance: {
                scope: source.scope,
                operation: source.operation,
                sourceEntryId: source.sourceEntryId,
            },
            match,
        } satisfies TagPatternCandidateSummary];
    }).sort(compareCandidates).slice(0, request.limit);
    const candidateSetHash = hashTextToImageContract({
        schemaVersion: "nbook.tag-pattern-candidate-set-identity/v1",
        retrievalPolicyVersion: TAG_PATTERN_RETRIEVAL_POLICY_VERSION,
        effectivePlanningHash,
        requestHash,
        candidates: candidates.map((candidate): TextToImageContractValue => ({
            patternId: candidate.patternId,
            sourceEntryId: candidate.sourceEntryId,
            order: candidate.order,
            intent: {...candidate.intent},
            applicability: {
                characterCount: {...candidate.applicability.characterCount},
                canvasIntents: [...candidate.applicability.canvasIntents],
                ratingScopes: [...candidate.applicability.ratingScopes],
                providerKinds: [...candidate.applicability.providerKinds],
                modelScopes: candidate.applicability.modelScopes.map((scope): TextToImageContractValue => scope.kind === "generic-novelai"
                    ? {kind: scope.kind}
                    : {kind: scope.kind, modelId: scope.modelId}),
            },
            provenance: {...candidate.provenance},
            match: {score: candidate.match.score, reasons: [...candidate.match.reasons]},
        })),
    });
    return TagPatternCandidateSetSchema.parse({
        schemaVersion: "nbook.tag-pattern-candidate-set/v1",
        retrievalPolicyVersion: TAG_PATTERN_RETRIEVAL_POLICY_VERSION,
        effectivePlanningHash,
        requestHash,
        candidateSetHash,
        candidates,
    });
}

/** 从已冻结闭集中按请求顺序返回 Pattern 摘要；未知 ID 整次拒绝。 */
export function getTagPatternCandidates(input: {candidateSet: TagPatternCandidateSet; patternIds: string[]}): TagPatternCandidateSummary[] {
    const candidateSet = TagPatternCandidateSetSchema.parse(input.candidateSet);
    if (!Array.isArray(input.patternIds) || input.patternIds.length < 1 || input.patternIds.length > 5) {
        throw new Error("TAG_PATTERN_QUERY_INVALID: get_tag_patterns 只接受 1..5 个 patternId");
    }
    if (new Set(input.patternIds).size !== input.patternIds.length) {
        throw new Error("TAG_PATTERN_QUERY_INVALID: patternId 不能重复");
    }
    const candidates = new Map(candidateSet.candidates.map((candidate) => [candidate.patternId, candidate]));
    return input.patternIds.map((patternId) => {
        const candidate = candidates.get(patternId);
        if (!candidate) throw new Error(`TAG_PATTERN_NOT_EXPOSED: ${patternId}`);
        return candidate;
    });
}

/** NFKC + case-fold + 稳定空白折叠；中文 trigger 只参与本地召回。 */
function normalizeSearchText(value: string): string {
    return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

/** applicability 是硬过滤，不参与模糊分数。 */
function matchesApplicability(pattern: TagPattern, request: TagPatternSearchRequest): boolean {
    const applicability = request.applicability;
    const retrieval = pattern.retrieval;
    if (applicability.characterCount < retrieval.characterCount.min || applicability.characterCount > retrieval.characterCount.max) return false;
    if (applicability.canvasIntent !== null
        && retrieval.canvasIntents.length > 0
        && !retrieval.canvasIntents.includes(applicability.canvasIntent)) return false;
    if (!retrieval.ratingScopes.includes(applicability.ratingScope)) return false;
    if (!retrieval.providerKinds.includes(applicability.providerKind)) return false;
    if (retrieval.modelScopes.length > 0 && !retrieval.modelScopes.some((scope) => modelScopeMatches(scope, applicability.modelScope))) return false;
    if (request.intent && Object.entries(request.intent).some(([key, value]) => pattern.intent[key as keyof typeof pattern.intent] !== value)) return false;
    return true;
}

/** generic pattern 可用于任一 NovelAI model；具体 pattern 只匹配同一具体 model。 */
function modelScopeMatches(patternScope: TextToImageModelScope, requestScope: TextToImageModelScope): boolean {
    if (patternScope.kind === "generic-novelai") return true;
    return requestScope.kind === "novelai-model" && patternScope.modelId === requestScope.modelId;
}

/** trigger 质量优先；intent 只在已通过硬过滤后提供稳定加分。 */
function scorePattern(
    pattern: TagPattern,
    normalizedQuery: string,
    request: TagPatternSearchRequest,
): TagPatternCandidateSummary["match"] | null {
    const reasons: TagPatternCandidateSummary["match"]["reasons"] = [];
    let score = 0;
    if (pattern.retrieval.mode === "always") {
        reasons.push("always");
        score = 10;
    } else {
        const anyTriggers = pattern.retrieval.any.map(normalizeSearchText);
        const allTriggers = pattern.retrieval.andAny.map(normalizeSearchText);
        const exact = anyTriggers.some((trigger) => trigger === normalizedQuery);
        const any = anyTriggers.some((trigger) => trigger.length > 0 && normalizedQuery.includes(trigger));
        const all = allTriggers.length > 0 && allTriggers.every((trigger) => trigger.length > 0 && normalizedQuery.includes(trigger));
        if (exact) {
            reasons.push("trigger_exact");
            score = 140;
        } else if (all) {
            reasons.push("trigger_all");
            score = 110;
        } else if (any) {
            reasons.push("trigger_any");
            score = 80;
        } else {
            return null;
        }
    }
    if (request.intent) {
        reasons.push("intent");
        score += 20;
    }
    return {score, reasons};
}

/** 分数优先，业务 order 与 ASCII patternId 只作稳定 tie-break。 */
function compareCandidates(left: TagPatternCandidateSummary, right: TagPatternCandidateSummary): number {
    return right.match.score - left.match.score
        || left.order - right.order
        || (left.patternId < right.patternId ? -1 : left.patternId > right.patternId ? 1 : 0);
}
