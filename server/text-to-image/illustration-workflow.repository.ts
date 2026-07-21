import type {PrismaClient} from "nbook/server/generated/project-prisma/client";
import type {IllustrationPlanningAttempt, IllustrationPlanningWorkflow} from "nbook/server/generated/project-prisma/client";
import {
    IllustrationContinuityShotSchema,
    IllustrationPlanningInputBundleSchema,
    type IllustrationContinuityShot,
    type IllustrationPlanningInputBundle,
} from "nbook/shared/text-to-image-illustration-workflow";
import {IllustrationPlanningProposalSchema, ValidatedIllustrationPlanSchema, type IllustrationPlanningProposal, type ValidatedIllustrationPlan} from "nbook/shared/text-to-image-illustration-planning";

export type IllustrationWorkflowStatus = "queued" | "running" | "validating" | "applying" | "ready" | "failed" | "canceled" | "stale";
export type IllustrationAttemptStatus = "created" | "running" | "succeeded" | "failed" | "interrupted" | "canceled";

export type IllustrationWorkflowRecord = {
    id: string;
    projectId: string;
    chapterPath: string;
    operation: "plan-chapter" | "plan-selection" | "review-candidates";
    planningRequestHash: string;
    planningInputHash: string;
    input: IllustrationPlanningInputBundle;
    status: IllustrationWorkflowStatus;
    /** queued 或已结束且无 active attempt 时为 null。 */
    activeAttemptId: string | null;
    retryable: boolean;
    staleReason: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    /** strict validation 尚未完成时为 null。 */
    validatedPlan: ValidatedIllustrationPlan | null;
    createdAt: string;
    updatedAt: string;
};

export type IllustrationAttemptRecord = {
    id: string;
    workflowId: string;
    status: IllustrationAttemptStatus;
    /** scheduler 尚未分配 Agent session 时为 null。 */
    sessionId: number | null;
    /** Agent invocation 尚未开始或没有成功分配时为 null。 */
    invocationId: string | null;
    /** Agent proposal 尚未成功并完成 evidence 封存时为 null。 */
    planningEvidenceHash: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
};

export class IllustrationWorkflowStateError extends Error {
    constructor(readonly code: "ILLUSTRATION_WORKFLOW_NOT_FOUND" | "ILLUSTRATION_WORKFLOW_STATE_CONFLICT" | "ILLUSTRATION_WORKFLOW_STALE", message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationWorkflowStateError";
    }
}

type RepositoryOptions = {idFactory?: (prefix: "workflow" | "attempt") => string};

/** Project SQLite Planning Workflow / Attempt 的唯一持久状态仓库。 */
export class IllustrationWorkflowRepository {
    private readonly idFactory: (prefix: "workflow" | "attempt") => string;
    private claimTail: Promise<void> = Promise.resolve();

    constructor(private readonly client: PrismaClient, options: RepositoryOptions = {}) {
        this.idFactory = options.idFactory ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
    }

    /** 在任何 Agent session 分配前按稳定唯一键原子汇合重复请求。 */
    async start(input: IllustrationPlanningInputBundle): Promise<IllustrationWorkflowRecord> {
        const bundle = IllustrationPlanningInputBundleSchema.parse(input);
        const operation = toStoredOperation(bundle.requestIdentity.operation);
        const row = await this.client.illustrationPlanningWorkflow.upsert({
            where: {
                projectId_chapterPath_operation_planningRequestHash: {
                    projectId: bundle.requestIdentity.projectId,
                    chapterPath: bundle.requestIdentity.chapterPath,
                    operation,
                    planningRequestHash: bundle.planningRequestHash,
                },
            },
            update: {},
            create: {
                id: this.idFactory("workflow"),
                projectId: bundle.requestIdentity.projectId,
                chapterPath: bundle.requestIdentity.chapterPath,
                operation,
                planningRequestHash: bundle.planningRequestHash,
                planningInputHash: bundle.planningInputHash,
                inputJson: JSON.stringify(bundle),
                status: "queued",
            },
        });
        if (row.planningInputHash !== bundle.planningInputHash) {
            throw new IllustrationWorkflowStateError("ILLUSTRATION_WORKFLOW_STALE", "同一 planningRequestHash 对应的冻结输入已漂移");
        }
        return mapWorkflow(row);
    }

