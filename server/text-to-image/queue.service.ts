import {randomUUID} from "node:crypto";
import {consola} from "consola";
import type {TextToImageJob} from "nbook/server/generated/project-prisma/client";
import type {
    TextToImageAssetDto,
    TextToImageJobDto,
    TextToImageJobKind,
    TextToImageJobPageDto,
} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {TextToImageChapterService} from "nbook/server/text-to-image/chapter.service";
import {requestNovelAiImages} from "nbook/server/text-to-image/novelai-image-generation";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";

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
};

export type EnqueueTextToImageJobInput = {
    projectPath: string;
    providerId: number;
    kind: TextToImageJobKind;
    prompt: string;
    negativePrompt: string;
    novelAi: TextToImageNovelAiInput;
    sourcePath?: string | null;
    sourceAnchorId?: string | null;
};

type PersistedRequest = Omit<EnqueueTextToImageJobInput, "projectPath" | "providerId" | "kind" | "sourcePath" | "sourceAnchorId">;

type QueueImage = {
    bytes: Uint8Array;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    width: number;
    height: number;
    seed: number;
};

type QueueDependencies = {
    resolveProvider: (providerId: number) => Promise<{credential: string; model: string; requestIntervalMs: number}>;
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
    }) => Promise<{id: string; asset?: TextToImageAssetDto}>;
    /** 正文任务首张资产写入后替换规范占位符；失败不会回滚生成成功状态。 */
    replaceBodyPrompt?: (input: {
        projectPath: string;
        chapterPath: string;
        promptId: string;
        asset: TextToImageAssetDto;
    }) => Promise<"inserted" | "missing">;
    /** 供测试替换等待策略；生产环境使用计时器。 */
    wait?: (milliseconds: number) => Promise<void>;
};

type QueueLane = {
    jobIds: string[];
    running: boolean;
    controllers: Map<string, AbortController>;
    lastRequestStartedAt: number;
};

const lanes = new Map<string, QueueLane>();
const MAX_REMOTE_RETRIES = 2;
const RETRY_BACKOFF_MS = 1_000;

/** Project 持久化文生图队列。任务状态先落 SQLite，再进入每 Provider 的串行 lane。 */
export class TextToImageQueueService {
    constructor(private readonly dependencies: QueueDependencies) {}

