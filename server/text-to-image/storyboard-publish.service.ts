import {
    createGlobalProfileHomeFacade,
    type ProfileHomeFacade,
} from "nbook/server/agent/profiles/profile-home";
import {resolveGlobalProfileNbookRoot} from "nbook/server/text-to-image/compat";
import {
    IllustrationDirectorSelectorConflictError,
    readIllustrationDirectorSelectorSnapshot,
    updateIllustrationDirectorSelector,
    type IllustrationDirectorSelectorSnapshot,
} from "nbook/server/config/config-service";
import {
    rebaseResolvedStoryboardCompanion,
    type ResolvedStoryboardCompanion,
} from "nbook/server/text-to-image/storyboard-candidate.service";
import {
    verifyResolvedStoryboardImportForPublish,
    type VerifiedResolvedStoryboardImport,
} from "nbook/server/text-to-image/storyboard-import.service";
import {
    readStoryboardGlobalPublishJournal,
    storyboardGlobalPublishDirectory,
    writeStoryboardGlobalPublishJournal,
    type StoryboardGlobalPublishJournal,
    type StoryboardGlobalPublishState,
} from "nbook/server/text-to-image/storyboard-publish-journal";
import {
    parseStoryboardPresetMarkdown,
    renderStoryboardPresetMarkdown,
} from "nbook/server/text-to-image/storyboard-preset.codec";
import {
    parseTagPatternMarkdown,
    renderTagPatternMarkdown,
} from "nbook/server/text-to-image/tag-pattern.codec";
import {
    StoryboardGlobalPublishPreviewRequestSchema,
    StoryboardGlobalPublishPreviewSchema,
    StoryboardGlobalPublishReceiptSchema,
    StoryboardGlobalPublishRequestSchema,
    StoryboardGlobalSelectorRetryRequestSchema,
    createStoryboardGlobalPublishPreviewToken,
    type StoryboardActivePair,
    type StoryboardGlobalPublishPreview,
    type StoryboardGlobalPublishPreviewRequest,
    type StoryboardGlobalPublishReceipt,
    type StoryboardGlobalPublishRequest,
    type StoryboardGlobalSelectorRetryRequest,
    type StoryboardPublishedPair,
} from "nbook/shared/text-to-image-storyboard-publish";
import {
    createStoryboardPresetHashes,
    StoryboardPresetSchema,
} from "nbook/shared/text-to-image-storyboard-preset";
import {
    createTagPatternSetHashes,
    TagPatternSetSchema,
} from "nbook/shared/text-to-image-tag-pattern";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

const PROFILE_KEY = "illustration.director";
const publishLocks = new Map<string, Promise<void>>();

export type StoryboardPublishErrorCode =
    | "STORYBOARD_IMPORT_APPROVAL_INVALID"
    | "STORYBOARD_PRESET_STALE"
    | "STORYBOARD_PRESET_ID_CONFLICT"
    | "TAG_PATTERN_SET_STALE";

/** Global companion publish 的稳定领域错误。 */
export class StoryboardPublishError extends Error {
    readonly code: StoryboardPublishErrorCode;

    constructor(code: StoryboardPublishErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "StoryboardPublishError";
        this.code = code;
    }
}

export type StoryboardGlobalPublishSelectorStore = {
    read(): Promise<IllustrationDirectorSelectorSnapshot>;
    update(input: {expectedConfigHash: string; storyboardPresetKey: string}): Promise<IllustrationDirectorSelectorSnapshot>;
};

type PublishVerifier = (input: {
    projectPath: string;
    importId: string;
    expectedResolvedPreviewToken: string;
    workspaceRoot?: string;
}) => Promise<Pick<VerifiedResolvedStoryboardImport, "preview">>;

type PublishServiceOptions = {
    workspaceRoot?: string;
    selector?: StoryboardGlobalPublishSelectorStore;
    verifyResolvedImport?: PublishVerifier;
    now?: () => number;
    /** 测试只在持久 stage 完成后注入中断。 */
    onStage?: (state: StoryboardGlobalPublishState) => Promise<void>;
};

type PreparedPublishPreview = {
    preview: StoryboardGlobalPublishPreview;
    presetMarkdown: string;
    patternMarkdown: string;
    presetFileHash: string;
    patternFileHash: string;
};

