import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    createGlobalProfileHomeFacade,
    type ProfileHomeFacade,
} from "nbook/server/agent/profiles/profile-home";
import {resolveGlobalProfileNbookRoot} from "nbook/server/text-to-image/compat";
import {
    StoryboardImportInspectPreviewSchema,
    StoryboardImportPendingPreviewSchema,
    StoryboardImportResolutionGatePreviewSchema,
    StoryboardImportResolvedPreviewSchema,
    StoryboardTagResolutionDiffSchema,
    StoryboardImportSourceListSchema,
    SourceRelativeJsonPathSchema,
    createPendingStoryboardPreviewToken,
    createStoryboardResolutionGateToken,
    type PendingStoryboardPackage,
    type StoryboardImportInspectPreview,
    type StoryboardImportPendingPreview,
    type StoryboardImportResolutionGatePreview,
    type StoryboardImportResolvedPreview,
    type StoryboardImportSourceList,
    type StoryboardResolvedTag,
} from "nbook/shared/text-to-image-storyboard-import";
import {
    hashTextToImageContract,
    type TextToImageContractValue,
} from "nbook/shared/text-to-image-contract-hash";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import type {TtpInspectedEntry} from "nbook/shared/text-to-image-storyboard-import";
import {
    StoryboardStableIdSchema,
    type StoryboardPreset,
} from "nbook/shared/text-to-image-storyboard-preset";
import type {PendingTagPatternSet} from "nbook/shared/text-to-image-storyboard-candidate";
import {
    parseTtpStoryboardJson,
    type ParsedTtpStoryboardJson,
} from "nbook/server/text-to-image/ttp-storyboard-json";
import {
    inspectTtpStoryboard,
    type TtpStoryboardInspection,
} from "nbook/server/text-to-image/ttp-storyboard-inspector";
import {
    buildPendingStoryboardCompanion,
    buildResolvedStoryboardCompanion,
    createPatternResolutionKey,
    StoryboardConversionOutputSchema,
    type PendingStoryboardCompanion,
    type StoryboardConversionOutput,
} from "nbook/server/text-to-image/storyboard-candidate.service";
import {
    parsePendingTagPatternMarkdown,
    renderPendingTagPatternMarkdown,
} from "nbook/server/text-to-image/storyboard-candidate.codec";
import {
    parseTagPatternMarkdown,
    renderTagPatternMarkdown,
} from "nbook/server/text-to-image/tag-pattern.codec";
import {
    parseStoryboardPresetMarkdown,
    renderStoryboardPresetMarkdown,
    createStoryboardPresetFileHash,
} from "nbook/server/text-to-image/storyboard-preset.codec";
import {createTextToImageMarkdownFileHash} from "nbook/server/text-to-image/strict-frontmatter";
import {
    readStoryboardImportJournal,
    storyboardImportStageReached,
    writeStoryboardImportJournal,
    type StoryboardImportJournal,
} from "nbook/server/text-to-image/storyboard-import-journal";
import {
    TagPolicyReviewApprovalInputSchema,
    type TagPolicyReviewApprovalInput,
} from "nbook/shared/text-to-image-tag-resolver";
import type {TagResolverService} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";
import {textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";

const IMPORT_PROFILE_KEY = "illustration.director";
const IMPORT_DIRECTORY = "imports/ttp-storyboard";
const IMPORT_TAG_GROUPS = ["scene", "composition", "lighting", "action", "negativeGlobal", "negativeCharacter"] as const;

export type StoryboardImportErrorCode =
    | "STORYBOARD_IMPORT_PATH_INVALID"
    | "STORYBOARD_IMPORT_SOURCE_NOT_FOUND"
    | "STORYBOARD_IMPORT_SOURCE_NOT_FILE"
    | "STORYBOARD_IMPORT_SOURCE_OUTSIDE_UPLOAD"
    | "STORYBOARD_IMPORT_SOURCE_CHANGED"
    | "STORYBOARD_IMPORT_ARCHIVE_NOT_FOUND"
    | "STORYBOARD_IMPORT_PREVIEW_NOT_READY"
    | "STORYBOARD_IMPORT_JOURNAL_INVALID"
    | "STORYBOARD_IMPORT_ARCHIVE_CONFLICT"
    | "STORYBOARD_IMPORT_CONVERSION_CONFLICT"
    | "STORYBOARD_IMPORT_PREVIEW_STALE"
    | "STORYBOARD_IMPORT_APPROVAL_INVALID";

/** Project inspect/journal 的稳定领域错误。 */
export class StoryboardImportError extends Error {
    readonly code: StoryboardImportErrorCode;

    constructor(code: StoryboardImportErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "StoryboardImportError";
        this.code = code;
    }
}

export type InspectStoryboardImportInput = {
    projectPath: string;
    sourceRelativePath: string;
    workspaceRoot?: string;
    converterVersion: string;
};

export type InspectedStoryboardImport = {
    importId: string;
    presetId: string;
    inspection: TtpStoryboardInspection;
    secretPaths: string[];
    journal: StoryboardImportJournal;
};

export type ConvertStoryboardImportInput = InspectStoryboardImportInput & {
    expectedImportId: string;
    conversion: StoryboardConversionOutput;
};

export type ConvertedStoryboardImport = {
    storyboard: StoryboardPreset;
    patterns: PendingTagPatternSet;
    package: PendingStoryboardPackage;
    journal: StoryboardImportJournal;
};

export type ListStoryboardImportSourcesInput = {
    projectPath: string;
};

export type ReadStoryboardImportPreviewInput = {
    importId: string;
    workspaceRoot?: string;
};

export type ResolveStoryboardImportTagsInput = ReadStoryboardImportPreviewInput & {
    projectPath: string;
    expectedPreviewToken: string;
    approvals: TagPolicyReviewApprovalInput[];
};

export type StoryboardImportPreview = StoryboardImportPendingPreview
    | StoryboardImportResolutionGatePreview
    | StoryboardImportResolvedPreview;

export type StoryboardImportResolutionDependencies = {
    resolver: Pick<TagResolverService, "readResolutionEvidence" | "resolveExplicitImportTag">;
};

export type VerifiedResolvedStoryboardImport = {
    journal: StoryboardImportJournal;
    preview: StoryboardImportResolvedPreview;
};

type ReadImportSource = {
    projectPath: string;
    sourceRelativePath: `upload/${string}.json`;
    parsed: ParsedTtpStoryboardJson;
    inspection: TtpStoryboardInspection;
    importId: string;
    presetId: string;
};

type PersistedInspection = {
    schemaVersion: "nbook.ttp-storyboard-inspect-manifest/v1";
    sourceShape: TtpStoryboardInspection["sourceShape"];
    sourcePresetKey: string;
    rawSourceHash: string;
    sanitizedSourceHash: string;
    entries: Array<{
        sourceIdentity: TtpInspectedEntry["sourceIdentity"];
        enabled: boolean;
        role: TtpInspectedEntry["role"];
        triggerMode: TtpInspectedEntry["triggerMode"];
        triggerWords: string[];
        andTriggerWords: string[];
        contentHash: string;
        unknownFields: string[];
        classifications: TtpInspectedEntry["classifications"];
        flags: TtpInspectedEntry["flags"];
    }>;
    macroTokens: TtpStoryboardInspection["macroTokens"];
    chunks: TtpStoryboardInspection["chunks"];
    inspectionHash: string;
};

const importLocks = new Map<string, Promise<void>>();

/** 只列出当前已打开 Project 的 upload 顶层普通 `.json` 文件，不递归扫描。 */
export async function listStoryboardImportSources(input: ListStoryboardImportSourcesInput): Promise<StoryboardImportSourceList> {
    const projectPath = input.projectPath;
    assertProjectOpen(textToImageProjectRef(projectPath));
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    const uploadPath = path.join(projectRoot, "upload");
    let uploadReal: string;
    try {
        uploadReal = await fs.realpath(uploadPath);
        if (!samePath(uploadReal, uploadPath)) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_SOURCE_OUTSIDE_UPLOAD", "upload 目录不得通过 symlink 指向 Project 外部");
        }
    } catch (error) {
        if (isNotFoundError(error)) {
            return StoryboardImportSourceListSchema.parse({
                schemaVersion: "nbook.storyboard-import-source-list/v1",
                sources: [],
            });
        }
        throw error;
    }
    const entries = await fs.readdir(uploadReal, {withFileTypes: true, encoding: "utf8"});
    const sources = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => ({
            relativePath: `upload/${entry.name}`,
            sizeBytes: (await fs.stat(path.join(uploadReal, entry.name))).size,
        })));
    sources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    markProjectActivity(textToImageProjectRef(projectPath));
    return StoryboardImportSourceListSchema.parse({
        schemaVersion: "nbook.storyboard-import-source-list/v1",
        sources,
    });
}

