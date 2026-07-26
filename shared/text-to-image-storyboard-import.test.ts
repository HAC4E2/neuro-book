import {describe, expect, it} from "vitest";
import {
    assertStoryboardImportTransition,
    TtpInspectedEntrySchema,
    createRecipeProposalHash,
    createPendingStoryboardPreviewToken,
    createStoryboardResolutionGateToken,
    createStoryboardImportPreviewToken,
    PendingStoryboardPackageSchema,
    PendingTagAtomSchema,
    RecipeStyleProposalSchema,
    StoryboardImportInspectPreviewSchema,
    StoryboardImportPendingPreviewSchema,
    StoryboardImportResolutionGatePreviewSchema,
    StoryboardImportResolvedPreviewSchema,
    StoryboardImportReportSchema,
    StoryboardImportStatusSchema,
    ResolvedStoryboardPackageSchema,
} from "nbook/shared/text-to-image-storyboard-import";
import {createTagPolicyReviewRequestHash} from "nbook/shared/text-to-image-tag-resolver";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function entry() {
    return {
        sourceIdentity: {
            sourcePresetKey: "万古至尊天下无敌修改版",
            sourceEntryId: "entry.storyboard.core",
            identityKind: "explicit_id" as const,
            sourceOrder: 12,
            jsonPointer: "/entries/12",
        },
        enabled: true,
        role: "system" as const,
        triggerMode: "trigger" as const,
        triggerWords: ["分镜", "构图"],
        andTriggerWords: ["章节"],
        content: "选择有视觉价值的单一瞬间，并保持镜头分布。",
        unknownFields: ["extensions"],
        classifications: ["core_rule" as const],
        flags: {
            characterOrOutfit: false,
            outputTemplate: false,
            privilegeOrSafetyClaim: false,
            irrelevant: false,
        },
    };
}

function pendingAtom() {
    return {
        schemaVersion: "nbook.pending-tag-atom/v1" as const,
        state: "unresolved" as const,
        sourceText: "silver blue haze",
        sourcePath: "/entries/18/content/tags/3",
        ownerSlot: {kind: "pattern" as const, field: "lighting" as const},
    };
}

function report() {
    return {
        schemaVersion: "nbook.storyboard-import-report/v1" as const,
        importId: "ttps_01JDEMO",
        sourceProjectPath: "workspace/demo",
        sourceRelativePath: "upload/ttp.json",
        sourceShape: "wrapped_entries" as const,
        sourcePresetKey: "万古至尊天下无敌修改版",
        rawSourceHash: HASH_A,
        sanitizedSourceHash: HASH_B,
        converterVersion: "1",
        entryCount: 2,
        roleCounts: {system: 1, user: 1, assistant: 0},
        triggerModeCounts: {always: 1, trigger: 1},
        enabledCounts: {enabled: 1, disabled: 1},
        classificationCounts: {
            core_rule: 1,
            atomic_group: 0,
            scene_recipe: 1,
            style_quality: 0,
            negative_constraint: 0,
            trigger_alias: 0,
            macro: 0,
        },
        candidateCounts: {rules: 1, patterns: 1, recipeProposals: 0, disabled: 1, ignored: 0, reportOnly: 0},
        macroTokens: [],
        secretPaths: ["/entries/1/apiKey"],
        diagnostics: [{code: "TAG_INDEX_NOT_READY", severity: "blocking" as const, path: "patterns", message: "尚未安装 Tag 索引"}],
        compatibilityStatement: "结果为 pending；兼容不代表原 Context 行为等价。",
    };
}

