import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {processTextToImageJobs} from "nbook/server/text-to-image/queue.processor";
import {requestNovelAiImages} from "nbook/server/text-to-image/novelai-image-generation";
import {
    findTextToImageAssetJobSnapshot,
    findLatestTextToImageAssetBySourceAnchorId,
    findTextToImageAssetByJobId,
    saveTextToImageAsset,
} from "nbook/server/text-to-image/asset.service";
import {saveTextToImageMask} from "nbook/server/text-to-image/mask.service";
import {createTextToImageReferenceResolver} from "nbook/server/text-to-image/reference-resolver";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

type PersistedJobRequest = {
    novelAi?: Record<string, unknown>;
};

/**
 * 历史图片后处理：重 roll、Tag 修改、局部重绘。
 * 复用原资产所属 Job 的 Provider 与参数快照，机械入队并同步消费。
 */
export async function rerollTextToImageAsset(input: {
    projectPath: string;
    assetId: string;
}): Promise<{jobId: string; asset: TextToImageAssetDto}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const request = parsePersistedRequest(snapshot.job.requestJson);
    return enqueueAndProcess({
        projectPath: input.projectPath,
        assetId: input.assetId,
        kind: "reroll",
        requestJson: JSON.stringify({
            prompt: snapshot.asset.prompt,
            negativePrompt: snapshot.asset.negativePrompt,
            useFinalPrompt: true,
            novelAi: {
                ...(request.novelAi ?? {}),
                seed: -1,
            },
        }),
    });
}

export async function editTextToImageAssetTag(input: {
    projectPath: string;
    assetId: string;
    newPrompt: string;
}): Promise<{jobId: string; asset: TextToImageAssetDto}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const request = parsePersistedRequest(snapshot.job.requestJson);
    return enqueueAndProcess({
        projectPath: input.projectPath,
        assetId: input.assetId,
        kind: "reroll",
        requestJson: JSON.stringify({
            prompt: input.newPrompt,
            negativePrompt: snapshot.asset.negativePrompt,
            useFinalPrompt: true,
            novelAi: {
                ...(request.novelAi ?? {}),
                seed: -1,
            },
        }),
    });
}

export async function inpaintTextToImageAsset(input: {
    projectPath: string;
    assetId: string;
    maskBase64: string;
    strength?: number;
    newPrompt?: string;
}): Promise<{jobId: string; asset: TextToImageAssetDto}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const request = parsePersistedRequest(snapshot.job.requestJson);
    const maskBytes = decodeBase64Png(input.maskBase64);
    const mask = await saveTextToImageMask({
        projectPath: input.projectPath,
        bytes: maskBytes,
    });
    const strength = typeof input.strength === "number" && Number.isFinite(input.strength)
        ? Math.min(1, Math.max(0, input.strength ?? 0.54))
        : 0.54;
    return enqueueAndProcess({
        projectPath: input.projectPath,
        assetId: input.assetId,
        kind: "inpaint",
        requestJson: JSON.stringify({
            prompt: input.newPrompt !== undefined && input.newPrompt.trim() !== ""
                ? input.newPrompt
                : snapshot.asset.prompt,
            negativePrompt: snapshot.asset.negativePrompt,
            useFinalPrompt: true,
            novelAi: {
                ...(request.novelAi ?? {}),
                seed: -1,
            },
            inpaint: {
                imageId: snapshot.asset.relativePath,
                maskId: mask.relativePath,
                strength,
            },
        }),
    });
}

async function requireAssetJobSnapshot(projectPath: string, assetId: string) {
    const snapshot = await findTextToImageAssetJobSnapshot(projectPath, assetId);
    if (!snapshot) {
        throw new Error(`文生图资产不存在：${assetId}`);
    }
    return snapshot;
}

function parsePersistedRequest(requestJson: string): PersistedJobRequest {
    return JSON.parse(requestJson) as PersistedJobRequest;
}

function decodeBase64Png(base64: string): Uint8Array {
    const normalized = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
    const bytes = Uint8Array.from(Buffer.from(normalized, "base64"));
    const pngSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (bytes.byteLength < pngSignature.byteLength
        || !pngSignature.every((value, index) => bytes[index] === value)) {
        throw new Error("遮罩只支持 PNG 图片");
    }
    return bytes;
}

async function enqueueAndProcess(input: {
    projectPath: string;
    assetId: string;
    kind: "reroll" | "inpaint";
    requestJson: string;
}): Promise<{jobId: string; asset: TextToImageAssetDto}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const queue = new TextToImageQueueService();
    const providerService = new TextToImageProviderService();
    const job = await queue.enqueue({
        projectPath: input.projectPath,
        providerId: snapshot.job.providerId,
        providerOwnerUserId: snapshot.job.providerOwnerUserId,
        providerCredentialRevision: snapshot.job.providerCredentialRevision,
        kind: input.kind,
        sourcePath: snapshot.asset.sourcePath,
        sourceAnchorId: snapshot.asset.sourceAnchorId,
        requestJson: input.requestJson,
        providerSnapshotJson: snapshot.job.providerSnapshotJson,
    });
    await processTextToImageJobs(input.projectPath, {
        listQueued: (projectPath) => queue.list(projectPath, "queued"),
        markRunning: (projectPath, id) => queue.markRunning(projectPath, id),
        markSucceeded: (projectPath, id) => queue.markSucceeded(projectPath, id),
        markFailed: (projectPath, id, message) => queue.markFailed(projectPath, id, message),
        resolveRuntime: (ownerUserId, providerId) => providerService.resolveRuntimeProvider(ownerUserId, providerId),
        generate: (generateInput) => requestNovelAiImages(
            generateInput,
            createTextToImageReferenceResolver(input.projectPath),
        ),
        saveAsset: saveTextToImageAsset,
    });
    const asset = await findPostprocessedAsset(input.projectPath, snapshot.asset.sourceAnchorId, job.id);
    if (!asset) {
        throw new Error(`文生图后处理任务已完成但未找到新图片：${job.id}`);
    }
    return {jobId: job.id, asset};
}

async function findPostprocessedAsset(
    projectPath: string,
    sourceAnchorId: string | null,
    jobId: string,
): Promise<TextToImageAssetDto | null> {
    if (sourceAnchorId) {
        const byAnchor = await findLatestTextToImageAssetBySourceAnchorId(projectPath, sourceAnchorId);
        if (byAnchor?.jobId === jobId) {
            return byAnchor;
        }
    }
    return await findTextToImageAssetByJobId(projectPath, jobId);
}