    /** 创建并持久化 queued 任务，随后异步调度，不在调用方请求内等待生成完成。 */
    async enqueue(input: EnqueueTextToImageJobInput): Promise<TextToImageJobDto> {
        const client = await textToImageProjectClient(input.projectPath);
        const job = await client.textToImageJob.create({
            data: {
                id: randomUUID(),
                providerId: input.providerId,
                kind: input.kind,
                status: "queued",
                sourcePath: input.sourcePath ?? null,
                sourceAnchorId: input.sourceAnchorId ?? null,
                sourceInsertStatus: input.kind === "body" && input.sourceAnchorId ? "pending" : "not_applicable",
                requestJson: JSON.stringify({
                    prompt: input.prompt,
                    negativePrompt: input.negativePrompt,
                    novelAi: input.novelAi,
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
        const job = await client.textToImageJob.findUnique({where: {id: jobId}});
        if (!job) {
            throw new Error("文生图任务不存在");
        }
        if (job.status !== "queued" && job.status !== "running") {
            return jobDto(job);
        }
        const lane = lanes.get(`${projectPath}:${job.providerId}`);
        lane?.controllers.get(job.id)?.abort();
        return jobDto(await client.textToImageJob.update({
            where: {id: job.id},
            data: {status: "canceled", finishedAt: new Date()},
        }));
    }

    /** 由用户显式重试历史失败任务，创建新记录而不改写原任务。 */
    async retry(projectPath: string, jobId: string): Promise<TextToImageJobDto> {
        const client = await textToImageProjectClient(projectPath);
        const previous = await client.textToImageJob.findUnique({where: {id: jobId}});
        if (!previous) {
            throw new Error("文生图任务不存在");
        }
        if (previous.status !== "failed" && previous.status !== "interrupted" && previous.status !== "canceled") {
            throw new Error("只有失败、中断或已取消的文生图任务可以重试");
        }
        const retry = await client.textToImageJob.create({
            data: {
                id: randomUUID(),
                providerId: previous.providerId,
                kind: "reroll",
                status: "queued",
                sourcePath: previous.sourcePath,
                sourceAnchorId: previous.sourceAnchorId,
                sourceInsertStatus: previous.sourceInsertStatus,
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
            where: {status: "running"},
            data: {status: "interrupted", finishedAt: new Date()},
        });
        const queuedJobs = await client.textToImageJob.findMany({
            where: {status: "queued"},
            select: {id: true, providerId: true},
            orderBy: [{createdAt: "asc"}, {id: "asc"}],
        });
        for (const job of queuedJobs) {
            this.schedule(projectPath, job.providerId, job.id);
        }
    }

    private schedule(projectPath: string, providerId: number, jobId: string): void {
        const key = `${projectPath}:${providerId}`;
        const lane: QueueLane = lanes.get(key) ?? {jobIds: [], running: false, controllers: new Map(), lastRequestStartedAt: 0};
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
        if (!job || job.status !== "queued") {
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

            const current = await client.textToImageJob.findUnique({where: {id: job.id}, select: {status: true}});
            if (!current || (current.status !== "queued" && current.status !== "running")) {
                return;
            }
            const active = await client.textToImageJob.update({
                where: {id: job.id},
                data: {status: "running", startedAt: new Date(), attemptCount: {increment: 1}, errorMessage: null},
            });
            const controller = new AbortController();
            const lane = lanes.get(`${projectPath}:${providerId}`);
            lane?.controllers.set(active.id, controller);
            try {
                const response = await this.dependencies.requestImages({
                    ...request,
                    novelAi: {...request.novelAi, model: provider.model},
                }, provider.credential, controller.signal);
                const assetIds: string[] = [];
                const savedAssets: Array<{id: string; asset?: TextToImageAssetDto}> = [];
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
                    savedAssets.push(asset);
                }
                let sourceInsertStatus = active.sourceInsertStatus;
                if (active.kind === "body" && active.sourcePath && active.sourceAnchorId && assetIds[0]) {
                    const firstAsset = savedAssets[0]?.asset;
                    if (firstAsset && this.dependencies.replaceBodyPrompt) {
                        try {
                            sourceInsertStatus = await this.dependencies.replaceBodyPrompt({
                                projectPath,
                                chapterPath: active.sourcePath,
                                promptId: active.sourceAnchorId,
                                asset: firstAsset,
                            });
                        } catch (error) {
                            consola.warn({projectPath, jobId: active.id, error}, "正文图片已生成，但占位符替换失败");
                            sourceInsertStatus = "missing";
                        }
                    } else {
                        sourceInsertStatus = "missing";
                    }
                }
                await client.textToImageJob.update({
                    where: {id: active.id},
                    data: {status: "succeeded", finishedAt: new Date(), resultAssetIdsJson: JSON.stringify(assetIds), sourceInsertStatus},
                });
                return;
            } catch (error) {
                const current = await client.textToImageJob.findUnique({where: {id: active.id}});
                if (current?.status === "canceled") {
                    return;
                }
                if (retries < MAX_REMOTE_RETRIES && isRetryableRemoteError(error)) {
                    retries += 1;
                    await this.wait(RETRY_BACKOFF_MS * 2 ** (retries - 1));
                    continue;
                }
                await this.markFailed(client, active.id, error);
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
        const safeInterval = Math.max(0, Math.floor(interval));
        const elapsed = Date.now() - lane.lastRequestStartedAt;
        if (lane.lastRequestStartedAt > 0 && elapsed < safeInterval) {
            await this.wait(safeInterval - elapsed);
        }
        lane.lastRequestStartedAt = Date.now();
    }

    /** 将最终失败状态写回 Project 数据库，错误内容仅保留可展示的短文本。 */
    private async markFailed(client: Awaited<ReturnType<typeof textToImageProjectClient>>, jobId: string, error: unknown): Promise<void> {
        await client.textToImageJob.update({
            where: {id: jobId},
            data: {status: "failed", finishedAt: new Date(), errorMessage: safeErrorMessage(error)},
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
    const chapters = new TextToImageChapterService();
    return new TextToImageQueueService({
        async resolveProvider(providerId) {
            const resolved = await providers.resolveCredential(userId, providerId);
            if (resolved.provider.kind !== "novelai") {
                throw new Error("当前 Provider 不支持 NovelAI 图片生成");
            }
            return {
                credential: resolved.credential,
                model: resolved.provider.model,
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
            return {id: asset.id, asset};
        },
        async replaceBodyPrompt(input) {
            return chapters.replacePrompt(input);
        },
    });
}

function parsePersistedRequest(input: string): PersistedRequest {
    const parsed: unknown = JSON.parse(input);
    if (!isPersistedRequest(parsed)) {
        throw new Error("文生图任务请求数据不合法");
    }
    return parsed;
}

function isPersistedRequest(value: unknown): value is PersistedRequest {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as {prompt?: unknown; negativePrompt?: unknown; novelAi?: unknown};
    return typeof candidate.prompt === "string"
        && typeof candidate.negativePrompt === "string"
        && typeof candidate.novelAi === "object"
        && candidate.novelAi !== null;
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
