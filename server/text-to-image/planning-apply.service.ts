import {absoluteFsPath} from "nbook/server/text-to-image/compat";
import fs from "node:fs/promises";
import path from "node:path";
import {lock} from "proper-lockfile";
import type {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    ChapterIllustrationStoryboardSchema,
    createChapterIllustrationPlanHash,
    type ChapterIllustrationPlanningSource,
    type ChapterIllustrationShot,
    type ChapterIllustrationStoryboard,
} from "nbook/shared/text-to-image-chapter-storyboard";
import {
    type IllustrationPlanningApplyJournal,
    PlanningApplyContractError,
    type IllustrationPlanningApplyPayload,
    type IllustrationPlanningApplyState,
} from "nbook/shared/text-to-image-planning-apply";
import {renderTextToImagePromptMarkdown, findTextToImagePromptMarkdown} from "nbook/shared/text-to-image-markdown";
import {createSemanticTagResolutionHash} from "nbook/shared/text-to-image-tag-resolution";
import type {IllustrationPlanningInputBundle} from "nbook/shared/text-to-image-illustration-workflow";
import type {ValidatedIllustrationPlan} from "nbook/shared/text-to-image-illustration-planning";
import {
    createTextToImageMarkdownFileHash,
} from "nbook/server/text-to-image/strict-frontmatter";
import {
    parseChapterStoryboardMarkdown,
    renderChapterStoryboardMarkdown,
} from "nbook/server/text-to-image/chapter-storyboard.codec";
import {IllustrationChapterParser} from "nbook/server/text-to-image/illustration-chapter-parser";
import {
    IllustrationWorkflowRepository,
    type IllustrationWorkflowRecord,
} from "nbook/server/text-to-image/illustration-workflow.repository";
import {PlanningApplyRepository} from "nbook/server/text-to-image/planning-apply.repository";
import {DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH} from "nbook/server/text-to-image/recipe.codec";
import {
    deleteResolvedProjectFileTracked,
    USER_LOCAL_ACTOR,
    writeResolvedProjectTextFileTracked,
} from "nbook/server/workspace-history/tracked-workspace-files";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";

type PlanningApplyIdKind = "journal" | "revision" | "shot" | "placeholder";
type ActivePlanningApplyState = Exclude<IllustrationPlanningApplyState, "completed" | "rolled_back" | "apply_conflict">;

type PlanningApplyServiceOptions = {
    client: PrismaClient;
    parser?: IllustrationChapterParser;
    clock?: () => Date;
    idFactory?: (kind: PlanningApplyIdKind, index: number) => string;
    /** 测试/故障注入边界：每次 durable stage 提交后调用。 */
    afterStage?: (state: IllustrationPlanningApplyState) => void | Promise<void>;
};

export class PlanningApplyServiceError extends Error {
    constructor(
        readonly code: "ILLUSTRATION_WORKFLOW_STALE" | "PLANNING_APPLY_CONFLICT" | "PLANNING_APPLY_INVALID",
        message: string,
    ) {
        super(`${code}: ${message}`);
        this.name = "PlanningApplyServiceError";
    }
}

/**
 * 把 validated Shot Intent 以 Journal 驱动的确定性阶段发布到 Storyboard 与章节正文。
 *
 * Agent 工作结束后才进入本服务；整个 apply 只在短时章节文件锁内读写，不调用图片 Provider。
 */
export class PlanningApplyService {
    private readonly parser: IllustrationChapterParser;
    private readonly clock: () => Date;
    private readonly idFactory: (kind: PlanningApplyIdKind, index: number) => string;
    private readonly workflowRepository: IllustrationWorkflowRepository;
    private readonly journalRepository: PlanningApplyRepository;

    constructor(private readonly options: PlanningApplyServiceOptions) {
        this.parser = options.parser ?? new IllustrationChapterParser();
        this.clock = options.clock ?? (() => new Date());
        this.idFactory = options.idFactory ?? ((kind, index) => `${kind}-${String(index + 1)}-${crypto.randomUUID()}`);
        this.workflowRepository = new IllustrationWorkflowRepository(options.client);
        this.journalRepository = new PlanningApplyRepository(options.client);
    }