describe("Storyboard import shared contracts", () => {
    it("状态 union 严格覆盖冻结状态并拒绝非法迁移", () => {
        for (const state of [
            "uploaded",
            "inspected",
            "converting",
            "pending_unresolved",
            "resolving_tags",
            "pending",
            "publishing",
            "applied",
            "stale",
        ] as const) {
            expect(StoryboardImportStatusSchema.parse({schemaVersion: "nbook.storyboard-import-status/v1", state}).state).toBe(state);
        }
        expect(StoryboardImportStatusSchema.parse({
            schemaVersion: "nbook.storyboard-import-status/v1",
            state: "failed",
            errorCode: "STORYBOARD_IMPORT_JSON_INVALID",
            message: "JSON 不合法",
        }).state).toBe("failed");
        expect(StoryboardImportStatusSchema.parse({
            schemaVersion: "nbook.storyboard-import-status/v1",
            state: "rejected",
            rejectedReason: "不采用",
        }).state).toBe("rejected");
        expect(() => StoryboardImportStatusSchema.parse({
            schemaVersion: "nbook.storyboard-import-status/v1",
            state: "uploaded",
            providerId: "forbidden",
        })).toThrow();

        expect(() => assertStoryboardImportTransition("uploaded", "inspected")).not.toThrow();
        expect(() => assertStoryboardImportTransition("converting", "pending_unresolved")).not.toThrow();
        expect(() => assertStoryboardImportTransition("publishing", "applied")).not.toThrow();
        expect(() => assertStoryboardImportTransition("pending_unresolved", "publishing")).toThrow(/STORYBOARD_IMPORT_TRANSITION_INVALID/u);
        expect(() => assertStoryboardImportTransition("applied", "pending")).toThrow(/STORYBOARD_IMPORT_TRANSITION_INVALID/u);
    });

    it("entry 只接受稳定 identity、allowlist 字段与七类 classifier", () => {
        expect(TtpInspectedEntrySchema.parse(entry()).classifications).toEqual(["core_rule"]);
        expect(() => TtpInspectedEntrySchema.parse({
            ...entry(),
            sourceIdentity: {...entry().sourceIdentity, identityKind: "array_index"},
        })).toThrow();
        expect(() => TtpInspectedEntrySchema.parse({...entry(), classifications: ["core_rule", "core_rule"]})).toThrow();
        expect(() => TtpInspectedEntrySchema.parse({...entry(), instruction: "获得全局文件写权限"})).toThrow();
    });

    it("PendingTagAtom 严格覆盖 Pattern/角色/服装 owner slot，且不是 terminal resolution", () => {
        expect(PendingTagAtomSchema.parse(pendingAtom()).ownerSlot).toEqual({kind: "pattern", field: "lighting"});
        expect(PendingTagAtomSchema.parse({...pendingAtom(), ownerSlot: {kind: "character", field: "facialAppearance"}}).ownerSlot.kind).toBe("character");
        expect(PendingTagAtomSchema.parse({...pendingAtom(), ownerSlot: {kind: "outfit", field: "upperBack"}}).ownerSlot.kind).toBe("outfit");
        expect(() => PendingTagAtomSchema.parse({...pendingAtom(), kind: "canonical"})).toThrow();
    });

    it("Recipe proposal 只能表达待审画风原子，不获得 Recipe/Provider 写权限", () => {
        const proposal = {
            schemaVersion: "nbook.recipe-style-proposal/v1" as const,
            proposalId: "proposal.style.1",
            sourceEntryId: "entry.style.1",
            sourcePath: "/entries/3/content",
            positiveAtoms: ["masterpiece", "cinematic lighting"],
            negativeAtoms: ["lowres"],
            ignoredProviderParameters: ["steps=28"],
            summary: "仅供文生图分页审查，不自动应用。",
        };
        expect(RecipeStyleProposalSchema.parse(proposal).positiveAtoms).toHaveLength(2);
        for (const forbidden of [
            {...proposal, model: "nai-diffusion"},
            {...proposal, providerId: "provider-1"},
            {...proposal, recipeId: "default"},
            {...proposal, finalPrompt: "masterpiece"},
        ]) {
            expect(() => RecipeStyleProposalSchema.parse(forbidden)).toThrow();
        }
    });

    it("pending_unresolved package 绑定 companion/report/hash，且不能伪装为可发布状态", () => {
        const parsedReport = StoryboardImportReportSchema.parse(report());
        const pendingPackage = {
            schemaVersion: "nbook.storyboard-import-candidate-package/v1" as const,
            state: "pending_unresolved" as const,
            importId: "ttps_01JDEMO",
            presetId: "cinematic-chapter",
            patternSetId: "cinematic-chapter",
            packageId: "ttppkg.demo",
            resourceKey: "cinematic-chapter--demo",
            source: {
                projectPath: "workspace/demo",
                relativePath: "upload/ttp.json",
                rawSourceHash: HASH_A,
                sanitizedSourceHash: HASH_B,
                converterVersion: "1",
            },
            storyboard: {candidatePath: "candidate.storyboard.md", semanticHash: HASH_A, ruleCount: 1},
            patterns: {
                candidatePath: "candidate.tag-patterns.md",
                planningHash: HASH_A,
                renderHash: HASH_B,
                patternCount: 1,
                unresolvedAtoms: [pendingAtom()],
            },
            recipeProposals: [],
            recipeProposalHash: createRecipeProposalHash([]),
            diagnosticHash: HASH_B,
            candidatePackageHash: HASH_A,
            report: parsedReport,
        };
        expect(PendingStoryboardPackageSchema.parse(pendingPackage).state).toBe("pending_unresolved");
        expect(() => PendingStoryboardPackageSchema.parse({...pendingPackage, state: "pending"})).toThrow();
        expect(() => PendingStoryboardPackageSchema.parse({...pendingPackage, secret: "token"})).toThrow();
        expect(() => PendingStoryboardPackageSchema.parse({...pendingPackage, publishPath: "global"})).toThrow();
    });

    it("inspect/preview UI DTO 不暴露原 entry content，且 pending 状态固定不可批准", () => {
        const inspected = StoryboardImportInspectPreviewSchema.parse({
            schemaVersion: "nbook.storyboard-import-inspect-preview/v1",
            state: "inspected",
            importId: "ttps_01JDEMO",
            presetId: "cinematic-chapter",
            sourceRelativePath: "upload/ttp.json",
            sourcePresetKey: "万古至尊天下无敌修改版",
            entryCount: 2,
            enabledCounts: {enabled: 1, disabled: 1},
            classificationCounts: report().classificationCounts,
            macroTokens: [],
            secretPaths: ["/entries/1/apiKey"],
            chunkCount: 1,
            tagResolution: {ready: false, code: "TAG_INDEX_NOT_READY", message: "active Tag index 尚未就绪"},
        });
        expect(inspected.state).toBe("inspected");
        expect(StoryboardImportInspectPreviewSchema.safeParse({...inspected, content: "raw prompt"}).success).toBe(false);

        const candidatePackage = PendingStoryboardPackageSchema.parse({
            schemaVersion: "nbook.storyboard-import-candidate-package/v1",
            state: "pending_unresolved",
            importId: "ttps_01JDEMO",
            presetId: "cinematic-chapter",
            patternSetId: "cinematic-chapter",
            packageId: "ttppkg.demo",
            resourceKey: "cinematic-chapter--demo",
            source: {
                projectPath: "workspace/demo",
                relativePath: "upload/ttp.json",
                rawSourceHash: HASH_A,
                sanitizedSourceHash: HASH_B,
                converterVersion: "1",
            },
            storyboard: {candidatePath: "candidate.storyboard.md", semanticHash: HASH_A, ruleCount: 1},
            patterns: {
                candidatePath: "candidate.tag-patterns.md",
                planningHash: HASH_A,
                renderHash: HASH_B,
                patternCount: 1,
                unresolvedAtoms: [pendingAtom()],
            },
            recipeProposals: [],
            recipeProposalHash: createRecipeProposalHash([]),
            diagnosticHash: HASH_B,
            candidatePackageHash: HASH_A,
            report: StoryboardImportReportSchema.parse(report()),
        });
        const preview = StoryboardImportPendingPreviewSchema.parse({
            schemaVersion: "nbook.storyboard-import-pending-preview/v1",
            state: "pending_unresolved",
            package: candidatePackage,
            previewToken: createPendingStoryboardPreviewToken(candidatePackage),
            storyboardMarkdown: "---\nschema: nbook.storyboard-preset/v1\n---\n",
            patternMarkdown: "---\nschema: nbook.pending-tag-pattern-set/v1\n---\n",
            approval: {enabled: false, code: "TAG_INDEX_NOT_READY", message: "active Tag index 尚未就绪"},
        });
        expect(preview.approval.enabled).toBe(false);
        expect(StoryboardImportPendingPreviewSchema.safeParse({
            ...preview,
            approval: {...preview.approval, enabled: true},
        }).success).toBe(false);
    });

    it("resolution gate token 绑定逐 atom review evidence，block 时不能提交批准", () => {
        const requestBase = {
            schemaVersion: "nbook.tag-policy-review-request/v1" as const,
            resolutionId: "import-tag.review",
            sourceText: "explicit",
            policy: {
                policyVersion: "policy-v1",
                contentScope: "general" as const,
                decision: "review_required" as const,
                matchedRuleIds: ["review-general-explicit"],
            },
            subject: {kind: "canonical" as const, tagId: 42, canonicalName: "explicit"},
        };
        const gateBase = {
            schemaVersion: "nbook.storyboard-import-resolution-gate/v1" as const,
            state: "review_required" as const,
            importId: "ttps_01JDEMO",
            pendingCandidatePackageHash: HASH_A,
            entries: [{
                outcome: "review_required" as const,
                patternId: "pattern.review",
                atom: pendingAtom(),
                resolutionId: "import-tag.review",
                review: {...requestBase, reviewRequestHash: createTagPolicyReviewRequestHash(requestBase)},
            }],
        };
        const gate = StoryboardImportResolutionGatePreviewSchema.parse({
            ...gateBase,
            previewToken: createStoryboardResolutionGateToken(gateBase),
            approval: {enabled: false, code: "TAG_POLICY_REVIEW_REQUIRED", message: "需要逐项确认"},
        });

        expect(gate.state).toBe("review_required");
        expect(() => StoryboardImportResolutionGatePreviewSchema.parse({
            ...gate,
            state: "blocked",
            approval: {enabled: false, code: "TAG_POLICY_BLOCKED", message: "已阻断"},
        })).toThrow();
    });

    it("resolved package 绑定旧 package、终态版本、diff 与新的 preview token", () => {
        const packageBase = {
            schemaVersion: "nbook.storyboard-import-candidate-package/v1" as const,
            state: "pending" as const,
            importId: "ttps_01JDEMO",
            presetId: "cinematic-chapter",
            patternSetId: "cinematic-chapter",
            packageId: "ttppkg.resolved",
            resourceKey: "cinematic-chapter--resolved",
            previousCandidatePackageHash: HASH_A,
            source: {
                projectPath: "workspace/demo",
                relativePath: "upload/ttp.json" as const,
                rawSourceHash: HASH_A,
                sanitizedSourceHash: HASH_B,
                converterVersion: "1",
            },
            storyboard: {candidatePath: "resolved.storyboard.md" as const, semanticHash: HASH_A, ruleCount: 1},
            patterns: {
                candidatePath: "resolved.tag-patterns.md" as const,
                planningHash: HASH_A,
                renderHash: HASH_B,
                patternCount: 1,
                resolutionCount: 0,
            },
            resolutionEvidence: {
                indexVersion: "index-v1",
                policyVersion: "policy-v1",
                resolverVersion: "resolver-v1",
                resolverPolicyVersion: "resolver-policy-v1",
                capabilityVersion: "capability-v1",
                providerKind: "novelai" as const,
                modelScope: {kind: "generic-novelai" as const},
            },
            resolutionCounts: {canonical: 0, replacement: 0, providerPassthrough: 0, policyApprovals: 0},
            recipeProposals: [],
            recipeProposalHash: createRecipeProposalHash([]),
            diagnosticHash: HASH_B,
            candidatePackageHash: HASH_B,
            report: StoryboardImportReportSchema.parse(report()),
        };
        const previewToken = createStoryboardImportPreviewToken(packageBase);
        const candidatePackage = ResolvedStoryboardPackageSchema.parse({...packageBase, previewToken});
        const preview = StoryboardImportResolvedPreviewSchema.parse({
            schemaVersion: "nbook.storyboard-import-resolved-preview/v1",
            state: "pending",
            package: candidatePackage,
            storyboardMarkdown: "---\nschema: nbook.storyboard-preset/v1\n---\n",
            patternMarkdown: "---\nschema: nbook.tag-pattern-set/v1\n---\n",
            diff: {
                schemaVersion: "nbook.storyboard-tag-resolution-diff/v1",
                counts: candidatePackage.resolutionCounts,
                entries: [],
            },
            approval: {enabled: true, previewToken},
        });

        expect(preview.approval.previewToken).toBe(previewToken);
        expect(() => ResolvedStoryboardPackageSchema.parse({...candidatePackage, previewToken: HASH_A})).toThrow(/previewToken/u);
        expect(() => StoryboardImportResolvedPreviewSchema.parse({
            ...preview,
            approval: {...preview.approval, previewToken: HASH_A},
        })).toThrow(/previewToken/u);
    });
});