    /** 读取单条 Workflow 与其 attempts；不存在时使用稳定错误。 */
    async read(workflowId: string): Promise<{workflow: IllustrationWorkflowRecord; attempts: IllustrationAttemptRecord[]}> {
        const row = await this.client.illustrationPlanningWorkflow.findUnique({
            where: {id: workflowId},
            include: {attempts: {orderBy: {createdAt: "asc"}}},
        });
        if (!row) throw notFound(workflowId);
        return {workflow: mapWorkflow(row), attempts: row.attempts.map(mapAttempt)};
    }

    /** 读取 Project 内 Workflow 列表；仅供只读状态/预览 API。 */
    async list(input: {projectId: string; chapterPath?: string}): Promise<IllustrationWorkflowRecord[]> {
        const rows = await this.client.illustrationPlanningWorkflow.findMany({
            where: {projectId: input.projectId, ...(input.chapterPath ? {chapterPath: input.chapterPath} : {})},
            orderBy: [{createdAt: "desc"}, {id: "desc"}],
        });
        return rows.map(mapWorkflow);
    }

    /** 读取进程重启后必须中断并重建的 active Workflow；不包含 queued 或任何终态。 */
    async listRecoverable(input: {projectId: string}): Promise<IllustrationWorkflowRecord[]> {
        const rows = await this.client.illustrationPlanningWorkflow.findMany({
            where: {
                projectId: input.projectId,
                status: {in: ["running", "validating"]},
                activeAttemptId: {not: null},
            },
            orderBy: [{createdAt: "asc"}, {id: "asc"}],
        });
        return rows.map(mapWorkflow);
    }

    /** 读取已经封存 validated plan、但发布事务尚未收口的 Workflow。 */
    async listApplying(input: {projectId: string}): Promise<IllustrationWorkflowRecord[]> {
        const rows = await this.client.illustrationPlanningWorkflow.findMany({
            where: {projectId: input.projectId, status: "applying", validatedPlanJson: {not: null}},
            orderBy: [{createdAt: "asc"}, {id: "asc"}],
        });
        return rows.map(mapWorkflow);
    }

    /** 当前持久状态是否已经被用户取消；供 scheduler 将迟到结果视为幂等终态。 */
    async isCanceled(workflowId: string): Promise<boolean> {
        const row = await this.client.illustrationPlanningWorkflow.findUnique({where: {id: workflowId}, select: {status: true}});
        return row?.status === "canceled";
    }