/** 跨 Profile Home pair + Global Config selector 的可恢复发布服务。 */
export class StoryboardGlobalPublishService {
    private readonly workspaceRoot?: string;
    private readonly lockScope: string;
    private readonly home: ProfileHomeFacade;
    private readonly selector: StoryboardGlobalPublishSelectorStore;
    private readonly verifyResolvedImport: PublishVerifier;
    private readonly now: () => number;
    private readonly onStage?: PublishServiceOptions["onStage"];

    constructor(options: PublishServiceOptions = {}) {
        this.workspaceRoot = options.workspaceRoot;
        this.lockScope = resolveGlobalProfileNbookRoot(options.workspaceRoot);
        this.home = createGlobalProfileHomeFacade(this.lockScope, PROFILE_KEY);
        this.selector = options.selector ?? {
            read: readIllustrationDirectorSelectorSnapshot,
            update: updateIllustrationDirectorSelector,
        };
        this.verifyResolvedImport = options.verifyResolvedImport ?? verifyResolvedStoryboardImportForPublish;
        this.now = options.now ?? Date.now;
        this.onStage = options.onStage;
    }

    /** 无副作用发布预览；每次都复验来源、resolved pair、active pair 与 config hash。 */
    async preview(input: StoryboardGlobalPublishPreviewRequest): Promise<StoryboardGlobalPublishPreview> {
        return (await this.preparePreview(StoryboardGlobalPublishPreviewRequestSchema.parse(input))).preview;
    }

    /** 创建 prepared journal 后按固定阶段发布；已有 journal 时只恢复，不再读取原 upload。 */
    async publish(input: StoryboardGlobalPublishRequest, actorId: string): Promise<StoryboardGlobalPublishReceipt> {
        const request = StoryboardGlobalPublishRequestSchema.parse(input);
        const parsedActorId = actorId.trim();
        if (!parsedActorId || parsedActorId.length > 160) {
            throw new StoryboardPublishError("STORYBOARD_IMPORT_APPROVAL_INVALID", "发布 actorId 不合法");
        }
        const publishId = createPublishId(request.publishPreviewToken);
        return withPublishLock(
            `${this.lockScope}:${request.importId}:${publishId}`,
            () => this.publishLocked(request, parsedActorId, publishId),
        );
    }

    /** 锁内创建或恢复同一 immutable pair 发布。 */
    private async publishLocked(
        request: StoryboardGlobalPublishRequest,
        parsedActorId: string,
        publishId: string,
    ): Promise<StoryboardGlobalPublishReceipt> {
        let journal = await readStoryboardGlobalPublishJournal(this.home, request.importId, publishId);
        if (!journal) {
            const prepared = await this.preparePreview(request);
            assertRequestMatchesPreview(request, prepared.preview);
            if (prepared.preview.state !== "ready") {
                throw new StoryboardPublishError("STORYBOARD_PRESET_ID_CONFLICT", prepared.preview.conflict?.message ?? "presetId 冲突");
            }
            const directory = storyboardGlobalPublishDirectory(request.importId, publishId);
            const presetArchivePath = `${directory}/approved.storyboard.md`;
            const patternArchivePath = `${directory}/approved.tag-patterns.md`;
            await writeImmutable(this.home, presetArchivePath, prepared.presetMarkdown, "STORYBOARD_PRESET_STALE");
            await writeImmutable(this.home, patternArchivePath, prepared.patternMarkdown, "TAG_PATTERN_SET_STALE");
            const timestamp = this.timestamp();
            const candidate: StoryboardGlobalPublishJournal = {
                schemaVersion: "nbook.storyboard-global-publish-journal/v1",
                publishId,
                importId: request.importId,
                state: "prepared",
                actorId: parsedActorId,
                requestedAt: timestamp,
                updatedAt: timestamp,
                target: request.target,
                expectedResolvedPreviewToken: request.expectedResolvedPreviewToken,
                publishPreviewToken: request.publishPreviewToken,
                sourceCandidatePackageHash: prepared.preview.sourceCandidatePackageHash,
                publishedCandidatePackageHash: prepared.preview.publishedCandidatePackageHash,
                diagnosticHash: prepared.preview.diagnosticHash,
                published: prepared.preview.published,
                previousSelectorKey: prepared.preview.previousSelectorKey,
                expected: {
                    activePresetFileHash: request.expectedActivePresetFileHash,
                    activePatternFileHash: request.expectedActivePatternFileHash,
                    globalConfigHash: request.expectedGlobalConfigHash,
                },
                staged: {
                    presetArchivePath,
                    patternArchivePath,
                    presetFileHash: prepared.presetFileHash,
                    patternFileHash: prepared.patternFileHash,
                },
                retryExpectedGlobalConfigHash: null,
                publishedAt: null,
                selectorUpdatedAt: null,
                completedAt: null,
            };
            const written = await writeStoryboardGlobalPublishJournal(this.home, candidate, "create");
            journal = written ? candidate : await this.requireJournal(request.importId, publishId);
        }
        assertJournalMatchesRequest(journal, request, parsedActorId);
        if (journal.state === "published_not_selected") return this.receipt(journal);
        return this.resume(journal);
    }