    /** 发布或恢复单个 applying Workflow。 */
    async applyValidatedPlan(input: {projectPath: string; workflowId: string}): Promise<IllustrationPlanningApplyJournal> {
        assertProjectOpen(input.projectPath);
        const detail = await this.workflowRepository.read(input.workflowId);
        const storyboardPath = storyboardPathFor(detail.workflow.chapterPath);
        const projectRoot = resolveProjectAbsolutePath(input.projectPath) as any;
        const chapterFile = path.join(projectRoot, ...detail.workflow.chapterPath.split("/"));
        const release = await lock(chapterFile, {retries: {retries: 8, minTimeout: 20, maxTimeout: 250}});
        try {
            let journal = await this.readJournalOrPrepare({
                projectPath: input.projectPath,
                projectRoot,
                storyboardPath,
                workflow: detail.workflow,
                attempts: detail.attempts,
            });
            if (journal.state === "prepared" && journal.createdAt === journal.updatedAt) {
                await this.afterStage("prepared");
            }
            journal = await this.continueApply({
                projectPath: input.projectPath,
                projectRoot,
                storyboardPath,
                journal,
            });
            return journal;
        } finally {
            await release();
        }
    }

    /** 恢复 Project 内所有 durable apply；也覆盖 validated plan 已封存但 journal 尚未 prepare 的窗口。 */
    async recoverProject(input: {projectPath: string; projectId: string}): Promise<void> {
        const recoverable = await this.journalRepository.readRecoverable({projectId: input.projectId});
        const applying = await this.workflowRepository.listApplying({projectId: input.projectId});
        const workflowIds = new Set([
            ...recoverable.map((journal) => journal.workflowId),
            ...applying.map((workflow) => workflow.id),
        ]);
        for (const workflowId of workflowIds) {
            await this.applyValidatedPlan({projectPath: input.projectPath, workflowId});
        }
    }

    /** 读取已有 journal；不存在时从 sealed Workflow 与当前文件 truth source 构造一次性 payload。 */
    private async readJournalOrPrepare(input: {
        projectPath: string;
        projectRoot: string;
        storyboardPath: string;
        workflow: IllustrationWorkflowRecord;
        attempts: Awaited<ReturnType<IllustrationWorkflowRepository["read"]>>["attempts"];
    }): Promise<IllustrationPlanningApplyJournal> {
        try {
            return await this.journalRepository.read(input.workflow.id);
        } catch (error) {
            if (!(error instanceof PlanningApplyContractError) || error.code !== "PLANNING_APPLY_NOT_FOUND") throw error;
        }
        if (input.workflow.status !== "applying" || !input.workflow.validatedPlan) {
            throw new PlanningApplyServiceError("PLANNING_APPLY_INVALID", "Workflow 未处于 applying 或缺少 validated plan");
        }
        const planningEvidenceHash = [...input.attempts].reverse().find((attempt) => attempt.planningEvidenceHash)?.planningEvidenceHash;
        if (!planningEvidenceHash) {
            throw new PlanningApplyServiceError("PLANNING_APPLY_INVALID", "succeeded Attempt 缺少 planningEvidenceHash");
        }
        const chapterBefore = await fs.readFile(path.join(input.projectRoot, ...input.workflow.chapterPath.split("/")), "utf8");
        const chapterSnapshot = this.parser.parse({chapterPath: input.workflow.chapterPath, markdown: chapterBefore});
        if (
            chapterSnapshot.chapterFileHash !== input.workflow.input.chapter.chapterFileHash
            || chapterSnapshot.sourceChapterHash !== input.workflow.input.chapter.sourceChapterHash
        ) {
            const reason = "章节 bytes 或清理后正文已偏离 Planning Input";
            await this.workflowRepository.markApplyStale({workflowId: input.workflow.id, reason, errorCode: "ILLUSTRATION_WORKFLOW_STALE"});
            throw new PlanningApplyServiceError("ILLUSTRATION_WORKFLOW_STALE", reason);
        }
        const storyboardBefore = await readOptionalText(path.join(input.projectRoot, ...input.storyboardPath.split("/")));
        const currentStoryboard = storyboardBefore === null
            ? createEmptyStoryboard(input.workflow.chapterPath, input.workflow.input.chapter.sourceChapterHash, this.idFactory("revision", 0))
            : parseChapterStoryboardMarkdown(storyboardBefore).storyboard;
        if (currentStoryboard.chapterPath !== input.workflow.chapterPath) {
            throw new PlanningApplyServiceError("PLANNING_APPLY_INVALID", "illustrations.md chapterPath 与目标章节不一致");
        }
        const payload = this.createPayload({
            workflow: input.workflow,
            plan: input.workflow.validatedPlan,
            planningEvidenceHash,
            chapterBefore,
            chapterSnapshot,
            storyboardBefore,
            currentStoryboard,
        });
        return this.journalRepository.prepare(payload);
    }

