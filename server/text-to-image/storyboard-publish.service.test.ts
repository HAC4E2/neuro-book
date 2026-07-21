import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createGlobalProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {IllustrationDirectorSelectorConflictError} from "nbook/server/config/config-service";
import {
    StoryboardGlobalPublishService,
    type StoryboardGlobalPublishSelectorStore,
} from "nbook/server/text-to-image/storyboard-publish.service";
import {parseStoryboardPresetMarkdown, renderStoryboardPresetMarkdown} from "nbook/server/text-to-image/storyboard-preset.codec";
import {parseTagPatternMarkdown, renderTagPatternMarkdown} from "nbook/server/text-to-image/tag-pattern.codec";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    createStoryboardImportPreviewToken,
    createRecipeProposalHash,
    ResolvedStoryboardPackageSchema,
    StoryboardImportResolvedPreviewSchema,
    type StoryboardImportResolvedPreview,
} from "nbook/shared/text-to-image-storyboard-import";
import {createStoryboardPresetHashes, StoryboardPresetSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {createTagPatternSetHashes, TagPatternSetSchema} from "nbook/shared/text-to-image-tag-pattern";

const HASH_RAW = `sha256:${"a".repeat(64)}`;
const HASH_SANITIZED = `sha256:${"b".repeat(64)}`;
const HASH_DIAGNOSTIC = `sha256:${"c".repeat(64)}`;
const HASH_CONFIG_A = `sha256:${"d".repeat(64)}`;
const HASH_CONFIG_B = `sha256:${"e".repeat(64)}`;

describe("StoryboardGlobalPublishService", () => {
    let workspaceRoot = "";
    let selector: StoryboardGlobalPublishSelectorStore;
    let selectorKey = "storyboard-presets/default.md";
    let configHash = HASH_CONFIG_A;
    let failSelectorOnce = false;

    beforeEach(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-storyboard-publish-"));
        selectorKey = "storyboard-presets/default.md";
        configHash = HASH_CONFIG_A;
        failSelectorOnce = false;
        selector = {
            read: vi.fn(async () => ({storyboardPresetKey: selectorKey, configHash})),
            update: vi.fn(async (input) => {
                if (failSelectorOnce) {
                    failSelectorOnce = false;
                    configHash = HASH_CONFIG_B;
                    throw new IllustrationDirectorSelectorConflictError();
                }
                if (input.expectedConfigHash !== configHash) throw new IllustrationDirectorSelectorConflictError();
                selectorKey = input.storyboardPresetKey;
                configHash = hashTextToImageContract({selectorKey, previous: configHash});
                return {storyboardPresetKey: selectorKey, configHash};
            }),
        };
    });

    afterEach(async () => {
        await fs.rm(workspaceRoot, {recursive: true, force: true});
    });

    it("把 approved pair create-only 发布，并在两份文件后最后切 selector", async () => {
        const resolved = createResolvedPreview();
        const verifier = vi.fn(async () => ({preview: resolved}));
        const service = createService(verifier);
        const preview = await service.preview({
            projectPath: "workspace/demo",
            importId: resolved.package.importId,
            expectedResolvedPreviewToken: resolved.package.previewToken,
            target: {mode: "candidate", confirmReplaceActive: false},
        });

        const receipt = await service.publish(createPublishRequest(preview, resolved.package.previewToken), "user-1");
        expect(receipt.state).toBe("completed");
        expect(receipt.currentSelectorKey).toBe(preview.published.presetPath);
        expect(selector.update).toHaveBeenCalledTimes(1);
        const home = createGlobalProfileHomeFacade(path.join(workspaceRoot, ".nbook"), "illustration.director");
        const preset = parseStoryboardPresetMarkdown(await home.readText(preview.published.presetPath));
        const patterns = parseTagPatternMarkdown(await home.readText(preview.published.patternPath));
        expect(preset.preset.review.status).toBe("approved");
        expect(patterns.patternSet.review.status).toBe("approved");
        expect(preset.preset.packageId).toBe(patterns.patternSet.packageId);
        expect(verifier).toHaveBeenCalledTimes(2);
    });

    it("preset 阶段中断后重放同一 journal，不覆盖也不重复验证来源", async () => {
        const resolved = createResolvedPreview();
        const verifier = vi.fn(async () => ({preview: resolved}));
        let interrupted = false;
        const first = createService(verifier, async (state) => {
            if (state === "preset_published" && !interrupted) {
                interrupted = true;
                throw new Error("simulated interruption");
            }
        });
        const preview = await first.preview({
            projectPath: "workspace/demo",
            importId: resolved.package.importId,
            expectedResolvedPreviewToken: resolved.package.previewToken,
            target: {mode: "candidate", confirmReplaceActive: false},
        });
        const request = createPublishRequest(preview, resolved.package.previewToken);
        await expect(first.publish(request, "user-1")).rejects.toThrow("simulated interruption");

        const resumed = createService(verifier);
        const receipt = await resumed.publish(request, "user-1");
        expect(receipt.state).toBe("completed");
        expect(verifier).toHaveBeenCalledTimes(2);
    });

    it("selector CAS 冲突进入 published_not_selected，显式 retry 只更新 selector", async () => {
        const resolved = createResolvedPreview();
        const verifier = vi.fn(async () => ({preview: resolved}));
        const service = createService(verifier);
        const preview = await service.preview({
            projectPath: "workspace/demo",
            importId: resolved.package.importId,
            expectedResolvedPreviewToken: resolved.package.previewToken,
            target: {mode: "candidate", confirmReplaceActive: false},
        });
        failSelectorOnce = true;
        const first = await service.publish(createPublishRequest(preview, resolved.package.previewToken), "user-1");
        expect(first.state).toBe("published_not_selected");
        expect(first.currentSelectorKey).toBe("storyboard-presets/default.md");
        expect(first.retryExpectedGlobalConfigHash).toBe(HASH_CONFIG_B);

        const completed = await service.retrySelector({
            projectPath: "workspace/demo",
            importId: resolved.package.importId,
            publishId: first.publishId,
            expectedActivePresetFileHash: null,
            expectedActivePatternFileHash: null,
            expectedGlobalConfigHash: first.retryExpectedGlobalConfigHash!,
            targetScope: "global",
            confirmGlobal: true,
        });
        expect(completed.state).toBe("completed");
        expect(selector.update).toHaveBeenCalledTimes(2);
        expect(verifier).toHaveBeenCalledTimes(2);
    });

    it("同一 publishId 的并发请求只推进一次 journal 与 selector", async () => {
        const resolved = createResolvedPreview();
        const verifier = vi.fn(async () => ({preview: resolved}));
        const service = createService(verifier);
        const preview = await service.preview({
            projectPath: "workspace/demo",
            importId: resolved.package.importId,
            expectedResolvedPreviewToken: resolved.package.previewToken,
            target: {mode: "candidate", confirmReplaceActive: false},
        });
        const request = createPublishRequest(preview, resolved.package.previewToken);

        const receipts = await Promise.all([
            service.publish(request, "user-1"),
            service.publish(request, "user-1"),
        ]);

        expect(receipts.map((receipt) => receipt.state)).toEqual(["completed", "completed"]);
        expect(new Set(receipts.map((receipt) => receipt.publishId))).toHaveLength(1);
        expect(selector.update).toHaveBeenCalledTimes(1);
        expect(verifier).toHaveBeenCalledTimes(2);
    });

    function createService(
        verifier: () => Promise<{preview: StoryboardImportResolvedPreview}>,
        onStage?: (state: string) => Promise<void>,
    ): StoryboardGlobalPublishService {
        return new StoryboardGlobalPublishService({
            workspaceRoot,
            selector,
            verifyResolvedImport: verifier,
            now: () => Date.parse("2026-07-20T00:00:00.000Z"),
            ...(onStage ? {onStage} : {}),
        });
    }
});