/**
 * 从当前已打开 Project 的显式 `upload/*.json` 执行 strict inspect，并先脱敏后写入全局 import archive。
 */
export async function inspectStoryboardImport(input: InspectStoryboardImportInput): Promise<InspectedStoryboardImport> {
    const source = await readImportSource(input);
    const home = createImportHome(input.workspaceRoot);
    const journal = await withImportLock(`${home.root}:${source.importId}`, async () => persistInspection(home, source, input.converterVersion));
    markProjectActivity(textToImageProjectRef(source.projectPath));
    return {
        importId: journal.importId,
        presetId: journal.presetId,
        inspection: source.inspection,
        secretPaths: [...source.parsed.secretPaths],
        journal,
    };
}

/** 把内部 inspect 投影为不含 entry content/secret value 的 UI DTO。 */
export function createStoryboardImportInspectPreview(inspected: InspectedStoryboardImport): StoryboardImportInspectPreview {
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
    for (const entry of inspected.inspection.entries) {
        enabledCounts[entry.enabled ? "enabled" : "disabled"] += 1;
        for (const classification of entry.classifications) classificationCounts[classification] += 1;
    }
    return StoryboardImportInspectPreviewSchema.parse({
        schemaVersion: "nbook.storyboard-import-inspect-preview/v1",
        state: "inspected",
        importId: inspected.importId,
        presetId: inspected.presetId,
        sourceRelativePath: inspected.journal.source.relativePath,
        sourcePresetKey: inspected.inspection.sourcePresetKey,
        entryCount: inspected.inspection.entries.length,
        enabledCounts,
        classificationCounts,
        macroTokens: inspected.inspection.macroTokens,
        secretPaths: inspected.secretPaths,
        chunkCount: inspected.inspection.chunks.length,
        tagResolution: {
            ready: false,
            code: "TAG_INDEX_NOT_READY",
            message: "active Tag index 尚未就绪；可以审查结构，但不能批准或发布。",
        },
    });
}

/**
 * 复验原 upload 后，把 strict conversion 成对写成 pending candidates/report；不读取或更新 active selector。
 */
