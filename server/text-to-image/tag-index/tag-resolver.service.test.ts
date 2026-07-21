import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {ProjectTagPolicyConfig} from "nbook/shared/text-to-image-tag-policy";
import {buildTagIndexVersion} from "nbook/server/text-to-image/tag-index/tag-index-builder";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {
    createTagIndexTestSnapshot,
    createTagIndexTestTerms,
    TAG_INDEX_TEST_HASH_A,
    TAG_INDEX_TEST_HASH_B,
} from "nbook/server/text-to-image/tag-index/tag-index-test-fixture";
import {normalizeTagIndexSnapshot} from "nbook/server/text-to-image/tag-index/tag-index-normalizer";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";
import {TagResolverService} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

describe("TagResolverService", () => {
    let root = "";
    let now = 1_784_505_600_000;
    let policy: ProjectTagPolicyConfig;
    let idSequence = 0;
    let store: TagIndexStore;
    let service: TagResolverService;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-tag-resolver-"));
        policy = {contentScope: "general", unknownTagPolicy: "provider_passthrough"};
        store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        await buildAndActivate("nai-cap-v1", null);
        service = new TagResolverService({
            reader: new TagIndexReader({root}),
            policyRegistry: new TagPolicyRegistryService(),
            capabilityVersion: "nai-cap-v1",
            resolveProjectPolicy: async () => policy,
            now: () => now,
            idFactory: () => `resolution-${++idSequence}`,
        });
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    /** 构建并以 CAS 激活一个 capability 版本。 */
    async function buildAndActivate(capabilityVersion: string, expectedCurrentHash: string | null) {
        const snapshot = createTagIndexTestSnapshot();
        const normalized = normalizeTagIndexSnapshot({snapshot, capabilityVersion});
        const ready = await buildTagIndexVersion({root, snapshot, normalized, terms: createTagIndexTestTerms()});
        return store.activateVersion({
            indexVersion: ready.manifest.indexVersion,
            manifestHash: ready.manifestHash,
            expectedCurrentHash,
        });
    }

    it("returns terminal canonical refs for exact/alias and only pending refs for unknown text", async () => {
        const runs = await service.resolveTags({
            runId: "run-a",
            contextId: "project-a",
            tags: ["core_tag", "legacy_core", "unmapped_scene"],
            modelScope: {kind: "generic-novelai"},
        });

        expect(runs[0]).toMatchObject({
            state: "terminal_canonical",
            terminal: {kind: "canonical", matchedBy: "exact", canonical: {canonicalName: "core_tag"}},
        });
        expect(runs[1]).toMatchObject({
            state: "terminal_canonical",
            terminal: {kind: "canonical", matchedBy: "alias", canonical: {canonicalName: "core_tag"}},
        });
        expect(runs[2]).toMatchObject({state: "pending_unknown", sourceText: "unmapped_scene"});
        expect(runs[2]).not.toHaveProperty("candidateSet");
    });

    it("suggests only main candidates, uses relation evidence, and finalizes top replacement idempotently", async () => {
        const [pending] = await service.resolveTags({
            runId: "run-a",
            contextId: "project-a",
            tags: ["low_weather"],
            modelScope: {kind: "generic-novelai"},
        });
        const suggested = await service.suggestTagReplacements({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: pending!.resolutionId,
            conceptQueries: [],
            limit: 8,
        });
        expect(suggested).toMatchObject({
            state: "candidates_ready",
            candidateSet: {
                reliableTopTagId: 4,
                candidates: [{canonical: {canonicalName: "core_tag"}, relationEvidence: ["implication"], eligible: true}],
            },
        });
        if (suggested.state !== "candidates_ready") throw new Error("fixture 必须进入 candidates_ready");

        const request = {
            runId: "run-a",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            candidateSetHash: suggested.candidateSet.candidateSetHash,
        };
        const [left, right] = await Promise.all([
            service.finalizeTagResolution(request),
            service.finalizeTagResolution(request),
        ]);
        expect(left).toEqual(right);
        expect(left).toMatchObject({
            state: "terminal_replacement",
            terminal: {
                kind: "replacement",
                canonical: {canonicalName: "core_tag"},
                candidateRank: 1,
                decisionProvenance: {selectedBy: "resolver_top"},
            },
        });
        if (left.state !== "terminal_replacement") throw new Error("fixture 必须进入 terminal_replacement");
        const validated = await service.validateTagResolutions({
            contextId: "project-a",
            targetScope: {kind: "novelai-model", modelId: "nai-diffusion-4-full"},
            resolutions: [left.terminal],
            policyApprovals: [null],
            indexVersion: left.terminal.indexVersion,
            policyVersion: left.terminal.policyVersion,
            resolverPolicyVersion: left.terminal.resolverPolicyVersion,
            capabilityVersion: left.terminal.capabilityVersion,
        });
        expect(validated.validationHash).toMatch(/^sha256:/u);
        const execution = await service.revalidateForExecution({
            contextId: "project-a",
            targetScope: {kind: "novelai-model", modelId: "nai-diffusion-4-full"},
            resolutions: [left.terminal],
            policyApprovals: [null],
        });
        expect(execution).toMatchObject({
            validationHash: expect.stringMatching(/^sha256:/u),
            resolutions: [{
                kind: "replacement",
                sourceText: "low_weather",
                modelScope: {kind: "novelai-model", modelId: "nai-diffusion-4-full"},
                canonical: {canonicalName: "core_tag"},
            }],
        });
        await expect(service.validateTagResolutions({
            contextId: "project-a",
            targetScope: {kind: "generic-novelai"},
            resolutions: [left.terminal],
            policyApprovals: [null],
            indexVersion: "stale-index",
            policyVersion: left.terminal.policyVersion,
            resolverPolicyVersion: left.terminal.resolverPolicyVersion,
            capabilityVersion: left.terminal.capabilityVersion,
        })).rejects.toMatchObject({code: "TAG_RESOLUTION_INVALID"});
    });

    it("finalizes an empty candidate set as strict passthrough and blocks policy/grammar bypasses", async () => {
        const [pending] = await service.resolveTags({
            runId: "run-a",
            contextId: "project-a",
            tags: [" silver-blue atmospheric haze "],
            modelScope: {kind: "generic-novelai"},
        });
        const suggested = await service.suggestTagReplacements({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: pending!.resolutionId,
            conceptQueries: [],
            limit: 8,
        });
        if (suggested.state !== "candidates_ready") throw new Error("fixture 必须进入 candidates_ready");
        await expect(service.suggestTagReplacements({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            conceptQueries: ["one", "two", "three", "four", "five"],
            limit: 8,
        })).rejects.toMatchObject({code: "TAG_RESOLUTION_INVALID"});
        const finalized = await service.finalizeTagResolution({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            candidateSetHash: suggested.candidateSet.candidateSetHash,
        });
        expect(finalized).toMatchObject({
            state: "terminal_passthrough",
            terminal: {kind: "provider_passthrough", wireText: "silver-blue atmospheric haze"},
        });

        const [blocked] = await service.resolveTags({
            runId: "run-a",
            contextId: "project-a",
            tags: ["rating:explicit"],
            modelScope: {kind: "generic-novelai"},
        });
        const blockedCandidates = await service.suggestTagReplacements({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: blocked!.resolutionId,
            conceptQueries: [],
            limit: 8,
        });
        if (blockedCandidates.state !== "candidates_ready") throw new Error("fixture 必须进入 candidates_ready");
        await expect(service.finalizeTagResolution({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: blockedCandidates.resolutionId,
            candidateSetHash: blockedCandidates.candidateSet.candidateSetHash,
        })).rejects.toMatchObject({code: "TAG_POLICY_BLOCKED"});
    });

    it("requires explicit review for strict unknown policy and rejects stale/cross-run candidate refs", async () => {
        policy = {contentScope: "general", unknownTagPolicy: "review_required"};
        const [pending] = await service.resolveTags({
            runId: "run-a",
            contextId: "project-a",
            tags: ["unmapped_scene"],
            modelScope: {kind: "generic-novelai"},
        });
        const suggested = await service.suggestTagReplacements({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: pending!.resolutionId,
            conceptQueries: [],
            limit: 8,
        });
        if (suggested.state !== "candidates_ready") throw new Error("fixture 必须进入 candidates_ready");
        await expect(service.finalizeTagResolution({
            runId: "run-b",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            candidateSetHash: suggested.candidateSet.candidateSetHash,
        })).rejects.toMatchObject({code: "TAG_REPLACEMENT_CANDIDATE_STALE"});
        await expect(service.finalizeTagResolution({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            candidateSetHash: TAG_INDEX_TEST_HASH_A,
        })).rejects.toMatchObject({code: "TAG_REPLACEMENT_CANDIDATE_STALE"});
        await expect(service.finalizeTagResolution({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            candidateSetHash: suggested.candidateSet.candidateSetHash,
        })).rejects.toMatchObject({code: "TAG_POLICY_REVIEW_REQUIRED"});
    });

    it("rejects active index drift and supports a separately audited eligible user override", async () => {
        const [pending] = await service.resolveTags({
            runId: "run-a",
            contextId: "project-a",
            tags: ["core"],
            modelScope: {kind: "generic-novelai"},
        });
        const suggested = await service.suggestTagReplacements({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: pending!.resolutionId,
            conceptQueries: ["core"],
            limit: 8,
        });
        if (suggested.state !== "candidates_ready") throw new Error("fixture 必须进入 candidates_ready");
        expect(suggested.candidateSet.eligibleCandidateTagIds).toEqual([4, 5]);
        const finalized = await service.finalizeTagResolution({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            candidateSetHash: suggested.candidateSet.candidateSetHash,
        });
        expect(finalized.state).toBe("terminal_replacement");

        await expect(service.overrideRunTagResolution({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            candidateSetHash: suggested.candidateSet.candidateSetHash,
            candidateTagId: 5,
            expectedPackageHash: TAG_INDEX_TEST_HASH_A,
            currentPackageHash: TAG_INDEX_TEST_HASH_B,
            actorId: "user-a",
            reason: "用户选择更合适的候选",
            approvalId: "approval-a",
        })).rejects.toMatchObject({code: "TAG_REPLACEMENT_CANDIDATE_STALE"});
        const overridden = await service.overrideRunTagResolution({
            runId: "run-a",
            contextId: "project-a",
            resolutionId: suggested.resolutionId,
            candidateSetHash: suggested.candidateSet.candidateSetHash,
            candidateTagId: 5,
            expectedPackageHash: TAG_INDEX_TEST_HASH_A,
            currentPackageHash: TAG_INDEX_TEST_HASH_A,
            actorId: "user-a",
            reason: "用户选择更合适的候选",
            approvalId: "approval-a",
        });
        expect(overridden).toMatchObject({
            state: "terminal_replacement",
            terminal: {
                canonical: {tagId: 5, canonicalName: "second_core"},
                decisionProvenance: {
                    selectedBy: "user_override",
                    originalTopTagId: 4,
                    selectedCandidateRank: 2,
                    actorId: "user-a",
                    approvalId: "approval-a",
                },
            },
        });

        const [stalePending] = await service.resolveTags({
            runId: "run-b",
            contextId: "project-a",
            tags: ["tail"],
            modelScope: {kind: "generic-novelai"},
        });
        const staleSuggested = await service.suggestTagReplacements({
            runId: "run-b",
            contextId: "project-a",
            resolutionId: stalePending!.resolutionId,
            conceptQueries: [],
            limit: 8,
        });
        if (staleSuggested.state !== "candidates_ready") throw new Error("fixture 必须进入 candidates_ready");
        const current = await store.readActivePointerState();
        await buildAndActivate("nai-cap-v2", current.pointerHash);
        await expect(service.finalizeTagResolution({
            runId: "run-b",
            contextId: "project-a",
            resolutionId: staleSuggested.resolutionId,
            candidateSetHash: staleSuggested.candidateSet.candidateSetHash,
        })).rejects.toMatchObject({code: "TAG_REPLACEMENT_CANDIDATE_STALE"});
    });

    it("explicit import 以稳定 resolutionId 返回 terminal/review/block，并只接受当前 reviewRequestHash", async () => {
        policy = {contentScope: "general", unknownTagPolicy: "review_required"};
        const review = await service.resolveExplicitImportTag({
            runId: "import-run-a",
            contextId: "project-a",
            resolutionId: "import-tag.unmapped",
            sourceText: "unmapped_scene",
            modelScope: {kind: "generic-novelai"},
            approval: null,
        });
        expect(review).toMatchObject({state: "review_required", review: {subject: {kind: "provider_passthrough"}}});
        if (review.state !== "review_required") throw new Error("fixture 必须进入 review_required");

        await expect(service.resolveExplicitImportTag({
            runId: "import-run-a",
            contextId: "project-a",
            resolutionId: "import-tag.unmapped",
            sourceText: "unmapped_scene",
            modelScope: {kind: "generic-novelai"},
            approval: {
                reviewRequestHash: TAG_INDEX_TEST_HASH_A,
                approvalId: "approval-import-a",
                actorId: "user-a",
                reason: "确认保留普通库外标签",
            },
        })).rejects.toMatchObject({code: "TAG_REPLACEMENT_CANDIDATE_STALE"});

        const approved = await service.resolveExplicitImportTag({
            runId: "import-run-a",
            contextId: "project-a",
            resolutionId: "import-tag.unmapped",
            sourceText: "unmapped_scene",
            modelScope: {kind: "generic-novelai"},
            approval: {
                reviewRequestHash: review.review.reviewRequestHash,
                approvalId: "approval-import-a",
                actorId: "user-a",
                reason: "确认保留普通库外标签",
            },
        });
        expect(approved).toMatchObject({
            state: "terminal",
            run: {state: "terminal_passthrough", terminal: {sourceText: "unmapped_scene"}},
            reviewApproval: {approvalId: "approval-import-a", policyVersion: "nbook-minimum-policy-2026-07-1"},
        });
        if (approved.state !== "terminal" || !("terminal" in approved.run) || !approved.reviewApproval) {
            throw new Error("fixture 必须得到带 review approval 的 terminal");
        }
        const policyApproval = {
            schemaVersion: "nbook.tag-policy-approval/v1" as const,
            ...approved.reviewApproval,
            resolutionKey: "tag.test-approved",
            ownerIdentity: "storyboard.test/pattern.test",
            ownerSlot: "pattern:scene",
            sourcePath: "/entries/1/content",
            sourceTextHash: hashTextToImageContract({sourceText: approved.run.terminal.sourceText}),
        };
        await expect(service.validateTagResolutions({
            contextId: "project-a",
            targetScope: {kind: "generic-novelai"},
            resolutions: [approved.run.terminal],
            policyApprovals: [null],
            indexVersion: approved.run.terminal.indexVersion,
            policyVersion: approved.run.terminal.policyVersion,
            resolverPolicyVersion: approved.run.terminal.resolverPolicyVersion,
            capabilityVersion: approved.run.terminal.capabilityVersion,
        })).rejects.toMatchObject({code: "TAG_POLICY_REVIEW_REQUIRED"});
        await expect(service.validateTagResolutions({
            contextId: "project-a",
            targetScope: {kind: "generic-novelai"},
            resolutions: [approved.run.terminal],
            policyApprovals: [policyApproval],
            indexVersion: approved.run.terminal.indexVersion,
            policyVersion: approved.run.terminal.policyVersion,
            resolverPolicyVersion: approved.run.terminal.resolverPolicyVersion,
            capabilityVersion: approved.run.terminal.capabilityVersion,
        })).resolves.toMatchObject({validationHash: expect.stringMatching(/^sha256:/u)});

        const blocked = await service.resolveExplicitImportTag({
            runId: "import-run-a",
            contextId: "project-a",
            resolutionId: "import-tag.blocked",
            sourceText: "rating:explicit",
            modelScope: {kind: "generic-novelai"},
            approval: null,
        });
        expect(blocked).toMatchObject({state: "blocked", code: "TAG_POLICY_BLOCKED"});

        const deprecated = await service.resolveExplicitImportTag({
            runId: "import-run-a",
            contextId: "project-a",
            resolutionId: "import-tag.deprecated",
            sourceText: "deprecated_tag",
            modelScope: {kind: "generic-novelai"},
            approval: null,
        });
        expect(deprecated).toMatchObject({state: "blocked", code: "TAG_DEPRECATED_NOT_EXECUTABLE"});
    });
});