    /** 构造 staged/applied 两份 Storyboard 与章节 after bytes，并一次性封入 journal payload。 */
    private createPayload(input: {
        workflow: IllustrationWorkflowRecord;
        plan: ValidatedIllustrationPlan;
        planningEvidenceHash: string;
        chapterBefore: string;
        chapterSnapshot: ReturnType<IllustrationChapterParser["parse"]>;
        storyboardBefore: string | null;
        currentStoryboard: ChapterIllustrationStoryboard;
    }): IllustrationPlanningApplyPayload {
        const journalId = this.idFactory("journal", 0);
        const revisionId = this.idFactory("revision", 0);
        const appliedAt = this.clock().toISOString();
        const planningSource = createPlanningSource({
            bundle: input.workflow.input,
            planningRunId: input.workflow.id,
            planningEvidenceHash: input.planningEvidenceHash,
            journalId,
        });
        const newShots = input.plan.shots.map((shot, index): ChapterIllustrationShot => {
            const persistentResolutions: ChapterIllustrationShot["tagResolutions"] = {};
            const resolutionKeys = new Map<string, string>();
            const refs = [...shot.tagDelta.prefer, ...shot.tagDelta.avoid];
            refs.forEach((ref, resolutionIndex) => {
                const resolution = shot.tagResolutions[ref.resolutionId];
                if (!resolution) throw new PlanningApplyServiceError("PLANNING_APPLY_INVALID", `缺少 terminal resolution：${ref.resolutionId}`);
                const resolutionKey = `tr_${createSemanticTagResolutionHash(resolution).slice("sha256:".length, "sha256:".length + 16)}_${String(resolutionIndex + 1)}`;
                persistentResolutions[resolutionKey] = resolution;
                resolutionKeys.set(ref.resolutionId, resolutionKey);
            });
            return {
                shotId: this.idFactory("shot", index),
                state: "active",
                shotIntentHash: shot.shotIntentHash,
                placeholderId: this.idFactory("placeholder", index),
                publication: {journalId, status: "pending", appliedAt: null},
                origin: {
                    kind: input.workflow.operation === "plan-chapter" ? "chapter-plan" : "selection",
                    planningRunId: input.workflow.id,
                },
                anchorId: shot.anchorId,
                insertAfterAnchorId: shot.insertAfterAnchorId,
                purpose: shot.purpose,
                characterIds: [...shot.characterIds],
                outfitRefs: [...shot.outfitRefs],
                action: {...shot.action},
                composition: {...shot.composition},
                continuity: {...shot.continuity},
                tagPatternRefs: [...shot.tagPatternRefs],
                tagResolutions: persistentResolutions,
                tagDelta: {
                    prefer: shot.tagDelta.prefer.map((ref) => requireResolutionKey(resolutionKeys, ref.resolutionId)),
                    avoid: shot.tagDelta.avoid.map((ref) => requireResolutionKey(resolutionKeys, ref.resolutionId)),
                },
            };
        });
        const stagedStoryboard = finalizeStoryboard({
            ...input.currentStoryboard,
            revisionId,
            sourceChapterHash: input.workflow.input.chapter.sourceChapterHash,
            planningSources: [...input.currentStoryboard.planningSources, planningSource],
            shots: [...input.currentStoryboard.shots, ...newShots],
        });
        const appliedStoryboard = finalizeStoryboard({
            ...stagedStoryboard,
            planningSources: stagedStoryboard.planningSources.map((source) => {
                if (source.planningRunId === input.workflow.id) {
                    return {...source, publication: {journalId, status: "applied" as const, appliedAt}};
                }
                if (input.workflow.operation === "plan-chapter" && source.operation === "plan-chapter" && source.state === "active") {
                    return {...source, state: "superseded" as const};
                }
                return source;
            }),
            shots: stagedStoryboard.shots.map((shot) => {
                if (shot.origin.planningRunId === input.workflow.id) {
                    return {...shot, publication: {journalId, status: "applied" as const, appliedAt}};
                }
                if (input.workflow.operation === "plan-chapter" && shot.origin.kind === "chapter-plan" && shot.state === "active") {
                    return {...shot, state: "superseded" as const};
                }
                return shot;
            }),
        });
        const stagedMarkdown = renderChapterStoryboardMarkdown(stagedStoryboard);
        const appliedMarkdown = renderChapterStoryboardMarkdown(appliedStoryboard);
        const supersededPlaceholderIds = input.workflow.operation === "plan-chapter"
            ? input.currentStoryboard.shots
                .filter((shot) => shot.origin.kind === "chapter-plan" && shot.state === "active")
                .map((shot) => shot.placeholderId)
                .filter((placeholderId) => findTextToImagePromptMarkdown(input.chapterBefore, placeholderId) !== null)
            : [];
        const chapterAfter = insertPlaceholders({
            parser: this.parser,
            chapterPath: input.workflow.chapterPath,
            markdown: removePlaceholders(input.chapterBefore, supersededPlaceholderIds),
            shots: newShots,
            sourceChapterHash: input.workflow.input.chapter.sourceChapterHash,
        });
        return {
            schemaVersion: "nbook.illustration-planning-apply/v1",
            journalId,
            workflowId: input.workflow.id,
            projectId: input.workflow.projectId,
            chapterPath: input.workflow.chapterPath,
            sourceChapterHash: input.workflow.input.chapter.sourceChapterHash,
            planHash: appliedStoryboard.planHash,
            expectedChapterHash: input.chapterSnapshot.chapterFileHash,
            expectedStoryboardHash: input.storyboardBefore === null ? null : createTextToImageMarkdownFileHash(input.storyboardBefore),
            storyboardBefore: input.storyboardBefore,
            stagedStoryboard: stagedMarkdown,
            stagedStoryboardHash: createTextToImageMarkdownFileHash(stagedMarkdown),
            appliedStoryboard: appliedMarkdown,
            appliedStoryboardHash: createTextToImageMarkdownFileHash(appliedMarkdown),
            chapterBefore: input.chapterBefore,
            chapterAfter,
            chapterAfterHash: createTextToImageMarkdownFileHash(chapterAfter),
            newPlaceholderIds: newShots.map((shot) => shot.placeholderId),
            supersededPlaceholderIds,
            planningRequestHash: input.workflow.planningRequestHash,
            planningInputHash: input.workflow.planningInputHash,
            planningEvidenceHash: input.planningEvidenceHash,
        };
    }

