import {createHash} from "node:crypto";
import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    createPendingTagPatternHashes,
    PendingTagPatternSetSchema,
    RecipeStyleCandidateSchema,
    StoryboardConversionDiagnosticSchema,
    StoryboardRuleCandidateSchema,
    TagPatternCandidateSchema,
    type PendingTagPattern,
    type PendingTagPatternSet,
    type StoryboardRuleCandidate,
    type TagPatternCandidate,
} from "nbook/shared/text-to-image-storyboard-candidate";
import {
    PendingTagAtomSchema,
    PendingStoryboardPackageSchema,
    RecipeStyleProposalSchema,
    ResolvedStoryboardPackageSchema,
    StoryboardTagResolutionDiffSchema,
    StoryboardTagResolutionEvidenceSchema,
    StoryboardResolvedTagSchema,
    StoryboardImportReportSchema,
    createRecipeProposalHash,
    createStoryboardImportPreviewToken,
    type ImportDiagnostic,
    type PendingTagAtom,
    type PatternTagField,
    type PendingStoryboardPackage,
    type RecipeStyleProposal,
    type ResolvedStoryboardPackage,
    type StoryboardImportMacroToken,
    type StoryboardImportReport,
    type StoryboardTagResolutionDiff,
    type StoryboardResolvedTag,
} from "nbook/shared/text-to-image-storyboard-import";
import {
    createTagPatternSetHashes,
    TagPatternSetSchema,
    type TagPattern,
    type TagPatternSet,
} from "nbook/shared/text-to-image-tag-pattern";
import type {SemanticTagResolution} from "nbook/shared/text-to-image-tag-resolution";
import {TagPolicyApprovalSchema} from "nbook/shared/text-to-image-tag-policy";
import {TagResolverPolicyApprovalSchema} from "nbook/shared/text-to-image-tag-resolver";
import {
    createStoryboardPresetHashes,
    StoryboardPresetSchema,
    StoryboardRuleSchema,
    StoryboardStableIdSchema,
    type StoryboardPreset,
    type StoryboardRule,
} from "nbook/shared/text-to-image-storyboard-preset";
import type {Chatu8StoryboardInspection} from "nbook/server/text-to-image/chatu8-storyboard-inspector";

export const STORYBOARD_CONVERSION_OUTPUT_SCHEMA_VERSION = "nbook.storyboard-conversion-output/v1" as const;

/** Director 的窄 conversion output；严格禁止最终 ID、Prompt、Recipe 或生成参数。 */
export const StoryboardConversionOutputSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_CONVERSION_OUTPUT_SCHEMA_VERSION),
    rules: z.array(StoryboardRuleCandidateSchema).max(10000),
    patterns: z.array(TagPatternCandidateSchema).max(10000),
    recipeProposals: z.array(RecipeStyleCandidateSchema).max(10000),
    diagnostics: z.array(StoryboardConversionDiagnosticSchema).max(10000),
}).strict();

export type StoryboardConversionOutput = z.infer<typeof StoryboardConversionOutputSchema>;

export type BuildPendingStoryboardInput = {
    importId: string;
    presetId: string;
    sourceProjectPath: string;
    sourceRelativePath: `upload/${string}.json`;
    converterVersion: string;
    inspection: Chatu8StoryboardInspection;
    secretPaths: string[];
    conversion: StoryboardConversionOutput;
};

export type PendingStoryboardCompanion = {
    storyboard: StoryboardPreset;
    patterns: PendingTagPatternSet;
    package: PendingStoryboardPackage;
};

/** 用户对显式 import diff 中 `review_required` 项的窄批准输入；owner/key 仍由服务端补全。 */
export const StoryboardTagReviewGrantSchema = TagResolverPolicyApprovalSchema;

export type StoryboardTagReviewGrant = z.infer<typeof StoryboardTagReviewGrantSchema>;

/** Resolver 对单个 pending Pattern atom 的唯一可持久终态输入。 */
export const ResolvedPatternTagSchema = StoryboardResolvedTagSchema;

export type ResolvedPatternTag = StoryboardResolvedTag;

export type BuildResolvedStoryboardInput = {
    pending: PendingStoryboardCompanion;
    resolutionContext: z.input<typeof StoryboardTagResolutionEvidenceSchema>;
    resolutions: ResolvedPatternTag[];
};

export type ResolvedStoryboardCompanion = {
    storyboard: StoryboardPreset;
    patterns: TagPatternSet;
    package: ResolvedStoryboardPackage;
    diff: StoryboardTagResolutionDiff;
};

export type RebaseResolvedStoryboardInput = {
    companion: ResolvedStoryboardCompanion;
    targetPresetId: string;
};

const TAG_GROUPS = [
    ["scene", "scene"],
    ["composition", "composition"],
    ["lighting", "lighting"],
    ["action", "action"],
    ["negativeGlobal", "negative_global"],
    ["negativeCharacter", "negative_character"],
] as const;

type SourceEntryEvidence = {
    enabled: boolean;
    jsonPointer: string;
};

/**
 * 把 strict inspect 与 strict Agent conversion 合成为不可批准的 pending companion pair。
 *
 * 此函数独占最终 ID、规范化、成对 hash 与 report 生成；不会读取或写入 Provider/Recipe 配置。
 */
