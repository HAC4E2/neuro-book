import {describe, expect, it} from "vitest";
import {parseTtpStoryboardJson} from "nbook/server/text-to-image/ttp-storyboard-json";
import {inspectTtpStoryboard} from "nbook/server/text-to-image/ttp-storyboard-inspector";
import {
    buildPendingStoryboardCompanion,
    buildResolvedStoryboardCompanion,
    createPatternResolutionKey,
    rebaseResolvedStoryboardCompanion,
    StoryboardConversionOutputSchema,
} from "nbook/server/text-to-image/storyboard-candidate.service";
import {PendingTagPatternSetSchema} from "nbook/shared/text-to-image-storyboard-candidate";
import {PendingStoryboardPackageSchema} from "nbook/shared/text-to-image-storyboard-import";
import {TagPatternSetSchema} from "nbook/shared/text-to-image-tag-pattern";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

function inspect(entries: object[]) {
    const parsed = parseTtpStoryboardJson(new TextEncoder().encode(JSON.stringify({entries})));
    return inspectTtpStoryboard(parsed);
}

function createRule(sourceEntryId: string, sourcePath: string) {
    return {
        kind: "shot-selection" as const,
        semanticSlot: "primary" as const,
        sourceEntryId,
        order: 10,
        enabled: true,
        when: {mode: "always" as const, any: [], andAny: []},
        provenance: {conversion: "derived" as const, sourcePaths: [sourcePath]},
        effect: {
            operation: "prefer" as const,
            beatTypes: ["establishing" as const, "action" as const],
            distribution: "balanced" as const,
            scoreDelta: 20,
        },
    };
}

function createPattern(sourceEntryId: string, sourcePath: string) {
    return {
        patternKind: "scene-recipe" as const,
        semanticSlot: "primary" as const,
        sourceEntryId,
        sourcePath,
        order: 20,
        enabled: true,
        retrieval: {
            mode: "trigger" as const,
            any: ["雨夜"],
            andAny: ["小巷"],
            characterCount: {min: 0, max: 3},
            canvasIntents: ["landscape" as const],
            ratingScopes: ["general" as const],
            providerKinds: ["novelai" as const],
            modelScopes: [{kind: "generic-novelai" as const}],
        },
        intent: {
            scene: "scene.rainy-alley",
            composition: "composition.wide",
            lighting: "lighting.backlit",
            action: "action.standing",
        },
        tags: {
            scene: ["rainy alley", "wet pavement"],
            composition: ["wide shot"],
            lighting: ["backlighting"],
            action: ["standing"],
            negativeGlobal: ["lowres"],
            negativeCharacter: [],
        },
        confidence: 0.91,
        provenance: {conversion: "normalized" as const, sourcePaths: [sourcePath]},
    };
}

function buildInput() {
    const inspection = inspect([
        {id: "core", role: "system", enabled: true, content: "为章节选择分镜和镜头。"},
        {
            id: "rainy",
            role: "user",
            enabled: true,
            triggerMode: "trigger",
            triggerWords: ["雨夜"],
            andTriggerWords: ["小巷"],
            content: "rainy alley, wide shot, backlighting, standing, wet pavement",
        },
    ]);
    const [core, rainy] = inspection.entries;
    if (!core || !rainy) throw new Error("fixture entries 缺失");
    return {
        input: {
            importId: "import.route-b",
            presetId: "storyboard.route-b",
            sourceProjectPath: "C:/projects/book-one",
            sourceRelativePath: "upload/storyboard.json" as const,
            converterVersion: "route-b-p2.1",
            inspection,
            secretPaths: ["/entries/0/apiKey"],
            conversion: {
                schemaVersion: "nbook.storyboard-conversion-output/v1" as const,
                rules: [createRule(core.sourceIdentity.sourceEntryId, `${core.sourceIdentity.jsonPointer}/content`)],
                patterns: [createPattern(rainy.sourceIdentity.sourceEntryId, `${rainy.sourceIdentity.jsonPointer}/content`)],
                recipeProposals: [],
                diagnostics: [],
            },
        },
        core,
        rainy,
    };
}