    /** 两份 immutable files 已发布后，使用用户显式确认的新 config hash 只重试 selector。 */
    async retrySelector(input: StoryboardGlobalSelectorRetryRequest): Promise<StoryboardGlobalPublishReceipt> {
        const request = StoryboardGlobalSelectorRetryRequestSchema.parse(input);
        return withPublishLock(
            `${this.lockScope}:${request.importId}:${request.publishId}`,
            () => this.retrySelectorLocked(request),
        );
    }

    /** 锁内只重试 Global Config selector，不重新验证或重写来源。 */
    private async retrySelectorLocked(
        request: StoryboardGlobalSelectorRetryRequest,
    ): Promise<StoryboardGlobalPublishReceipt> {
        let journal = await this.requireJournal(request.importId, request.publishId);
        if (journal.state === "completed") return this.receipt(journal);
        if (journal.state !== "published_not_selected") {
            throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "publish 尚未进入可重试 selector 状态");
        }
        if (request.expectedActivePresetFileHash !== journal.expected.activePresetFileHash
            || request.expectedActivePatternFileHash !== journal.expected.activePatternFileHash
            || request.expectedGlobalConfigHash !== journal.retryExpectedGlobalConfigHash) {
            throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "selector retry expected hash 已失效");
        }
        await this.assertTargetFiles(journal);
        const selector = await this.selector.read();
        if (selector.storyboardPresetKey === journal.published.presetPath) {
            journal = await this.markSelectorUpdated(journal);
            return this.resume(journal);
        }
        if (selector.storyboardPresetKey !== journal.previousSelectorKey) {
            throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "全局 selector 已由其他操作切换");
        }
        await this.assertPreviousActive(journal);
        try {
            await this.selector.update({
                expectedConfigHash: request.expectedGlobalConfigHash,
                storyboardPresetKey: journal.published.presetPath,
            });
            journal = await this.markSelectorUpdated(journal);
            return this.resume(journal);
        } catch (error) {
            if (!(error instanceof IllustrationDirectorSelectorConflictError)) throw error;
            journal = await this.markNotSelected(journal, (await this.selector.read()).configHash);
            return this.receipt(journal);
        }
    }

    /** 重新构建 exact preview 及 approved staged bytes。 */
    private async preparePreview(input: StoryboardGlobalPublishPreviewRequest): Promise<PreparedPublishPreview> {
        const verified = await this.verifyResolvedImport({
            projectPath: input.projectPath,
            importId: input.importId,
            expectedResolvedPreviewToken: input.expectedResolvedPreviewToken,
            ...(this.workspaceRoot ? {workspaceRoot: this.workspaceRoot} : {}),
        });
        const sourceCompanion = parseResolvedCompanion(verified.preview);
        const companion = input.target.mode === "save_as"
            ? rebaseResolvedStoryboardCompanion({companion: sourceCompanion, targetPresetId: input.target.presetId})
            : sourceCompanion;
        if (input.target.mode === "save_as" && input.target.presetId === sourceCompanion.package.presetId) {
            throw new StoryboardPublishError("STORYBOARD_PRESET_ID_CONFLICT", "另存为 presetId 必须与 candidate presetId 不同");
        }
        const approved = approveCompanion(companion);
        const selector = await this.selector.read();
        const active = await readActivePair(this.home, selector.storyboardPresetKey);
        if (input.target.mode === "save_as" && active?.presetId === input.target.presetId) {
            throw new StoryboardPublishError("STORYBOARD_PRESET_ID_CONFLICT", "另存为 presetId 已是当前 active 逻辑 identity");
        }
        const needsReplaceConfirmation = input.target.mode === "candidate"
            && active?.presetId === companion.package.presetId
            && !input.target.confirmReplaceActive;
        const base = {
            schemaVersion: "nbook.storyboard-global-publish-preview/v1" as const,
            state: needsReplaceConfirmation ? "conflict" as const : "ready" as const,
            importId: companion.package.importId,
            target: input.target,
            sourceCandidatePackageHash: sourceCompanion.package.candidatePackageHash,
            publishedCandidatePackageHash: companion.package.candidatePackageHash,
            diagnosticHash: companion.package.diagnosticHash,
            published: approved.published,
            previousSelectorKey: selector.storyboardPresetKey,
            active,
            expected: {
                activePresetFileHash: active?.presetFileHash ?? null,
                activePatternFileHash: active?.patternFileHash ?? null,
                globalConfigHash: selector.configHash,
            },
            conflict: needsReplaceConfirmation && active ? {
                code: "PRESET_ID_CONFLICT" as const,
                activePresetId: active.presetId,
                message: "candidate presetId 与当前 active preset 冲突；请选择显式替换或另存为新 presetId。",
            } : null,
            confirmGlobalRequired: true as const,
        };
        return {
            preview: StoryboardGlobalPublishPreviewSchema.parse({
                ...base,
                publishPreviewToken: createStoryboardGlobalPublishPreviewToken(base),
            }),
            presetMarkdown: approved.presetMarkdown,
            patternMarkdown: approved.patternMarkdown,
            presetFileHash: approved.presetFileHash,
            patternFileHash: approved.patternFileHash,
        };
    }

    /** 从当前 journal stage 幂等推进；published_not_selected 必须经 retrySelector。 */
    private async resume(initial: StoryboardGlobalPublishJournal): Promise<StoryboardGlobalPublishReceipt> {
        let journal = initial;
        while (true) {
            if (journal.state === "completed" || journal.state === "published_not_selected") return this.receipt(journal);
            if (journal.state === "prepared") {
                const content = await this.home.readText(journal.staged.presetArchivePath);
                assertFileHash(content, journal.staged.presetFileHash, "STORYBOARD_PRESET_STALE");
                await writeImmutable(this.home, journal.published.presetPath, content, "STORYBOARD_PRESET_STALE");
                journal = await this.replaceJournal({...journal, state: "preset_published", publishedAt: this.timestamp()});
                await this.onStage?.(journal.state);
                continue;
            }
            if (journal.state === "preset_published") {
                const content = await this.home.readText(journal.staged.patternArchivePath);
                assertFileHash(content, journal.staged.patternFileHash, "TAG_PATTERN_SET_STALE");
                await writeImmutable(this.home, journal.published.patternPath, content, "TAG_PATTERN_SET_STALE");
                journal = await this.replaceJournal({...journal, state: "patterns_published"});
                await this.onStage?.(journal.state);
                continue;
            }
            if (journal.state === "patterns_published") {
                await this.assertTargetFiles(journal);
                const selector = await this.selector.read();
                if (selector.storyboardPresetKey === journal.published.presetPath) {
                    journal = await this.markSelectorUpdated(journal);
                    continue;
                }
                if (selector.storyboardPresetKey !== journal.previousSelectorKey) {
                    journal = await this.markNotSelected(journal, selector.configHash);
                    return this.receipt(journal);
                }
                await this.assertPreviousActive(journal);
                try {
                    await this.selector.update({
                        expectedConfigHash: journal.expected.globalConfigHash,
                        storyboardPresetKey: journal.published.presetPath,
                    });
                    journal = await this.markSelectorUpdated(journal);
                } catch (error) {
                    if (!(error instanceof IllustrationDirectorSelectorConflictError)) throw error;
                    journal = await this.markNotSelected(journal, (await this.selector.read()).configHash);
                    return this.receipt(journal);
                }
                continue;
            }
            if (journal.state === "selector_updated") {
                const selector = await this.selector.read();
                if (selector.storyboardPresetKey !== journal.published.presetPath) {
                    throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "selector_updated journal 与 Global Config 不一致");
                }
                journal = await this.replaceJournal({...journal, state: "completed", completedAt: this.timestamp()});
                await this.onStage?.(journal.state);
                continue;
            }
            throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", `无法恢复 publish state ${journal.state}`);
        }
    }

    /** 两份目标文件必须保持 prepared journal 冻结的确切 bytes。 */
    private async assertTargetFiles(journal: StoryboardGlobalPublishJournal): Promise<void> {
        const [preset, patterns] = await Promise.all([
            this.home.readText(journal.published.presetPath),
            this.home.readText(journal.published.patternPath),
        ]);
        assertFileHash(preset, journal.staged.presetFileHash, "STORYBOARD_PRESET_STALE");
        assertFileHash(patterns, journal.staged.patternFileHash, "TAG_PATTERN_SET_STALE");
    }

    /** selector 切换前，previous pair 仍须与用户预览时的 expected hashes 一致。 */
    private async assertPreviousActive(journal: StoryboardGlobalPublishJournal): Promise<void> {
        const active = await readActivePair(this.home, journal.previousSelectorKey);
        if ((active?.presetFileHash ?? null) !== journal.expected.activePresetFileHash) {
            throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "active Storyboard file hash 已变化");
        }
        if ((active?.patternFileHash ?? null) !== journal.expected.activePatternFileHash) {
            throw new StoryboardPublishError("TAG_PATTERN_SET_STALE", "active Tag Pattern file hash 已变化");
        }
    }

    private async markSelectorUpdated(journal: StoryboardGlobalPublishJournal): Promise<StoryboardGlobalPublishJournal> {
        const updated = await this.replaceJournal({
            ...journal,
            state: "selector_updated",
            retryExpectedGlobalConfigHash: null,
            selectorUpdatedAt: journal.selectorUpdatedAt ?? this.timestamp(),
        });
        await this.onStage?.(updated.state);
        return updated;
    }

    private async markNotSelected(
        journal: StoryboardGlobalPublishJournal,
        retryExpectedGlobalConfigHash: string,
    ): Promise<StoryboardGlobalPublishJournal> {
        const updated = await this.replaceJournal({
            ...journal,
            state: "published_not_selected",
            retryExpectedGlobalConfigHash,
        });
        await this.onStage?.(updated.state);
        return updated;
    }

    private async replaceJournal(journal: StoryboardGlobalPublishJournal): Promise<StoryboardGlobalPublishJournal> {
        const next = {...journal, updatedAt: this.timestamp()};
        await writeStoryboardGlobalPublishJournal(this.home, next, "overwrite");
        return this.requireJournal(journal.importId, journal.publishId);
    }

    private async requireJournal(importId: string, publishId: string): Promise<StoryboardGlobalPublishJournal> {
        const journal = await readStoryboardGlobalPublishJournal(this.home, importId, publishId);
        if (!journal) throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "global publish journal 缺失");
        return journal;
    }

    private async receipt(journal: StoryboardGlobalPublishJournal): Promise<StoryboardGlobalPublishReceipt> {
        if (!journal.publishedAt) throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "publish 尚未写入两份工件");
        const selector = await this.selector.read();
        return StoryboardGlobalPublishReceiptSchema.parse({
            schemaVersion: "nbook.storyboard-global-publish-receipt/v1",
            publishId: journal.publishId,
            importId: journal.importId,
            state: journal.state === "completed" ? "completed" : "published_not_selected",
            published: journal.published,
            previousSelectorKey: journal.previousSelectorKey,
            currentSelectorKey: selector.storyboardPresetKey,
            retryExpectedGlobalConfigHash: journal.state === "published_not_selected"
                ? journal.retryExpectedGlobalConfigHash
                : null,
            publishedAt: journal.publishedAt,
            completedAt: journal.completedAt,
        });
    }

    private timestamp(): string {
        return new Date(this.now()).toISOString();
    }
}