    /** 逐阶段比较精确 bytes、写入、CAS；迟到重放只补缺失阶段。 */
    private async continueApply(input: {
        projectPath: string;
        projectRoot: string;
        storyboardPath: string;
        journal: IllustrationPlanningApplyJournal;
    }): Promise<IllustrationPlanningApplyJournal> {
        let journal = input.journal;
        const payload = journal.payload;
        const storyboardFile = path.join(input.projectRoot, ...input.storyboardPath.split("/"));
        const chapterFile = path.join(input.projectRoot, ...payload.chapterPath.split("/"));

        if (journal.state === "prepared") {
            const current = await readOptionalText(storyboardFile);
            if (current !== payload.stagedStoryboard) {
                if (!matchesOptionalHash(current, payload.expectedStoryboardHash)) {
                    return this.markConflict(journal, "Storyboard 在 staged write 前已漂移");
                }
                await writeResolvedProjectTextFileTracked({
                    projectPath: input.projectPath,
                    projectRoot: input.projectRoot,
                    filePath: input.storyboardPath,
                    content: payload.stagedStoryboard,
                    actor: USER_LOCAL_ACTOR,
                    knownBefore: current,
                });
                invalidateProjectWorkspaceIndexAfterMutation({target: {kind: "project-workspace", root: input.projectPath, projectPath: ""}} as any);
            }
            journal = await this.journalRepository.advance({workflowId: payload.workflowId, from: "prepared", to: "storyboard_written"});
            await this.afterStage("storyboard_written");
        }

        if (journal.state === "storyboard_written") {
            const currentChapter = await fs.readFile(chapterFile, "utf8");
            const currentChapterHash = createTextToImageMarkdownFileHash(currentChapter);
            if (currentChapterHash !== payload.chapterAfterHash) {
                if (currentChapterHash !== payload.expectedChapterHash) {
                    const containsPublishedPlaceholder = payload.newPlaceholderIds.some((id) => findTextToImagePromptMarkdown(currentChapter, id) !== null);
                    if (containsPublishedPlaceholder) return this.markConflict(journal, "章节在 placeholder write 崩溃窗口发生外部编辑");
                    return this.rollbackStaged({
                        projectPath: input.projectPath,
                        projectRoot: input.projectRoot,
                        storyboardPath: input.storyboardPath,
                        journal,
                        reason: "章节在 placeholder write 前已漂移",
                    });
                }
                await writeResolvedProjectTextFileTracked({
                    projectPath: input.projectPath,
                    projectRoot: input.projectRoot,
                    filePath: payload.chapterPath,
                    content: payload.chapterAfter,
                    actor: USER_LOCAL_ACTOR,
                    knownBefore: currentChapter,
                });
                invalidateProjectWorkspaceIndexAfterMutation({target: {kind: "project-workspace", root: input.projectPath, projectPath: ""}} as any);
            }
            journal = await this.journalRepository.advance({workflowId: payload.workflowId, from: "storyboard_written", to: "chapter_written"});
            await this.afterStage("chapter_written");
        }

        if (journal.state === "chapter_written") {
            const current = await readOptionalText(storyboardFile);
            if (current !== payload.appliedStoryboard) {
                if (current !== payload.stagedStoryboard) return this.markConflict(journal, "Storyboard 在 applied write 前已漂移");
                await writeResolvedProjectTextFileTracked({
                    projectPath: input.projectPath,
                    projectRoot: input.projectRoot,
                    filePath: input.storyboardPath,
                    content: payload.appliedStoryboard,
                    actor: USER_LOCAL_ACTOR,
                    knownBefore: current,
                });
                invalidateProjectWorkspaceIndexAfterMutation({target: {kind: "project-workspace", root: input.projectPath, projectPath: ""}} as any);
            }
            journal = await this.journalRepository.advance({workflowId: payload.workflowId, from: "chapter_written", to: "storyboard_applied"});
            await this.afterStage("storyboard_applied");
        }

        if (journal.state === "storyboard_applied") {
            journal = await this.journalRepository.advance({workflowId: payload.workflowId, from: "storyboard_applied", to: "completed"});
            await this.afterStage("completed");
        }
        if (journal.state === "completed") await this.workflowRepository.completeApply(payload.workflowId);
        return journal;
    }

