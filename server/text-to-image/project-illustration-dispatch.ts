import type {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {
    IllustrationCompiledRequestSchema,
    type IllustrationCompiledRequest,
} from "nbook/shared/text-to-image-execution";
import {
    ProviderLaneItemSnapshotSchema,
    type ProviderLaneItemSnapshot,
} from "nbook/shared/text-to-image-dispatch";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {TextToImageChapterService} from "nbook/server/text-to-image/chapter.service";
import {ILLUSTRATION_DISPATCH_REGISTRATION_VERSION} from "nbook/server/text-to-image/execution.repository";
import type {
    IllustrationDispatchPreflight,
    IllustrationDispatchProjectPort,
} from "nbook/server/text-to-image/illustration-dispatch.worker";
import {IllustrationResultService} from "nbook/server/text-to-image/illustration-result.service";
import {
    NovelAiHttpError,
    requestCompiledNovelAiImage,
    type CompiledNovelAiResponse,
    type CompiledNovelAiReferenceResolver,
} from "nbook/server/text-to-image/novelai-image-generation";
import type {ProviderLaneDispatchResult} from "nbook/server/text-to-image/provider-lane.worker";
import type {ExpiredAttemptResolution} from "nbook/server/text-to-image/provider-lane.repository";
import {withEphemeralTextToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import fs from "node:fs/promises";

type ProjectRunner = <T>(projectPath: string, operation: (client: PrismaClient) => Promise<T>) => Promise<T>;

type ImageRequester = (
    request: IllustrationCompiledRequest,
    credential: string,
    signal: AbortSignal,
    resolver?: CompiledNovelAiReferenceResolver,
) => Promise<CompiledNovelAiResponse>;

export type ProjectResultWriteInput = {
    client: PrismaClient;
    item: ProviderLaneItemSnapshot;
    request: IllustrationCompiledRequest;
    response: CompiledNovelAiResponse;
};

type ResultWriter = (input: ProjectResultWriteInput) => Promise<"completed" | "outcome_unknown">;

/**
 * P5 生产参考资产解析器：按 contentHash 读取 source-image 字节，
 * Vibe encoding 按 sourceContentHash+model+informationExtracted 缓存读写。
 */
export function createProjectNovelAiReferenceResolver(projectPath: string): CompiledNovelAiReferenceResolver {
    const service = new TextToImageReferenceAssetService();
    return {
        readBytes: async (contentHash) => {
            const map = await service.readByContentHashes(projectPath, [contentHash]);
            const dto = map.get(contentHash);
            if (!dto) throw new Error(`参考资产 contentHash=${contentHash} 不存在`);
            const content = await service.content(projectPath, dto.id);
            return {bytes: new Uint8Array(await fs.readFile(content.absolutePath)), mimeType: content.mimeType};
        },
        findVibeEncoding: async (sourceContentHash, model, informationExtracted) => {
            const sourceMap = await service.readByContentHashes(projectPath, [sourceContentHash]);
            const source = sourceMap.get(sourceContentHash);
            if (!source) return null;
            const encoding = await service.findVibeEncoding({
                projectPath,
                sourceAssetId: source.id,
                model,
                infoExtracted: informationExtracted,
            });
            if (!encoding) return null;
            const content = await service.content(projectPath, encoding.id);
            return new Uint8Array(await fs.readFile(content.absolutePath));
        },
        storeVibeEncoding: async (sourceContentHash, model, informationExtracted, encodingBytes) => {
            const sourceMap = await service.readByContentHashes(projectPath, [sourceContentHash]);
            const source = sourceMap.get(sourceContentHash);
            if (!source) throw new Error(`派生 Vibe encoding 源资产 contentHash=${sourceContentHash} 不存在`);
            await service.upload({
                projectPath,
                bytes: encodingBytes,
                mimeType: "application/octet-stream",
                kind: "vibe-encoding",
                parentAssetId: source.id,
                derivedModel: model,
                derivedInfoExtracted: informationExtracted,
            });
        },
    };
}

type DispatchOptions = {
    runProject?: ProjectRunner;
    requestImage?: ImageRequester;
    writeResult?: ResultWriter;
    signalFactory?: () => AbortSignal;
};

class ProjectDispatchValidationError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROJECT_JOB_STALE";

    constructor(message: string) {
        super(message);
        this.name = "ProjectDispatchValidationError";
    }
}

/** 生产 Project port：短连接复验、strict adapter、Asset/Markdown/result 写回均不依赖打开 Project。 */
export class ProjectIllustrationDispatch implements IllustrationDispatchProjectPort {
    private readonly runProject: ProjectRunner;
    private readonly requestImage: ImageRequester;
    private readonly writeResult: ResultWriter;
    private readonly signalFactory: () => AbortSignal;

    constructor(options: DispatchOptions = {}) {
        this.runProject = options.runProject ?? withEphemeralTextToImageProjectClient;
        // requestCompiledNovelAiImage 的第 4 参是 fetchImpl、第 5 参才是 resolver；
        // ImageRequester 端口不暴露 fetch 注入，这里必须显式占住 fetchImpl 位，否则 resolver 会被当成 fetch 调用。
        this.requestImage = options.requestImage
            ?? ((request, credential, signal, resolver) => requestCompiledNovelAiImage(request, credential, signal, undefined, resolver));
        this.writeResult = options.writeResult ?? writeProjectResult;
        this.signalFactory = options.signalFactory ?? (() => new AbortController().signal);
    }

    async preflight(itemInput: ProviderLaneItemSnapshot): Promise<IllustrationDispatchPreflight> {
        const item = ProviderLaneItemSnapshotSchema.parse(itemInput);
        try {
            await this.runProject(item.projectPath, async (client) => {
                await validateProjectClosure(client, item, "queued");
                if (item.state === "retry_leased") {
                    await clearRetryEvidence(client, item);
                }
            });
            return {kind: "valid"};
        } catch (error) {
            return {
                kind: "invalid",
                code: error instanceof ProjectDispatchValidationError ? error.code : "TEXT_TO_IMAGE_PROJECT_UNAVAILABLE",
                message: error instanceof Error ? error.message : "Project dispatch preflight 失败",
            };
        }
    }

    /** 凭据在 paid boundary 前不可用时，先终结 Project Job；失败会让 App claim 保持可恢复。 */
    async configurationError(itemInput: ProviderLaneItemSnapshot, code: string, message: string): Promise<void> {
        const item = ProviderLaneItemSnapshotSchema.parse(itemInput);
        await this.runProject(item.projectPath, async (client) => {
            await validateProjectClosure(client, item, "queued");
            const updated = await client.textToImageJob.updateMany({
                where: {
                    id: item.jobId,
                    status: "queued",
                    activeAttemptId: null,
                    activeAttemptFence: null,
                },
                data: {
                    status: "configuration_stale",
                    stableErrorCode: code,
                    errorMessage: message,
                    finishedAt: new Date(),
                },
            });
            if (updated.count !== 1) {
                const current = await client.textToImageJob.findUnique({where: {id: item.jobId}});
                if (current?.status === "configuration_stale"
                    && current.stableErrorCode === code
                    && current.errorMessage === message) return;
                throw new ProjectDispatchValidationError("Project Job 配置错误终态 CAS 失败");
            }
        });
    }

    /** attempt_started 后再次复验并把所有明确/不明确出口镜像到 Project Job。 */
    async execute(itemInput: ProviderLaneItemSnapshot, credential: string): Promise<ProviderLaneDispatchResult> {
        const item = ProviderLaneItemSnapshotSchema.parse(itemInput);
        if (item.state !== "attempt_started" || !item.sendAttemptId || item.sendFence === null) {
            return {kind: "outcome_unknown", message: "缺少持久化 send attempt/fence"};
        }
        return await this.runProject(item.projectPath, async (client) => {
            const request = await validateProjectClosure(client, item, "queued");
            const running = await client.textToImageJob.updateMany({
                where: {id: item.jobId, kind: "illustration", status: "queued", activeAttemptId: null, activeAttemptFence: null},
                data: {
                    status: "running",
                    activeAttemptId: item.sendAttemptId,
                    activeAttemptFence: item.sendFence,
                    attemptCount: {increment: 1},
                    startedAt: new Date(),
                    finishedAt: null,
                    stableErrorCode: null,
                    errorMessage: null,
                },
            });
            if (running.count !== 1) return {kind: "outcome_unknown", message: "Project Job running fence CAS 失败"};
            try {
                await validateProjectClosure(client, item, "running");
                const response = await this.requestImage(request, credential, this.signalFactory(), createProjectNovelAiReferenceResolver(item.projectPath));
                const outcome = await this.writeResult({client, item, request, response});
                return outcome === "completed"
                    ? {kind: "completed"}
                    : {kind: "outcome_unknown", message: "图片已返回，但 Project 结果未形成可信终态"};
            } catch (error) {
                if (error instanceof NovelAiHttpError) {
                    if (error.retryable) {
                        await markJobRetryable(client, item, error.code, error.message);
                        return {kind: "retryable", code: error.code, message: error.message};
                    }
                    await markJobTerminal(client, item, "failed", error.code, error.message);
                    return {kind: "failed", code: error.code, message: error.message};
                }
                const message = error instanceof Error ? error.message : "远端请求结果无法确认";
                await markJobTerminal(client, item, "outcome_unknown", "TEXT_TO_IMAGE_OUTCOME_UNKNOWN", message);
                return {kind: "outcome_unknown", message};
            }
        });
    }

    /** App 在 Project terminal 后崩溃时，以 matching attempt/fence 镜像明确终态。 */
    async inspectExpiredAttempt(itemInput: ProviderLaneItemSnapshot): Promise<ExpiredAttemptResolution> {
        const item = ProviderLaneItemSnapshotSchema.parse(itemInput);
        return await this.runProject(item.projectPath, async (client) => {
            const job = await client.textToImageJob.findUnique({where: {id: item.jobId}});
            if (!job || job.activeAttemptId !== item.sendAttemptId || job.activeAttemptFence !== item.sendFence) {
                return {kind: "outcome_unknown", message: "Project 缺少 matching attempt/fence 终态"};
            }
            if (job.status === "succeeded") return {kind: "completed"};
            if (job.status === "queued" && job.stableErrorCode && job.errorMessage && isRetryableNovelAiErrorCode(job.stableErrorCode)) {
                return {kind: "retryable", code: job.stableErrorCode, message: job.errorMessage};
            }
            if (job.status === "failed" || job.status === "configuration_stale") {
                return {
                    kind: "failed",
                    code: job.stableErrorCode ?? "TEXT_TO_IMAGE_PROJECT_ATTEMPT_FAILED",
                    message: job.errorMessage ?? "Project Job 已明确失败",
                };
            }
            return {
                kind: "outcome_unknown",
                message: job.errorMessage ?? `Project Job ${job.status} 未形成可证明的远端终态`,
            };
        });
    }
}

/** 复验 Job/Manifest/approval/outbox/provider/request hash 与当前 lane fence。 */
async function validateProjectClosure(
    client: PrismaClient,
    item: ProviderLaneItemSnapshot,
    expectedStatus: "queued" | "running",
): Promise<IllustrationCompiledRequest> {
    const job = await client.textToImageJob.findUnique({where: {id: item.jobId}});
    if (!job || job.kind !== "illustration" || job.status !== expectedStatus) throw new ProjectDispatchValidationError("Project Job 状态已漂移");
    const rawRequest: unknown = parseJson(job.requestJson);
    const request = IllustrationCompiledRequestSchema.parse(rawRequest);
    const manifest = job.executionManifestId
        ? await client.illustrationExecutionManifest.findUnique({where: {id: job.executionManifestId}})
        : null;
    const approval = job.executionManifestId
        ? await client.illustrationExecutionApproval.findUnique({where: {manifestId: job.executionManifestId}})
        : null;
    const outbox = await client.textToImageDispatchOutbox.findUnique({where: {jobId: job.id}});
    if (!manifest || !approval || !outbox
        || manifest.executionManifestHash !== item.manifestHash
        || manifest.projectId !== item.projectId
        || approval.manifestId !== manifest.id
        || outbox.dispatchKey !== item.dispatchKey
        || outbox.manifestHash !== item.manifestHash
        || outbox.registrationVersion !== ILLUSTRATION_DISPATCH_REGISTRATION_VERSION
        || outbox.preparationId !== item.preparationId
        || outbox.prepareAttemptId !== item.prepareAttemptId
        || outbox.prepareVersion !== item.prepareVersion
        || job.providerOwnerUserId !== item.ownerUserId
        || job.providerId !== item.providerId
        || job.providerCredentialRevision !== item.providerCredentialRevision
        || job.compiledRequestHash !== request.compiledRequestHash
        || request.provider.ownerUserId !== item.ownerUserId
        || request.provider.providerId !== item.providerId
        || request.provider.credentialRevision !== item.providerCredentialRevision) {
        throw new ProjectDispatchValidationError("Project immutable dispatch closure 与 App lane item 不一致");
    }
    if (expectedStatus === "running"
        && (job.activeAttemptId !== item.sendAttemptId || job.activeAttemptFence !== item.sendFence)) {
        throw new ProjectDispatchValidationError("Project Job attempt fence 已漂移");
    }
    return request;
}

/** retry_leased 在领取新 App fence 前，先以旧 attempt/error CAS 清理 Project 重试证据。 */
async function clearRetryEvidence(client: PrismaClient, item: ProviderLaneItemSnapshot): Promise<void> {
    if (!item.sendAttemptId || item.sendFence === null || !item.errorCode || !item.errorMessage) {
        throw new ProjectDispatchValidationError("retry_leased 缺少上一 attempt 的完整证据");
    }
    const cleared = await client.textToImageJob.updateMany({
        where: {
            id: item.jobId,
            status: "queued",
            activeAttemptId: item.sendAttemptId,
            activeAttemptFence: item.sendFence,
            stableErrorCode: item.errorCode,
            errorMessage: item.errorMessage,
        },
        data: {
            activeAttemptId: null,
            activeAttemptFence: null,
            stableErrorCode: null,
            errorMessage: null,
            startedAt: null,
            finishedAt: null,
        },
    });
    if (cleared.count === 1) return;
    const current = await client.textToImageJob.findUnique({where: {id: item.jobId}});
    if (current?.status === "queued"
        && current.activeAttemptId === null
        && current.activeAttemptFence === null
        && current.stableErrorCode === null
        && current.errorMessage === null) {
        return;
    }
    throw new ProjectDispatchValidationError("Project retry evidence 已漂移");
}

/** 把图片保存为 Project Asset，再通过现有 result service 精确替换 V2 placeholder。 */
async function writeProjectResult(input: {
    client: PrismaClient;
    item: ProviderLaneItemSnapshot;
    request: IllustrationCompiledRequest;
    response: CompiledNovelAiResponse;
}): Promise<"completed" | "outcome_unknown"> {
    const completing = await input.client.textToImageJob.updateMany({
        where: {
            id: input.item.jobId,
            status: "running",
            activeAttemptId: input.item.sendAttemptId,
            activeAttemptFence: input.item.sendFence,
        },
        data: {status: "completing"},
    });
    if (completing.count !== 1) return "outcome_unknown";
    const clientFactory = async (): Promise<PrismaClient> => input.client;
    const assets = new TextToImageAssetService({client: clientFactory});
    const asset = await assets.save({
        projectPath: input.item.projectPath,
        jobId: input.item.jobId,
        bytes: input.response.image.bytes,
        mimeType: input.response.image.mimeType,
        width: input.response.image.width,
        height: input.response.image.height,
        model: input.response.request.model,
        seed: input.response.request.seed,
        prompt: input.request.prompt,
        negativePrompt: input.request.negativePrompt,
        sourceKind: "illustration",
        sourcePath: input.request.source.chapterPath,
        sourceAnchorId: input.request.source.placeholderId,
    });
    const result = await new IllustrationResultService({
        assets,
        chapters: new TextToImageChapterService(false),
        client: clientFactory,
    }).applyAssetResult({
        projectPath: input.item.projectPath,
        jobId: input.item.jobId,
        assetId: asset.id,
        attemptFence: {attemptId: input.item.sendAttemptId!, fencingVersion: input.item.sendFence!},
    });
    const terminal = await input.client.textToImageJob.findUnique({where: {id: input.item.jobId}});
    return terminal?.status === "succeeded" && result.status !== "late" ? "completed" : "outcome_unknown";
}

async function markJobTerminal(
    client: PrismaClient,
    item: ProviderLaneItemSnapshot,
    status: "failed" | "configuration_stale" | "outcome_unknown",
    code: string,
    message: string,
): Promise<void> {
    await client.textToImageJob.updateMany({
        where: {
            id: item.jobId,
            status: {in: ["running", "completing"]},
            activeAttemptId: item.sendAttemptId,
            activeAttemptFence: item.sendFence,
        },
        data: {status, stableErrorCode: code, errorMessage: message, finishedAt: new Date()},
    });
}

/** 明确 429/5xx 不是结果不明；Project 回到 queued，但保留旧 fence 供 App 重试握手。 */
async function markJobRetryable(
    client: PrismaClient,
    item: ProviderLaneItemSnapshot,
    code: string,
    message: string,
): Promise<void> {
    const updated = await client.textToImageJob.updateMany({
        where: {
            id: item.jobId,
            status: "running",
            activeAttemptId: item.sendAttemptId,
            activeAttemptFence: item.sendFence,
        },
        data: {status: "queued", stableErrorCode: code, errorMessage: message, finishedAt: new Date()},
    });
    if (updated.count !== 1) {
        throw new ProjectDispatchValidationError("Project Job retryable fence CAS 失败");
    }
}

/** 只有明确的 NovelAI 429/5xx 响应允许自动建立新 attempt。 */
function isRetryableNovelAiErrorCode(code: string): boolean {
    const match = /^NOVELAI_HTTP_(\d{3})$/u.exec(code);
    const status = match?.[1] ? Number(match[1]) : 0;
    return status === 429 || (status >= 500 && status <= 599);
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        throw new ProjectDispatchValidationError("Project Job requestJson 不是合法 JSON");
    }
}