export function buildPendingStoryboardCompanion(input: BuildPendingStoryboardInput): PendingStoryboardCompanion {
    const conversion = StoryboardConversionOutputSchema.parse(input.conversion);
    const sourceEntries = new Map(input.inspection.entries.map((entry) => [entry.sourceIdentity.sourceEntryId, {
        enabled: entry.enabled,
        jsonPointer: entry.sourceIdentity.jsonPointer,
    }]));
    const rules = conversion.rules.map((candidate) => buildRule(candidate, sourceEntries));
    assertUniqueIds(rules.map((rule) => rule.ruleId), "STORYBOARD_IMPORT_RULE_ID_CONFLICT");
    rules.sort((left, right) => left.order - right.order || left.ruleId.localeCompare(right.ruleId));

    const patterns = conversion.patterns.map((candidate) => buildPattern(candidate, sourceEntries));
    assertUniqueIds(patterns.map((pattern) => pattern.patternId), "STORYBOARD_IMPORT_PATTERN_ID_CONFLICT");
    patterns.sort((left, right) => left.order - right.order || left.patternId.localeCompare(right.patternId));

    const recipeProposals = conversion.recipeProposals.map((candidate) => {
        const source = assertSourceEntry(candidate.sourceEntryId, sourceEntries);
        assertSourceActivation(source, true, candidate.sourceEntryId);
        assertSourcePath(candidate.sourcePath, source, candidate.sourceEntryId);
        return RecipeStyleProposalSchema.parse({
            schemaVersion: "nbook.recipe-style-proposal/v1",
            proposalId: createStableId("c8recipe", candidate.sourceEntryId, "style-quality", "primary"),
            sourceEntryId: candidate.sourceEntryId,
            sourcePath: candidate.sourcePath,
            positiveAtoms: normalizeTagTexts(candidate.positiveAtoms),
            negativeAtoms: normalizeTagTexts(candidate.negativeAtoms),
            ignoredProviderParameters: normalizeTagTexts(candidate.ignoredProviderParameters),
            summary: candidate.summary,
        });
    });
    assertUniqueIds(recipeProposals.map((proposal) => proposal.proposalId), "STORYBOARD_IMPORT_RECIPE_ID_CONFLICT");
    recipeProposals.sort((left, right) => left.proposalId.localeCompare(right.proposalId));

    const diagnostics = createDiagnostics(
        input.inspection.macroTokens,
        conversion.diagnostics,
        rules.filter((rule) => rule.enabled).length,
    );
    const unboundIdentity = {packageId: "candidate.unbound", resourceKey: "candidate.unbound"} as const;
    const unboundStoryboard = createStoryboardCandidate(input, unboundIdentity, rules, diagnostics);
    const unboundPatternSet = PendingTagPatternSetSchema.parse({
        schema: "nbook.pending-tag-pattern-set/v1",
        state: "pending_unresolved",
        patternSetId: input.presetId,
        presetId: input.presetId,
        ...unboundIdentity,
        title: stableTitle(input.inspection.sourcePresetKey),
        enabled: true,
        source: createSource(input),
        review: {status: "pending_unresolved"},
        patterns,
        risks: conversion.diagnostics,
    });

    const storyboardHashes = createStoryboardPresetHashes(unboundStoryboard);
    const patternHashes = createPendingTagPatternHashes(unboundPatternSet);
    const unresolvedAtoms = patterns.flatMap((pattern) => TAG_GROUPS.flatMap(([group]) => pattern.pendingTags[group]));
    const diagnosticHash = hashTextToImageContract({
        diagnostics: diagnostics.map((diagnostic) => ({...diagnostic})),
        macroTokens: input.inspection.macroTokens.map((token) => ({...token})),
        secretPaths: [...input.secretPaths].sort(),
    });
    const report = createReport(input, conversion, diagnostics, rules.length, patterns.length, recipeProposals.length);
    const candidatePackageHash = createCandidatePackageHash({
        semanticHash: storyboardHashes.semanticHash,
        planningHash: patternHashes.planningHash,
        renderHash: patternHashes.renderHash,
        diagnosticHash,
    });
    const packageIdentity = createCandidatePackageIdentity(input.presetId, candidatePackageHash);
    const storyboard = StoryboardPresetSchema.parse({...unboundStoryboard, ...packageIdentity});
    const patternSet = PendingTagPatternSetSchema.parse({...unboundPatternSet, ...packageIdentity});
    const pendingPackage = PendingStoryboardPackageSchema.parse({
        schemaVersion: "nbook.storyboard-import-candidate-package/v1",
        state: "pending_unresolved",
        importId: input.importId,
        presetId: input.presetId,
        patternSetId: input.presetId,
        ...packageIdentity,
        source: {
            projectPath: input.sourceProjectPath,
            relativePath: input.sourceRelativePath,
            rawSourceHash: input.inspection.rawSourceHash,
            sanitizedSourceHash: input.inspection.sanitizedSourceHash,
            converterVersion: input.converterVersion,
        },
        storyboard: {
            candidatePath: "candidate.storyboard.md",
            semanticHash: storyboardHashes.semanticHash,
            ruleCount: rules.length,
        },
        patterns: {
            candidatePath: "candidate.tag-patterns.md",
            planningHash: patternHashes.planningHash,
            renderHash: patternHashes.renderHash,
            patternCount: patterns.length,
            unresolvedAtoms,
        },
        recipeProposals,
        recipeProposalHash: createRecipeProposalHash(recipeProposals),
        diagnosticHash,
        candidatePackageHash,
        report,
    });
    return {storyboard, patterns: patternSet, package: pendingPackage};
}