export async function convertStoryboardImport(input: ConvertStoryboardImportInput): Promise<ConvertedStoryboardImport> {
    let source: ReadImportSource;
    try {
        source = await readImportSource(input, input.expectedImportId);
    } catch (error) {
        if (error instanceof StoryboardImportError && error.code === "STORYBOARD_IMPORT_SOURCE_NOT_FOUND") {
            throw new StoryboardImportError("STORYBOARD_IMPORT_SOURCE_CHANGED", "原 upload 文件已删除");
        }
        throw error;
    }
    const conversion = StoryboardConversionOutputSchema.parse(input.conversion);
    const home = createImportHome(input.workspaceRoot);
    const result = await withImportLock(`${home.root}:${source.importId}`, async () => {
        const inspectedJournal = await persistInspection(home, source, input.converterVersion);
        const companion = buildPendingStoryboardCompanion({
            importId: inspectedJournal.importId,
            presetId: inspectedJournal.presetId,
            sourceProjectPath: inspectedJournal.source.projectPath,
            sourceRelativePath: parseSourceRelativePath(inspectedJournal.source.relativePath),
            converterVersion: inspectedJournal.source.converterVersion,
            inspection: source.inspection,
            secretPaths: source.parsed.secretPaths,
            conversion,
        });
        const storyboardMarkdown = renderStoryboardPresetMarkdown(companion.storyboard);
        const patternMarkdown = renderPendingTagPatternMarkdown(companion.patterns);
        const candidateFiles = {
            storyboardFileHash: createStoryboardPresetFileHash(storyboardMarkdown),
            patternFileHash: createTextToImageMarkdownFileHash(patternMarkdown),
        };

        if (inspectedJournal.package
            && (inspectedJournal.package.candidatePackageHash !== companion.package.candidatePackageHash
                || inspectedJournal.package.recipeProposalHash !== companion.package.recipeProposalHash)) {
            throw new StoryboardImportError(
                "STORYBOARD_IMPORT_CONVERSION_CONFLICT",
                "相同 importId/converterVersion 产生了不同 candidate package；必须提升 converterVersion",
            );
        }

        await writeImportArtifact(home, source.importId, "candidate.storyboard.md", storyboardMarkdown);
        await writeImportArtifact(home, source.importId, "candidate.tag-patterns.md", patternMarkdown);
        let journal = inspectedJournal;
        if (!storyboardImportStageReached(journal.stage, "candidates_written")) {
            journal = await replaceJournal(home, {
                ...journal,
                stage: "candidates_written",
                candidateFiles,
                package: companion.package,
            });
        } else if (!journal.candidateFiles
            || journal.candidateFiles.storyboardFileHash !== candidateFiles.storyboardFileHash
            || journal.candidateFiles.patternFileHash !== candidateFiles.patternFileHash) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_CONVERSION_CONFLICT", "candidate file hash 与 journal 不一致");
        }

        const reportMarkdown = renderImportReport(companion.package);
        const reportFileHash = createTextToImageMarkdownFileHash(reportMarkdown);
        await writeImportArtifact(home, source.importId, "report.md", reportMarkdown);
        if (!storyboardImportStageReached(journal.stage, "report_written")) {
            journal = await replaceJournal(home, {...journal, stage: "report_written", reportFileHash});
        } else if (journal.reportFileHash !== reportFileHash) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_CONVERSION_CONFLICT", "report file hash 与 journal 不一致");
        }
        if (!storyboardImportStageReached(journal.stage, "completed")) {
            journal = await replaceJournal(home, {...journal, stage: "completed"});
        }
        return {...companion, journal};
    });
    markProjectActivity(textToImageProjectRef(source.projectPath));
    return result;
}

/** 从全局 journal 返回当前唯一 preview；resolved/gate/pending 互斥，不读取原 upload 或 active selector。 */
export async function readStoryboardImportPreview(input: ReadStoryboardImportPreviewInput): Promise<StoryboardImportPreview> {
    const importId = StoryboardStableIdSchema.parse(input.importId);
    const home = createImportHome(input.workspaceRoot);
    const journal = await readStoryboardImportJournal(home, importId);
    if (!journal) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_ARCHIVE_NOT_FOUND", "import archive 不存在");
    }
    if (!journal.package || !journal.candidateFiles || !storyboardImportStageReached(journal.stage, "candidates_written")) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_NOT_READY", "Director 尚未提交完整 pending companion");
    }
    if (journal.resolution.state === "gate") return journal.resolution.preview;
    if (journal.resolution.state === "prepared") {
        throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_NOT_READY", "resolved artifacts 正在等待 journal 恢复");
    }
    if (journal.resolution.state === "resolved") {
        return readResolvedImportPreview(home, journal);
    }
    const [storyboardMarkdown, patternMarkdown] = await Promise.all([
        readImportArtifact(home, importId, "candidate.storyboard.md"),
        readImportArtifact(home, importId, "candidate.tag-patterns.md"),
    ]);
    const storyboard = parseStoryboardPresetMarkdown(storyboardMarkdown);
    const patterns = parsePendingTagPatternMarkdown(patternMarkdown);
    const candidatePackage = journal.package;
    if (storyboard.fileHash !== journal.candidateFiles.storyboardFileHash
        || patterns.fileHash !== journal.candidateFiles.patternFileHash
        || storyboard.hashes.semanticHash !== candidatePackage.storyboard.semanticHash
        || patterns.hashes.planningHash !== candidatePackage.patterns.planningHash
        || patterns.hashes.renderHash !== candidatePackage.patterns.renderHash
        || storyboard.preset.packageId !== candidatePackage.packageId
        || storyboard.preset.resourceKey !== candidatePackage.resourceKey
        || patterns.patternSet.packageId !== candidatePackage.packageId
        || patterns.patternSet.resourceKey !== candidatePackage.resourceKey
        || storyboard.preset.rules.length !== candidatePackage.storyboard.ruleCount
        || patterns.patternSet.patterns.length !== candidatePackage.patterns.patternCount) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", "pending candidate 与 journal package 不一致");
    }
    return StoryboardImportPendingPreviewSchema.parse({
        schemaVersion: "nbook.storyboard-import-pending-preview/v1",
        state: "pending_unresolved",
        package: candidatePackage,
        previewToken: createPendingStoryboardPreviewToken(candidatePackage),
        storyboardMarkdown,
        patternMarkdown,
        approval: {
            enabled: false,
            code: "TAG_INDEX_NOT_READY",
            message: "active Tag index 尚未就绪；当前候选不可批准或发布。",
        },
    });
}

