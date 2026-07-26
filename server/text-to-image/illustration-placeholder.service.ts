import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    ILLUSTRATION_PLACEHOLDER_STATUS_VERSION,
    IllustrationPlaceholderStatusSchema,
    type IllustrationPlaceholderState,
    type IllustrationPlaceholderStatus,
} from "nbook/shared/text-to-image-execution-ui";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {
    IllustrationExecutionCompilerError,
    ProductionIllustrationExecutionCompiler,
} from "nbook/server/text-to-image/illustration-execution.compiler";
import {TextToImageRecipeNotConfiguredError} from "nbook/server/text-to-image/recipe.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";

const PlaceholderStatusInputSchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    ownerUserId: z.number().int().positive().safe(),
    placeholderId: z.string().trim().min(1).max(200),
}).strict();

export type IllustrationPlaceholderJobSnapshot = {
    id: string;
    status: "queued" | "running" | "completing" | "succeeded" | "failed" | "canceled" | "interrupted" | "configuration_stale" | "outcome_unknown";
    sourceInsertStatus: "not_applicable" | "pending" | "inserted" | "missing";
    /** Job 尚无稳定执行错误时为 null。 */
    stableErrorCode: string | null;
    /** Job 尚无用户可读错误时为 null。 */
    errorMessage: string | null;
    updatedAt: string;
};

export type IllustrationPlaceholderStatusDependencies = {
    /** 只读取当前用户在该 Project/placeholder 下最新的 Route B Job。 */
    readLatestJob(input: {projectPath: string; ownerUserId: number; placeholderId: string}): Promise<IllustrationPlaceholderJobSnapshot | null>;
    /** 校验当前正文/Storyboard/Recipe 引用并返回稳定 button source identity。 */
    readSourceIdentity(input: {projectPath: string; ownerUserId: number; placeholderId: string}): Promise<string>;
};

/** Project SQLite Job 与当前发布事实的唯一 placeholder 状态投影。 */
export class IllustrationPlaceholderStatusService {
    private readonly dependencies: IllustrationPlaceholderStatusDependencies;

    constructor(dependencies: IllustrationPlaceholderStatusDependencies = createProductionDependencies()) {
        this.dependencies = dependencies;
    }

    /** 持久 Job 优先；没有 Job 或最新 Job 已是可再生成终态时，验证当前发布 target，绝不创建 Preview 或写入状态。 */
    async read(rawInput: {projectPath: string; ownerUserId: number; placeholderId: string}): Promise<IllustrationPlaceholderStatus> {
        const input = PlaceholderStatusInputSchema.parse(rawInput);
        const job = await this.dependencies.readLatestJob(input);
        if (job && !isRegenerableTerminalJob(job)) return createJobStatus(input.placeholderId, job);
        try {
            const sourceIdentityHash = TextToImageContractHashSchema.parse(await this.dependencies.readSourceIdentity(input));
            return finalizeStatus({
                placeholderId: input.placeholderId,
                status: "ready",
                sourceIdentityHash,
                job: null,
                errorCode: null,
                errorMessage: null,
            });
        } catch (error) {
            if (error instanceof IllustrationExecutionCompilerError) {
                return finalizeStatus({
                    placeholderId: input.placeholderId,
                    status: "stale",
                    sourceIdentityHash: null,
                    job: null,
                    errorCode: "ILLUSTRATION_PLACEHOLDER_STALE",
                    errorMessage: error.message,
                });
            }
            if (error instanceof TextToImageRecipeNotConfiguredError) {
                return finalizeStatus({
                    placeholderId: input.placeholderId,
                    status: "stale",
                    sourceIdentityHash: null,
                    job: null,
                    errorCode: error.code,
                    errorMessage: error.message,
                });
            }
            throw error;
        }
    }
}

/** 创建生产只读端口；不共享 mutable cache。 */
function createProductionDependencies(): IllustrationPlaceholderStatusDependencies {
    const compiler = new ProductionIllustrationExecutionCompiler();
    return {
        readLatestJob: async (input) => {
            const client = await textToImageProjectClient(input.projectPath);
            const job = await client.textToImageJob.findFirst({
                where: {
                    kind: "illustration",
                    sourceAnchorId: input.placeholderId,
                    providerOwnerUserId: input.ownerUserId,
                },
                orderBy: [{createdAt: "desc"}, {id: "desc"}],
            });
            if (!job) return null;
            return {
                id: job.id,
                status: job.status,
                sourceInsertStatus: job.sourceInsertStatus,
                stableErrorCode: job.stableErrorCode,
                errorMessage: job.errorMessage,
                updatedAt: (job.finishedAt ?? job.startedAt ?? job.createdAt).toISOString(),
            };
        },
        readSourceIdentity: async (input) => (await compiler.readTarget(input)).sourceIdentityHash,
    };
}

/**
 * 无计费不确定性的终态不再永久锁死占位块：正文里仍存在占位块时回退 target 校验，
 * 允许用户显式再次生成（failed/canceled/interrupted 是明确未产出的终态；
 * succeeded+missing 是结果被"还原为占位块"或占位块曾缺席的重roll路径）。
 * outcome_unknown（可能已扣费）与 configuration_stale（凭据已更换）保持冻结七态投影，
 * 不得静默变回 ready——这两态的出路是章节重新规划或配置修复。
 */
function isRegenerableTerminalJob(job: IllustrationPlaceholderJobSnapshot): boolean {
    if (job.status === "succeeded") return job.sourceInsertStatus === "missing";
    return job.status === "failed"
        || job.status === "canceled"
        || job.status === "interrupted";
}

/** 将 Project Job 生命周期收窄到冻结的七态 placeholder 合同。 */
function createJobStatus(placeholderId: string, job: IllustrationPlaceholderJobSnapshot): IllustrationPlaceholderStatus {
    const status: IllustrationPlaceholderState = job.status === "queued"
        ? "queued"
        : job.status === "running" || job.status === "completing"
            ? "running"
            : job.status === "configuration_stale"
                ? "stale"
                : job.status === "outcome_unknown"
                    ? "outcome_unknown"
                    : job.status === "succeeded" && job.sourceInsertStatus !== "missing"
                        ? "running"
                        : "failed";
    return finalizeStatus({
        placeholderId,
        status,
        sourceIdentityHash: null,
        job: {
            jobId: job.id,
            status: job.status,
            sourceInsertStatus: job.sourceInsertStatus,
            errorCode: job.stableErrorCode,
            errorMessage: job.errorMessage,
            updatedAt: job.updatedAt,
        },
        errorCode: job.stableErrorCode,
        errorMessage: job.errorMessage,
    });
}

/** stateHash 覆盖完整公开投影，浏览器只用它使短期 Preview cache 失效。 */
function finalizeStatus(input: Omit<IllustrationPlaceholderStatus, "schemaVersion" | "stateHash">): IllustrationPlaceholderStatus {
    const stateHash = hashTextToImageContract({
        schemaVersion: ILLUSTRATION_PLACEHOLDER_STATUS_VERSION,
        ...input,
    });
    return IllustrationPlaceholderStatusSchema.parse({
        schemaVersion: ILLUSTRATION_PLACEHOLDER_STATUS_VERSION,
        ...input,
        stateHash,
    });
}

let productionService: IllustrationPlaceholderStatusService | null = null;

/** Nitro API 共用无状态 service 实例。 */
export function getIllustrationPlaceholderStatusService(): IllustrationPlaceholderStatusService {
    productionService ??= new IllustrationPlaceholderStatusService();
    return productionService;
}