    /** chapter 尚未写入时，只有 staged bytes 仍精确匹配才允许补偿回滚。 */
    private async rollbackStaged(input: {
        projectPath: string;
        projectRoot: string;
        storyboardPath: string;
        journal: IllustrationPlanningApplyJournal;
        reason: string;
    }): Promise<IllustrationPlanningApplyJournal> {
        const storyboardFile = path.join(input.projectRoot, ...input.storyboardPath.split("/"));
        const current = await readOptionalText(storyboardFile);
        if (current !== input.journal.payload.stagedStoryboard) return this.markConflict(input.journal, `${input.reason}，且 staged Storyboard 已漂移`);
        if (input.journal.payload.storyboardBefore === null) {
            await deleteResolvedProjectFileTracked({
                projectPath: input.projectPath,
                projectRoot: input.projectRoot,
                filePath: input.storyboardPath,
                actor: USER_LOCAL_ACTOR,
            });
        } else {
            await writeResolvedProjectTextFileTracked({
                projectPath: input.projectPath,
                projectRoot: input.projectRoot,
                filePath: input.storyboardPath,
                content: input.journal.payload.storyboardBefore,
                actor: USER_LOCAL_ACTOR,
                knownBefore: current,
            });
        }
        invalidateProjectWorkspaceIndexAfterMutation({target: {kind: "project-workspace", root: input.projectPath, projectPath: ""}} as any);
        const journal = await this.journalRepository.advance({
            workflowId: input.journal.workflowId,
            from: "storyboard_written",
            to: "rolled_back",
            errorCode: "ILLUSTRATION_WORKFLOW_STALE",
            errorMessage: input.reason,
        });
        await this.workflowRepository.markApplyStale({
            workflowId: input.journal.workflowId,
            reason: input.reason,
            errorCode: "ILLUSTRATION_WORKFLOW_STALE",
        });
        await this.afterStage("rolled_back");
        return journal;
    }