/**
 * 把一对 `pending_unresolved` companion 与全部 Resolver terminal snapshot 合成为新的 resolved candidate。
 *
 * resolution key、owner/source 绑定、正式 Pattern 与 package 身份均由服务端计算；调用方不能提交自由 Tag 或 key。
 */
export function buildResolvedStoryboardCompanion(input: BuildResolvedStoryboardInput): ResolvedStoryboardCompanion {
    const pending = assertPendingCompanion(input.pending);
    const resolutionContext = StoryboardTagResolutionEvidenceSchema.parse(input.resolutionContext);
    const submitted = input.resolutions.map((resolution) => ResolvedPatternTagSchema.parse(resolution));
    const expected = new Map<string, {pattern: PendingTagPattern; atom: PendingTagAtom}>();
    for (const pattern of pending.patterns.patterns) {
        for (const [group] of TAG_GROUPS) {
            for (const atom of pattern.pendingTags[group]) {
                const key = createPatternResolutionKey(pending.patterns.patternSetId, pattern.patternId, atom);
                if (expected.has(key)) throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_DUPLICATE: ${key}`);
                expected.set(key, {pattern, atom});
            }
        }
    }

    const resolvedByKey = new Map<string, ResolvedPatternTag>();
    for (const resolved of submitted) {
        const key = createPatternResolutionKey(pending.patterns.patternSetId, resolved.patternId, resolved.atom);
        if (resolvedByKey.has(key)) throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_DUPLICATE: ${key}`);
        const owner = expected.get(key);
        if (!owner || owner.pattern.patternId !== resolved.patternId) {
            throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_OWNER_INVALID: ${resolved.patternId}`);
        }
        assertResolutionContext(resolved.terminal, resolutionContext);
        resolvedByKey.set(key, resolved);
    }
    for (const key of expected.keys()) {
        if (!resolvedByKey.has(key)) throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_MISSING: ${key}`);
    }

    const unboundIdentity = {packageId: "candidate.unbound", resourceKey: "candidate.unbound"} as const;
    const unboundStoryboard = StoryboardPresetSchema.parse({...pending.storyboard, ...unboundIdentity, review: {status: "pending"}});
    const unboundPatternSet = TagPatternSetSchema.parse({
        schema: "nbook.tag-pattern-set/v1",
        patternSetId: pending.patterns.patternSetId,
        presetId: pending.patterns.presetId,
        ...unboundIdentity,
        title: pending.patterns.title,
        enabled: pending.patterns.enabled,
        source: pending.patterns.source,
        review: {status: "pending"},
        patterns: pending.patterns.patterns.map((pattern) => buildResolvedPattern(
            pending.patterns.patternSetId,
            pattern,
            resolvedByKey,
        )),
        risks: pending.patterns.risks,
    });
    const storyboardHashes = createStoryboardPresetHashes(unboundStoryboard);
    const patternHashes = createTagPatternSetHashes(unboundPatternSet);
    const candidatePackageHash = createCandidatePackageHash({
        semanticHash: storyboardHashes.semanticHash,
        planningHash: patternHashes.planningHash,
        renderHash: patternHashes.renderHash,
        diagnosticHash: pending.package.diagnosticHash,
    });
    const packageIdentity = createCandidatePackageIdentity(pending.package.presetId, candidatePackageHash);
    const storyboard = StoryboardPresetSchema.parse({...unboundStoryboard, ...packageIdentity});
    const patterns = TagPatternSetSchema.parse({...unboundPatternSet, ...packageIdentity});
    const diffEntries = pending.patterns.patterns.flatMap((pattern) => TAG_GROUPS.flatMap(([group]) => pattern.pendingTags[group].map((atom) => {
        const resolutionKey = createPatternResolutionKey(patterns.patternSetId, pattern.patternId, atom);
        const resolved = resolvedByKey.get(resolutionKey);
        if (!resolved) throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_MISSING: ${resolutionKey}`);
        return {
            resolutionKey,
            patternId: pattern.patternId,
            ownerSlot: atom.ownerSlot,
            sourceText: atom.sourceText,
            sourcePath: atom.sourcePath,
            terminal: resolved.terminal,
            policyApproval: patterns.patterns
                .find((item) => item.patternId === pattern.patternId)!
                .policyApprovals[resolutionKey] ?? null,
        };
    })));
    const resolutionCounts = {
        canonical: diffEntries.filter((entry) => entry.terminal.kind === "canonical").length,
        replacement: diffEntries.filter((entry) => entry.terminal.kind === "replacement").length,
        providerPassthrough: diffEntries.filter((entry) => entry.terminal.kind === "provider_passthrough").length,
        policyApprovals: diffEntries.filter((entry) => entry.policyApproval !== null).length,
    };
    const diff = StoryboardTagResolutionDiffSchema.parse({
        schemaVersion: "nbook.storyboard-tag-resolution-diff/v1",
        counts: resolutionCounts,
        entries: diffEntries,
    });
    const packageBase = {
        schemaVersion: "nbook.storyboard-import-candidate-package/v1" as const,
        state: "pending" as const,
        importId: pending.package.importId,
        presetId: pending.package.presetId,
        patternSetId: pending.package.patternSetId,
        ...packageIdentity,
        previousCandidatePackageHash: pending.package.candidatePackageHash,
        source: pending.package.source,
        storyboard: {
            candidatePath: "resolved.storyboard.md" as const,
            semanticHash: storyboardHashes.semanticHash,
            ruleCount: storyboard.rules.length,
        },
        patterns: {
            candidatePath: "resolved.tag-patterns.md" as const,
            planningHash: patternHashes.planningHash,
            renderHash: patternHashes.renderHash,
            patternCount: patterns.patterns.length,
            resolutionCount: diff.entries.length,
        },
        resolutionEvidence: resolutionContext,
        resolutionCounts,
        recipeProposals: pending.package.recipeProposals,
        recipeProposalHash: pending.package.recipeProposalHash,
        diagnosticHash: pending.package.diagnosticHash,
        candidatePackageHash,
        report: pending.package.report,
    };
    const resolvedPackage = ResolvedStoryboardPackageSchema.parse({
        ...packageBase,
        previewToken: createStoryboardImportPreviewToken(packageBase),
    });
    return {storyboard, patterns, package: resolvedPackage, diff};
}

/**
 * 将 resolved companion 确定性另存为新的逻辑 preset。
 *
 * Pattern resolution key 含 patternSetId，因此不能只改文件名或顶层 ID；所有 refs、approval owner 与 diff
 * 必须一并重绑定，随后重新计算 pair/package hash 与 preview token。
 */
export function rebaseResolvedStoryboardCompanion(
    input: RebaseResolvedStoryboardInput,
): ResolvedStoryboardCompanion {
    const targetPresetId = StoryboardStableIdSchema.parse(input.targetPresetId);
    const source = {
        storyboard: StoryboardPresetSchema.parse(input.companion.storyboard),
        patterns: TagPatternSetSchema.parse(input.companion.patterns),
        package: ResolvedStoryboardPackageSchema.parse(input.companion.package),
        diff: StoryboardTagResolutionDiffSchema.parse(input.companion.diff),
    };
    if (targetPresetId === source.storyboard.presetId) {
        throw new Error("STORYBOARD_IMPORT_PRESET_ID_UNCHANGED");
    }
    if (source.storyboard.packageId !== source.patterns.packageId
        || source.storyboard.resourceKey !== source.patterns.resourceKey
        || source.package.packageId !== source.storyboard.packageId
        || source.package.resourceKey !== source.storyboard.resourceKey) {
        throw new Error("STORYBOARD_IMPORT_RESOLVED_COMPANION_INVALID");
    }

    const diffByKey = new Map(source.diff.entries.map((entry) => [entry.resolutionKey, entry]));
    const rebasedDiffEntries: StoryboardTagResolutionDiff["entries"] = [];
    const rebasedPatterns = source.patterns.patterns.map((pattern) => {
        const keyMap = new Map<string, string>();
        for (const oldKey of Object.keys(pattern.tagResolutions)) {
            const entry = diffByKey.get(oldKey);
            if (!entry || entry.patternId !== pattern.patternId) {
                throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_OWNER_INVALID: ${oldKey}`);
            }
            const newKey = createPatternResolutionKey(targetPresetId, pattern.patternId, {
                schemaVersion: "nbook.pending-tag-atom/v1",
                state: "unresolved",
                sourceText: entry.sourceText,
                sourcePath: entry.sourcePath,
                ownerSlot: entry.ownerSlot,
            });
            if ([...keyMap.values()].includes(newKey)) {
                throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_DUPLICATE: ${newKey}`);
            }
            keyMap.set(oldKey, newKey);
        }

        const tagResolutions: TagPattern["tagResolutions"] = {};
        const policyApprovals: TagPattern["policyApprovals"] = {};
        for (const [oldKey, newKey] of keyMap) {
            const resolution = pattern.tagResolutions[oldKey];
            const entry = diffByKey.get(oldKey);
            if (!resolution || !entry) throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_MISSING: ${oldKey}`);
            tagResolutions[newKey] = resolution;
            const oldApproval = pattern.policyApprovals[oldKey];
            const approval = oldApproval ? TagPolicyApprovalSchema.parse({
                ...oldApproval,
                resolutionKey: newKey,
                ownerIdentity: `${targetPresetId}/${pattern.patternId}`,
            }) : null;
            if (approval) policyApprovals[newKey] = approval;
            rebasedDiffEntries.push({...entry, resolutionKey: newKey, policyApproval: approval});
        }

        const refs = (keys: string[]): string[] => keys.map((oldKey) => {
            const newKey = keyMap.get(oldKey);
            if (!newKey) throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_MISSING: ${oldKey}`);
            return newKey;
        });
        return TagPatternSetSchema.shape.patterns.element.parse({
            ...pattern,
            tagResolutions,
            policyApprovals,
            positive: {
                scene: refs(pattern.positive.scene),
                composition: refs(pattern.positive.composition),
                lighting: refs(pattern.positive.lighting),
                action: refs(pattern.positive.action),
            },
            negative: {
                global: refs(pattern.negative.global),
                characters: refs(pattern.negative.characters),
            },
        });
    });

    const unboundIdentity = {packageId: "candidate.unbound", resourceKey: "candidate.unbound"} as const;
    const unboundStoryboard = StoryboardPresetSchema.parse({
        ...source.storyboard,
        presetId: targetPresetId,
        patternSetId: targetPresetId,
        ...unboundIdentity,
        review: {status: "pending"},
    });
    const unboundPatterns = TagPatternSetSchema.parse({
        ...source.patterns,
        patternSetId: targetPresetId,
        presetId: targetPresetId,
        ...unboundIdentity,
        review: {status: "pending"},
        patterns: rebasedPatterns,
    });
    const storyboardHashes = createStoryboardPresetHashes(unboundStoryboard);
    const patternHashes = createTagPatternSetHashes(unboundPatterns);
    const candidatePackageHash = createCandidatePackageHash({
        semanticHash: storyboardHashes.semanticHash,
        planningHash: patternHashes.planningHash,
        renderHash: patternHashes.renderHash,
        diagnosticHash: source.package.diagnosticHash,
    });
    const packageIdentity = createCandidatePackageIdentity(targetPresetId, candidatePackageHash);
    const storyboard = StoryboardPresetSchema.parse({...unboundStoryboard, ...packageIdentity});
    const patterns = TagPatternSetSchema.parse({...unboundPatterns, ...packageIdentity});
    const diff = StoryboardTagResolutionDiffSchema.parse({
        ...source.diff,
        entries: rebasedDiffEntries.sort((left, right) => left.resolutionKey.localeCompare(right.resolutionKey)),
    });
    const packageBase = {
        ...source.package,
        presetId: targetPresetId,
        patternSetId: targetPresetId,
        ...packageIdentity,
        storyboard: {
            ...source.package.storyboard,
            semanticHash: storyboardHashes.semanticHash,
        },
        patterns: {
            ...source.package.patterns,
            planningHash: patternHashes.planningHash,
            renderHash: patternHashes.renderHash,
        },
        candidatePackageHash,
    };
    const resolvedPackage = ResolvedStoryboardPackageSchema.parse({
        ...packageBase,
        previewToken: createStoryboardImportPreviewToken(packageBase),
    });
    return {storyboard, patterns, package: resolvedPackage, diff};
}

/** 按冻结 ownerIdentity + ownerSlot + sourcePath + sourceTextHash 派生长期 resolution key。 */
export function createPatternResolutionKey(patternSetId: string, patternId: string, atomInput: PendingTagAtom): string {
    const atom = PendingTagAtomSchema.parse(atomInput);
    if (atom.ownerSlot.kind !== "pattern") throw new Error("STORYBOARD_IMPORT_TAG_RESOLUTION_OWNER_INVALID");
    const digest = hashTextToImageContract({
        ownerIdentity: `${patternSetId}/${patternId}`,
        ownerSlot: `pattern:${atom.ownerSlot.field}`,
        sourcePath: atom.sourcePath,
        sourceTextHash: hashTextToImageContract({sourceText: atom.sourceText}),
    }).slice("sha256:".length);
    return `tag.${digest}`;
}

/** 构建一个正式 Pattern；所有分组只引用本 Pattern 内服务端分配的 resolution key。 */
function buildResolvedPattern(
    patternSetId: string,
    pending: PendingTagPattern,
    resolvedByKey: Map<string, ResolvedPatternTag>,
): TagPattern {
    const refs = Object.fromEntries(TAG_GROUPS.map(([group]) => [
        group,
        pending.pendingTags[group].map((atom) => createPatternResolutionKey(patternSetId, pending.patternId, atom)),
    ])) as {[TGroup in typeof TAG_GROUPS[number][0]]: string[]};
    const orderedKeys = TAG_GROUPS.flatMap(([group]) => refs[group]);
    const tagResolutions: Record<string, SemanticTagResolution> = {};
    const policyApprovals: TagPattern["policyApprovals"] = {};
    for (const resolutionKey of orderedKeys) {
        const resolved = resolvedByKey.get(resolutionKey);
        if (!resolved) throw new Error(`STORYBOARD_IMPORT_TAG_RESOLUTION_MISSING: ${resolutionKey}`);
        tagResolutions[resolutionKey] = resolved.terminal;
        if (!resolved.reviewApproval) continue;
        policyApprovals[resolutionKey] = TagPolicyApprovalSchema.parse({
            schemaVersion: "nbook.tag-policy-approval/v1",
            ...resolved.reviewApproval,
            resolutionKey,
            ownerIdentity: `${patternSetId}/${pending.patternId}`,
            ownerSlot: `pattern:${resolved.atom.ownerSlot.kind === "pattern" ? resolved.atom.ownerSlot.field : "invalid"}`,
            sourcePath: resolved.atom.sourcePath,
            sourceTextHash: hashTextToImageContract({sourceText: resolved.atom.sourceText}),
        });
    }
    return {
        patternId: pending.patternId,
        sourceEntryId: pending.sourceEntryId,
        order: pending.order,
        enabled: pending.enabled,
        retrieval: pending.retrieval,
        intent: pending.intent,
        tagResolutions,
        policyApprovals,
        positive: {
            scene: refs.scene,
            composition: refs.composition,
            lighting: refs.lighting,
            action: refs.action,
        },
        negative: {global: refs.negativeGlobal, characters: refs.negativeCharacter},
        providerSyntaxRefs: [],
        providerSyntaxNodes: {},
        confidence: pending.confidence,
        provenance: pending.provenance,
    };
}

/** terminal 的所有非时间 evidence 必须与本次 active Resolver context 一致。 */
function assertResolutionContext(
    resolution: SemanticTagResolution,
    context: z.output<typeof StoryboardTagResolutionEvidenceSchema>,
): void {
    if (resolution.indexVersion !== context.indexVersion
        || resolution.policyVersion !== context.policyVersion
        || resolution.resolverVersion !== context.resolverVersion
        || resolution.resolverPolicyVersion !== context.resolverPolicyVersion
        || resolution.capabilityVersion !== context.capabilityVersion
        || resolution.providerKind !== context.providerKind
        || hashTextToImageContract(resolution.modelScope) !== hashTextToImageContract(context.modelScope)) {
        throw new Error("STORYBOARD_IMPORT_TAG_RESOLUTION_CONTEXT_MISMATCH");
    }
}

/** 复验 pending pair/package，避免外部调用者只替换其中一份候选。 */
function assertPendingCompanion(input: PendingStoryboardCompanion): PendingStoryboardCompanion {
    const storyboard = StoryboardPresetSchema.parse(input.storyboard);
    const patterns = PendingTagPatternSetSchema.parse(input.patterns);
    const candidatePackage = PendingStoryboardPackageSchema.parse(input.package);
    const storyboardHashes = createStoryboardPresetHashes(storyboard);
    const patternHashes = createPendingTagPatternHashes(patterns);
    if (storyboard.packageId !== candidatePackage.packageId
        || patterns.packageId !== candidatePackage.packageId
        || storyboard.resourceKey !== candidatePackage.resourceKey
        || patterns.resourceKey !== candidatePackage.resourceKey
        || storyboardHashes.semanticHash !== candidatePackage.storyboard.semanticHash
        || patternHashes.planningHash !== candidatePackage.patterns.planningHash
        || patternHashes.renderHash !== candidatePackage.patterns.renderHash
        || storyboard.rules.length !== candidatePackage.storyboard.ruleCount
        || patterns.patterns.length !== candidatePackage.patterns.patternCount) {
        throw new Error("STORYBOARD_IMPORT_PENDING_COMPANION_INVALID");
    }
    return {storyboard, patterns, package: candidatePackage};
}

/** 为规则候选分配最终 ruleId，并由最终 Storyboard schema 再验证一次。 */
function buildRule(candidate: StoryboardRuleCandidate, sourceEntries: Map<string, SourceEntryEvidence>): StoryboardRule {
    const source = assertSourceEntry(candidate.sourceEntryId, sourceEntries);
    assertSourceActivation(source, candidate.enabled, candidate.sourceEntryId);
    candidate.provenance.sourcePaths.forEach((sourcePath) => assertSourcePath(sourcePath, source, candidate.sourceEntryId));
    const {semanticSlot, ...rule} = candidate;
    return StoryboardRuleSchema.parse({
        ...rule,
        ruleId: createStableId("c8", candidate.sourceEntryId, candidate.kind, semanticSlot),
    });
}

/** 将自由 Tag 原子收窄为 pending-only 节点，绝不伪造 terminal resolution。 */
function buildPattern(candidate: TagPatternCandidate, sourceEntries: Map<string, SourceEntryEvidence>): PendingTagPattern {
    const source = assertSourceEntry(candidate.sourceEntryId, sourceEntries);
    assertSourceActivation(source, candidate.enabled, candidate.sourceEntryId);
    assertSourcePath(candidate.sourcePath, source, candidate.sourceEntryId);
    candidate.provenance.sourcePaths.forEach((sourcePath) => assertSourcePath(sourcePath, source, candidate.sourceEntryId));
    const pendingTags = {
        scene: createPendingAtoms(candidate.tags.scene, candidate.sourcePath, "scene"),
        composition: createPendingAtoms(candidate.tags.composition, candidate.sourcePath, "composition"),
        lighting: createPendingAtoms(candidate.tags.lighting, candidate.sourcePath, "lighting"),
        action: createPendingAtoms(candidate.tags.action, candidate.sourcePath, "action"),
        negativeGlobal: createPendingAtoms(candidate.tags.negativeGlobal, candidate.sourcePath, "negative_global"),
        negativeCharacter: createPendingAtoms(candidate.tags.negativeCharacter, candidate.sourcePath, "negative_character"),
    };
    return {
        patternId: createStableId("c8", candidate.sourceEntryId, candidate.patternKind, candidate.semanticSlot),
        patternKind: candidate.patternKind,
        semanticSlot: candidate.semanticSlot,
        sourceEntryId: candidate.sourceEntryId,
        order: candidate.order,
        enabled: candidate.enabled,
        retrieval: candidate.retrieval,
        intent: candidate.intent,
        pendingTags,
        confidence: candidate.confidence,
        provenance: candidate.provenance,
    };
}

/** 按 owner slot 生成去重、稳定排序的 pending Tag 原子。 */
function createPendingAtoms(
    texts: string[],
    sourcePath: string,
    field: PatternTagField,
): PendingTagAtom[] {
    return normalizeTagTexts(texts).map((sourceText) => ({
        schemaVersion: "nbook.pending-tag-atom/v1",
        state: "unresolved",
        sourceText,
        sourcePath,
        ownerSlot: {kind: "pattern", field},
    }));
}

/** 创建 pending Storyboard candidate；空规则通过 blocking risk 明确退出。 */
function createStoryboardCandidate(
    input: BuildPendingStoryboardInput,
    packageIdentity: {packageId: string; resourceKey: string},
    rules: StoryboardRule[],
    diagnostics: ImportDiagnostic[],
): StoryboardPreset {
    if (input.inspection.macroTokens.length > 256) {
        throw new Error("STORYBOARD_IMPORT_MACRO_LIMIT_EXCEEDED");
    }
    const bindings = createMacroBindings(input.inspection.macroTokens);
    const unresolved = input.inspection.macroTokens.flatMap((token) => {
        if (token.classification === "registered_binding") return [];
        return [{
            token: token.token,
            path: token.path,
            classification: token.classification === "tag_fragment"
                ? "tag-fragment" as const
                : token.classification === "ambiguous_double_brace"
                    ? "ambiguous" as const
                    : token.classification,
            blocking: token.blocking,
        }];
    });
    return StoryboardPresetSchema.parse({
        schema: "nbook.storyboard-preset/v1",
        presetId: input.presetId,
        patternSetId: input.presetId,
        ...packageIdentity,
        title: stableTitle(input.inspection.sourcePresetKey),
        enabled: true,
        source: createSource(input),
        review: {status: "pending"},
        matching: {normalization: "nfkc-casefold"},
        defaults: {preferredShotCount: {min: 1, max: 6}, minimumParagraphGap: 1},
        macros: {bindings, unresolved},
        rules,
        risks: diagnostics,
    });
}

/** 将 inspect 宏白名单绑定到运行时已注册的数据节点。 */
function createMacroBindings(tokens: StoryboardImportMacroToken[]): Record<string, "chapter.markdown" | "chapter.compiledContext" | "invocation.request"> {
    const bindings: Record<string, "chapter.markdown" | "chapter.compiledContext" | "invocation.request"> = {};
    for (const token of tokens) {
        if (token.classification !== "registered_binding") continue;
        const name = token.token.slice(2, -2).trim();
        const binding = name === "正文"
            ? "chapter.markdown" as const
            : name === "上下文"
                ? "chapter.compiledContext" as const
                : "invocation.request" as const;
        bindings[name] = binding;
    }
    return bindings;
}

/** 合并 conversion 风险与确定性阻断项，不把 Pattern 为空误判为阻断。 */
function createDiagnostics(
    macroTokens: StoryboardImportMacroToken[],
    conversionDiagnostics: ImportDiagnostic[],
    ruleCount: number,
): ImportDiagnostic[] {
    const diagnostics = conversionDiagnostics.map((diagnostic) => ({...diagnostic}));
    if (ruleCount === 0) {
        diagnostics.push({
            code: "NO_USABLE_STORYBOARD_RULE",
            severity: "blocking",
            path: "/entries",
            message: "未转换出可用的 Storyboard 规则，候选不可批准。",
        });
    }
    for (const token of macroTokens) {
        if (!token.blocking) continue;
        diagnostics.push({
            code: "UNRESOLVED_BLOCKING_MACRO",
            severity: "blocking",
            path: token.path,
            message: `未解析宏 ${token.token} 阻断其依赖候选。`,
        });
    }
    return diagnostics.sort(compareDiagnostic);
}

/** 生成不复制完整外部 Prompt 的 bounded import report。 */
function createReport(
    input: BuildPendingStoryboardInput,
    conversion: StoryboardConversionOutput,
    diagnostics: ImportDiagnostic[],
    ruleCount: number,
    patternCount: number,
    recipeCount: number,
): StoryboardImportReport {
    const roleCounts = {system: 0, user: 0, assistant: 0};
    const triggerModeCounts = {always: 0, trigger: 0};
    const enabledCounts = {enabled: 0, disabled: 0};
    const classificationCounts = {
        core_rule: 0,
        atomic_group: 0,
        scene_recipe: 0,
        style_quality: 0,
        negative_constraint: 0,
        trigger_alias: 0,
        macro: 0,
    };
    for (const entry of input.inspection.entries) {
        roleCounts[entry.role] += 1;
        triggerModeCounts[entry.triggerMode] += 1;
        enabledCounts[entry.enabled ? "enabled" : "disabled"] += 1;
        entry.classifications.forEach((classification) => {
            classificationCounts[classification] += 1;
        });
    }
    return StoryboardImportReportSchema.parse({
        schemaVersion: "nbook.storyboard-import-report/v1",
        importId: input.importId,
        sourceProjectPath: input.sourceProjectPath,
        sourceRelativePath: input.sourceRelativePath,
        sourceShape: input.inspection.sourceShape,
        sourcePresetKey: input.inspection.sourcePresetKey,
        rawSourceHash: input.inspection.rawSourceHash,
        sanitizedSourceHash: input.inspection.sanitizedSourceHash,
        converterVersion: input.converterVersion,
        entryCount: input.inspection.entries.length,
        roleCounts,
        triggerModeCounts,
        enabledCounts,
        classificationCounts,
        candidateCounts: {
            rules: ruleCount,
            patterns: patternCount,
            recipeProposals: recipeCount,
            disabled: conversion.rules.filter((rule) => !rule.enabled).length
                + conversion.patterns.filter((pattern) => !pattern.enabled).length,
            ignored: input.inspection.entries.filter((entry) => entry.flags.irrelevant).length,
            reportOnly: input.inspection.entries.filter((entry) => entry.flags.characterOrOutfit
                || entry.flags.outputTemplate || entry.flags.privilegeOrSafetyClaim).length,
        },
        macroTokens: input.inspection.macroTokens,
        secretPaths: [...input.secretPaths].sort(),
        diagnostics,
        compatibilityStatement: "该结果是 pending 结构化候选；兼容不代表与原 Context 指令行为等价。",
    });
}

/** candidatePackageHash 只投影外部内容 hash，不读取自身字段。 */
function createCandidatePackageHash(input: {
    semanticHash: string;
    planningHash: string;
    renderHash: string;
    diagnosticHash: string;
}): string {
    return hashTextToImageContract({
        semanticHash: input.semanticHash,
        planningHash: input.planningHash,
        renderHash: input.renderHash,
        diagnosticHash: input.diagnosticHash,
    });
}

/** 用候选包内容 hash 派生 companion pair 的共享不可变身份。 */
function createCandidatePackageIdentity(presetId: string, candidatePackageHash: string): {
    packageId: string;
    resourceKey: string;
} {
    const digest = candidatePackageHash.slice("sha256:".length);
    const suffix = `--${digest}`;
    return {
        packageId: `c8pkg.${digest}`,
        resourceKey: `${presetId.slice(0, 160 - suffix.length)}${suffix}`,
    };
}

/** 创建 Chatu8 source provenance。 */
function createSource(input: BuildPendingStoryboardInput) {
    return {
        kind: "chatu8" as const,
        importId: input.importId,
        rawSourceHash: input.inspection.rawSourceHash,
        sanitizedSourceHash: input.inspection.sanitizedSourceHash,
        converterVersion: input.converterVersion,
    };
}

/** 规则/Pattern 必须引用本轮 inspect 中真实存在的 source entry。 */
function assertSourceEntry(sourceEntryId: string, sourceEntries: Map<string, SourceEntryEvidence>): SourceEntryEvidence {
    const source = sourceEntries.get(sourceEntryId);
    if (!source) {
        throw new Error(`STORYBOARD_IMPORT_SOURCE_ENTRY_UNKNOWN: ${sourceEntryId}`);
    }
    return source;
}

/** disabled source 只能产生 disabled candidate，不能被 Agent 重新激活。 */
function assertSourceActivation(source: SourceEntryEvidence, candidateEnabled: boolean, sourceEntryId: string): void {
    if (!source.enabled && candidateEnabled) {
        throw new Error(`STORYBOARD_IMPORT_DISABLED_SOURCE_ACTIVATION: ${sourceEntryId}`);
    }
}

/** provenance 必须落在其 source entry 的 JSON Pointer 子树内。 */
function assertSourcePath(sourcePath: string, source: SourceEntryEvidence, sourceEntryId: string): void {
    if (sourcePath !== source.jsonPointer && !sourcePath.startsWith(`${source.jsonPointer}/`)) {
        throw new Error(`STORYBOARD_IMPORT_SOURCE_PATH_MISMATCH: ${sourceEntryId}`);
    }
}

/** 相同 identity tuple 冲突时 fail-closed，不覆盖或猜测修复。 */
function assertUniqueIds(ids: string[], errorCode: string): void {
    const seen = new Set<string>();
    for (const id of ids) {
        if (seen.has(id)) throw new Error(`${errorCode}: ${id}`);
        seen.add(id);
    }
}

/** 生成只依赖注册 identity tuple 的可读稳定 ID。 */
function createStableId(prefix: string, ...parts: string[]): string {
    const digest = createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 20);
    const suffix = parts.slice(-2).map((part) => part.replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 40)).join(".");
    return `${prefix}.${digest}${suffix ? `.${suffix}` : ""}`;
}

/** pending Tag 做 NFKC、去重、稳定排序；顺序变化不制造无意义 diff。 */
function normalizeTagTexts(values: string[]): string[] {
    return [...new Set(values.map((value) => value.normalize("NFKC").trim()))].sort((left, right) => left.localeCompare(right));
}

/** title 是展示字段，超长动态顶层 key 做有界裁切。 */
function stableTitle(value: string): string {
    return value.trim().slice(0, 160) || "Imported Storyboard";
}

/** 诊断按 severity/code/path/message 稳定排序，避免 Agent 返回顺序污染 hash。 */
function compareDiagnostic(left: ImportDiagnostic, right: ImportDiagnostic): number {
    return left.severity.localeCompare(right.severity)
        || left.code.localeCompare(right.code)
        || left.path.localeCompare(right.path)
        || left.message.localeCompare(right.message);
}