/**
 * 发布准备专用复验：resolved archive、原 upload bytes 与脱敏 archive 必须仍绑定同一 import。
 * prepared publish journal 写成后，中断恢复不再依赖来源 Project 或原 upload 存续。
 */
export async function verifyResolvedStoryboardImportForPublish(input: {
    projectPath: string;
    importId: string;
    expectedResolvedPreviewToken: string;
    workspaceRoot?: string;
}): Promise<VerifiedResolvedStoryboardImport> {
    const projectPath = input.projectPath;
    assertProjectOpen(textToImageProjectRef(projectPath));
    const importId = StoryboardStableIdSchema.parse(input.importId);
    const expectedResolvedPreviewToken = TextToImageContractHashSchema.parse(input.expectedResolvedPreviewToken);
    const home = createImportHome(input.workspaceRoot);
    return withImportLock(`${home.root}:${importId}`, async () => {
        const journal = await requireJournal(home, importId);
        if (journal.source.projectPath !== projectPath) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "import 不属于当前 Project Workspace");
        }
        if (journal.resolution.state !== "resolved") {
            throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_NOT_READY", "Tag resolution 尚未形成可发布 candidate");
        }
        const preview = await readResolvedImportPreview(home, journal);
        if (preview.package.previewToken !== expectedResolvedPreviewToken) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_STALE", "resolved preview token 已失效");
        }
        if (!preview.approval.enabled) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "blocking diagnostic 未清除，不能发布");
        }
        const source = await readImportSource({
            projectPath,
            sourceRelativePath: journal.source.relativePath,
            converterVersion: journal.source.converterVersion,
        }, journal.importId);
        assertJournalSource(journal, source, journal.source.converterVersion);
        const sanitizedArchive = await readImportArtifact(home, importId, "source.sanitized.json");
        if (sha256(sanitizedArchive) !== journal.source.sanitizedSourceHash) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_ARCHIVE_CONFLICT", "source.sanitized.json hash 与 journal 不一致");
        }
        markProjectActivity(textToImageProjectRef(projectPath));
        return {journal, preview};
    });
}

/**
 * 用户显式触发的 pending Tag resolution operation。
 *
 * 所有 atom 使用同一 run/context；review 只能消费当前 gate hash，terminal 先冻结进 journal prepared，
 * 再幂等写入正式 resolved companion，避免中断后因审计时间变化产生文件冲突。
 */