    /** 不可安全补偿时，原子关闭 journal/workflow，保留现场供显式处理。 */
    private async markConflict(journal: IllustrationPlanningApplyJournal, reason: string): Promise<IllustrationPlanningApplyJournal> {
        const conflicted = await this.journalRepository.markWorkflowStale({
            workflowId: journal.workflowId,
            expectedState: requireActiveApplyState(journal.state),
            errorCode: "PLANNING_APPLY_CONFLICT",
            errorMessage: reason,
        });
        await this.afterStage("apply_conflict");
        return conflicted;
    }

    /** durable stage hook。 */
    private async afterStage(state: IllustrationPlanningApplyState): Promise<void> {
        await this.options.afterStage?.(state);
    }
}

/** 闭集校验后读取持久 resolution key；缺失表示发布内部契约已损坏。 */
function requireResolutionKey(keys: ReadonlyMap<string, string>, resolutionId: string): string {
    const key = keys.get(resolutionId);
    if (!key) throw new PlanningApplyServiceError("PLANNING_APPLY_INVALID", `缺少持久 terminal resolution key：${resolutionId}`);
    return key;
}

/** Journal 只有非终态才能进入 apply_conflict。 */
function requireActiveApplyState(state: IllustrationPlanningApplyState): ActivePlanningApplyState {
    if (state === "prepared" || state === "storyboard_written" || state === "chapter_written" || state === "storyboard_applied") return state;
    throw new PlanningApplyServiceError("PLANNING_APPLY_INVALID", `终态 Journal 不能标记冲突：${state}`);
}

/** 从冻结 bundle 构造 Storyboard planning source。 */
function createPlanningSource(input: {
    bundle: IllustrationPlanningInputBundle;
    planningRunId: string;
    planningEvidenceHash: string;
    journalId: string;
}): ChapterIllustrationPlanningSource {
    const bundle = input.bundle;
    return {
        planningRunId: input.planningRunId,
        operation: bundle.requestIdentity.operation,
        state: "active",
        publication: {journalId: input.journalId, status: "pending", appliedAt: null},
        chapterFileHashAtPlan: bundle.chapter.chapterFileHash,
        planningRequestHash: bundle.planningRequestHash,
        planningInputHash: bundle.planningInputHash,
        planningEvidenceHash: input.planningEvidenceHash,
        sourceChapterHashAtPlan: bundle.chapter.sourceChapterHash,
        selection: bundle.chapter.selection ? {
            selectionHash: bundle.chapter.selection.selectionHash,
            startAnchorId: bundle.chapter.selection.startAnchorId,
            endAnchorId: bundle.chapter.selection.endAnchorId,
            insertAfterAnchorId: bundle.chapter.selection.insertAfterAnchorId,
        } : null,
        effectivePreset: {presetId: bundle.effectivePreset.presetId, semanticHash: bundle.effectivePreset.semanticHash},
        effectivePatternSet: {
            patternSetId: bundle.effectivePreset.presetId,
            planningHash: bundle.patternCandidates.effectivePlanningHash,
            candidateSetHash: bundle.patternCandidates.candidateSetHash,
        },
        recipePlanningConstraints: {
            key: DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH,
            constraintsHash: bundle.recipePlanningConstraints.constraintsHash,
            capabilitySummaryHash: hashTextToImageContract(bundle.recipePlanningConstraints),
        },
        tagQuerySnapshot: {
            ...bundle.tagQuerySnapshot,
            providerKind: "novelai",
            modelScope: bundle.toolContext.modelScope,
            resultHash: hashTextToImageContract({
                tagQuerySnapshot: bundle.tagQuerySnapshot,
                modelScope: bundle.toolContext.modelScope,
                projectScopeHash: bundle.tagPolicySnapshot.projectScopeHash,
            }),
        },
        director: {
            profileVersion: bundle.requestIdentity.directorProfileVersion,
            operationVersion: bundle.requestIdentity.directorOperationVersion,
            modelConfigFingerprint: bundle.requestIdentity.modelConfigFingerprint,
        },
        contentBlockParserVersion: bundle.requestIdentity.contentBlockParserVersion,
        planValidatorVersion: bundle.requestIdentity.planValidatorVersion,
        systemPolicyVersion: bundle.requestIdentity.systemPolicyVersion,
        visualPlanningFactsHash: bundle.requestIdentity.visualPlanningFactsHash,
        contextSnapshotHash: hashTextToImageContract({
            chapter: bundle.chapter,
            characters: bundle.characters,
            continuityBaseline: bundle.continuityBaseline,
        }),
        planPolicyHash: bundle.requestIdentity.planPolicyHash,
    };
}