    /**
     * 冻结当前章节的连续性摘要：整章重规划仅保留 selection，选区规划保留最新整章与其它 selection。
     * P4 发布 aggregate 后可替换数据源，但本方法不会把当前 operation 将替换的结果自反馈进 request hash。
     */
    async readContinuityBaseline(input: {
        projectId: string;
        chapterPath: string;
        operation: "plan-chapter" | "plan-selection" | "review-candidates";
        selectionHash: string | null;
    }): Promise<IllustrationContinuityShot[]> {
        const rows = await this.client.illustrationPlanningWorkflow.findMany({
            where: {
                projectId: input.projectId,
                chapterPath: input.chapterPath,
                status: "ready",
                validatedPlanJson: {not: null},
            },
            orderBy: [{updatedAt: "desc"}, {id: "desc"}],
        });
        let chapterSelected = false;
        const selectionKeys = new Set<string>();
        const selected: Array<{sourceKey: string; plan: ValidatedIllustrationPlan; origin: "chapter-plan" | "selection"; selectionHash: string | null}> = [];
        for (const row of rows) {
            const bundleValue: unknown = JSON.parse(row.inputJson);
            const bundle = IllustrationPlanningInputBundleSchema.parse(bundleValue);
            const planValue: unknown = JSON.parse(row.validatedPlanJson!);
            const plan = ValidatedIllustrationPlanSchema.parse(planValue);
            if (bundle.requestIdentity.operation === "plan-chapter") {
                if (input.operation === "plan-chapter" || chapterSelected) continue;
                chapterSelected = true;
                selected.push({sourceKey: "0:chapter", plan, origin: "chapter-plan", selectionHash: null});
                continue;
            }
            const selectionHash = bundle.requestIdentity.selectionHash;
            if (!selectionHash || (input.operation === "plan-selection" && selectionHash === input.selectionHash) || selectionKeys.has(selectionHash)) {
                continue;
            }
            selectionKeys.add(selectionHash);
            selected.push({sourceKey: `1:${selectionHash}`, plan, origin: "selection", selectionHash});
        }
        return selected.sort((left, right) => compareText(left.sourceKey, right.sourceKey)).flatMap((source) => source.plan.shots.map((shot) => IllustrationContinuityShotSchema.parse({
            shotIntentHash: shot.shotIntentHash,
            origin: source.origin,
            selectionHash: source.selectionHash,
            characterIds: shot.characterIds,
            composition: {
                shotSize: shot.composition.shotSize,
                cameraAngle: shot.composition.cameraAngle,
                viewpoint: shot.composition.viewpoint,
                canvasIntent: shot.composition.canvasIntent,
            },
            continuity: shot.continuity,
        })));
    }