describe("pending Storyboard companion builder", () => {
    it("只接受无最终 ID、无 Prompt、无 Provider/Recipe 写权限的严格 conversion output", () => {
        const {input} = buildInput();
        const valid = StoryboardConversionOutputSchema.parse(input.conversion);
        expect(valid.rules).toHaveLength(1);

        expect(StoryboardConversionOutputSchema.safeParse({
            ...input.conversion,
            rules: [{...input.conversion.rules[0], ruleId: "agent-owned"}],
        }).success).toBe(false);
        expect(StoryboardConversionOutputSchema.safeParse({
            ...input.conversion,
            patterns: [{...input.conversion.patterns[0], patternId: "agent-owned", finalPrompt: "do not save"}],
        }).success).toBe(false);
        expect(StoryboardConversionOutputSchema.safeParse({
            ...input.conversion,
            sampler: "k_euler",
            steps: 28,
            recipeId: "agent-recipe",
        }).success).toBe(false);
        expect(StoryboardConversionOutputSchema.safeParse({
            ...input.conversion,
            rules: [{
                kind: "tag-policy",
                semanticSlot: "scene",
                sourceEntryId: input.conversion.rules[0]!.sourceEntryId,
                order: 1,
                enabled: true,
                when: {mode: "always", any: [], andAny: []},
                provenance: input.conversion.rules[0]!.provenance,
                effect: {operation: "prefer", category: "scene", resolutionRefs: ["agent-invented-ref"]},
            }],
        }).success).toBe(false);
    });

    it("由 sourceEntryId + kind + 注册槽位稳定分配 ID，effect 与 Tag 顺序不参与身份", () => {
        const {input} = buildInput();
        const first = buildPendingStoryboardCompanion(input);
        const changed = buildPendingStoryboardCompanion({
            ...input,
            conversion: {
                ...input.conversion,
                rules: [{
                    ...input.conversion.rules[0]!,
                    effect: {...input.conversion.rules[0]!.effect, scoreDelta: 30},
                }],
                patterns: [{
                    ...input.conversion.patterns[0]!,
                    tags: {
                        ...input.conversion.patterns[0]!.tags,
                        scene: ["rainy alley", "reflective pavement"],
                    },
                }],
            },
        });

        expect(first.storyboard.rules[0]!.ruleId).toBe(changed.storyboard.rules[0]!.ruleId);
        expect(first.patterns.patterns[0]!.patternId).toBe(changed.patterns.patterns[0]!.patternId);
        expect(first.package.storyboard.semanticHash).not.toBe(changed.package.storyboard.semanticHash);
        expect(first.package.patterns.renderHash).not.toBe(changed.package.patterns.renderHash);
    });

    it("拒绝同 entry/kind/slot 重复，不通过后写覆盖来修复 Agent 输出", () => {
        const {input} = buildInput();
        expect(() => buildPendingStoryboardCompanion({
            ...input,
            conversion: {...input.conversion, rules: [input.conversion.rules[0]!, input.conversion.rules[0]!]},
        })).toThrow("STORYBOARD_IMPORT_RULE_ID_CONFLICT");
        expect(() => buildPendingStoryboardCompanion({
            ...input,
            conversion: {...input.conversion, patterns: [input.conversion.patterns[0]!, input.conversion.patterns[0]!]},
        })).toThrow("STORYBOARD_IMPORT_PATTERN_ID_CONFLICT");
    });

    it("禁用 source entry 不得被 conversion 重新激活，且全禁用规则仍视为无可用规则", () => {
        const inspection = inspect([{id: "disabled", role: "system", enabled: false, content: "完整分镜示例"}]);
        const entry = inspection.entries[0];
        if (!entry) throw new Error("fixture entry 缺失");
        const rule = createRule(entry.sourceIdentity.sourceEntryId, `${entry.sourceIdentity.jsonPointer}/content`);
        const base = {
            importId: "import.disabled",
            presetId: "storyboard.disabled",
            sourceProjectPath: "C:/projects/book-one",
            sourceRelativePath: "upload/disabled.json" as const,
            converterVersion: "route-b-p2.1",
            inspection,
            secretPaths: [],
        };

        expect(() => buildPendingStoryboardCompanion({
            ...base,
            conversion: {
                schemaVersion: "nbook.storyboard-conversion-output/v1",
                rules: [rule],
                patterns: [],
                recipeProposals: [],
                diagnostics: [],
            },
        })).toThrow("STORYBOARD_IMPORT_DISABLED_SOURCE_ACTIVATION");

        const result = buildPendingStoryboardCompanion({
            ...base,
            conversion: {
                schemaVersion: "nbook.storyboard-conversion-output/v1",
                rules: [{...rule, enabled: false}],
                patterns: [],
                recipeProposals: [],
                diagnostics: [],
            },
        });
        expect(result.storyboard.risks).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "NO_USABLE_STORYBOARD_RULE", severity: "blocking"}),
        ]));
    });

    it("每份可解析 JSON 都成对产生 candidate；空规则阻断而空 Pattern 本身不阻断", () => {
        const inspection = inspect([{id: "irrelevant", role: "system", enabled: true, content: "普通说明"}]);
        const result = buildPendingStoryboardCompanion({
            importId: "import.empty",
            presetId: "storyboard.empty",
            sourceProjectPath: "C:/projects/book-one",
            sourceRelativePath: "upload/empty.json",
            converterVersion: "route-b-p2.1",
            inspection,
            secretPaths: [],
            conversion: {
                schemaVersion: "nbook.storyboard-conversion-output/v1",
                rules: [],
                patterns: [],
                recipeProposals: [],
                diagnostics: [],
            },
        });

        expect(result.storyboard.rules).toEqual([]);
        expect(result.patterns.patterns).toEqual([]);
        expect(result.storyboard.risks).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "NO_USABLE_STORYBOARD_RULE", severity: "blocking"}),
        ]));
        expect(result.patterns.risks).not.toEqual(expect.arrayContaining([
            expect.objectContaining({severity: "blocking"}),
        ]));
        expect(PendingStoryboardPackageSchema.parse(result.package)).toEqual(result.package);
        expect(PendingTagPatternSetSchema.parse(result.patterns)).toEqual(result.patterns);
    });

    it("未解析 Tag 只能存在 pending companion，不能伪装成最终 TagPatternSet", () => {
        const {input} = buildInput();
        const result = buildPendingStoryboardCompanion(input);
        const pendingPattern = result.patterns.patterns[0]!;

        expect(pendingPattern.pendingTags.scene[0]).toEqual(expect.objectContaining({
            state: "unresolved",
            sourceText: "rainy alley",
            ownerSlot: {kind: "pattern", field: "scene"},
        }));
        expect(TagPatternSetSchema.safeParse(result.patterns).success).toBe(false);
        expect(result.package.patterns.unresolvedAtoms).toHaveLength(6);
    });

    it("candidate package hash 绑定两份候选与诊断，但不会读取自身旧 hash 形成反馈", () => {
        const {input} = buildInput();
        const first = buildPendingStoryboardCompanion(input);
        const repeated = buildPendingStoryboardCompanion(input);
        const diagnosed = buildPendingStoryboardCompanion({
            ...input,
            conversion: {
                ...input.conversion,
                diagnostics: [{
                    code: "SOURCE_AMBIGUOUS",
                    severity: "warning" as const,
                    path: "/entries/1/content",
                    message: "场景词存在歧义",
                }],
            },
        });

        expect(repeated.package.candidatePackageHash).toBe(first.package.candidatePackageHash);
        expect(diagnosed.package.candidatePackageHash).not.toBe(first.package.candidatePackageHash);
        expect(diagnosed.package.diagnosticHash).not.toBe(first.package.diagnosticHash);
    });

    it("先计算不含包身份的 candidatePackageHash，再让 companion pair 共享其派生身份", () => {
        const {input} = buildInput();
        const first = buildPendingStoryboardCompanion(input);
        const changed = buildPendingStoryboardCompanion({
            ...input,
            conversion: {
                ...input.conversion,
                rules: [{
                    ...input.conversion.rules[0]!,
                    effect: {...input.conversion.rules[0]!.effect, scoreDelta: 31},
                }],
            },
        });
        const digest = first.package.candidatePackageHash.slice("sha256:".length);

        expect(first.package.packageId).toBe(`ttppkg.${digest}`);
        expect(first.package.resourceKey).toBe(`${input.presetId}--${digest}`);
        expect(first.storyboard.packageId).toBe(first.package.packageId);
        expect(first.storyboard.resourceKey).toBe(first.package.resourceKey);
        expect(first.patterns.packageId).toBe(first.package.packageId);
        expect(first.patterns.resourceKey).toBe(first.package.resourceKey);
        expect(changed.package.candidatePackageHash).not.toBe(first.package.candidatePackageHash);
        expect(changed.package.packageId).not.toBe(first.package.packageId);
        expect(changed.package.resourceKey).not.toBe(first.package.resourceKey);
    });

    it("Recipe proposal 使用独立 hash 检测漂移，不污染 companion candidatePackageHash", () => {
        const {input, rainy} = buildInput();
        const first = buildPendingStoryboardCompanion(input);
        const proposed = buildPendingStoryboardCompanion({
            ...input,
            conversion: {
                ...input.conversion,
                recipeProposals: [{
                    sourceEntryId: rainy.sourceIdentity.sourceEntryId,
                    sourcePath: `${rainy.sourceIdentity.jsonPointer}/content`,
                    positiveAtoms: ["cinematic lighting"],
                    negativeAtoms: ["lowres"],
                    ignoredProviderParameters: ["steps=28"],
                    summary: "只读 Recipe 迁移提议",
                }],
            },
        });

        expect(proposed.package.candidatePackageHash).toBe(first.package.candidatePackageHash);
        expect(proposed.package.packageId).toBe(first.package.packageId);
        expect(proposed.package.recipeProposalHash).not.toBe(first.package.recipeProposalHash);
    });
});