/** 创建空 aggregate，并立即补齐自洽 planHash。 */
function createEmptyStoryboard(chapterPath: string, sourceChapterHash: string, revisionId: string): ChapterIllustrationStoryboard {
    return finalizeStoryboard({
        schema: "nbook.chapter-illustrations/v2",
        chapterPath,
        revisionId,
        sourceChapterHash,
        planHash: `sha256:${"0".repeat(64)}`,
        planningSources: [],
        shots: [],
    });
}

/** 对 Storyboard 草稿重算 planHash 并通过完整 ownership schema。 */
function finalizeStoryboard(storyboard: ChapterIllustrationStoryboard): ChapterIllustrationStoryboard {
    return ChapterIllustrationStoryboardSchema.parse({
        ...storyboard,
        planHash: createChapterIllustrationPlanHash(storyboard),
    });
}

/** 删除显式 superseded 的未生成 V2 placeholders；已替换图片不匹配、因此自然保留。 */
function removePlaceholders(markdown: string, placeholderIds: string[]): string {
    let result = markdown;
    for (const placeholderId of placeholderIds) {
        const placeholder = findTextToImagePromptMarkdown(result, placeholderId);
        if (placeholder) result = result.replace(placeholder.raw, "");
    }
    return result;
}

/** 按服务端稳定 anchor 精确插入本批 V2 placeholders。 */
function insertPlaceholders(input: {
    parser: IllustrationChapterParser;
    chapterPath: string;
    markdown: string;
    shots: ChapterIllustrationShot[];
    sourceChapterHash: string;
}): string {
    const snapshot = input.parser.parse({chapterPath: input.chapterPath, markdown: input.markdown});
    if (snapshot.sourceChapterHash !== input.sourceChapterHash) {
        throw new PlanningApplyServiceError("ILLUSTRATION_WORKFLOW_STALE", "移除 superseded placeholders 后正文语义发生变化");
    }
    const blocks = new Map(snapshot.blocks.flatMap((block) => block.anchorId ? [[block.anchorId, block] as const] : []));
    const insertions = input.shots.map((shot, index) => {
        const block = blocks.get(shot.insertAfterAnchorId);
        if (!block) throw new PlanningApplyServiceError("ILLUSTRATION_WORKFLOW_STALE", `可信锚点已漂移：${shot.insertAfterAnchorId}`);
        return {
            offset: block.endOffset,
            index,
            markdown: renderTextToImagePromptMarkdown({
                id: shot.placeholderId,
                schema: "nbook.text-to-image-prompt/v2",
                shotId: shot.shotId,
                shotIntentHash: shot.shotIntentHash,
                sourceChapterHash: input.sourceChapterHash,
                anchorId: shot.anchorId,
                origin: shot.origin.kind,
            }),
        };
    });
    let result = input.markdown;
    for (const insertion of insertions.sort((left, right) => right.offset - left.offset || right.index - left.index)) {
        result = `${result.slice(0, insertion.offset)}\n\n${insertion.markdown}${result.slice(insertion.offset)}`;
    }
    return result;
}

/** 读取可选文本文件；只有 ENOENT 映射为空。 */
async function readOptionalText(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, "utf8");
    } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return null;
        throw error;
    }
}

/** 比较可选文件的精确 Markdown bytes hash。 */
function matchesOptionalHash(content: string | null, expectedHash: string | null): boolean {
    if (content === null || expectedHash === null) return content === null && expectedHash === null;
    return createTextToImageMarkdownFileHash(content) === expectedHash;
}

/** Node 文件系统错误收窄。 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

/** Chapter index.md 到同目录 illustrations.md 的唯一映射。 */
function storyboardPathFor(chapterPath: string): string {
    if (!/^manuscript\/.+\/index\.md$/u.test(chapterPath)) {
        throw new PlanningApplyServiceError("PLANNING_APPLY_INVALID", "章节路径必须以 /index.md 结尾");
    }
    return chapterPath.replace(/\/index\.md$/u, "/illustrations.md");
}