/** resolved preview 必须与两份 Markdown 的 identity/hash 精确一致。 */
function parseResolvedCompanion(preview: VerifiedResolvedStoryboardImport["preview"]): ResolvedStoryboardCompanion {
    const storyboard = parseStoryboardPresetMarkdown(preview.storyboardMarkdown);
    const patterns = parseTagPatternMarkdown(preview.patternMarkdown);
    if (storyboard.hashes.semanticHash !== preview.package.storyboard.semanticHash
        || patterns.hashes.planningHash !== preview.package.patterns.planningHash
        || patterns.hashes.renderHash !== preview.package.patterns.renderHash
        || storyboard.preset.packageId !== preview.package.packageId
        || patterns.patternSet.packageId !== preview.package.packageId
        || storyboard.preset.resourceKey !== preview.package.resourceKey
        || patterns.patternSet.resourceKey !== preview.package.resourceKey) {
        throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "resolved companion 与 package hash 不一致");
    }
    return {storyboard: storyboard.preset, patterns: patterns.patternSet, package: preview.package, diff: preview.diff};
}

/** 把 pending resolved candidate 冻结为 approved pair，并返回 canonical bytes/hash。 */
function approveCompanion(companion: ResolvedStoryboardCompanion): {
    published: StoryboardPublishedPair;
    presetMarkdown: string;
    patternMarkdown: string;
    presetFileHash: string;
    patternFileHash: string;
} {
    const storyboardHashes = createStoryboardPresetHashes(companion.storyboard);
    const patternHashes = createTagPatternSetHashes(companion.patterns);
    const approvedStoryboard = StoryboardPresetSchema.parse({
        ...companion.storyboard,
        review: {
            status: "approved",
            approvedSemanticHash: storyboardHashes.semanticHash,
            approvedDiagnosticHash: storyboardHashes.diagnosticHash,
            approvedRawSourceHash: companion.package.source.rawSourceHash,
            approvedSanitizedSourceHash: companion.package.source.sanitizedSourceHash,
        },
    });
    const approvedPatterns = TagPatternSetSchema.parse({
        ...companion.patterns,
        review: {
            status: "approved",
            approvedPlanningHash: patternHashes.planningHash,
            approvedRenderHash: patternHashes.renderHash,
            approvedRawSourceHash: companion.package.source.rawSourceHash,
            approvedSanitizedSourceHash: companion.package.source.sanitizedSourceHash,
        },
    });
    const presetMarkdown = renderStoryboardPresetMarkdown(approvedStoryboard);
    const patternMarkdown = renderTagPatternMarkdown(approvedPatterns);
    const parsedPreset = parseStoryboardPresetMarkdown(presetMarkdown);
    const parsedPatterns = parseTagPatternMarkdown(patternMarkdown);
    return {
        published: {
            presetId: approvedStoryboard.presetId,
            patternSetId: approvedPatterns.patternSetId,
            packageId: approvedStoryboard.packageId,
            resourceKey: approvedStoryboard.resourceKey,
            storyboardSemanticHash: storyboardHashes.semanticHash,
            patternPlanningHash: patternHashes.planningHash,
            patternRenderHash: patternHashes.renderHash,
            presetPath: `storyboard-presets/${approvedStoryboard.resourceKey}.md`,
            patternPath: `tag-patterns/${approvedStoryboard.resourceKey}.md`,
        },
        presetMarkdown,
        patternMarkdown,
        presetFileHash: parsedPreset.fileHash,
        patternFileHash: parsedPatterns.fileHash,
    };
}

