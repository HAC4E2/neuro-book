import type {FinalNovelAiPromptBundle} from "nbook/shared/text-to-image-novelai-prompt";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {kickTextToImageQueue} from "nbook/server/text-to-image/queue-runtime";
import {
    findTextToImageAssetJobSnapshot,
    findLatestTextToImageAssetBySourceAnchorId,
    findTextToImageAssetByJobId,
} from "nbook/server/text-to-image/asset.service";
import {saveTextToImageMask} from "nbook/server/text-to-image/mask.service";
import {
    TextToImageLlmProviderSettingsSchema,
    type TextToImageAssetDto,
} from "nbook/shared/dto/text-to-image.dto";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import {generateTagModifyPrompt} from "nbook/server/text-to-image/tag-modify-llm";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";

type PersistedJobRequest = {
    useFinalPrompt?: boolean;
    novelAi?: Record<string, unknown>;
    finalPromptBundle?: FinalNovelAiPromptBundle;
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
    const bundle = parseAssetFinalBundle(snapshot.asset.finalPromptBundleJson);
    return sendTextToImageAsset({
        projectPath: input.projectPath,
        assetId: input.assetId,
        prompt: bundle?.actualInput ?? parsePersistedRequest(snapshot.job.requestJson).finalPromptBundle?.actualInput ?? snapshot.asset.prompt,
    });
}

export async function editTextToImageAssetTag(input: {
    projectPath: string;
    assetId: string;
    userId: number;
    modificationRequest: string;
}): Promise<{prompt: string}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const runtime = await resolveBoundTextToImageLlmRuntime(input.userId, "tag_modify");
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const trace = textToImageLlmTraceHub.start(input.userId, {requestType: "tag_modify", profileId: runtime.profileId, model: settings.model});
    const prompt = await generateTagModifyPrompt({
        provider: {
            baseUrl: settings.baseUrl,
            credential: runtime.credential,
            settings: runtime.settings,
        },
        currentPrompt: snapshot.asset.prompt,
        modificationRequest: input.modificationRequest,
        contextEntries: runtime.contextEntries,
        promptMode: runtime.promptMode,
        trace,
        runtime: {
            context: snapshot.asset.prompt,
            currentTag: snapshot.asset.prompt,
            userDemand: input.modificationRequest,
            triggerText: `${snapshot.asset.prompt}\n${input.modificationRequest}`,
        },
    });
    return {prompt};
}

export async function sendTextToImageAsset(input: {
    projectPath: string;
    assetId: string;
    prompt: string;
}): Promise<{jobId: string; asset: TextToImageAssetDto}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const request = parsePersistedRequest(snapshot.job.requestJson);
    const assetBundle = parseAssetFinalBundle(snapshot.asset.finalPromptBundleJson);
    return enqueueAndProcess({
        projectPath: input.projectPath,
        assetId: input.assetId,
        kind: "reroll",
        requestJson: JSON.stringify(buildAssetSendRequest({
            prompt: input.prompt,
            negativePrompt: snapshot.asset.negativePrompt,
            persistedRequest: {...request, finalPromptBundle: request.finalPromptBundle ?? assetBundle ?? undefined},
        })),
    });
}

export function buildAssetSendRequest(input: {
    prompt: string;
    negativePrompt: string;
    persistedRequest: PersistedJobRequest;
}): {
    prompt: string;
    negativePrompt: string;
    useFinalPrompt: true;
    novelAi: Record<string, unknown>;
    finalPromptBundle?: FinalNovelAiPromptBundle;
} {
    const prompt = input.prompt.trim();
    if (prompt === "") {
        throw new Error("发送 Tag 不能为空");
    }
    const bundle = input.persistedRequest.finalPromptBundle;
    return {
        prompt: bundle?.actualInput ?? prompt,
        negativePrompt: bundle?.actualNegativeInput ?? input.negativePrompt,
        useFinalPrompt: true,
        novelAi: {
            ...(input.persistedRequest.novelAi ?? {}),
            seed: -1,
        },
        ...(bundle ? {finalPromptBundle: bundle} : {}),
    };
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
    const assetBundle = parseAssetFinalBundle(snapshot.asset.finalPromptBundleJson);
    const requestBundle = request.finalPromptBundle ?? assetBundle;
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
            ...(requestBundle ? {finalPromptBundle: input.newPrompt?.trim()
                ? {...requestBundle, basePositive: input.newPrompt.trim(), actualInput: input.newPrompt.trim()}
                : requestBundle} : {}),
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

function parseAssetFinalBundle(json: string | null | undefined): FinalNovelAiPromptBundle | null {
    if (!json) return null;
    try {
        const value = JSON.parse(json) as Partial<FinalNovelAiPromptBundle>;
        return value.version === 1 && value.modelFamily === "nai4"
            && typeof value.actualInput === "string" && typeof value.actualNegativeInput === "string"
            && Array.isArray(value.characters)
            ? value as FinalNovelAiPromptBundle
            : null;
    } catch {
        return null;
    }
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
    await kickTextToImageQueue(input.projectPath);
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
