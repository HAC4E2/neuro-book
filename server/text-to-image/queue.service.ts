import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {consola} from "consola";
import {z} from "zod";
import type {TextToImageJob} from "nbook/server/generated/project-prisma/client";
import type {
    TextToImageJobDto,
    TextToImageJobPageDto,
    TextToImageProviderSnapshotDto,
} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {requestNovelAiImages} from "nbook/server/text-to-image/novelai-image-generation";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";
import {
    TextToImageRecipeSnapshotSchema,
    TextToImageRecipeStyleSchema,
    getActiveTextToImageRecipeStyle,
    type TextToImageRecipeStyle,
    type TextToImageRecipeSnapshot,
    type TextToImageRecipeSource,
} from "nbook/shared/text-to-image-recipe";

export type TextToImageNovelAiInput = {
    model: string;
    sampler: string;
    noiseSchedule: string;
    promptGuidance: number;
    promptGuidanceRescale: number;
    width: number;
    height: number;
    steps: number;
    seed: number;
    count: number;
    aiDefaultCharacterPosition: boolean;
    variety: boolean;
    smeaMode: "auto" | "off" | "on";
    smeaDyn: boolean;
    decrisper: boolean;
};

export type EnqueueTextToImageJobInput = {
    projectPath: string;
    providerId: number;
    kind: "manual";
    prompt: string;
    negativePrompt: string;
    novelAi: TextToImageNovelAiInput;
    style: TextToImageRecipeStyle;
    recipeSnapshot: TextToImageRecipeSnapshot;
    sourcePath?: string | null;
    sourceAnchorId?: string | null;
};

const PersistedRequestSchema = z.object({
    prompt: z.string(),
    negativePrompt: z.string(),
    novelAi: z.object({
        model: z.string().trim().min(1),
        sampler: z.string().trim().min(1),
        noiseSchedule: z.string().trim().min(1),
        promptGuidance: z.number(),
        promptGuidanceRescale: z.number(),
        width: z.number().int().min(64).max(4096),
        height: z.number().int().min(64).max(4096),
        steps: z.number().int().min(1).max(50),
        seed: z.number().int().min(-1),
        count: z.number().int().min(1).max(4),
        aiDefaultCharacterPosition: z.boolean(),
        variety: z.boolean(),
        smeaMode: z.enum(["auto", "off", "on"]),
        smeaDyn: z.boolean(),
        decrisper: z.boolean(),
    }).strict(),
    style: TextToImageRecipeStyleSchema,
    recipeSnapshot: TextToImageRecipeSnapshotSchema,
}).strict();

type PersistedRequest = z.infer<typeof PersistedRequestSchema>;

type QueueImage = {
    bytes: Uint8Array;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    width: number;
    height: number;
    seed: number;
};

type QueueDependencies = {
    /** 在任何 Project Job 写入前确认 owner-scoped singleton，并返回脱敏快照。 */
    assertProviderReady: (providerId: number) => Promise<TextToImageProviderSnapshotDto>;
    resolveProvider: (providerId: number) => Promise<{credential: string; requestIntervalMs: number}>;
    requestImages: (input: PersistedRequest, credential: string, signal: AbortSignal) => Promise<{
        images: QueueImage[];
        request: {model: string; seed: number};
        warnings: string[];
    }>;
    saveAsset: (input: {
        projectPath: string;
        jobId: string;
        image: QueueImage;
        model: string;
        prompt: string;
        negativePrompt: string;
        sourceKind: string;
        sourcePath: string | null;
        sourceAnchorId: string | null;
    }) => Promise<{id: string}>;
    /** 补偿删除尚未交付给正文或成功 Job 的资产，避免批量保存中途失败留下孤儿记录。 */
    deleteAsset: (projectPath: string, assetId: string) => Promise<void>;
    /** 供测试替换等待策略；生产环境使用计时器。 */
    wait?: (milliseconds: number) => Promise<void>;
};

type QueueLane = {
    providerId: number;
    jobIds: string[];
    running: boolean;
    controllers: Map<string, AbortController>;
    lastRequestStartedAt: number;
};

const lanes = new Map<string, QueueLane>();
const MAX_REMOTE_RETRIES = 2;
const RETRY_BACKOFF_MS = 1_000;