    /**
     * 领取最早 queued Workflow；进程内串行只缩小 SQLite 锁窗口，数据库 status CAS 仍是跨实例硬边界。
     */
    async claimNext(input: {projectId: string; concurrency: number}): Promise<{workflow: IllustrationWorkflowRecord; attempt: IllustrationAttemptRecord} | null> {
        if (!Number.isSafeInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > 4) {
            throw new IllustrationWorkflowStateError("ILLUSTRATION_WORKFLOW_STATE_CONFLICT", "planning concurrency 必须为 1..4");
        }
        const previous = this.claimTail;
        let release!: () => void;
        this.claimTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
            return await this.client.$transaction(async (transaction) => {
                const running = await transaction.illustrationPlanningWorkflow.count({
                    where: {projectId: input.projectId, status: {in: ["running", "validating", "applying"]}},
                });
                if (running >= input.concurrency) return null;
                const queued = await transaction.illustrationPlanningWorkflow.findFirst({
                    where: {projectId: input.projectId, status: "queued"},
                    orderBy: [{createdAt: "asc"}, {id: "asc"}],
                });
                if (!queued) return null;
                const attemptId = this.idFactory("attempt");
                const claimed = await transaction.illustrationPlanningWorkflow.updateMany({
                    where: {id: queued.id, status: "queued", activeAttemptId: null},
                    data: {
                        status: "running",
                        activeAttemptId: attemptId,
                        retryable: false,
                        staleReason: null,
                        errorCode: null,
                        errorMessage: null,
                    },
                });
                if (claimed.count !== 1) return null;
                const attempt = await transaction.illustrationPlanningAttempt.create({
                    data: {id: attemptId, workflowId: queued.id, status: "created"},
                });
                const workflow = await transaction.illustrationPlanningWorkflow.findUniqueOrThrow({where: {id: queued.id}});
                return {workflow: mapWorkflow(workflow), attempt: mapAttempt(attempt)};
            });
        } finally {
            release();
        }
    }

    /** scheduler 分配独立 Agent session 后，把 attempt 从 created 切到 running。 */
    async bindAttempt(input: {workflowId: string; attemptId: string; sessionId: number}): Promise<IllustrationAttemptRecord> {
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            if (!workflow || workflow.status !== "running" || workflow.activeAttemptId !== input.attemptId) throw stateConflict("attempt 不再 active");
            const result = await transaction.illustrationPlanningAttempt.updateMany({
                where: {id: input.attemptId, workflowId: input.workflowId, status: "created", sessionId: null},
                data: {status: "running", sessionId: input.sessionId, startedAt: new Date()},
            });
            if (result.count !== 1) throw stateConflict("attempt 无法绑定 session");
            return mapAttempt(await transaction.illustrationPlanningAttempt.findUniqueOrThrow({where: {id: input.attemptId}}));
        });
    }

    /** Agent 完成 strict proposal 后先落 attempt evidence，并进入 validating；此时仍不写任何 Workspace 文件。 */
    async succeedAttempt(input: {
        workflowId: string;
        attemptId: string;
        invocationId: string;
        proposal: IllustrationPlanningProposal;
        planningEvidenceHash: string;
        evidenceJson: string;
    }): Promise<IllustrationWorkflowRecord> {
        const proposal = IllustrationPlanningProposalSchema.parse(input.proposal);
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            if (!workflow || workflow.status !== "running" || workflow.activeAttemptId !== input.attemptId) throw stateConflict("成功 attempt 不再 active");
            const attempt = await transaction.illustrationPlanningAttempt.updateMany({
                where: {id: input.attemptId, workflowId: input.workflowId, status: "running"},
                data: {
                    status: "succeeded",
                    invocationId: input.invocationId,
                    planningEvidenceHash: input.planningEvidenceHash,
                    evidenceJson: input.evidenceJson,
                    proposalJson: JSON.stringify(proposal),
                    finishedAt: new Date(),
                },
            });
            if (attempt.count !== 1) throw stateConflict("attempt 未运行或已结束");
            return mapWorkflow(await transaction.illustrationPlanningWorkflow.update({
                where: {id: input.workflowId},
                data: {status: "validating", proposalJson: JSON.stringify(proposal)},
            }));
        });
    }

    /** strict validator 通过后持久 plan-only preview；P4 才进入 applying / 文件发布。 */
    async completeValidation(input: {workflowId: string; attemptId: string; plan: ValidatedIllustrationPlan}): Promise<IllustrationWorkflowRecord> {
        const plan = ValidatedIllustrationPlanSchema.parse(input.plan);
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            if (!workflow || workflow.status !== "validating" || workflow.activeAttemptId !== input.attemptId) throw stateConflict("Workflow 不在 validating");
            const attempt = await transaction.illustrationPlanningAttempt.findUnique({where: {id: input.attemptId}});
            if (!attempt || attempt.status !== "succeeded") throw stateConflict("Attempt 尚未 succeeded");
            return mapWorkflow(await transaction.illustrationPlanningWorkflow.update({
                where: {id: input.workflowId},
                data: {
                    status: "applying",
                    activeAttemptId: null,
                    validatedPlanJson: JSON.stringify(plan),
                    retryable: false,
                    errorCode: null,
                    errorMessage: null,
                },
            }));
        });
    }

    /** Planning Apply Journal completed 后，唯一允许的 applying -> ready 出口。 */
    async completeApply(workflowId: string): Promise<IllustrationWorkflowRecord> {
        const result = await this.client.illustrationPlanningWorkflow.updateMany({
            where: {id: workflowId, status: "applying", validatedPlanJson: {not: null}},
            data: {
                status: "ready",
                activeAttemptId: null,
                retryable: false,
                staleReason: null,
                errorCode: null,
                errorMessage: null,
            },
        });
        const row = await this.client.illustrationPlanningWorkflow.findUnique({where: {id: workflowId}});
        if (!row) throw notFound(workflowId);
        if (result.count === 1 || row.status === "ready") return mapWorkflow(row);
        throw stateConflict(`Workflow ${workflowId} 无法从 applying 进入 ready`);
    }

    /** P6：review-candidates 只读审查无需 apply，直接从 validating → ready。 */
    async skipApplyToReady(workflowId: string): Promise<IllustrationWorkflowRecord> {
        const result = await this.client.illustrationPlanningWorkflow.updateMany({
            where: {id: workflowId, status: "validating", validatedPlanJson: {not: null}},
            data: {
                status: "ready",
                activeAttemptId: null,
                retryable: false,
                staleReason: null,
                errorCode: null,
                errorMessage: null,
            },
        });
        const row = await this.client.illustrationPlanningWorkflow.findUnique({where: {id: workflowId}});
        if (!row) throw notFound(workflowId);
        if (result.count === 1 || row.status === "ready") return mapWorkflow(row);
        throw stateConflict(`Workflow ${workflowId} 无法从 validating 进入 ready（review-candidates 只读）`);
    }

    /** 文件真相源漂移或 apply rollback 后，把 Workflow 稳定标为 stale。 */
    async markApplyStale(input: {workflowId: string; reason: string; errorCode: string}): Promise<IllustrationWorkflowRecord> {
        const result = await this.client.illustrationPlanningWorkflow.updateMany({
            where: {id: input.workflowId, status: "applying"},
            data: {
                status: "stale",
                activeAttemptId: null,
                retryable: false,
                staleReason: input.reason,
                errorCode: input.errorCode,
                errorMessage: input.reason,
            },
        });
        const row = await this.client.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
        if (!row) throw notFound(input.workflowId);
        if (result.count === 1 || row.status === "stale") return mapWorkflow(row);
        throw stateConflict(`Workflow ${input.workflowId} 无法标记为 stale`);
    }

    /**
     * proposal/evidence 已成功封存、但 validating 阶段无法完成时的唯一失败出口。
     * succeeded attempt 保持不可变，便于审计；若 ready 事务实际已提交，则按幂等成功处理。
     */
    async failValidation(input: {
        workflowId: string;
        attemptId: string;
        retryable: boolean;
        errorCode: string;
        errorMessage: string;
    }): Promise<IllustrationWorkflowRecord> {
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            const attempt = await transaction.illustrationPlanningAttempt.findUnique({where: {id: input.attemptId}});
            if (workflow?.status === "ready" && workflow.activeAttemptId === null && attempt?.status === "succeeded") {
                return mapWorkflow(workflow);
            }
            if (!workflow || workflow.status !== "validating" || workflow.activeAttemptId !== input.attemptId) {
                throw stateConflict("校验失败的 Workflow 不在 validating");
            }
            if (!attempt || attempt.workflowId !== input.workflowId || attempt.status !== "succeeded") {
                throw stateConflict("校验失败的 Attempt 尚未 succeeded");
            }
            return mapWorkflow(await transaction.illustrationPlanningWorkflow.update({
                where: {id: input.workflowId},
                data: {
                    status: "failed",
                    activeAttemptId: null,
                    retryable: input.retryable,
                    errorCode: input.errorCode,
                    errorMessage: input.errorMessage,
                },
            }));
        });
    }

    /** Agent invocation 返回失败时结束 attempt；retry 必须由用户显式触发。 */
    async failAttempt(input: {
        workflowId: string;
        attemptId: string;
        retryable: boolean;
        errorCode: string;
        errorMessage: string;
        invocationId?: string;
    }): Promise<IllustrationWorkflowRecord> {
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            if (!workflow || workflow.status !== "running" || workflow.activeAttemptId !== input.attemptId) throw stateConflict("失败 attempt 不再 active");
            const attempt = await transaction.illustrationPlanningAttempt.updateMany({
                where: {id: input.attemptId, workflowId: input.workflowId, status: {in: ["created", "running"]}},
                data: {
                    status: "failed",
                    invocationId: input.invocationId,
                    errorCode: input.errorCode,
                    errorMessage: input.errorMessage,
                    finishedAt: new Date(),
                },
            });
            if (attempt.count !== 1) throw stateConflict("attempt 已结束");
            return mapWorkflow(await transaction.illustrationPlanningWorkflow.update({
                where: {id: input.workflowId},
                data: {
                    status: "failed",
                    activeAttemptId: null,
                    retryable: input.retryable,
                    errorCode: input.errorCode,
                    errorMessage: input.errorMessage,
                },
            }));
        });
    }

    /**
     * 取消单条 Workflow，并在同一事务关闭其 active Attempt。
     * 已取消状态幂等返回；其它终态不能被伪装成取消。
     */
    async cancel(input: {workflowId: string; reason: string}): Promise<{workflow: IllustrationWorkflowRecord; sessionId: number | null}> {
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            if (!workflow) throw notFound(input.workflowId);
            if (workflow.status === "canceled") return {workflow: mapWorkflow(workflow), sessionId: null};
            if (!["queued", "running", "validating", "applying"].includes(workflow.status)) {
                throw stateConflict("当前 Workflow 不允许取消");
            }
            const attempt = workflow.activeAttemptId
                ? await transaction.illustrationPlanningAttempt.findUnique({where: {id: workflow.activeAttemptId}})
                : null;
            if (attempt && attempt.workflowId !== workflow.id) throw stateConflict("active attempt 不属于当前 Workflow");
            if (attempt?.status === "created" || attempt?.status === "running") {
                const closed = await transaction.illustrationPlanningAttempt.updateMany({
                    where: {id: attempt.id, workflowId: workflow.id, status: {in: ["created", "running"]}},
                    data: {
                        status: "canceled",
                        errorCode: "ILLUSTRATION_WORKFLOW_CANCELED",
                        errorMessage: input.reason,
                        finishedAt: new Date(),
                    },
                });
                if (closed.count !== 1) throw stateConflict("取消时 active attempt 已变化");
            }
            const canceled = await transaction.illustrationPlanningWorkflow.update({
                where: {id: workflow.id},
                data: {
                    status: "canceled",
                    activeAttemptId: null,
                    retryable: true,
                    staleReason: null,
                    validatedPlanJson: null,
                    errorCode: "ILLUSTRATION_WORKFLOW_CANCELED",
                    errorMessage: input.reason,
                },
            });
            return {workflow: mapWorkflow(canceled), sessionId: attempt?.sessionId ?? null};
        });
    }

    /**
     * 进程重启恢复：旧 Attempt 一律 interrupted；只有当前重建的两层 hash 均相同才重新 queued。
     * 任何旧 proposal/evidence 都不会被接续为新 Attempt 的输入。
     */
    async recover(input: {
        workflowId: string;
        attemptId: string;
        /** null 表示当前服务端真相源无法安全重建，必须 stale。 */
        planningRequestHash: string | null;
        /** null 表示当前服务端真相源无法安全重建，必须 stale。 */
        planningInputHash: string | null;
        staleReason: string;
    }): Promise<IllustrationWorkflowRecord> {
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            if (!workflow) throw notFound(input.workflowId);
            if (!["running", "validating", "applying"].includes(workflow.status)
                || workflow.activeAttemptId !== input.attemptId) {
                throw stateConflict("Workflow 不再处于可恢复 active 状态");
            }
            const attempt = await transaction.illustrationPlanningAttempt.updateMany({
                where: {
                    id: input.attemptId,
                    workflowId: workflow.id,
                    status: {in: ["created", "running", "succeeded"]},
                },
                data: {
                    status: "interrupted",
                    errorCode: "ILLUSTRATION_WORKFLOW_INTERRUPTED",
                    errorMessage: "应用进程中断，旧 Attempt 不会续跑",
                    finishedAt: new Date(),
                },
            });
            if (attempt.count !== 1) throw stateConflict("重启恢复时 Attempt 已不再 active");
            const exact = input.planningRequestHash !== null
                && input.planningInputHash !== null
                && workflow.planningRequestHash === input.planningRequestHash
                && workflow.planningInputHash === input.planningInputHash;
            return mapWorkflow(await transaction.illustrationPlanningWorkflow.update({
                where: {id: workflow.id},
                data: exact ? {
                    status: "queued",
                    activeAttemptId: null,
                    retryable: false,
                    staleReason: null,
                    proposalJson: null,
                    validatedPlanJson: null,
                    errorCode: null,
                    errorMessage: null,
                } : {
                    status: "stale",
                    activeAttemptId: null,
                    retryable: false,
                    staleReason: input.staleReason,
                    proposalJson: null,
                    validatedPlanJson: null,
                    errorCode: "ILLUSTRATION_WORKFLOW_STALE",
                    errorMessage: input.staleReason,
                },
            }));
        });
    }

    /** 将无 active Attempt 的旧请求显式失效；用于 retry 前的当前真相源漂移。 */
    async markStale(input: {workflowId: string; reason: string}): Promise<IllustrationWorkflowRecord> {
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            if (!workflow) throw notFound(input.workflowId);
            if (workflow.activeAttemptId !== null || ["running", "validating", "applying"].includes(workflow.status)) {
                throw stateConflict("active Workflow 不能绕过恢复流程直接 stale");
            }
            return mapWorkflow(await transaction.illustrationPlanningWorkflow.update({
                where: {id: workflow.id},
                data: {
                    status: "stale",
                    retryable: false,
                    staleReason: input.reason,
                    errorCode: "ILLUSTRATION_WORKFLOW_STALE",
                    errorMessage: input.reason,
                },
            }));
        });
    }

    /** 只有 retryable failed/canceled 且输入证据未变时才重新排队，并始终创建新 attempt。 */
    async retry(input: {workflowId: string; planningInputHash: string}): Promise<IllustrationWorkflowRecord> {
        return this.client.$transaction(async (transaction) => {
            const workflow = await transaction.illustrationPlanningWorkflow.findUnique({where: {id: input.workflowId}});
            if (!workflow) throw notFound(input.workflowId);
            if (workflow.planningInputHash !== input.planningInputHash) {
                throw new IllustrationWorkflowStateError("ILLUSTRATION_WORKFLOW_STALE", "retry 的 Planning Input 已漂移");
            }
            if (!workflow.retryable || (workflow.status !== "failed" && workflow.status !== "canceled") || workflow.activeAttemptId !== null) {
                throw stateConflict("当前 Workflow 不允许 retry");
            }
            return mapWorkflow(await transaction.illustrationPlanningWorkflow.update({
                where: {id: input.workflowId},
                data: {status: "queued", retryable: false, errorCode: null, errorMessage: null},
            }));
        });
    }
}

