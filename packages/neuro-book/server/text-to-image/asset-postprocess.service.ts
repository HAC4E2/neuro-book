import type {
    FinalNovelAiCharacterPrompt,
    FinalNovelAiPromptBundle,
} from "nbook/shared/text-to-image-novelai-prompt";
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
    TextToImageNovelAiModelSchema,
    type TextToImageAssetDto,
} from "nbook/shared/dto/text-to-image.dto";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import {generateTagModifyPrompt} from "nbook/server/text-to-image/tag-modify-llm";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";
import {
    TextToImageProviderService,
    type CurrentNovelAiProviderSnapshot,
} from "nbook/server/text-to-image/provider.service";
import type {
    NovelAiCharacterPromptInput,
    NovelAiInpaintInput,
} from "nbook/server/text-to-image/novelai-image-generation";

type PersistedJobRequest = {
    prompt?: string;
    negativePrompt?: string;
    characterPrompts?: NovelAiCharacterPromptInput[];
    useFinalPrompt?: boolean;
    novelAi?: Record<string, unknown>;
    finalPromptBundle?: FinalNovelAiPromptBundle;
    inpaint?: NovelAiInpaintInput;
    generationRecipeId?: string;
};

type AssetProviderSnapshot = {
    providerId: number;
    providerOwnerUserId: number;
    providerCredentialRevision: number;
    providerSnapshotJson: string;
};

/** 历史图片后处理：重 roll、Tag 修改、局部重绘。 */
export async function rerollTextToImageAsset(input: {
    projectPath: string;
    assetId: string;
    userId: number;
}): Promise<{jobId: string; asset: TextToImageAssetDto}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const source = resolveSourceGenerationRequest(snapshot.job.requestJson);
    const provider = await new TextToImageProviderService().resolveCurrentNovelAiProvider(input.userId);
    return enqueueAndProcess({
        projectPath: input.projectPath,
        snapshot,
        provider,
        kind: "reroll",
        requestJson: JSON.stringify(buildAssetRerollRequest({sourceRequest: source.request, generationRecipeId: provider.generationRecipeId})),
    });
}

export async function editTextToImageAssetTag(input: {
    projectPath: string;
    assetId: string;
    userId: number;
    modificationRequest: string;
}): Promise<{prompt: string}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const source = resolveSourceGenerationRequest(snapshot.job.requestJson);
    const runtime = await resolveBoundTextToImageLlmRuntime(input.userId, "tag_modify");
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const trace = textToImageLlmTraceHub.start(input.userId, {requestType: "tag_modify", profileId: runtime.profileId, model: settings.model});
    const prompt = await generateTagModifyPrompt({
        provider: {
            baseUrl: settings.baseUrl,
            credential: runtime.credential,
            settings: runtime.settings,
        },
        currentPrompt: source.prompt,
        modificationRequest: input.modificationRequest,
        contextEntries: runtime.contextEntries,
        promptMode: runtime.promptMode,
        trace,
        runtime: {
            context: source.prompt,
            currentTag: source.prompt,
            userDemand: input.modificationRequest,
            triggerText: `${source.prompt}\n${input.modificationRequest}`,
        },
    });
    return {prompt};
}

export async function sendTextToImageAsset(input: {
    projectPath: string;
    assetId: string;
    userId: number;
    prompt: string;
}): Promise<{jobId: string; asset: TextToImageAssetDto}> {
    const snapshot = await requireAssetJobSnapshot(input.projectPath, input.assetId);
    const source = resolveSourceGenerationRequest(snapshot.job.requestJson);
    const provider = await new TextToImageProviderService().resolveCurrentNovelAiProvider(input.userId);
    return enqueueAndProcess({
        projectPath: input.projectPath,
        snapshot,
        provider,
        kind: "reroll",
        requestJson: JSON.stringify(buildAssetSendRequest({
            prompt: input.prompt,
            negativePrompt: source.negativePrompt,
            characterPrompts: source.characterPrompts,
            generationRecipeId: provider.generationRecipeId,
            persistedRequest: source.request,
        })),
    });
}

/** `/reroll` 和 `/send` 共用的当前配方请求形状；历史快照参数只为兼容调用方传入，故意不读取。 */
export function buildAssetSendRequest(input: {
    prompt: string;
    negativePrompt: string;
    characterPrompts?: NovelAiCharacterPromptInput[];
    generationRecipeId?: string;
    persistedRequest?: PersistedJobRequest;
}): PersistedJobRequest {
    const prompt = input.prompt.trim();
    if (prompt === "") {
        throw new Error("发送 Tag 不能为空");
    }
    void input.persistedRequest;
    return {
        prompt,
        negativePrompt: input.negativePrompt,
        ...(input.characterPrompts ? {characterPrompts: input.characterPrompts} : {}),
        ...(input.generationRecipeId ? {generationRecipeId: input.generationRecipeId} : {}),
        novelAi: {seed: -1},
    };
}