export async function resolveStoryboardImportTags(
    input: ResolveStoryboardImportTagsInput,
    dependencies: StoryboardImportResolutionDependencies,
): Promise<StoryboardImportPreview> {
    const importId = StoryboardStableIdSchema.parse(input.importId);
    const projectPath = input.projectPath;
    assertProjectOpen(textToImageProjectRef(projectPath));
    const expectedPreviewToken = TextToImageContractHashSchema.parse(input.expectedPreviewToken);
    if (!Array.isArray(input.approvals) || input.approvals.length > 100000) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "approval 数量非法");
    }
    const approvals = input.approvals.map((approval) => TagPolicyReviewApprovalInputSchema.parse(approval));
    const approvalByHash = new Map<string, TagPolicyReviewApprovalInput>();
    for (const approval of approvals) {
        if (approvalByHash.has(approval.reviewRequestHash)) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "reviewRequestHash 不能重复");
        }
        approvalByHash.set(approval.reviewRequestHash, approval);
    }
    const home = createImportHome(input.workspaceRoot);
    return withImportLock(`${home.root}:${importId}`, async () => {
        let journal = await requireJournal(home, importId);
        if (journal.source.projectPath !== projectPath) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "import 不属于当前 Project Workspace");
        }
        if (!journal.package || !journal.candidateFiles || !storyboardImportStageReached(journal.stage, "candidates_written")) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_NOT_READY", "pending companion 尚未冻结");
        }
        const pending = await readPendingCompanion(home, journal);
        if (journal.resolution.state === "prepared" || journal.resolution.state === "resolved") {
            if (expectedPreviewToken !== journal.resolution.acceptedPreviewToken
                && expectedPreviewToken !== journal.resolution.package.previewToken) {
                throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_STALE", "resolved preview token 已变化");
            }
            if (journal.resolution.state === "prepared") {
                journal = await completePreparedResolution(home, journal, pending);
            }
            return readResolvedImportPreview(home, journal);
        }

        const gate = journal.resolution.state === "gate" ? journal.resolution.preview : null;
        const currentPreviewToken = gate?.previewToken ?? createPendingStoryboardPreviewToken(journal.package);
        if (expectedPreviewToken !== currentPreviewToken) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_STALE", "pending/review preview token 已变化");
        }
        const approvalByResolution = new Map<string, TagPolicyReviewApprovalInput>();
        if (!gate && approvals.length > 0) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "尚无 review gate，不能提交 approval");
        }
        if (gate) {
            const reviewEntries = gate.entries.filter((entry) => entry.outcome === "review_required");
            const allowedHashes = new Set(reviewEntries.map((entry) => entry.review.reviewRequestHash));
            for (const approval of approvals) {
                if (!allowedHashes.has(approval.reviewRequestHash)) {
                    throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "approval 不属于当前 review gate");
                }
            }
            if (approvals.length > 0 && approvals.length !== reviewEntries.length) {
                throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "必须逐项确认当前 gate 的全部 review_required atom");
            }
            for (const entry of reviewEntries) {
                const approval = approvalByHash.get(entry.review.reviewRequestHash);
                if (approval) approvalByResolution.set(entry.resolutionId, approval);
            }
        }

        const contextId = createImportRuntimeId("import-context", {projectPath: journal.source.projectPath});
        const runId = createImportRuntimeId("import-run", {
            importId,
            pendingCandidatePackageHash: journal.package.candidatePackageHash,
        });
        const resolutionContext = await dependencies.resolver.readResolutionEvidence({
            contextId,
            modelScope: {kind: "generic-novelai"},
        });
        const records: StoryboardResolvedTag[] = [];
        const gateEntries: StoryboardImportResolutionGatePreview["entries"] = [];
        for (const pattern of pending.patterns.patterns) {
            for (const group of IMPORT_TAG_GROUPS) {
                for (const atom of pattern.pendingTags[group]) {
                    const resolutionId = createPatternResolutionKey(pending.patterns.patternSetId, pattern.patternId, atom);
                    const result = await dependencies.resolver.resolveExplicitImportTag({
                        runId,
                        contextId,
                        resolutionId,
                        sourceText: atom.sourceText,
                        modelScope: {kind: "generic-novelai"},
                        approval: approvalByResolution.get(resolutionId) ?? null,
                    });
                    if (result.state === "terminal") {
                        if (!("terminal" in result.run)) {
                            throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", "Resolver terminal result 缺失 snapshot");
                        }
                        records.push({
                            patternId: pattern.patternId,
                            atom,
                            terminal: result.run.terminal,
                            reviewApproval: result.reviewApproval,
                        });
                    } else if (result.state === "review_required") {
                        gateEntries.push({
                            outcome: "review_required",
                            patternId: pattern.patternId,
                            atom,
                            resolutionId,
                            review: result.review,
                        });
                    } else {
                        gateEntries.push({
                            outcome: "blocked",
                            patternId: pattern.patternId,
                            atom,
                            resolutionId,
                            code: result.code,
                            policy: result.policy,
                            subject: result.subject,
                        });
                    }
                }
            }
        }

        if (gateEntries.length > 0) {
            const state = gateEntries.some((entry) => entry.outcome === "blocked") ? "blocked" as const : "review_required" as const;
            const gateBase = {
                schemaVersion: "nbook.storyboard-import-resolution-gate/v1" as const,
                state,
                importId,
                pendingCandidatePackageHash: journal.package.candidatePackageHash,
                entries: gateEntries,
            };
            const preview = StoryboardImportResolutionGatePreviewSchema.parse({
                ...gateBase,
                previewToken: createStoryboardResolutionGateToken(gateBase),
                approval: state === "blocked"
                    ? {enabled: false, code: "TAG_POLICY_BLOCKED", message: "至少一个 Tag 被当前 policy 或 deprecated 边界阻断。"}
                    : {enabled: false, code: "TAG_POLICY_REVIEW_REQUIRED", message: "必须逐项确认当前 review_required Tag 后重新解析。"},
            });
            journal = await replaceJournal(home, {...journal, resolution: {state: "gate", preview}});
            return journal.resolution.state === "gate" ? journal.resolution.preview : preview;
        }
        if (approvalByResolution.size !== records.filter((record) => record.reviewApproval !== null).length) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_APPROVAL_INVALID", "Resolver 未消费全部 review approval");
        }

        const resolved = buildResolvedStoryboardCompanion({pending, resolutionContext, resolutions: records});
        const storyboardMarkdown = renderStoryboardPresetMarkdown(resolved.storyboard);
        const patternMarkdown = renderTagPatternMarkdown(resolved.patterns);
        const diffText = `${JSON.stringify(resolved.diff, null, 4)}\n`;
        const resolvedFiles = {
            storyboardFileHash: createStoryboardPresetFileHash(storyboardMarkdown),
            patternFileHash: createTextToImageMarkdownFileHash(patternMarkdown),
            diffFileHash: createTextToImageMarkdownFileHash(diffText),
        };
        journal = await replaceJournal(home, {
            ...journal,
            resolution: {
                state: "prepared",
                pendingCandidatePackageHash: journal.package.candidatePackageHash,
                acceptedPreviewToken: expectedPreviewToken,
                records,
                resolvedFiles,
                package: resolved.package,
                diff: resolved.diff,
            },
        });
        journal = await completePreparedResolution(home, journal, pending);
        return readResolvedImportPreview(home, journal);
    });
}

/** 读取源文件并完成真实路径 containment、strict parse 与 deterministic inspect。 */
async function readImportSource(
    input: InspectStoryboardImportInput,
    expectedImportId?: string,
): Promise<ReadImportSource> {
    const projectPath = input.projectPath;
    assertProjectOpen(textToImageProjectRef(projectPath));
    const sourceRelativePath = parseSourceRelativePath(input.sourceRelativePath);
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    const sourcePath = await resolveUploadSource(projectRoot, sourceRelativePath);
    let bytes: Uint8Array;
    try {
        bytes = await fs.readFile(sourcePath);
    } catch (error) {
        if (isNotFoundError(error)) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_SOURCE_NOT_FOUND", "upload 文件不存在");
        }
        throw error;
    }
    const importId = createStableId("ttpi", sha256Bytes(bytes), input.converterVersion);
    if (expectedImportId && importId !== expectedImportId) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_SOURCE_CHANGED", "原 upload 文件内容或 converterVersion 已改变");
    }
    const parsed = parseTtpStoryboardJson(bytes);
    const inspection = inspectTtpStoryboard(parsed);
    const presetId = createStableId("ttpp", projectPath, sourceRelativePath, inspection.sourcePresetKey);
    return {projectPath, sourceRelativePath, parsed, inspection, importId, presetId};
}

