import {describe, expect, it} from "vitest";
import {
    createTagPolicyReviewRequestHash,
    TagResolutionRunSchema,
    TagResolverCandidateSetSchema,
    TagResolverExplicitResultSchema,
    TagResolverSearchRequestSchema,
} from "nbook/shared/text-to-image-tag-resolver";
import {createProviderPassthroughValidationHash} from "nbook/shared/text-to-image-tag-resolution";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

/** 构造复用 P0 terminal envelope 的 canonical fixture。 */
function canonicalTerminal(): object {
    return {
        schemaVersion: "nbook.semantic-tag-resolution/v1",
        kind: "canonical",
        sourceText: "wide shot",
        indexVersion: "db3k-fixture",
        policyVersion: "safe-v1",
        resolverVersion: "resolver-v1",
        resolverPolicyVersion: "resolver-policy-v1",
        capabilityVersion: "nai-cap-v1",
        providerKind: "novelai",
        modelScope: {kind: "generic-novelai"},
        candidateSetHash: null,
        resolvedAt: "2026-07-20T00:00:00.000Z",
        matchedBy: "alias",
        canonical: {tagId: 10, canonicalName: "wide_shot"},
        decisionProvenance: {selectedBy: "alias", conceptQueriesHash: null},
    };
}

describe("text-to-image Tag resolver contracts", () => {
    it("allows only exact or alias results to terminate directly from created", () => {
        const run = TagResolutionRunSchema.parse({
            schemaVersion: "nbook.tag-resolution-run/v1",
            state: "terminal_canonical",
            runId: "trun-fixture",
            resolutionId: "tres-fixture",
            contextId: "import-fixture",
            sourceText: "wide shot",
            modelScope: {kind: "generic-novelai"},
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:00:00.000Z",
            terminal: canonicalTerminal(),
        });
        expect(run.state).toBe("terminal_canonical");
        expect(() => TagResolutionRunSchema.parse({...run, terminal: {...canonicalTerminal(), kind: "replacement"}})).toThrow();
    });

    it("freezes candidate ordering, eligibility and candidateSetHash", () => {
        const set = TagResolverCandidateSetSchema.parse({
            schemaVersion: "nbook.tag-resolver-candidate-set/v1",
            resolutionId: "tres-fixture",
            indexVersion: "db3k-fixture",
            policyVersion: "safe-v1",
            resolverVersion: "resolver-v1",
            resolverPolicyVersion: "resolver-policy-v1",
            capabilityVersion: "nai-cap-v1",
            providerKind: "novelai",
            modelScope: {kind: "generic-novelai"},
            conceptQueriesHash: HASH_A,
            candidateSetHash: HASH_B,
            candidates: [
                {
                    rank: 1,
                    canonical: {tagId: 10, canonicalName: "rain"},
                    category: "general",
                    postCount: 90000,
                    usageTier: "high",
                    matchClass: "fts",
                    normalizedMatchScore: 0.96,
                    semanticScore: 0.96,
                    semanticClusterHash: HASH_A,
                    compatibility: 1,
                    relationEvidence: ["implication"],
                    eligible: true,
                },
                {
                    rank: 2,
                    canonical: {tagId: 11, canonicalName: "rainy"},
                    category: "general",
                    postCount: 5000,
                    usageTier: "tail",
                    matchClass: "prefix",
                    normalizedMatchScore: 0.9,
                    semanticScore: 0.9,
                    semanticClusterHash: HASH_B,
                    compatibility: 1,
                    relationEvidence: [],
                    eligible: false,
                },
            ],
            eligibleCandidateTagIds: [10],
            reliableTopTagId: 10,
            queriedTiers: ["core", "high", "common", "tail"],
        });
        expect(set.reliableTopTagId).toBe(10);
        expect(() => TagResolverCandidateSetSchema.parse({...set, eligibleCandidateTagIds: [11]})).toThrow();
        expect(() => TagResolverCandidateSetSchema.parse({...set, reliableTopTagId: 11})).toThrow();
        expect(TagResolverCandidateSetSchema.parse({...set, reliableTopTagId: null}).eligibleCandidateTagIds).toEqual([10]);
    });

    it("keeps pending and candidates out of the terminal snapshot union", () => {
        const pending = TagResolutionRunSchema.parse({
            schemaVersion: "nbook.tag-resolution-run/v1",
            state: "pending_unknown",
            runId: "trun-fixture",
            resolutionId: "tres-fixture",
            contextId: "import-fixture",
            sourceText: "silver blue haze",
            modelScope: {kind: "generic-novelai"},
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:00:00.000Z",
        });
        expect(pending.state).toBe("pending_unknown");
        expect(() => TagResolutionRunSchema.parse({...pending, terminal: canonicalTerminal()})).toThrow();
    });

    it("accepts terminal passthrough only with the existing strict sanitizer evidence", () => {
        const sourceText = " silver-blue atmospheric haze ";
        const terminal = {
            schemaVersion: "nbook.semantic-tag-resolution/v1",
            kind: "provider_passthrough",
            sourceText,
            wireText: "silver-blue atmospheric haze",
            validationTextHash: createProviderPassthroughValidationHash(sourceText),
            indexVersion: "db3k-fixture",
            policyVersion: "safe-v1",
            resolverVersion: "resolver-v1",
            resolverPolicyVersion: "resolver-policy-v1",
            capabilityVersion: "nai-cap-v1",
            providerKind: "novelai",
            modelScope: {kind: "generic-novelai"},
            candidateSetHash: HASH_A,
            resolvedAt: "2026-07-20T00:00:00.000Z",
            reason: "no_reliable_candidate",
            decisionProvenance: {selectedBy: "passthrough_fallback", conceptQueriesHash: null},
        };
        const run = TagResolutionRunSchema.parse({
            schemaVersion: "nbook.tag-resolution-run/v1",
            state: "terminal_passthrough",
            runId: "trun-fixture",
            resolutionId: "tres-fixture",
            contextId: "import-fixture",
            sourceText,
            modelScope: {kind: "generic-novelai"},
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:00:00.000Z",
            terminal,
        });
        expect(run.state).toBe("terminal_passthrough");
        expect(() => TagResolutionRunSchema.parse({
            ...run,
            terminal: {...terminal, wireText: "{silver-blue haze}"},
        })).toThrow();
    });

    it("bounds search requests and never accepts arbitrary provider/source fields", () => {
        expect(TagResolverSearchRequestSchema.parse({
            query: "wide shot",
            modelScope: {kind: "generic-novelai"},
            limit: 30,
        }).limit).toBe(30);
        expect(() => TagResolverSearchRequestSchema.parse({
            query: "wide shot",
            modelScope: {kind: "generic-novelai"},
            limit: 31,
        })).toThrow();
        expect(() => TagResolverSearchRequestSchema.parse({
            query: "wide shot",
            modelScope: {kind: "generic-novelai"},
            limit: 8,
            sourceUrl: "https://example.com",
        })).toThrow();
    });

    it("explicit import 的 review/block 结果绑定 resolution、policy 与 subject，不混入 terminal union", () => {
        const requestBase = {
            schemaVersion: "nbook.tag-policy-review-request/v1" as const,
            resolutionId: "import-tag.abc",
            sourceText: "explicit",
            policy: {
                policyVersion: "safe-v1",
                contentScope: "general" as const,
                decision: "review_required" as const,
                matchedRuleIds: ["review-general-explicit"],
            },
            subject: {kind: "canonical" as const, tagId: 42, canonicalName: "explicit"},
        };
        const reviewRequestHash = createTagPolicyReviewRequestHash(requestBase);
        const review = TagResolverExplicitResultSchema.parse({
            state: "review_required",
            review: {...requestBase, reviewRequestHash},
        });
        const blocked = TagResolverExplicitResultSchema.parse({
            state: "blocked",
            code: "TAG_POLICY_BLOCKED",
            resolutionId: "import-tag.blocked",
            sourceText: "rating:explicit",
            policy: {...requestBase.policy, decision: "block", matchedRuleIds: ["block-rating-control-prefix"]},
            subject: {kind: "provider_passthrough", validationTextHash: HASH_A},
        });

        expect(review.state).toBe("review_required");
        expect(blocked.state).toBe("blocked");
        if (review.state !== "review_required") throw new Error("fixture 必须进入 review_required");
        expect(() => TagResolverExplicitResultSchema.parse({
            ...review,
            review: {...review.review, reviewRequestHash: HASH_A},
        })).toThrow(/reviewRequestHash/u);
        expect(() => TagResolverExplicitResultSchema.parse({...review, terminal: canonicalTerminal()})).toThrow();
    });
});
