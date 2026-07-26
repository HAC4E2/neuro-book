import type {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {ZodError} from "zod";
import {ILLUSTRATION_DIRECTOR_PROFILE_KEY} from "nbook/shared/agent/illustration-director";
import {
    IllustrationPlanningWorkflowDtoSchema,
    type IllustrationPlanningInputBundle,
    type IllustrationPlanningStartRequest,
    type IllustrationPlanningWorkflowDto,
} from "nbook/shared/text-to-image-illustration-workflow";
import {IllustrationPlanningApplyPayloadSchema} from "nbook/shared/text-to-image-planning-apply";
import {loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {IllustrationSelectionError} from "nbook/server/text-to-image/illustration-chapter-parser";
import {CharacterVisualRegistryError} from "nbook/server/text-to-image/character-visual-registry.service";
import {
    IllustrationPlanningInputBuilder,
    IllustrationPlanningInputError,
} from "nbook/server/text-to-image/illustration-planning-input.builder";
import {
    IllustrationWorkflowRepository,
    IllustrationWorkflowStateError,
    type IllustrationAttemptRecord,
    type IllustrationWorkflowRecord,
} from "nbook/server/text-to-image/illustration-workflow.repository";
import {IllustrationWorkflowScheduler} from "nbook/server/text-to-image/illustration-workflow.scheduler";
import {PlanningApplyService} from "nbook/server/text-to-image/planning-apply.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {ProjectOverlayError} from "nbook/server/text-to-image/project-overlay.service";
import {
    TextToImageRecipeConflictError,
    TextToImageRecipeInvalidError,
    TextToImageRecipeNotConfiguredError,
} from "nbook/server/text-to-image/recipe.service";
import {isTagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";

type SchedulerPort = Pick<IllustrationWorkflowScheduler, "tick" | "cancel">;
type PlanningApplyPort = Pick<PlanningApplyService, "recoverProject">;

type IllustrationWorkflowServiceOptions = {
    builder?: Pick<IllustrationPlanningInputBuilder, "build" | "rebuild">;
    client?: (projectPath: string) => Promise<PrismaClient>;
    readConcurrency?: (projectPath: string) => Promise<number>;
    createScheduler?: (repository: IllustrationWorkflowRepository) => SchedulerPort;
    createPlanningApply?: (client: PrismaClient) => PlanningApplyPort;
    nonceFactory?: () => string;
};

/** Planning Workflow 的应用服务；负责 build -> atomic upsert -> scheduler，不写章节或 Storyboard。 */
export class IllustrationWorkflowService {
    private readonly builder: Pick<IllustrationPlanningInputBuilder, "build" | "rebuild">;
    private readonly client: (projectPath: string) => Promise<PrismaClient>;
    private readonly readConcurrency: (projectPath: string) => Promise<number>;
    private readonly createScheduler: (repository: IllustrationWorkflowRepository) => SchedulerPort;
    private readonly createPlanningApply: (client: PrismaClient) => PlanningApplyPort;
    private readonly nonceFactory: () => string;
    private readonly schedulers = new Map<string, SchedulerPort>();
    private readonly recoveredProjects = new Map<string, Promise<void>>();

    constructor(options: IllustrationWorkflowServiceOptions = {}) {
        this.builder = options.builder ?? new IllustrationPlanningInputBuilder();
        this.client = options.client ?? textToImageProjectClient;
        this.readConcurrency = options.readConcurrency ?? readPlanningConcurrency;
        this.createScheduler = options.createScheduler ?? ((repository) => new IllustrationWorkflowScheduler({repository}));
        this.createPlanningApply = options.createPlanningApply ?? ((client) => new PlanningApplyService({client}));
        this.nonceFactory = options.nonceFactory ?? (() => crypto.randomUUID());
    }

    /** 构建冻结输入并在分配 Agent session 前原子汇合同一 request。 */
    async start(request: IllustrationPlanningStartRequest): Promise<IllustrationPlanningWorkflowDto> {
        const client = await this.client(request.projectPath);
        const projectId = await readProjectId(client);
        const repository = new IllustrationWorkflowRepository(client);
        await this.ensureRecovered(request.projectPath, projectId, client, repository);
        const bundle = await this.builder.build(request);
        await assertProjectIdentity(client, bundle.requestIdentity.projectId);
        const workflow = await repository.start(bundle);
        // 幂等复用命中可重试终态时，把再次点击"正文生图"视为一次显式重试；
        // 不可重试的终态（如 plan 严格校验失败）原样返回，由前端引导用户走"重新规划"。
        if (workflow.retryable && (workflow.status === "failed" || workflow.status === "canceled") && workflow.activeAttemptId === null) {
            try {
                await repository.retry({workflowId: workflow.id, planningInputHash: bundle.planningInputHash});
            } catch (error) {
                if (!(error instanceof IllustrationWorkflowStateError)) throw error;
            }
        }
        await this.tick(request.projectPath, workflow.projectId, repository);
        return this.read({projectPath: request.projectPath, workflowId: workflow.id});
    }

    /** 读取单条 plan-only 状态与 preview，不返回完整 Planning Input/evidence。 */
    async read(input: {projectPath: string; workflowId: string}): Promise<IllustrationPlanningWorkflowDto> {
        const client = await this.client(input.projectPath);
        const projectId = await readProjectId(client);
        const repository = new IllustrationWorkflowRepository(client);
        await this.ensureRecovered(input.projectPath, projectId, client, repository);
        const detail = await repository.read(input.workflowId);
        if (detail.workflow.projectId !== projectId) {
            throw new IllustrationWorkflowAccessError("ILLUSTRATION_WORKFLOW_NOT_FOUND", "Workflow 不属于当前 Project");
        }
        const queuePositions = await readQueuePositions(repository, projectId);
        const publishedPlaceholders = await readPublishedPlaceholders(client, [detail.workflow.id]);
        return toDto(
            detail.workflow,
            detail.attempts,
            queuePositions.get(detail.workflow.id) ?? null,
            publishedPlaceholders.get(detail.workflow.id) ?? [],
        );
    }

    /** 列出 Project 或章节内的 plan-only Workflow；attempt 详情按需由单条 GET 读取。 */
    async list(input: {projectPath: string; chapterPath?: string}): Promise<IllustrationPlanningWorkflowDto[]> {
        const client = await this.client(input.projectPath);
        const projectId = await readProjectId(client);
        const repository = new IllustrationWorkflowRepository(client);
        await this.ensureRecovered(input.projectPath, projectId, client, repository);
        const workflows = await repository.list({projectId, ...(input.chapterPath ? {chapterPath: input.chapterPath} : {})});
        const queuePositions = await readQueuePositions(repository, projectId);
        const publishedPlaceholders = await readPublishedPlaceholders(client, workflows.map((workflow) => workflow.id));
        return workflows.map((workflow) => toDto(
            workflow,
            [],
            queuePositions.get(workflow.id) ?? null,
            publishedPlaceholders.get(workflow.id) ?? [],
        ));
    }

    /** 取消单条 Workflow；先提交持久 canceled，再尽力终止该 session。 */
    async cancel(input: {projectPath: string; workflowId: string}): Promise<IllustrationPlanningWorkflowDto> {
        const client = await this.client(input.projectPath);
        const projectId = await readProjectId(client);
        const repository = new IllustrationWorkflowRepository(client);
        await this.ensureRecovered(input.projectPath, projectId, client, repository);
        const detail = await repository.read(input.workflowId);
        assertWorkflowProject(detail.workflow, projectId);
        const reason = "用户取消插图规划";
        const canceled = await repository.cancel({workflowId: input.workflowId, reason});
        await this.scheduler(input.projectPath, repository).cancel({workflowId: input.workflowId, sessionId: canceled.sessionId, reason});
        return this.read({projectPath: input.projectPath, workflowId: input.workflowId});
    }

    /** 仅在当前服务端重建的 request/input hash 与旧证据完全一致时显式重试。 */
    async retry(input: {projectPath: string; workflowId: string}): Promise<IllustrationPlanningWorkflowDto> {
        const context = await this.actionContext(input);
        let rebuilt: IllustrationPlanningInputBundle;
        try {
            rebuilt = await this.builder.rebuild({projectPath: input.projectPath, bundle: context.detail.workflow.input});
        } catch (error) {
            const reason = planningDriftReason(error);
            if (!reason) throw error;
            await context.repository.markStale({workflowId: input.workflowId, reason});
            throw new IllustrationWorkflowStateError("ILLUSTRATION_WORKFLOW_STALE", reason);
        }
        if (rebuilt.planningRequestHash !== context.detail.workflow.planningRequestHash
            || rebuilt.planningInputHash !== context.detail.workflow.planningInputHash) {
            const reason = "Planning 真相源已变化，请显式重新规划";
            await context.repository.markStale({workflowId: input.workflowId, reason});
            throw new IllustrationWorkflowStateError("ILLUSTRATION_WORKFLOW_STALE", reason);
        }
        const queued = await context.repository.retry({workflowId: input.workflowId, planningInputHash: rebuilt.planningInputHash});
        await this.tick(input.projectPath, queued.projectId, context.repository);
        return this.read({projectPath: input.projectPath, workflowId: input.workflowId});
    }

    /** 以新的 reason/nonce 重建当前服务端事实，创建独立 request identity 与 Workflow。 */
    async replan(input: {projectPath: string; workflowId: string; reason: string}): Promise<IllustrationPlanningWorkflowDto> {
        const context = await this.actionContext(input);
        if (!["ready", "failed", "canceled", "stale"].includes(context.detail.workflow.status)) {
            throw new IllustrationWorkflowStateError("ILLUSTRATION_WORKFLOW_STATE_CONFLICT", "只有终态 Workflow 可以重新规划");
        }
        const bundle = await this.builder.rebuild({
            projectPath: input.projectPath,
            bundle: context.detail.workflow.input,
            replan: {reason: input.reason, nonce: this.nonceFactory()},
        });
        const workflow = await context.repository.start(bundle);
        await this.tick(input.projectPath, workflow.projectId, context.repository);
        return this.read({projectPath: input.projectPath, workflowId: workflow.id});
    }

    /** 为单条 action 建立 Project ownership 与一次性重启恢复边界。 */
    private async actionContext(input: {projectPath: string; workflowId: string}): Promise<{
        projectId: string;
        repository: IllustrationWorkflowRepository;
        detail: Awaited<ReturnType<IllustrationWorkflowRepository["read"]>>;
    }> {
        const client = await this.client(input.projectPath);
        const projectId = await readProjectId(client);
        const repository = new IllustrationWorkflowRepository(client);
        await this.ensureRecovered(input.projectPath, projectId, client, repository);
        const detail = await repository.read(input.workflowId);
        assertWorkflowProject(detail.workflow, projectId);
        return {projectId, repository, detail};
    }

    /** 每个 Project 每个服务进程只执行一次重启恢复；失败会清除门闩以允许下次重试。 */
    private async ensureRecovered(
        projectPath: string,
        projectId: string,
        client: PrismaClient,
        repository: IllustrationWorkflowRepository,
    ): Promise<void> {
        const existing = this.recoveredProjects.get(projectPath);
        if (existing) return existing;
        const recovery = this.recoverProject(projectPath, projectId, client, repository);
        this.recoveredProjects.set(projectPath, recovery);
        try {
            await recovery;
        } catch (error) {
            if (this.recoveredProjects.get(projectPath) === recovery) this.recoveredProjects.delete(projectPath);
            throw error;
        }
    }

    /** 中断旧 Attempt，从当前真相源重建；精确一致才 queued，否则 stale。 */
    private async recoverProject(
        projectPath: string,
        projectId: string,
        client: PrismaClient,
        repository: IllustrationWorkflowRepository,
    ): Promise<void> {
        await this.createPlanningApply(client).recoverProject({projectPath, projectId});
        const recoverable = await repository.listRecoverable({projectId});
        let queued = false;
        for (const workflow of recoverable) {
            if (!workflow.activeAttemptId) {
                throw new IllustrationWorkflowStateError(
                    "ILLUSTRATION_WORKFLOW_STATE_CONFLICT",
                    `可恢复 Workflow ${workflow.id} 缺少 active Attempt`,
                );
            }
            let rebuilt: IllustrationPlanningInputBundle | null = null;
            let staleReason = "Planning 真相源已变化，旧 Attempt 已中断";
            try {
                rebuilt = await this.builder.rebuild({projectPath, bundle: workflow.input});
            } catch (error) {
                const reason = planningDriftReason(error);
                if (!reason) throw error;
                staleReason = reason;
            }
            const result = await repository.recover({
                workflowId: workflow.id,
                attemptId: workflow.activeAttemptId,
                planningRequestHash: rebuilt?.planningRequestHash ?? null,
                planningInputHash: rebuilt?.planningInputHash ?? null,
                staleReason,
            });
            queued ||= result.status === "queued";
        }
        if (queued) await this.tick(projectPath, projectId, repository);
    }

    /** 复用同一 Project scheduler，保证 cancel 能命中当前进程内 active run。 */
    private scheduler(projectPath: string, repository: IllustrationWorkflowRepository): SchedulerPort {
        const existing = this.schedulers.get(projectPath);
        if (existing) return existing;
        const scheduler = this.createScheduler(repository);
        this.schedulers.set(projectPath, scheduler);
        return scheduler;
    }

    /** 使用当前 Director 配置的并发上限推进持久队列。 */
    private async tick(projectPath: string, projectId: string, repository: IllustrationWorkflowRepository): Promise<void> {
        const concurrency = await this.readConcurrency(projectPath);
        await this.scheduler(projectPath, repository).tick({projectPath, projectId, concurrency});
    }
}

/** 对单条 Workflow 执行 Project ownership fail-closed 校验。 */
function assertWorkflowProject(workflow: IllustrationWorkflowRecord, projectId: string): void {
    if (workflow.projectId !== projectId) {
        throw new IllustrationWorkflowAccessError("ILLUSTRATION_WORKFLOW_NOT_FOUND", "Workflow 不属于当前 Project");
    }
}

/** 将已知当前真相源缺失/冲突归一为 stale 原因；未知基础设施错误继续向上抛出。 */
function planningDriftReason(error: unknown): string | null {
    const known = error instanceof IllustrationPlanningInputError
        || error instanceof IllustrationSelectionError
        || error instanceof CharacterVisualRegistryError
        || error instanceof ProjectOverlayError
        || error instanceof TextToImageRecipeConflictError
        || error instanceof TextToImageRecipeInvalidError
        || error instanceof TextToImageRecipeNotConfiguredError
        || error instanceof ZodError
        || isTagIndexError(error);
    if (!known) return null;
    const message = error instanceof Error ? error.message : "当前 Planning 真相源无法通过严格校验";
    return `当前 Planning 真相源无法复现旧输入：${message}`.slice(0, 1000);
}

export class IllustrationWorkflowAccessError extends Error {
    constructor(readonly code: "ILLUSTRATION_WORKFLOW_NOT_FOUND" | "ILLUSTRATION_PROJECT_ID_MISSING" | "ILLUSTRATION_PROJECT_ID_CONFLICT", message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationWorkflowAccessError";
    }
}

async function assertProjectIdentity(client: PrismaClient, expectedProjectId: string): Promise<void> {
    const projectId = await readProjectId(client);
    if (projectId !== expectedProjectId) {
        throw new IllustrationWorkflowAccessError("ILLUSTRATION_PROJECT_ID_CONFLICT", "Planning Input projectId 与当前 Project 数据库不一致");
    }
}

async function readProjectId(client: PrismaClient): Promise<string> {
    const metadata = await client.projectMetadata.findUnique({where: {key: "projectId"}});
    if (!metadata) {
        throw new IllustrationWorkflowAccessError("ILLUSTRATION_PROJECT_ID_MISSING", "Project 数据库缺少可移植 projectId");
    }
    return metadata.value;
}

async function readQueuePositions(repository: IllustrationWorkflowRepository, projectId: string): Promise<Map<string, number>> {
    const queued = (await repository.list({projectId}))
        .filter((workflow) => workflow.status === "queued")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    return new Map(queued.map((workflow, index) => [workflow.id, index + 1]));
}

function toDto(
    workflow: IllustrationWorkflowRecord,
    attempts: IllustrationAttemptRecord[],
    queuePosition: number | null,
    publishedPlaceholderIds: string[],
): IllustrationPlanningWorkflowDto {
    return IllustrationPlanningWorkflowDtoSchema.parse({
        id: workflow.id,
        chapterPath: workflow.chapterPath,
        operation: workflow.operation,
        planningRequestHash: workflow.planningRequestHash,
        planningInputHash: workflow.planningInputHash,
        status: workflow.status,
        activeAttemptId: workflow.activeAttemptId,
        retryable: workflow.retryable,
        staleReason: workflow.staleReason,
        errorCode: workflow.errorCode,
        errorMessage: workflow.errorMessage,
        queuePosition,
        validatedPlan: workflow.validatedPlan,
        publishedPlaceholderIds,
        attempts: attempts.map((attempt) => ({
            id: attempt.id,
            status: attempt.status,
            sessionId: attempt.sessionId,
            invocationId: attempt.invocationId,
            planningEvidenceHash: attempt.planningEvidenceHash,
            errorCode: attempt.errorCode,
            errorMessage: attempt.errorMessage,
            createdAt: attempt.createdAt,
            startedAt: attempt.startedAt,
            finishedAt: attempt.finishedAt,
        })),
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
    });
}

/** completed Apply Journal 是 Workflow → 发布 placeholder IDs 的唯一只读来源。 */
async function readPublishedPlaceholders(client: PrismaClient, workflowIds: string[]): Promise<Map<string, string[]>> {
    if (workflowIds.length === 0) return new Map();
    const journals = await client.illustrationPlanningApplyJournal.findMany({
        where: {workflowId: {in: workflowIds}, state: "completed"},
        select: {workflowId: true, payloadJson: true},
    });
    return new Map(journals.map((journal) => {
        const payload: unknown = JSON.parse(journal.payloadJson);
        return [journal.workflowId, IllustrationPlanningApplyPayloadSchema.parse(payload).newPlaceholderIds] as const;
    }));
}

async function readPlanningConcurrency(projectPath: string): Promise<number> {
    const effective = await loadEffectiveConfigForAgentRuntime({projectPath});
    const value = effective.agent.profiles[ILLUSTRATION_DIRECTOR_PROFILE_KEY]?.settings.planningConcurrency;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 4 ? value : 2;
}

let service: IllustrationWorkflowService | null = null;

/** Nitro 进程内应用服务入口；正确性仍由 Project SQLite 唯一键/CAS 保证。 */
export function getIllustrationWorkflowService(): IllustrationWorkflowService {
    service ??= new IllustrationWorkflowService();
    return service;
}