/** 创建/恢复 archive 与 inspect manifest，任何文件冲突均 fail-closed。 */
async function persistInspection(
    home: ProfileHomeFacade,
    source: ReadImportSource,
    converterVersion: string,
): Promise<StoryboardImportJournal> {
    let journal = await readStoryboardImportJournal(home, source.importId);
    if (!journal) {
        const prepared: StoryboardImportJournal = {
            schemaVersion: "nbook.storyboard-import-journal/v1",
            importId: source.importId,
            presetId: source.presetId,
            stage: "prepared",
            source: {
                projectPath: source.projectPath,
                relativePath: source.sourceRelativePath,
                rawSourceHash: source.parsed.rawSourceHash,
                sanitizedSourceHash: source.parsed.sanitizedSourceHash,
                converterVersion,
            },
            inspectHash: source.inspection.inspectionHash,
            candidateFiles: null,
            reportFileHash: null,
            package: null,
            resolution: {state: "not_started"},
        };
        const written = await writeStoryboardImportJournal(home, prepared, "create");
        journal = written ? prepared : await requireJournal(home, source.importId);
    }
    assertJournalSource(journal, source, converterVersion);

    const sanitizedText = new TextDecoder("utf-8", {fatal: true}).decode(source.parsed.sanitizedBytes);
    await writeImportArtifact(home, source.importId, "source.sanitized.json", sanitizedText);
    if (!storyboardImportStageReached(journal.stage, "archive_written")) {
        journal = await replaceJournal(home, {...journal, stage: "archive_written"});
    }

    const inspectText = `${JSON.stringify(createInspectManifest(source.inspection), null, 4)}\n`;
    await writeImportArtifact(home, source.importId, "inspect.json", inspectText);
    if (!storyboardImportStageReached(journal.stage, "inspect_written")) {
        journal = await replaceJournal(home, {...journal, stage: "inspect_written"});
    }
    return journal;
}

/** 把 inspect 持久化投影限制为 hash/分类/来源映射，不复制完整 content。 */
function createInspectManifest(inspection: TtpStoryboardInspection): PersistedInspection {
    return {
        schemaVersion: "nbook.ttp-storyboard-inspect-manifest/v1",
        sourceShape: inspection.sourceShape,
        sourcePresetKey: inspection.sourcePresetKey,
        rawSourceHash: inspection.rawSourceHash,
        sanitizedSourceHash: inspection.sanitizedSourceHash,
        entries: inspection.entries.map((entry) => ({
            sourceIdentity: {...entry.sourceIdentity},
            enabled: entry.enabled,
            role: entry.role,
            triggerMode: entry.triggerMode,
            triggerWords: [...entry.triggerWords],
            andTriggerWords: [...entry.andTriggerWords],
            contentHash: sha256(entry.content),
            unknownFields: [...entry.unknownFields],
            classifications: [...entry.classifications],
            flags: {...entry.flags},
        })),
        macroTokens: inspection.macroTokens.map((token) => ({...token})),
        chunks: inspection.chunks.map((chunk) => ({
            ...chunk,
            segments: chunk.segments.map((segment) => ({...segment})),
        })),
        inspectionHash: inspection.inspectionHash,
    };
}

/** 精确解析一层 upload JSON 路径；绝对路径、反斜杠和子目录统一拒绝。 */
function parseSourceRelativePath(value: string): `upload/${string}.json` {
    const parsed = SourceRelativeJsonPathSchema.safeParse(value);
    if (!parsed.success) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_PATH_INVALID", "只接受显式 upload/<file>.json");
    }
    const fileName = parsed.data.slice("upload/".length, -".json".length);
    return `upload/${fileName}.json`;
}

/** realpath containment 防止 upload 目录或文件 symlink 逃逸当前 Project。 */
async function resolveUploadSource(projectRoot: string, sourceRelativePath: string): Promise<string> {
    let projectReal: string;
    let uploadReal: string;
    let sourceReal: string;
    try {
        projectReal = await fs.realpath(projectRoot);
        uploadReal = await fs.realpath(path.join(projectRoot, "upload"));
        sourceReal = await fs.realpath(path.join(projectRoot, ...sourceRelativePath.split("/")));
    } catch (error) {
        if (isNotFoundError(error)) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_SOURCE_NOT_FOUND", "upload 文件不存在");
        }
        throw error;
    }
    if (!samePath(uploadReal, path.join(projectReal, "upload"))) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_SOURCE_OUTSIDE_UPLOAD", "upload 目录不得通过 symlink 指向 Project 外部");
    }
    const relativePath = path.relative(uploadReal, sourceReal);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath.includes(path.sep)) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_SOURCE_OUTSIDE_UPLOAD", "源文件必须位于当前 Project 的 upload 顶层");
    }
    const stat = await fs.stat(sourceReal);
    if (!stat.isFile()) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_SOURCE_NOT_FILE", "源路径必须是普通文件");
    }
    return sourceReal;
}