function createPublishRequest(
    preview: Awaited<ReturnType<StoryboardGlobalPublishService["preview"]>>,
    expectedResolvedPreviewToken: string,
) {
    return {
        projectPath: "workspace/demo",
        importId: preview.importId,
        expectedResolvedPreviewToken,
        publishPreviewToken: preview.publishPreviewToken,
        target: preview.target,
        candidatePackageHash: preview.sourceCandidatePackageHash,
        diagnosticHash: preview.diagnosticHash,
        expectedActivePresetFileHash: preview.expected.activePresetFileHash,
        expectedActivePatternFileHash: preview.expected.activePatternFileHash,
        expectedGlobalConfigHash: preview.expected.globalConfigHash,
        targetScope: "global" as const,
        confirmGlobal: true as const,
    };
}

function createResolvedPreview(): StoryboardImportResolvedPreview {
    const unboundStoryboard = StoryboardPresetSchema.parse({
        schema: "nbook.storyboard-preset/v1",
        presetId: "candidate.preset",
        patternSetId: "candidate.preset",
        packageId: "candidate.unbound",
        resourceKey: "candidate.unbound",
        title: "Candidate",
        enabled: true,
        source: {
            kind: "chatu8",
            importId: "c8i.publish",
            rawSourceHash: HASH_RAW,
            sanitizedSourceHash: HASH_SANITIZED,
            converterVersion: "converter-v1",
        },
        review: {status: "pending"},
        matching: {normalization: "nfkc-casefold"},
        defaults: {preferredShotCount: {min: 1, max: 1}, minimumParagraphGap: 1},
        macros: {bindings: {}, unresolved: []},
        rules: [{
            ruleId: "rule.primary",
            order: 1,
            enabled: true,
            when: {mode: "always", any: [], andAny: []},
            kind: "constraint",
            effect: {requireValidAnchor: true},
        }],
        risks: [],
    });
    const unboundPatterns = TagPatternSetSchema.parse({
        schema: "nbook.tag-pattern-set/v1",
        patternSetId: "candidate.preset",
        presetId: "candidate.preset",
        packageId: "candidate.unbound",
        resourceKey: "candidate.unbound",
        title: "Candidate patterns",
        enabled: true,
        source: unboundStoryboard.source,
        review: {status: "pending"},
        patterns: [],
        risks: [],
    });
    const storyboardHashes = createStoryboardPresetHashes(unboundStoryboard);
    const patternHashes = createTagPatternSetHashes(unboundPatterns);
    const candidatePackageHash = hashTextToImageContract({
        semanticHash: storyboardHashes.semanticHash,
        planningHash: patternHashes.planningHash,
        renderHash: patternHashes.renderHash,
        diagnosticHash: HASH_DIAGNOSTIC,
    });
    const digest = candidatePackageHash.slice("sha256:".length);
    const identity = {packageId: `c8pkg.${digest}`, resourceKey: `candidate.preset--${digest}`};
    const storyboard = StoryboardPresetSchema.parse({...unboundStoryboard, ...identity});
    const patterns = TagPatternSetSchema.parse({...unboundPatterns, ...identity});
    const report = {
        schemaVersion: "nbook.storyboard-import-report/v1" as const,
        importId: "c8i.publish",
        sourceProjectPath: "workspace/demo",
        sourceRelativePath: "upload/source.json" as const,
        sourceShape: "direct_entries" as const,
        sourcePresetKey: "source",
        rawSourceHash: HASH_RAW,
        sanitizedSourceHash: HASH_SANITIZED,
        converterVersion: "converter-v1",
        entryCount: 1,
        roleCounts: {system: 1, user: 0, assistant: 0},
        triggerModeCounts: {always: 1, trigger: 0},
        enabledCounts: {enabled: 1, disabled: 0},
        classificationCounts: {core_rule: 1, atomic_group: 0, scene_recipe: 0, style_quality: 0, negative_constraint: 0, trigger_alias: 0, macro: 0},
        candidateCounts: {rules: 1, patterns: 0, recipeProposals: 0, disabled: 0, ignored: 0, reportOnly: 0},
        macroTokens: [],
        secretPaths: [],
        diagnostics: [],
        compatibilityStatement: "pending candidate",
    };
    const packageBase = {
        schemaVersion: "nbook.storyboard-import-candidate-package/v1" as const,
        state: "pending" as const,
        importId: "c8i.publish",
        presetId: storyboard.presetId,
        patternSetId: patterns.patternSetId,
        ...identity,
        previousCandidatePackageHash: HASH_RAW,
        source: {projectPath: "workspace/demo", relativePath: "upload/source.json" as const, rawSourceHash: HASH_RAW, sanitizedSourceHash: HASH_SANITIZED, converterVersion: "converter-v1"},
        storyboard: {candidatePath: "resolved.storyboard.md" as const, semanticHash: storyboardHashes.semanticHash, ruleCount: 1},
        patterns: {candidatePath: "resolved.tag-patterns.md" as const, planningHash: patternHashes.planningHash, renderHash: patternHashes.renderHash, patternCount: 0, resolutionCount: 0},
        resolutionEvidence: {indexVersion: "index-v1", policyVersion: "policy-v1", resolverVersion: "resolver-v1", resolverPolicyVersion: "resolver-policy-v1", capabilityVersion: "capability-v1", providerKind: "novelai" as const, modelScope: {kind: "generic-novelai" as const}},
        resolutionCounts: {canonical: 0, replacement: 0, providerPassthrough: 0, policyApprovals: 0},
        recipeProposals: [],
        recipeProposalHash: createRecipeProposalHash([]),
        diagnosticHash: HASH_DIAGNOSTIC,
        candidatePackageHash,
        report,
    };
    const candidatePackage = ResolvedStoryboardPackageSchema.parse({...packageBase, previewToken: createStoryboardImportPreviewToken(packageBase)});
    return StoryboardImportResolvedPreviewSchema.parse({
        schemaVersion: "nbook.storyboard-import-resolved-preview/v1",
        state: "pending",
        package: candidatePackage,
        storyboardMarkdown: renderStoryboardPresetMarkdown(storyboard),
        patternMarkdown: renderTagPatternMarkdown(patterns),
        diff: {schemaVersion: "nbook.storyboard-tag-resolution-diff/v1", counts: candidatePackage.resolutionCounts, entries: []},
        approval: {enabled: true, previewToken: candidatePackage.previewToken},
    });
}