/** 严格读取 current selector 指向的 approved companion；半套、stale 或 identity mismatch 均拒绝。 */
async function readActivePair(home: ProfileHomeFacade, selectorKey: string): Promise<StoryboardActivePair | null> {
    const patternKey = selectorKey.replace(/^storyboard-presets\//u, "tag-patterns/");
    const [hasPreset, hasPatterns] = await Promise.all([home.exists(selectorKey), home.exists(patternKey)]);
    if (!hasPreset && !hasPatterns) return null;
    if (hasPreset !== hasPatterns) {
        throw new StoryboardPublishError("TAG_PATTERN_SET_STALE", "active selector 指向半套 companion pair");
    }
    const [presetText, patternText] = await Promise.all([home.readText(selectorKey), home.readText(patternKey)]);
    const preset = parseStoryboardPresetMarkdown(presetText);
    const patterns = parseTagPatternMarkdown(patternText);
    if (preset.preset.review.status !== "approved"
        || preset.preset.review.approvedSemanticHash !== preset.hashes.semanticHash
        || preset.preset.review.approvedDiagnosticHash !== preset.hashes.diagnosticHash) {
        throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "active Storyboard 不是当前内容的 approved 版本");
    }
    if (patterns.patternSet.review.status !== "approved"
        || patterns.patternSet.review.approvedPlanningHash !== patterns.hashes.planningHash
        || patterns.patternSet.review.approvedRenderHash !== patterns.hashes.renderHash) {
        throw new StoryboardPublishError("TAG_PATTERN_SET_STALE", "active Tag Pattern 不是当前内容的 approved 版本");
    }
    const expectedResourceKey = selectorKey.slice("storyboard-presets/".length, -".md".length);
    if (preset.preset.packageId !== patterns.patternSet.packageId
        || preset.preset.resourceKey !== patterns.patternSet.resourceKey
        || preset.preset.presetId !== patterns.patternSet.presetId
        || preset.preset.patternSetId !== patterns.patternSet.patternSetId
        || preset.preset.resourceKey !== expectedResourceKey) {
        throw new StoryboardPublishError("TAG_PATTERN_SET_STALE", "active companion identity 不匹配");
    }
    return {
        presetId: preset.preset.presetId,
        patternSetId: patterns.patternSet.patternSetId,
        packageId: preset.preset.packageId,
        resourceKey: preset.preset.resourceKey,
        storyboardSemanticHash: preset.hashes.semanticHash,
        patternPlanningHash: patterns.hashes.planningHash,
        patternRenderHash: patterns.hashes.renderHash,
        presetPath: selectorKey,
        patternPath: patternKey,
        presetFileHash: preset.fileHash,
        patternFileHash: patterns.fileHash,
    };
}