/** 确认 journal 绑定同 raw/sanitized/converter；同内容跨 Project 可复用既有 archive。 */
function assertJournalSource(journal: StoryboardImportJournal, source: ReadImportSource, converterVersion: string): void {
    if (journal.importId !== source.importId
        || journal.source.rawSourceHash !== source.parsed.rawSourceHash
        || journal.source.sanitizedSourceHash !== source.parsed.sanitizedSourceHash
        || journal.source.converterVersion !== converterVersion
        || journal.inspectHash !== source.inspection.inspectionHash) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", "journal 与当前 strict inspect 不一致");
    }
}

/** create-only 写入 archive artifact；已存在时必须逐字节相同。 */
async function writeImportArtifact(
    home: ProfileHomeFacade,
    importId: string,
    fileName: string,
    content: string,
): Promise<void> {
    const filePath = `${IMPORT_DIRECTORY}/${StoryboardStableIdSchema.parse(importId)}/${fileName}`;
    try {
        const existing = await home.readText(filePath);
        if (existing !== content) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_ARCHIVE_CONFLICT", `${fileName} 与既有 archive 不一致`);
        }
        return;
    } catch (error) {
        if (!isNotFoundError(error)) throw error;
    }
    const result = await home.writeText(filePath, content, {mode: "create"});
    if (!result.written && await home.readText(filePath) !== content) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_ARCHIVE_CONFLICT", `${fileName} 并发写入冲突`);
    }
}

/** 读取已 journaled 的导入工件；缺失统一视为 archive 完整性错误。 */
async function readImportArtifact(home: ProfileHomeFacade, importId: string, fileName: string): Promise<string> {
    try {
        return await home.readText(`${IMPORT_DIRECTORY}/${importId}/${fileName}`);
    } catch (error) {
        if (isNotFoundError(error)) {
            throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", `${fileName} 缺失`);
        }
        throw error;
    }
}

/** 从 pending artifact 与 journal 复验并重建 companion；Tag resolution 不读取原 upload。 */
async function readPendingCompanion(
    home: ProfileHomeFacade,
    journal: StoryboardImportJournal,
): Promise<PendingStoryboardCompanion> {
    if (!journal.package || !journal.candidateFiles) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_NOT_READY", "pending companion 尚未冻结");
    }
    const [storyboardMarkdown, patternMarkdown] = await Promise.all([
        readImportArtifact(home, journal.importId, "candidate.storyboard.md"),
        readImportArtifact(home, journal.importId, "candidate.tag-patterns.md"),
    ]);
    const storyboard = parseStoryboardPresetMarkdown(storyboardMarkdown);
    const patterns = parsePendingTagPatternMarkdown(patternMarkdown);
    if (storyboard.fileHash !== journal.candidateFiles.storyboardFileHash
        || patterns.fileHash !== journal.candidateFiles.patternFileHash
        || storyboard.hashes.semanticHash !== journal.package.storyboard.semanticHash
        || patterns.hashes.planningHash !== journal.package.patterns.planningHash
        || patterns.hashes.renderHash !== journal.package.patterns.renderHash
        || storyboard.preset.packageId !== journal.package.packageId
        || patterns.patternSet.packageId !== journal.package.packageId) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", "pending companion 与 journal 不一致");
    }
    return {storyboard: storyboard.preset, patterns: patterns.patternSet, package: journal.package};
}

/** prepared journal 已冻结全部 terminal/approval 时间；据此幂等完成三份 resolved artifact。 */
async function completePreparedResolution(
    home: ProfileHomeFacade,
    journal: StoryboardImportJournal,
    pending: PendingStoryboardCompanion,
): Promise<StoryboardImportJournal> {
    if (journal.resolution.state === "resolved") return journal;
    if (journal.resolution.state !== "prepared") {
        throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", "resolution 尚未 prepared");
    }
    const prepared = journal.resolution;
    const rebuilt = buildResolvedStoryboardCompanion({
        pending,
        resolutionContext: prepared.package.resolutionEvidence,
        resolutions: prepared.records,
    });
    const storyboardMarkdown = renderStoryboardPresetMarkdown(rebuilt.storyboard);
    const patternMarkdown = renderTagPatternMarkdown(rebuilt.patterns);
    const diffText = `${JSON.stringify(rebuilt.diff, null, 4)}\n`;
    const rebuiltFiles = {
        storyboardFileHash: createStoryboardPresetFileHash(storyboardMarkdown),
        patternFileHash: createTextToImageMarkdownFileHash(patternMarkdown),
        diffFileHash: createTextToImageMarkdownFileHash(diffText),
    };
    if (rebuilt.package.candidatePackageHash !== prepared.package.candidatePackageHash
        || rebuilt.package.previewToken !== prepared.package.previewToken
        || hashTextToImageContract(rebuilt.diff) !== hashTextToImageContract(prepared.diff)
        || hashTextToImageContract(rebuiltFiles) !== hashTextToImageContract(prepared.resolvedFiles)) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", "prepared resolution 无法确定性重建");
    }
    await writeImportArtifact(home, journal.importId, "resolved.storyboard.md", storyboardMarkdown);
    await writeImportArtifact(home, journal.importId, "resolved.tag-patterns.md", patternMarkdown);
    await writeImportArtifact(home, journal.importId, "resolved.diff.json", diffText);
    return replaceJournal(home, {...journal, resolution: {...prepared, state: "resolved"}});
}