function mapWorkflow(row: IllustrationPlanningWorkflow): IllustrationWorkflowRecord {
    const jsonValue: unknown = JSON.parse(row.inputJson);
    return {
        id: row.id,
        projectId: row.projectId,
        chapterPath: row.chapterPath,
        operation: row.operation === "plan_chapter" ? "plan-chapter" : row.operation === "review_candidates" ? "review-candidates" : "plan-selection",
        planningRequestHash: row.planningRequestHash,
        planningInputHash: row.planningInputHash,
        input: IllustrationPlanningInputBundleSchema.parse(jsonValue),
        status: row.status,
        activeAttemptId: row.activeAttemptId,
        retryable: row.retryable,
        staleReason: row.staleReason,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        validatedPlan: row.validatedPlanJson === null
            ? null
            : ValidatedIllustrationPlanSchema.parse(JSON.parse(row.validatedPlanJson) as unknown),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function mapAttempt(row: IllustrationPlanningAttempt): IllustrationAttemptRecord {
    return {
        id: row.id,
        workflowId: row.workflowId,
        status: row.status,
        sessionId: row.sessionId,
        invocationId: row.invocationId,
        planningEvidenceHash: row.planningEvidenceHash,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
    };
}

function toStoredOperation(operation: "plan-chapter" | "plan-selection" | "review-candidates"): "plan_chapter" | "plan_selection" | "review_candidates" {
    if (operation === "plan-chapter") return "plan_chapter";
    if (operation === "review-candidates") return "review_candidates";
    return "plan_selection";
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function notFound(id: string): IllustrationWorkflowStateError {
    return new IllustrationWorkflowStateError("ILLUSTRATION_WORKFLOW_NOT_FOUND", `Workflow 不存在：${id}`);
}

function stateConflict(message: string): IllustrationWorkflowStateError {
    return new IllustrationWorkflowStateError("ILLUSTRATION_WORKFLOW_STATE_CONFLICT", message);
}