function assertRequestMatchesPreview(request: StoryboardGlobalPublishRequest, preview: StoryboardGlobalPublishPreview): void {
    if (request.publishPreviewToken !== preview.publishPreviewToken
        || request.candidatePackageHash !== preview.sourceCandidatePackageHash
        || request.diagnosticHash !== preview.diagnosticHash
        || request.expectedActivePresetFileHash !== preview.expected.activePresetFileHash
        || request.expectedActivePatternFileHash !== preview.expected.activePatternFileHash
        || request.expectedGlobalConfigHash !== preview.expected.globalConfigHash
        || hashTextToImageContract(request.target) !== hashTextToImageContract(preview.target)) {
        throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "global publish preview 已失效");
    }
}

function assertJournalMatchesRequest(
    journal: StoryboardGlobalPublishJournal,
    request: StoryboardGlobalPublishRequest,
    actorId: string,
): void {
    if (journal.actorId !== actorId
        || journal.publishPreviewToken !== request.publishPreviewToken
        || journal.expectedResolvedPreviewToken !== request.expectedResolvedPreviewToken
        || journal.sourceCandidatePackageHash !== request.candidatePackageHash
        || journal.diagnosticHash !== request.diagnosticHash
        || journal.expected.activePresetFileHash !== request.expectedActivePresetFileHash
        || journal.expected.activePatternFileHash !== request.expectedActivePatternFileHash
        || journal.expected.globalConfigHash !== request.expectedGlobalConfigHash
        || hashTextToImageContract(journal.target) !== hashTextToImageContract(request.target)) {
        throw new StoryboardPublishError("STORYBOARD_PRESET_STALE", "publish request 与 prepared journal 不一致");
    }
}