/**
 * Provider reconciliation 在 Project Job 已持久化为终态后中止对应的进程内远端 attempt。
 * Queue catch 会观察数据库终态并停止回写或自动重试。
 */
export function abortTextToImageProviderAttempts(providerIds: number[]): void {
    const discarded = new Set(providerIds);
    for (const lane of lanes.values()) {
        if (!discarded.has(lane.providerId)) {
            continue;
        }
        lane.jobIds.splice(0);
        for (const controller of lane.controllers.values()) {
            controller.abort();
        }
    }
}

/** Project 持久化文生图队列。任务状态先落 SQLite，再进入每 Provider 的串行 lane。 */
export class TextToImageQueueService {
    constructor(private readonly dependencies: QueueDependencies) {}

    /** 创建并持久化 queued 任务，随后异步调度，不在调用方请求内等待生成完成。 */
    async enqueue(input: EnqueueTextToImageJobInput): Promise<TextToImageJobDto> {
        assertRecipeCompiledRequest(input);
        const providerSnapshot = await this.dependencies.assertProviderReady(input.providerId);
        const client = await textToImageProjectClient(input.projectPath);
        const job = await client.textToImageJob.create({
            data: {
                id: randomUUID(),
                providerId: input.providerId,
                kind: input.kind,
                status: "queued",
                sourcePath: input.sourcePath ?? null,
                sourceAnchorId: input.sourceAnchorId ?? null,
                sourceInsertStatus: "not_applicable",
                providerSnapshotJson: JSON.stringify(providerSnapshot),
                requestJson: JSON.stringify({
                    prompt: input.prompt,
                    negativePrompt: input.negativePrompt,
                    novelAi: input.novelAi,
                    style: input.style,
                    recipeSnapshot: input.recipeSnapshot,
                }),
                resultAssetIdsJson: "[]",
            },
        });
        this.schedule(input.projectPath, job.providerId, job.id);
        return jobDto(job);
    }