/** 复验 resolved artifacts 后生成唯一可审批 preview。 */
async function readResolvedImportPreview(
    home: ProfileHomeFacade,
    journal: StoryboardImportJournal,
): Promise<StoryboardImportResolvedPreview> {
    if (journal.resolution.state !== "resolved") {
        throw new StoryboardImportError("STORYBOARD_IMPORT_PREVIEW_NOT_READY", "resolved artifacts 尚未完成");
    }
    const resolution = journal.resolution;
    const [storyboardMarkdown, patternMarkdown, diffText] = await Promise.all([
        readImportArtifact(home, journal.importId, "resolved.storyboard.md"),
        readImportArtifact(home, journal.importId, "resolved.tag-patterns.md"),
        readImportArtifact(home, journal.importId, "resolved.diff.json"),
    ]);
    const storyboard = parseStoryboardPresetMarkdown(storyboardMarkdown);
    const patterns = parseTagPatternMarkdown(patternMarkdown);
    let diffInput: unknown;
    try {
        diffInput = JSON.parse(diffText);
    } catch (error) {
        throw new StoryboardImportError(
            "STORYBOARD_IMPORT_JOURNAL_INVALID",
            error instanceof Error ? `resolved diff JSON 非法：${error.message}` : "resolved diff JSON 非法",
        );
    }
    const diff = StoryboardTagResolutionDiffSchema.parse(diffInput);
    if (storyboard.fileHash !== resolution.resolvedFiles.storyboardFileHash
        || patterns.fileHash !== resolution.resolvedFiles.patternFileHash
        || createTextToImageMarkdownFileHash(diffText) !== resolution.resolvedFiles.diffFileHash
        || storyboard.hashes.semanticHash !== resolution.package.storyboard.semanticHash
        || patterns.hashes.planningHash !== resolution.package.patterns.planningHash
        || patterns.hashes.renderHash !== resolution.package.patterns.renderHash
        || storyboard.preset.packageId !== resolution.package.packageId
        || patterns.patternSet.packageId !== resolution.package.packageId
        || storyboard.preset.resourceKey !== resolution.package.resourceKey
        || patterns.patternSet.resourceKey !== resolution.package.resourceKey
        || hashTextToImageContract(diff) !== hashTextToImageContract(resolution.diff)) {
        throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", "resolved companion/diff 与 journal 不一致");
    }
    const hasBlocking = storyboard.preset.risks.some((risk) => risk.severity === "blocking")
        || storyboard.preset.macros.unresolved.some((macro) => macro.blocking)
        || patterns.patternSet.risks.some((risk) => risk.severity === "blocking");
    return StoryboardImportResolvedPreviewSchema.parse({
        schemaVersion: "nbook.storyboard-import-resolved-preview/v1",
        state: "pending",
        package: resolution.package,
        storyboardMarkdown,
        patternMarkdown,
        diff,
        approval: hasBlocking
            ? {
                enabled: false,
                code: "BLOCKING_DIAGNOSTIC",
                message: "resolved candidate 仍含 blocking diagnostic，不可进入全局 pair publish。",
                previewToken: resolution.package.previewToken,
            }
            : {enabled: true, previewToken: resolution.package.previewToken},
    });
}

/** 生成只含稳定 ASCII 的 import runtime ID，不复用可变 Project path。 */
function createImportRuntimeId(prefix: "import-context" | "import-run", evidence: TextToImageContractValue): string {
    return `${prefix}.${hashTextToImageContract(evidence).slice("sha256:".length)}`;
}

/** overwrite journal 并返回 strict round-trip 结果。 */
async function replaceJournal(home: ProfileHomeFacade, journal: StoryboardImportJournal): Promise<StoryboardImportJournal> {
    await writeStoryboardImportJournal(home, journal, "overwrite");
    return requireJournal(home, journal.importId);
}

/** 读取必然存在的 journal；缺失代表 archive 被外部破坏。 */
async function requireJournal(home: ProfileHomeFacade, importId: string): Promise<StoryboardImportJournal> {
    const journal = await readStoryboardImportJournal(home, importId);
    if (!journal) throw new StoryboardImportError("STORYBOARD_IMPORT_JOURNAL_INVALID", "journal 缺失");
    return journal;
}

/** report.md 同时展示 bounded report 与 pair/package hash，不复制完整外部 Prompt。 */
function renderImportReport(pendingPackage: PendingStoryboardPackage): string {
    return [
        `# TTP Storyboard Import ${pendingPackage.importId}`,
        "",
        "状态：pending_unresolved（不可批准）",
        "",
        `- Storyboard: ${pendingPackage.storyboard.candidatePath} / ${pendingPackage.storyboard.semanticHash}`,
        `- Tag Patterns: ${pendingPackage.patterns.candidatePath} / planning ${pendingPackage.patterns.planningHash} / render ${pendingPackage.patterns.renderHash}`,
        `- Diagnostic: ${pendingPackage.diagnosticHash}`,
        `- Candidate package: ${pendingPackage.candidatePackageHash}`,
        "",
        "```json",
        JSON.stringify(pendingPackage.report, null, 4),
        "```",
        "",
    ].join("\n");
}

/** 按 rawSourceHash + converterVersion 派生内容寻址 importId。 */
function createStableId(prefix: string, ...parts: string[]): string {
    const digest = createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 32);
    return `${prefix}.${digest}`;
}

/** 创建受限全局 illustration.director Profile Home。 */
function createImportHome(workspaceRoot: string | undefined): ProfileHomeFacade {
    return createGlobalProfileHomeFacade(
        resolveGlobalProfileNbookRoot(workspaceRoot),
        IMPORT_PROFILE_KEY,
    );
}

/** 单进程同 import 串行化；失败不会阻断后续重放。 */
async function withImportLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = importLocks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    importLocks.set(key, tail);
    await previous.catch(() => undefined);
    try {
        return await operation();
    } finally {
        release();
        if (importLocks.get(key) === tail) importLocks.delete(key);
    }
}

function sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sha256Bytes(value: Uint8Array): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function samePath(left: string, right: string): boolean {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    return process.platform === "win32"
        ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
        : normalizedLeft === normalizedRight;
}

function isNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
