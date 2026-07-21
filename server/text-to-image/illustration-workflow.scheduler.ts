import {
    ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED,
    ILLUSTRATION_DIRECTOR_PROFILE_KEY,
} from "nbook/shared/agent/illustration-director";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    IllustrationPlanningProposalSchema,
    type IllustrationPlanningProposal,
} from "nbook/shared/text-to-image-illustration-planning";
import {createSemanticTagResolutionHash, type SemanticTagResolution} from "nbook/shared/text-to-image-tag-resolution";
import type {IllustrationPlanningInputBundle} from "nbook/shared/text-to-image-illustration-workflow";
import {loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {useAgentHarness} from "nbook/server/agent/http";
import {
    readIllustrationPlanningToolEvidence,
    releaseIllustrationPlanningToolEvidence,
} from "nbook/server/agent/tools/illustration-planning-tools";
import {
    IllustrationPlanValidationError,
    validateIllustrationPlan,
} from "nbook/server/text-to-image/illustration-plan-validator";
import {
    IllustrationWorkflowRepository,
    type IllustrationAttemptRecord,
    type IllustrationWorkflowRecord,
} from "nbook/server/text-to-image/illustration-workflow.repository";
import {PlanningApplyService} from "nbook/server/text-to-image/planning-apply.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";

export type IllustrationPlanningToolEvidence = {
    calls: Array<{toolKey: string; argsJson: string; argsHash: string; resultJson: string; resultHash: string}>;
    terminalResolutions: Array<{resolutionId: string; resolution: SemanticTagResolution}>;
};

export type IllustrationPlanningAgentRuntime = {
    isDirectorConfigured(projectPath: string): Promise<boolean>;
    createAgent(input: {
        projectPath: string;
        operation: "plan-chapter" | "plan-selection" | "review-candidates";
        bundle: IllustrationPlanningInputBundle;
    }): Promise<{sessionId: number}>;
    invoke(input: {
        sessionId: number;
        operation: "plan-chapter" | "plan-selection" | "review-candidates";
        chapterPath: string;
    }): Promise<{
        sessionId: number;
        invocationId: string;
        status: string;
        /** Agent report_result 是外部边界，scheduler 必须立即 strict parse。 */
        data?: unknown;
        error?: string;
    }>;
    readEvidence(invocationId: string): Promise<IllustrationPlanningToolEvidence>;
    releaseEvidence(invocationId: string): void;
    /** 取消指定 session 的当前 invocation；持久 Workflow 状态仍由 repository 决定。 */
    abort(input: {sessionId: number; reason: string}): Promise<void>;
};

/** 经过 strict validation 的计划只能由持久化 Planning Apply 服务发布。 */
export type IllustrationPlanningPublisher = {
    applyValidatedPlan(input: {projectPath: string; workflowId: string}): Promise<void>;
};

type SchedulerOptions = {
    repository: IllustrationWorkflowRepository;
    runtime?: IllustrationPlanningAgentRuntime;
    publisher?: IllustrationPlanningPublisher;
};

type ActivePlanningRun = {
    promise: Promise<void>;
    sessionId: number | null;
    cancelRequested: boolean;
    cancelReason: string;
    abortSent: boolean;
};

/** 持久 Workflow scheduler；每条 attempt 分配独立 Agent session，运行期间不持有章节文件锁。 */
export class IllustrationWorkflowScheduler {
    private readonly runtime: IllustrationPlanningAgentRuntime;
    private readonly publisher: IllustrationPlanningPublisher;
    private readonly active = new Map<string, ActivePlanningRun>();

    constructor(private readonly options: SchedulerOptions) {
        this.runtime = options.runtime ?? createProductionRuntime();
        this.publisher = options.publisher ?? createProductionPublisher();
    }

    /** 领取直到达到 Project 并发上限；返回本轮新启动数量，不等待模型完成。 */
    async tick(input: {projectPath: string; projectId: string; concurrency: number}): Promise<number> {
        let started = 0;
        while (true) {
            const claimed = await this.options.repository.claimNext({projectId: input.projectId, concurrency: input.concurrency});
            if (!claimed) return started;
            const active: ActivePlanningRun = {
                promise: Promise.resolve(),
                sessionId: null,
                cancelRequested: false,
                cancelReason: "Workflow 已取消",
                abortSent: false,
            };
            active.promise = this.executeClaimed(input.projectPath, claimed.workflow, claimed.attempt, active)
                .finally(() => this.active.delete(claimed.workflow.id));
            this.active.set(claimed.workflow.id, active);
            started += 1;
        }
    }

    /**
     * 向单条 active run 发送独立取消信号；repository 应先完成 canceled CAS。
     * abort 失败不会撤销持久 canceled，迟到结果仍会被状态栅栏丢弃。
     */
    async cancel(input: {workflowId: string; sessionId: number | null; reason: string}): Promise<void> {
        const active = this.active.get(input.workflowId);
        if (active) {
            active.cancelRequested = true;
            active.cancelReason = input.reason;
        }
        const sessionId = active?.sessionId ?? input.sessionId;
        if (sessionId === null || active?.abortSent) return;
        if (active) active.abortSent = true;
        try {
            await this.runtime.abort({sessionId, reason: input.reason});
        } catch {
            // canceled 的持久 CAS 是真相源；abort 仅用于尽快回收仍在运行的 Agent invocation。
        }
    }

    /** 测试、关闭与显式维护入口等待当前 scheduler 启动的 attempts 结束。 */
    async drain(): Promise<void> {
        while (this.active.size > 0) await Promise.all([...this.active.values()].map((active) => active.promise));
    }

    private async executeClaimed(
        projectPath: string,
        workflow: IllustrationWorkflowRecord,
        attempt: IllustrationAttemptRecord,
        active: ActivePlanningRun,
    ): Promise<void> {
        let invocationId: string | null = null;
        let attemptSucceeded = false;
        let validationSealed = false;
        try {
            if (!await this.runtime.isDirectorConfigured(projectPath)) {
                throw new SchedulerRunError(
                    ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED,
                    "请先在设置 → 模型配置中配置 illustration.director",
                    false,
                );
            }
            const created = await this.runtime.createAgent({
                projectPath,
                operation: workflow.operation,
                bundle: workflow.input,
            });
            active.sessionId = created.sessionId;
            if (active.cancelRequested || await this.options.repository.isCanceled(workflow.id)) {
                await this.cancel({workflowId: workflow.id, sessionId: created.sessionId, reason: active.cancelReason});
                return;
            }
            await this.options.repository.bindAttempt({workflowId: workflow.id, attemptId: attempt.id, sessionId: created.sessionId});
            if (active.cancelRequested || await this.options.repository.isCanceled(workflow.id)) {
                await this.cancel({workflowId: workflow.id, sessionId: created.sessionId, reason: active.cancelReason});
                return;
            }
            const result = await this.runtime.invoke({
                sessionId: created.sessionId,
                operation: workflow.operation,
                chapterPath: workflow.chapterPath,
            });
            invocationId = result.invocationId;
            if (result.status !== "completed") {
                throw new SchedulerRunError(
                    "ILLUSTRATION_DIRECTOR_FAILED",
                    result.error ?? `illustration.director 未完成：${result.status}`,
                    result.status !== "canceled",
                );
            }
            const parsed = IllustrationPlanningProposalSchema.safeParse(result.data);
            if (!parsed.success) {
                throw new SchedulerRunError(
                    "ILLUSTRATION_PLAN_INVALID",
                    `Director 输出不符合 Shot Intent schema：${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
                    false,
                );
            }
            const evidence = await this.runtime.readEvidence(result.invocationId);
            const plan = validateProposal(workflow.input, parsed.data, evidence);
            const evidenceValue = {
                schemaVersion: "nbook.illustration-planning-evidence/v1",
                planningInputHash: workflow.planningInputHash,
                invocation: {
                    sessionId: result.sessionId,
                    invocationId: result.invocationId,
                    profileKey: ILLUSTRATION_DIRECTOR_PROFILE_KEY,
                    profileVersion: workflow.input.requestIdentity.directorProfileVersion,
                    operationVersion: workflow.input.requestIdentity.directorOperationVersion,
                },
                calls: evidence.calls,
                terminalResolutions: evidence.terminalResolutions.map((item) => ({
                    resolutionId: item.resolutionId,
                    resolutionHash: createSemanticTagResolutionHash(item.resolution),
                })),
                proposalJson: JSON.stringify(parsed.data),
            };
            const planningEvidenceHash = hashTextToImageContract({json: JSON.stringify(evidenceValue)});
            await this.options.repository.succeedAttempt({
                workflowId: workflow.id,
                attemptId: attempt.id,
                invocationId: result.invocationId,
                proposal: parsed.data,
                planningEvidenceHash,
                evidenceJson: JSON.stringify({...evidenceValue, planningEvidenceHash}),
            });
            attemptSucceeded = true;
            await this.options.repository.completeValidation({workflowId: workflow.id, attemptId: attempt.id, plan});
            validationSealed = true;
            /** P6：review-candidates 是只读审查，跳过 Planning Apply 直接 ready。 */
            if (workflow.input.requestIdentity.operation === "review-candidates") {
                await this.options.repository.skipApplyToReady(workflow.id);
            } else {
                await this.publisher.applyValidatedPlan({projectPath, workflowId: workflow.id});
            }
        } catch (error) {
            if (await this.options.repository.isCanceled(workflow.id)) {
                if (active.sessionId !== null) {
                    await this.cancel({workflowId: workflow.id, sessionId: active.sessionId, reason: active.cancelReason});
                }
                return;
            }
            // validated plan 已进入 applying 后，发布中断必须保留 durable 状态供 journal 恢复，不能伪装为 validation failure。
            if (validationSealed) return;
            const failure = normalizeFailure(error);
            if (attemptSucceeded) {
                await this.options.repository.failValidation({
                    workflowId: workflow.id,
                    attemptId: attempt.id,
                    retryable: failure.retryable,
                    errorCode: failure.code,
                    errorMessage: failure.message,
                });
            } else {
                await this.options.repository.failAttempt({
                    workflowId: workflow.id,
                    attemptId: attempt.id,
                    retryable: failure.retryable,
                    errorCode: failure.code,
                    errorMessage: failure.message,
                    ...(invocationId ? {invocationId} : {}),
                });
            }
        } finally {
            if (invocationId) this.runtime.releaseEvidence(invocationId);
        }
    }
}

/** 生产发布器按 Project 获取独立 Prisma client，并把文件事务交给 PlanningApplyService。 */
function createProductionPublisher(): IllustrationPlanningPublisher {
    return {
        async applyValidatedPlan(input) {
            const client = await textToImageProjectClient(input.projectPath);
            await new PlanningApplyService({client}).applyValidatedPlan(input);
        },
    };
}

function validateProposal(
    bundle: IllustrationPlanningInputBundle,
    proposal: IllustrationPlanningProposal,
    evidence: IllustrationPlanningToolEvidence,
) {
    const selection = bundle.chapter.selection;
    return validateIllustrationPlan({
        operation: bundle.requestIdentity.operation,
        proposal,
        closure: {
            characterIds: bundle.characters.map((character) => character.characterId),
            outfitRefs: bundle.characters.flatMap((character) => character.outfits.map((outfit) => outfit.outfitRef)),
            patternIds: bundle.patternCandidates.candidates.map((candidate) => candidate.patternId),
            anchorIds: bundle.chapter.blocks.map((block) => block.anchorId),
            terminalResolutions: evidence.terminalResolutions,
        },
        ...(selection ? {selectionAnchor: {anchorId: selection.endAnchorId, insertAfterAnchorId: selection.insertAfterAnchorId}} : {}),
    });
}

class SchedulerRunError extends Error {
    constructor(readonly code: string, message: string, readonly retryable: boolean) {
        super(message);
        this.name = "SchedulerRunError";
    }
}

function normalizeFailure(error: unknown): SchedulerRunError {
    if (error instanceof SchedulerRunError) return error;
    if (error instanceof IllustrationPlanValidationError) return new SchedulerRunError(error.code, error.message, false);
    return new SchedulerRunError("ILLUSTRATION_WORKFLOW_INTERNAL_ERROR", error instanceof Error ? error.message : "未知 planning 错误", true);
}

function createProductionRuntime(): IllustrationPlanningAgentRuntime {
    return {
        async isDirectorConfigured(projectPath) {
            const effective = await loadEffectiveConfigForAgentRuntime({projectPath});
            return Boolean(effective.agent.profiles[ILLUSTRATION_DIRECTOR_PROFILE_KEY]?.model.modelKey);
        },
        async createAgent(input) {
            const created = await useAgentHarness().createAgent({
                profileKey: ILLUSTRATION_DIRECTOR_PROFILE_KEY,
                initial: {operation: input.operation, planningInput: input.bundle},
                workspaceRoot: "workspace",
                workspaceKey: input.projectPath,
                projectPath: input.projectPath,
                title: `插图规划 · ${input.bundle.requestIdentity.chapterPath}`,
            });
            return {sessionId: created.sessionId};
        },
        async invoke(input) {
            const result = await useAgentHarness().invokeAgent({
                sessionId: input.sessionId,
                mode: "prompt",
                message: {text: input.operation === "plan-chapter"
                    ? "为冻结章节生成完整严格 Shot Intent，并在同一运行内完成连续性复核；只提交 report_result。"
                    : input.operation === "plan-selection"
                        ? "只为冻结选区生成一条严格 Shot Intent；不要返回锚点，只提交 report_result。"
                        : "只读审查章节中所有已生成插图的占位符，按 approved/needs_improvement/rejected 逐条给出评估与建议；不得生图、改正文或 reroll；只提交 report_result。"},
                title: `运行插图规划 · ${input.chapterPath}`,
                caller: {kind: "system", profileKey: ILLUSTRATION_DIRECTOR_PROFILE_KEY},
            });
            return {
                sessionId: result.sessionId,
                invocationId: result.invocationId,
                status: result.status,
                error: result.error,
                data: result.reportResult?.data,
            };
        },
        readEvidence: readIllustrationPlanningToolEvidence,
        releaseEvidence: releaseIllustrationPlanningToolEvidence,
        async abort(input) {
            await useAgentHarness().abortInvocation(input.sessionId, {reason: input.reason});
        },
    };
}