export function buildAssetRerollRequest(input: {sourceRequest: PersistedJobRequest; generationRecipeId?: string}): PersistedJobRequest {
    return buildAssetSendRequest({
        prompt: input.sourceRequest.prompt ?? "",
        negativePrompt: input.sourceRequest.negativePrompt ?? "",
        characterPrompts: input.sourceRequest.characterPrompts,
        generationRecipeId: input.generationRecipeId,
        persistedRequest: input.sourceRequest,
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
    const assetBundle = parseAssetFinalBundle(snapshot.asset.finalPromptBundleJson);
    const requestBundle = request.finalPromptBundle ?? assetBundle;
    const maskBytes = decodeBase64Png(input.maskBase64);
    const mask = await saveTextToImageMask({
        projectPath: input.projectPath,
        bytes: maskBytes,
    });
    const strength = typeof input.strength === "number" && Number.isFinite(input.strength)
        ? Math.min(1, Math.max(0, input.strength))
        : 0.54;
    return enqueueAndProcess({
        projectPath: input.projectPath,
        snapshot,
        provider: {
            providerId: snapshot.job.providerId,
            providerOwnerUserId: snapshot.job.providerOwnerUserId,
            providerCredentialRevision: snapshot.job.providerCredentialRevision,
            generationRecipeId: "",
            providerSnapshotJson: snapshot.job.providerSnapshotJson,
        },
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

export function parseAssetFinalBundle(json: string | null | undefined): FinalNovelAiPromptBundle | null {
    if (!json) return null;
    try {
        return parsePromptBundleValue(JSON.parse(json));
    } catch {
        return null;
    }
}

function parsePersistedRequest(requestJson: string): PersistedJobRequest {
    try {
        const value: unknown = JSON.parse(requestJson);
        if (!isRecord(value)) throw new Error();
        const request: PersistedJobRequest = {};
        if (value.prompt !== undefined && typeof value.prompt !== "string") throw new Error();
        if (value.negativePrompt !== undefined && typeof value.negativePrompt !== "string") throw new Error();
        if (typeof value.prompt === "string") request.prompt = value.prompt;
        if (typeof value.negativePrompt === "string") request.negativePrompt = value.negativePrompt;
        if (value.characterPrompts !== undefined) request.characterPrompts = parseCharacterPrompts(value.characterPrompts);
        if (value.useFinalPrompt !== undefined && typeof value.useFinalPrompt !== "boolean") throw new Error();
        if (typeof value.useFinalPrompt === "boolean") request.useFinalPrompt = value.useFinalPrompt;
        if (value.novelAi !== undefined) {
            const novelAi = readRecord(value.novelAi);
            if (!novelAi) throw new Error();
            request.novelAi = novelAi;
        }
        if (value.finalPromptBundle !== undefined) {
            const bundle = parsePromptBundleValue(value.finalPromptBundle);
            if (!bundle) throw new Error();
            request.finalPromptBundle = bundle;
        }
        if (value.inpaint !== undefined) {
            const inpaint = parseInpaint(value.inpaint);
            if (!inpaint) throw new Error();
            request.inpaint = inpaint;
        }
        return request;
    } catch {
        throw new Error("无法读取该图片的原始生成请求");
    }
}

function resolveSourceGenerationRequest(requestJson: string): {
    request: PersistedJobRequest;
    prompt: string;
    negativePrompt: string;
    characterPrompts?: NovelAiCharacterPromptInput[];
} {
    const request = parsePersistedRequest(requestJson);
    const prompt = request.prompt?.trim() ?? "";
    if (prompt === "") {
        throw new Error("该历史图片缺少可重 roll 的基础 Prompt");
    }
    return {
        request,
        prompt,
        negativePrompt: request.negativePrompt ?? "",
        characterPrompts: request.characterPrompts,
    };
}

function parsePromptBundleValue(value: unknown): FinalNovelAiPromptBundle | null {
    if (!isRecord(value)) return null;
    const version = value.version;
    const basePositive = readString(value.basePositive);
    const baseNegative = readString(value.baseNegative);
    const actualInput = readString(value.actualInput);
    const actualNegativeInput = readString(value.actualNegativeInput);
    const appliedRuleLines = Array.isArray(value.appliedRuleLines)
        && value.appliedRuleLines.every((item) => typeof item === "number" && Number.isInteger(item))
        ? value.appliedRuleLines
        : null;
    const characters = parseBundleCharacters(value.characters);
    if (basePositive === null || baseNegative === null || actualInput === null || actualNegativeInput === null
        || appliedRuleLines === null || characters === null) {
        return null;
    }
    if (version === 1 && value.modelFamily === "nai4") {
        return {
            version: 1,
            modelFamily: "nai4",
            basePositive,
            baseNegative,
            characters,
            actualInput,
            actualNegativeInput,
            appliedRuleLines,
        };
    }
    const model = TextToImageNovelAiModelSchema.safeParse(value.model);
    if (version !== 2 || (value.modelFamily !== "nai45" && value.modelFamily !== "nai5") || !model.success) {
        return null;
    }
    return {
        version: 2,
        modelFamily: value.modelFamily,
        model: model.data,
        basePositive,
        baseNegative,
        characters,
        actualInput,
        actualNegativeInput,
        appliedRuleLines,
    };
}

function parseBundleCharacters(value: unknown): FinalNovelAiCharacterPrompt[] | null {
    if (!Array.isArray(value)) return null;
    const characters: FinalNovelAiCharacterPrompt[] = [];
    for (const item of value) {
        if (!isRecord(item)) return null;
        const positive = readString(item.positive);
        const negative = readString(item.negative);
        if (positive === null || negative === null) return null;
        if (item.centerX !== undefined && typeof item.centerX !== "number") return null;
        if (item.centerY !== undefined && typeof item.centerY !== "number") return null;
        characters.push({
            positive,
            negative,
            ...(typeof item.centerX === "number" ? {centerX: item.centerX} : {}),
            ...(typeof item.centerY === "number" ? {centerY: item.centerY} : {}),
        });
    }
    return characters;
}

function parseCharacterPrompts(value: unknown): NovelAiCharacterPromptInput[] {
    if (!Array.isArray(value)) throw new Error();
    return value.map((item) => {
        if (!isRecord(item) || typeof item.prompt !== "string" || typeof item.negativePrompt !== "string") throw new Error();
        if (item.centerX !== undefined && typeof item.centerX !== "number") throw new Error();
        if (item.centerY !== undefined && typeof item.centerY !== "number") throw new Error();
        return {
            prompt: item.prompt,
            negativePrompt: item.negativePrompt,
            ...(typeof item.centerX === "number" ? {centerX: item.centerX} : {}),
            ...(typeof item.centerY === "number" ? {centerY: item.centerY} : {}),
        };
    });
}

function parseInpaint(value: unknown): NovelAiInpaintInput | null {
    if (!isRecord(value) || typeof value.imageId !== "string" || typeof value.maskId !== "string" || typeof value.strength !== "number") {
        return null;
    }
    return {imageId: value.imageId, maskId: value.maskId, strength: value.strength};
}

function readString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requireAssetJobSnapshot(projectPath: string, assetId: string) {
    const snapshot = await findTextToImageAssetJobSnapshot(projectPath, assetId);
    if (!snapshot) {
        throw new Error(`文生图资产不存在：${assetId}`);
    }
    return snapshot;
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
    snapshot: Awaited<ReturnType<typeof requireAssetJobSnapshot>>;
    provider: AssetProviderSnapshot | CurrentNovelAiProviderSnapshot;
    kind: "reroll" | "inpaint";
    requestJson: string;
}): Promise<{jobId: string; asset: TextToImageAssetDto}> {
    const queue = new TextToImageQueueService();
    const job = await queue.enqueue({
        projectPath: input.projectPath,
        providerId: input.provider.providerId,
        providerOwnerUserId: input.provider.providerOwnerUserId,
        providerCredentialRevision: input.provider.providerCredentialRevision,
        kind: input.kind,
        sourcePath: input.snapshot.asset.sourcePath,
        sourceAnchorId: input.snapshot.asset.sourceAnchorId,
        requestJson: input.requestJson,
        providerSnapshotJson: input.provider.providerSnapshotJson,
    });
    await kickTextToImageQueue(input.projectPath);
    const completedJob = (await queue.list(input.projectPath)).find((item) => item.id === job.id);
    assertPostprocessJobSucceeded(completedJob, job.id);
    const asset = await findPostprocessedAsset(input.projectPath, input.snapshot.asset.sourceAnchorId, job.id);
    if (!asset) {
        throw new Error(`文生图后处理任务已完成但未找到新图片：${job.id}`);
    }
    return {jobId: job.id, asset};
}

/** 后处理接口必须先投射队列真实终态，不能把生成失败伪装成资产查找失败。 */
export function assertPostprocessJobSucceeded(
    job: {status: string; errorMessage: string | null} | undefined,
    jobId: string,
): void {
    if (!job) {
        throw new Error(`文生图后处理任务不存在：${jobId}`);
    }
    if (job.status === "failed") {
        throw new Error(job.errorMessage?.trim() || `文生图后处理任务失败：${jobId}`);
    }
    if (job.status === "canceled") {
        throw new Error(`文生图后处理任务已取消：${jobId}`);
    }
    if (job.status !== "succeeded") {
        throw new Error(`文生图后处理任务状态异常：${job.status}`);
    }
}

async function findPostprocessedAsset(
    projectPath: string,
    sourceAnchorId: string | null,
    jobId: string,
): Promise<TextToImageAssetDto | null> {
    const byJob = await findTextToImageAssetByJobId(projectPath, jobId);
    if (byJob) {
        return sourceAnchorId && byJob.sourceAnchorId !== sourceAnchorId ? null : byJob;
    }
    if (!sourceAnchorId) return null;
    const byAnchor = await findLatestTextToImageAssetBySourceAnchorId(projectPath, sourceAnchorId);
    return byAnchor?.jobId === jobId ? byAnchor : null;
}