async function writeImmutable(
    home: ProfileHomeFacade,
    filePath: string,
    content: string,
    code: StoryboardPublishErrorCode,
): Promise<void> {
    try {
        const existing = await home.readText(filePath);
        if (existing !== content) throw new StoryboardPublishError(code, `${filePath} 已存在不同内容`);
        return;
    } catch (error) {
        if (!isNotFoundError(error)) throw error;
    }
    const result = await home.writeText(filePath, content, {mode: "create"});
    if (!result.written && await home.readText(filePath) !== content) {
        throw new StoryboardPublishError(code, `${filePath} 并发 create-only 冲突`);
    }
}

function assertFileHash(content: string, expectedHash: string, code: StoryboardPublishErrorCode): void {
    const actual = code === "TAG_PATTERN_SET_STALE"
        ? parseTagPatternMarkdown(content).fileHash
        : parseStoryboardPresetMarkdown(content).fileHash;
    if (actual !== expectedHash) throw new StoryboardPublishError(code, "publish file hash 已变化");
}

/** 同一 publishId 的 journal 与 selector 状态机必须由一个请求独占推进。 */
async function withPublishLock<TResult>(key: string, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = publishLocks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    publishLocks.set(key, tail);
    await previous.catch(() => undefined);
    try {
        return await operation();
    } finally {
        release();
        if (publishLocks.get(key) === tail) publishLocks.delete(key);
    }
}

function createPublishId(publishPreviewToken: string): string {
    return `ttppub.${publishPreviewToken.slice("sha256:".length)}`;
}

function isNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