describe("resolved Storyboard companion builder", () => {
    function resolvedInput() {
        const {input} = buildInput();
        const pending = buildPendingStoryboardCompanion(input);
        let tagId = 1000;
        const resolutions = pending.patterns.patterns.flatMap((pattern) => Object.values(pattern.pendingTags).flatMap((atoms) => atoms.map((atom) => {
            tagId += 1;
            return {
                patternId: pattern.patternId,
                atom,
                terminal: {
                    schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
                    kind: "canonical" as const,
                    sourceText: atom.sourceText,
                    indexVersion: "index-v1",
                    policyVersion: "policy-v1",
                    resolverVersion: "resolver-v1",
                    resolverPolicyVersion: "resolver-policy-v1",
                    capabilityVersion: "capability-v1",
                    providerKind: "novelai" as const,
                    modelScope: {kind: "generic-novelai" as const},
                    candidateSetHash: null,
                    resolvedAt: "2026-07-20T00:00:00.000Z",
                    matchedBy: "exact" as const,
                    canonical: {tagId, canonicalName: atom.sourceText.replace(/\s+/gu, "_")},
                    decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
                },
                reviewApproval: null,
            };
        })));
        return {
            pending,
            input: {
                pending,
                resolutionContext: {
                    indexVersion: "index-v1",
                    policyVersion: "policy-v1",
                    resolverVersion: "resolver-v1",
                    resolverPolicyVersion: "resolver-policy-v1",
                    capabilityVersion: "capability-v1",
                    providerKind: "novelai" as const,
                    modelScope: {kind: "generic-novelai" as const},
                },
                resolutions,
            },
        };
    }

    it("把全部 pending atom 转成正式 TagPatternSet，并重算 package/hash/token", () => {
        const {pending, input} = resolvedInput();
        const resolved = buildResolvedStoryboardCompanion(input);
        const pattern = resolved.patterns.patterns[0]!;

        expect(TagPatternSetSchema.parse(resolved.patterns)).toEqual(resolved.patterns);
        expect(pattern.positive.scene).toHaveLength(2);
        expect(Object.keys(pattern.tagResolutions)).toHaveLength(pending.package.patterns.unresolvedAtoms.length);
        expect(resolved.package.state).toBe("pending");
        expect(resolved.package.previousCandidatePackageHash).toBe(pending.package.candidatePackageHash);
        expect(resolved.package.candidatePackageHash).not.toBe(pending.package.candidatePackageHash);
        expect(resolved.package.previewToken).not.toBe(pending.package.candidatePackageHash);
        expect(resolved.storyboard.packageId).toBe(resolved.patterns.packageId);
        expect(resolved.storyboard.resourceKey).toBe(resolved.patterns.resourceKey);
    });

    it("resolution key 只由 owner/slot/source path/sourceTextHash 派生，不受 terminal 变化影响", () => {
        const {input} = resolvedInput();
        const resolution = input.resolutions[0]!;
        const first = createPatternResolutionKey(input.pending.patterns.patternSetId, resolution.patternId, resolution.atom);
        const changedTerminal = {...resolution, terminal: {...resolution.terminal, resolvedAt: "2026-07-20T01:00:00.000Z"}};
        const second = createPatternResolutionKey(input.pending.patterns.patternSetId, changedTerminal.patternId, changedTerminal.atom);

        expect(second).toBe(first);
        expect(first).toMatch(/^tag\.[a-f0-9]{64}$/u);
    });

    it("拒绝缺失、重复、跨 owner atom 与自由 Tag 字符串", () => {
        const {input} = resolvedInput();
        expect(() => buildResolvedStoryboardCompanion({...input, resolutions: input.resolutions.slice(1)})).toThrow(
            "STORYBOARD_IMPORT_TAG_RESOLUTION_MISSING",
        );
        expect(() => buildResolvedStoryboardCompanion({...input, resolutions: [...input.resolutions, input.resolutions[0]!]})).toThrow(
            "STORYBOARD_IMPORT_TAG_RESOLUTION_DUPLICATE",
        );
        expect(() => buildResolvedStoryboardCompanion({
            ...input,
            resolutions: [{...input.resolutions[0]!, patternId: "other.pattern"}, ...input.resolutions.slice(1)],
        })).toThrow("STORYBOARD_IMPORT_TAG_RESOLUTION_OWNER_INVALID");
        expect(() => buildResolvedStoryboardCompanion({
            ...input,
            resolutions: [{...input.resolutions[0]!, terminal: "rain"}, ...input.resolutions.slice(1)],
        })).toThrow();
    });

    it("把 review_required grant 收窄成绑定当前 resolution key/owner/source 的 Pattern approval", () => {
        const {input} = resolvedInput();
        const first = input.resolutions[0]!;
        const reviewed = {
            ...first,
            reviewApproval: {
                approvalId: "approval.import.1",
                actorId: "user-1",
                reason: "确认该标签适用于当前导入 Pattern",
                policyVersion: "policy-v1",
                contentScope: "general" as const,
                matchedRuleIds: ["review-general-import"],
                subject: {
                    kind: "canonical" as const,
                    tagId: first.terminal.canonical.tagId,
                    canonicalName: first.terminal.canonical.canonicalName,
                },
                approvedAt: "2026-07-20T00:00:00.000Z",
            },
        };
        const resolved = buildResolvedStoryboardCompanion({
            ...input,
            resolutions: [reviewed, ...input.resolutions.slice(1)],
        });
        const resolutionKey = createPatternResolutionKey(input.pending.patterns.patternSetId, first.patternId, first.atom);
        const approval = resolved.patterns.patterns[0]!.policyApprovals[resolutionKey]!;

        expect(approval.ownerIdentity).toBe(`${input.pending.patterns.patternSetId}/${first.patternId}`);
        expect(approval.ownerSlot).toBe(`pattern:${first.atom.ownerSlot.field}`);
        expect(approval.sourcePath).toBe(first.atom.sourcePath);
        expect(approval.sourceTextHash).toBe(hashTextToImageContract({sourceText: first.atom.sourceText}));
        expect(resolved.package.resolutionCounts.policyApprovals).toBe(1);
    });

    it("另存为新 presetId 时重绑定完整 pair identity、resolution refs 与 preview token", () => {
        const {input} = resolvedInput();
        const resolved = buildResolvedStoryboardCompanion(input);
        const rebased = rebaseResolvedStoryboardCompanion({
            companion: resolved,
            targetPresetId: "saved.as.preset",
        });
        const oldPattern = resolved.patterns.patterns[0]!;
        const newPattern = rebased.patterns.patterns[0]!;

        expect(rebased.storyboard.presetId).toBe("saved.as.preset");
        expect(rebased.storyboard.patternSetId).toBe("saved.as.preset");
        expect(rebased.patterns.patternSetId).toBe("saved.as.preset");
        expect(rebased.storyboard.packageId).toBe(rebased.patterns.packageId);
        expect(rebased.storyboard.resourceKey).toBe(rebased.patterns.resourceKey);
        expect(rebased.package.candidatePackageHash).not.toBe(resolved.package.candidatePackageHash);
        expect(rebased.package.previewToken).not.toBe(resolved.package.previewToken);
        expect(Object.keys(newPattern.tagResolutions)).not.toEqual(Object.keys(oldPattern.tagResolutions));
        expect(Object.values(newPattern.tagResolutions).map((resolution) => resolution.sourceText).sort())
            .toEqual(Object.values(oldPattern.tagResolutions).map((resolution) => resolution.sourceText).sort());
        expect(rebased.diff.entries.map((entry) => entry.resolutionKey).sort())
            .toEqual(Object.keys(newPattern.tagResolutions).sort());
        expect(() => rebaseResolvedStoryboardCompanion({
            companion: resolved,
            targetPresetId: resolved.storyboard.presetId,
        })).toThrow("STORYBOARD_IMPORT_PRESET_ID_UNCHANGED");
    });
});