    /** 稳定时间倒序列出当前 Project 的任务摘要。 */
    async list(input: {projectPath: string; status?: TextToImageJobDto["status"]; page?: number; pageSize?: number}): Promise<TextToImageJobPageDto> {
        const client = await textToImageProjectClient(input.projectPath);
        const page = Math.max(1, Math.floor(input.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 30)));
        const jobs = await client.textToImageJob.findMany({
            where: {status: input.status},
            orderBy: [{createdAt: "desc"}, {id: "desc"}],
            skip: (page - 1) * pageSize,
            take: pageSize + 1,
        });
        return {
            items: jobs.slice(0, pageSize).map(jobDto),
            page,
            pageSize,
            hasMore: jobs.length > pageSize,
        };
    }

    /** 取消 queued 或 running 任务；运行中请求会收到 AbortSignal。 */
    async cancel(projectPath: string, jobId: string): Promise<TextToImageJobDto> {
        const client = await textToImageProjectClient(projectPath);
        // illustration Job 由持久 Provider lane 的 lease/attempt fence 管理，旧队列直接翻状态会绕过完成权 CAS。
        const canceled = await client.textToImageJob.updateMany({
            where: {id: jobId, kind: {not: "illustration"}, status: {in: ["queued", "running"]}},
            data: {status: "canceled", finishedAt: new Date()},
        });
        const job = await client.textToImageJob.findUnique({where: {id: jobId}});
        if (!job) {
            throw new Error("文生图任务不存在");
        }
        if (job.kind === "illustration") {
            throw new Error("插图任务由持久 Provider lane 管理，不能从旧队列取消。");
        }
        if (canceled.count === 1) {
            const lane = lanes.get(`${projectPath}:${job.providerId}`);
            lane?.controllers.get(job.id)?.abort();
        }
        return jobDto(job);
    }

    /** 由用户显式重试历史失败任务，创建新记录而不改写原任务。 */
    async retry(projectPath: string, jobId: string): Promise<TextToImageJobDto> {
        const client = await textToImageProjectClient(projectPath);
        const previous = await client.textToImageJob.findUnique({where: {id: jobId}});
        if (!previous) {
            throw new Error("文生图任务不存在");
        }
        if (previous.kind === "illustration") {
            throw new Error("插图任务不走旧队列重试；请在正文占位块或资产详情使用“还原并重新生成”。");
        }
        if (previous.status !== "failed" && previous.status !== "interrupted" && previous.status !== "canceled") {
            throw new Error("只有失败、中断或已取消的文生图任务可以重试");
        }
        const providerSnapshot = await this.dependencies.assertProviderReady(previous.providerId);
        const retry = await client.textToImageJob.create({
            data: {
                id: randomUUID(),
                providerId: previous.providerId,
                kind: "reroll",
                status: "queued",
                sourcePath: previous.sourcePath,
                sourceAnchorId: previous.sourceAnchorId,
                sourceInsertStatus: previous.sourceInsertStatus,
                providerSnapshotJson: JSON.stringify(providerSnapshot),
                requestJson: previous.requestJson,
                resultAssetIdsJson: "[]",
            },
        });
        this.schedule(projectPath, retry.providerId, retry.id);
        return jobDto(retry);
    }

    /** Project 重新打开后的恢复：不确定是否提交成功的 running 任务只标记中断，queued 任务重新调度。 */
    async recoverProject(projectPath: string): Promise<void> {
        const client = await textToImageProjectClient(projectPath);
        await client.textToImageJob.updateMany({
            where: {kind: {not: "illustration"}, status: {in: ["running", "completing"]}},
            data: {status: "interrupted", finishedAt: new Date()},
        });
        const queuedJobs = await client.textToImageJob.findMany({
            where: {kind: {not: "illustration"}, status: "queued"},
            select: {id: true, providerId: true},
            orderBy: [{createdAt: "asc"}, {id: "asc"}],
        });
        for (const job of queuedJobs) {
            this.schedule(projectPath, job.providerId, job.id);
        }
    }

    private schedule(projectPath: string, providerId: number, jobId: string): void {
        const key = `${projectPath}:${providerId}`;
        const lane: QueueLane = lanes.get(key) ?? {providerId, jobIds: [], running: false, controllers: new Map(), lastRequestStartedAt: 0};
        lane.jobIds.push(jobId);
        lanes.set(key, lane);
        setTimeout(() => {
            void this.runLane(projectPath, providerId, lane).catch(() => {
                consola.debug({projectPath, providerId}, "文生图队列 lane 已在 Project 关闭后停止");
            });
        }, 0);
    }

    private async runLane(projectPath: string, providerId: number, lane: QueueLane): Promise<void> {
        if (lane.running) {
            return;
        }
        lane.running = true;
        try {
            while (lane.jobIds.length > 0) {
                const jobId = lane.jobIds.shift();
                if (!jobId) {
                    continue;
                }
                await this.runJob(projectPath, providerId, jobId);
            }
        } finally {
            lane.running = false;
        }
    }

    private async runJob(projectPath: string, providerId: number, jobId: string): Promise<void> {
        const client = await textToImageProjectClient(projectPath);
        const job = await client.textToImageJob.findUnique({where: {id: jobId}});
        if (!job || job.kind === "illustration" || job.status !== "queued") {
            return;
        }
        const request = parsePersistedRequest(job.requestJson);
        let retries = 0;
        while (true) {
            let provider: Awaited<ReturnType<QueueDependencies["resolveProvider"]>>;
            try {
                provider = await this.dependencies.resolveProvider(providerId);
                await this.waitForProviderInterval(projectPath, providerId, provider.requestIntervalMs);
            } catch (error) {
                await this.markFailed(client, job.id, error);
                return;
            }

            const claimed = await client.textToImageJob.updateMany({
                where: {id: job.id, status: {in: ["queued", "running"]}},
                data: {status: "running", startedAt: new Date(), attemptCount: {increment: 1}, errorMessage: null},
            });
            if (claimed.count !== 1) {
                return;
            }
            const active = await client.textToImageJob.findUnique({where: {id: job.id}});
            if (!active || active.status !== "running") {
                return;
            }
            const controller = new AbortController();
            const lane = lanes.get(`${projectPath}:${providerId}`);
            lane?.controllers.set(active.id, controller);
            const assetIds: string[] = [];
            let assetBatchComplete = false;
            try {
                const response = await this.dependencies.requestImages(request, provider.credential, controller.signal);
                const completionClaim = await client.textToImageJob.updateMany({
                    where: {id: active.id, status: "running"},
                    data: {status: "completing"},
                });
                if (completionClaim.count !== 1) {
                    return;
                }
                for (const image of response.images) {
                    const asset = await this.dependencies.saveAsset({
                        projectPath,
                        jobId: active.id,
                        image,
                        model: response.request.model,
                        prompt: request.prompt,
                        negativePrompt: request.negativePrompt,
                        sourceKind: active.kind,
                        sourcePath: active.sourcePath,
                        sourceAnchorId: active.sourceAnchorId,
                    });
                    assetIds.push(asset.id);
                }
                assetBatchComplete = true;
                const completed = await client.textToImageJob.updateMany({
                    where: {id: active.id, status: "completing"},
                    data: {status: "succeeded", finishedAt: new Date(), resultAssetIdsJson: JSON.stringify(assetIds)},
                });
                if (completed.count !== 1) {
                    throw new Error("文生图任务完成状态已变化");
                }
                return;
            } catch (error) {
                const current = await client.textToImageJob.findUnique({where: {id: active.id}});
                if (!current || (current.status !== "queued" && current.status !== "running" && current.status !== "completing")) {
                    return;
                }
                if (current.status === "running" && retries < MAX_REMOTE_RETRIES && isRetryableRemoteError(error)) {
                    retries += 1;
                    await this.wait(RETRY_BACKOFF_MS * 2 ** (retries - 1));
                    continue;
                }
                let retainedAssetIds = assetIds;
                if (current.status === "completing" && !assetBatchComplete && assetIds.length > 0) {
                    retainedAssetIds = [];
                    for (const assetId of [...assetIds].reverse()) {
                        try {
                            await this.dependencies.deleteAsset(projectPath, assetId);
                        } catch (deleteError) {
                            retainedAssetIds.unshift(assetId);
                            consola.warn({projectPath, jobId: active.id, assetId, error: deleteError}, "批量图片保存失败后补偿删除资产失败");
                        }
                    }
                }
                await this.markFailed(client, active.id, error, retainedAssetIds);
                return;
            } finally {
                lane?.controllers.delete(active.id);
            }
        }
    }

    /** 同一 Project / Provider 只允许按 Provider 配置的间隔启动远程请求。 */
    private async waitForProviderInterval(projectPath: string, providerId: number, interval: number): Promise<void> {
        const lane = lanes.get(`${projectPath}:${providerId}`);
        if (!lane) {
            return;
        }
        const safeInterval = Math.max(15_000, Math.floor(interval));
        const elapsed = Date.now() - lane.lastRequestStartedAt;
        if (lane.lastRequestStartedAt > 0 && elapsed < safeInterval) {
            await this.wait(safeInterval - elapsed);
        }
        lane.lastRequestStartedAt = Date.now();
    }

    /** 将最终失败状态写回 Project 数据库，错误内容仅保留可展示的短文本。 */
    private async markFailed(client: Awaited<ReturnType<typeof textToImageProjectClient>>, jobId: string, error: unknown, resultAssetIds: string[] = []): Promise<void> {
        await client.textToImageJob.updateMany({
            where: {id: jobId, status: {in: ["queued", "running", "completing"]}},
            data: {status: "failed", finishedAt: new Date(), errorMessage: safeErrorMessage(error), resultAssetIdsJson: JSON.stringify(resultAssetIds)},
        });
    }

    private async wait(milliseconds: number): Promise<void> {
        if (this.dependencies.wait) {
            await this.dependencies.wait(milliseconds);
            return;
        }
        await new Promise<void>((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }
}

/** 为当前登录用户创建队列执行器；凭据只在 provider 调用前从应用数据库解密。 */
export function createTextToImageQueueService(userId: number): TextToImageQueueService {
    const providers = new TextToImageProviderService();
    const assets = new TextToImageAssetService();
    return new TextToImageQueueService({
        async assertProviderReady(providerId) {
            return await providers.assertNovelAiReady(userId, providerId);
        },
        async resolveProvider(providerId) {
            const resolved = await providers.resolveNovelAiCredential(userId, providerId);
            return {
                credential: resolved.credential,
                requestIntervalMs: resolved.provider.settings.requestIntervalMs,
            };
        },
        requestImages: requestNovelAiImages,
        async saveAsset(input) {
            const asset = await assets.save({
                projectPath: input.projectPath,
                jobId: input.jobId,
                bytes: input.image.bytes,
                mimeType: input.image.mimeType,
                width: input.image.width,
                height: input.image.height,
                model: input.model,
                seed: input.image.seed,
                prompt: input.prompt,
                negativePrompt: input.negativePrompt,
                sourceKind: input.sourceKind,
                sourcePath: input.sourcePath,
                sourceAnchorId: input.sourceAnchorId,
            });
            return {id: asset.id};
        },
        async deleteAsset(projectPath, assetId) {
            await assets.delete(projectPath, assetId);
        },
    });
}

function parsePersistedRequest(input: string): PersistedRequest {
    const parsed: unknown = JSON.parse(input);
    const request = PersistedRequestSchema.parse(parsed);
    assertRecipeCompiledRequest(request);
    return request;
}

/** 防止任何未来内部入口绕过 Recipe service，伪造 model/采样/尺寸/画风或 snapshot hash。 */
function assertRecipeCompiledRequest(request: PersistedRequest): void {
    // 手工 PersistedRequest 不携带参考资源：Recipe 含任何参考选择时 fail-closed，杜绝静默丢弃。
    if (request.recipeSnapshot.references.vibeReferences.length > 0
        || request.recipeSnapshot.references.characterReferences.length > 0
        || request.recipeSnapshot.references.inpaint !== null) {
        throw new Error("手工 Job 的 Recipe snapshot 不允许携带参考资源");
    }
    const {planningConstraintsHash: _planningHash, recipeSourceHash: _sourceHash, ...source} = request.recipeSnapshot;
    const canonical = createTextToImageRecipeSnapshot(source);
    if (canonical.planningConstraintsHash !== request.recipeSnapshot.planningConstraintsHash
        || canonical.recipeSourceHash !== request.recipeSnapshot.recipeSourceHash) {
        throw new Error("Recipe snapshot hash 与 source 不一致");
    }
    const expectedNovelAi: Omit<TextToImageNovelAiInput, "count" | "seed"> = {
        model: canonical.model,
        sampler: canonical.sampler,
        noiseSchedule: canonical.noiseSchedule,
        promptGuidance: canonical.promptGuidance,
        promptGuidanceRescale: canonical.promptGuidanceRescale,
        width: canonical.dimensions.fixed.width,
        height: canonical.dimensions.fixed.height,
        steps: canonical.steps,
        aiDefaultCharacterPosition: canonical.advanced.aiDefaultCharacterPosition,
        variety: canonical.advanced.variety,
        smeaMode: canonical.advanced.smeaMode,
        smeaDyn: canonical.advanced.smeaDyn,
        decrisper: canonical.advanced.decrisper,
    };
    const {count: _count, seed: actualSeed, ...actualNovelAi} = request.novelAi;
    const seedMatches = canonical.seed.policy === "fixed"
        ? actualSeed === canonical.seed.fixed
        : Number.isInteger(actualSeed) && actualSeed >= 0 && actualSeed <= 4_294_967_295;
    if (!isDeepStrictEqual(actualNovelAi, expectedNovelAi)
        || !seedMatches
        || !isDeepStrictEqual(request.style, getActiveTextToImageRecipeStyle(canonical))) {
        throw new Error("内部编译参数与 Recipe snapshot 不一致");
    }
}

function safeErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : "文生图请求失败";
    return raw.replace(/[\r\n\t]/gu, " ").slice(0, 500);
}

function isRetryableRemoteError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
        return false;
    }
    if (error instanceof Error && error.name === "AbortError") {
        return false;
    }
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
        ? error.status
        : Number((error instanceof Error ? error.message : "").match(/\b([45]\d{2})\b/u)?.[1]);
    if (Number.isInteger(status)) {
        return status === 429 || status >= 500;
    }
    return error instanceof TypeError;
}

function jobDto(job: TextToImageJob): TextToImageJobDto {
    return {
        id: job.id,
        providerId: job.providerId,
        kind: job.kind,
        status: job.status,
        sourcePath: job.sourcePath,
        sourceAnchorId: job.sourceAnchorId,
        sourceInsertStatus: job.sourceInsertStatus,
        resultAssetIds: parseAssetIds(job.resultAssetIdsJson),
        errorMessage: job.errorMessage,
        attemptCount: job.attemptCount,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
    };
}

function parseAssetIds(input: string): string[] {
    try {
        const value: unknown = JSON.parse(input);
        return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
    } catch {
        return [];
    }
}
