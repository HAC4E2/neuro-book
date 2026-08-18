import type {TextToImageJobDto} from "nbook/server/text-to-image/queue.service";
import {
    requestNovelAiImages,
    type NovelAiImageInput,
    type NovelAiInpaintInput,
    type NovelAiCharacterPromptInput,
} from "nbook/server/text-to-image/novelai-image-generation";
import {
    saveTextToImageAsset,
    type SaveTextToImageAssetInput,
} from "nbook/server/text-to-image/asset.service";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import type {FinalNovelAiPromptBundle} from "nbook/shared/text-to-image-novelai-prompt";
import {dedupeNovelAiPrompt} from "nbook/shared/text-to-image-novelai-prompt";
import {
    buildFinalNovelAiPromptBundle,
    NOVEL_AI_LOCAL_QUALITY_OWNERSHIP,
} from "nbook/server/text-to-image/final-novelai-prompt";
import {resolveNovelAiUcPreset} from "nbook/server/text-to-image/novelai-quality";
import {resolveNovelAiGenerationSettings} from "nbook/server/text-to-image/novelai-settings-normalizer";

export type TextToImageQueueDependencies = {
    listQueued: (projectPath: string) => Promise<TextToImageJobDto[]>;
    markRunning: (projectPath: string, id: string) => Promise<boolean>;
    markSucceeded: (projectPath: string, id: string) => Promise<boolean>;
    markFailed: (projectPath: string, id: string, message: string) => Promise<boolean>;
    markSourceInserted?: (projectPath: string, id: string) => Promise<boolean>;
    markSourceMissing?: (projectPath: string, id: string) => Promise<boolean>;
    resolveRuntime: (ownerUserId: number, providerId: number) => Promise<{settings: Record<string, unknown>; credential: string; credentialRevision: number}>;
    generate: (input: NovelAiImageInput) => Promise<Uint8Array[]>;
    saveAsset: (input: SaveTextToImageAssetInput) => Promise<TextToImageAssetDto>;
    writeBodyAsset?: (projectPath: string, job: TextToImageJobDto, asset: TextToImageAssetDto) => Promise<"inserted" | "already_inserted" | "missing">;
};

type PersistedJobRequest = {
    prompt?: string;
    negativePrompt?: string;
    characterPrompts?: NovelAiCharacterPromptInput[];
    novelAi?: Record<string, unknown>;
    inpaint?: NovelAiInpaintInput;
    /** 历史图片后处理传入最终组合 prompt，跳过固定前后缀与质量预设二次拼接。 */
    useFinalPrompt?: boolean;
    /** 历史资产保存的结构化最终快照；重绘/局部重绘优先复用。 */
    finalPromptBundle?: FinalNovelAiPromptBundle;
};

/** 消费指定 Project 的所有 queued Job；单个 Job 失败不阻塞后续。 */
export async function processTextToImageJobs(
    projectPath: string,
    deps: TextToImageQueueDependencies,
): Promise<number> {
    const jobs = [...await deps.listQueued(projectPath)].sort(compareQueuedJobs);
    for (const job of jobs) {
        const claimed = await deps.markRunning(projectPath, job.id);
        if (!claimed) continue;
        try {
            await processSingleJob(projectPath, job, deps);
            await deps.markSucceeded(projectPath, job.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : "队列处理失败";
            await deps.markFailed(projectPath, job.id, message);
        }
    }
    return jobs.length;
}

function compareQueuedJobs(left: TextToImageJobDto, right: TextToImageJobDto): number {
    const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
    return createdAtOrder !== 0 ? createdAtOrder : left.id.localeCompare(right.id);
}

async function processSingleJob(
    projectPath: string,
    job: TextToImageJobDto,
    deps: TextToImageQueueDependencies,
): Promise<void> {
    const request = JSON.parse(job.requestJson) as PersistedJobRequest;
    const runtime = await deps.resolveRuntime(job.providerOwnerUserId, job.providerId);
    if (runtime.credentialRevision !== job.providerCredentialRevision) {
        throw new Error("Provider API Key 在排队后已变更或删除；请重新提交生图任务");
    }
    const requestNovelAi = request.novelAi ?? {};
    const settings = resolveNovelAiGenerationSettings({
        ...runtime.settings,
        ...requestNovelAi,
    }, {
        ...(typeof requestNovelAi.width === "number" ? {width: requestNovelAi.width} : {}),
        ...(typeof requestNovelAi.height === "number" ? {height: requestNovelAi.height} : {}),
    });

    const {prompt, negativePrompt, characterPrompts, bundle} = request.useFinalPrompt
        ? resolvePersistedFinalPrompt(request)
        : buildQueuePromptBundle(settings, request);

    const images = await deps.generate({
        credential: runtime.credential,
        baseUrl: settings.baseUrl,
        model: settings.model,
        prompt,
        negativePrompt,
        characterPrompts,
        width: settings.width,
        height: settings.height,
        steps: settings.steps,
        seed: settings.seed,
        sampler: settings.sampler,
        noiseSchedule: settings.noiseSchedule,
        scale: settings.promptGuidance,
        cfgRescale: settings.promptGuidanceRescale,
        variety: settings.variety,
        decrisp: settings.decrisp,
        aiDefaultCharacterPosition: settings.aiDefaultCharacterPosition,
        requestIntervalMs: settings.requestIntervalMs,
        ucPreset: resolveNovelAiUcPreset(settings.model, NOVEL_AI_LOCAL_QUALITY_OWNERSHIP.ucPreset),
        positiveQualityPreset: NOVEL_AI_LOCAL_QUALITY_OWNERSHIP.qualityToggle,
        vibe: settings.vibe,
        vibeGroup: settings.vibeGroup,
        vibeGroups: settings.vibeGroups,
        characterReference: settings.characterReference,
        characterGroups: settings.characterGroups,
        inpaint: request.inpaint,
    });
    let latestAsset: TextToImageAssetDto | null = null;
    for (const bytes of images) {
        latestAsset = await deps.saveAsset({
            projectPath,
            jobId: job.id,
            bytes,
            mimeType: "image/png",
            width: settings.width,
            height: settings.height,
            model: settings.model,
            seed: settings.seed,
            prompt,
            negativePrompt,
            finalPromptBundleJson: JSON.stringify(bundle),
            sourceKind: job.kind,
            sourcePath: job.sourcePath,
            sourceAnchorId: job.sourceAnchorId,
        });
    }
    if (!latestAsset) {
        throw new Error("NovelAI 未返回图片资产");
    }
    if (job.kind === "body" && latestAsset && deps.writeBodyAsset) {
        const status = await deps.writeBodyAsset(projectPath, job, latestAsset);
        try {
            if (status === "inserted" || status === "already_inserted") {
                await deps.markSourceInserted?.(projectPath, job.id);
            } else {
                await deps.markSourceMissing?.(projectPath, job.id);
            }
        } catch {
            // sourceInsertStatus 是可恢复的状态投影；资产和正文已经写入时，
            // 不应因一次状态更新故障把成功的 NovelAI Job 改报为生成失败。
        }
    }
}

type ResolvedQueuePrompt = {
    prompt: string;
    negativePrompt: string;
    characterPrompts: NovelAiCharacterPromptInput[];
    bundle: FinalNovelAiPromptBundle;
};

function buildQueuePromptBundle(
    settings: ReturnType<typeof resolveNovelAiGenerationSettings>,
    request: PersistedJobRequest,
): ResolvedQueuePrompt {
    const bundle = buildFinalNovelAiPromptBundle({
        model: settings.model,
        prompt: request.prompt ?? "",
        negativePrompt: request.negativePrompt ?? null,
        fixedPositivePrompt: settings.fixedPositivePrompt,
        fixedPositivePromptEnd: settings.fixedPositivePromptEnd,
        fixedNegativePrompt: settings.fixedNegativePrompt,
        rulesText: settings.promptReplaceText,
        furryDataset: settings.furryDataset,
        positiveQualityPreset: settings.positiveQualityPreset,
        negativeQualityPreset: settings.negativeQualityPreset,
        characterPrompts: request.characterPrompts,
    });
    return {
        prompt: bundle.actualInput,
        negativePrompt: bundle.actualNegativeInput,
        characterPrompts: bundle.characters.map(toGeneratorCharacterPrompt),
        bundle,
    };
}

function toGeneratorCharacterPrompt(item: FinalNovelAiPromptBundle["characters"][number]): NovelAiCharacterPromptInput {
    return {
        prompt: item.positive,
        negativePrompt: item.negative,
        ...(item.centerX === undefined ? {} : {centerX: item.centerX}),
        ...(item.centerY === undefined ? {} : {centerY: item.centerY}),
    };
}

function resolvePersistedFinalPrompt(request: PersistedJobRequest): ResolvedQueuePrompt {
    if (request.finalPromptBundle) {
        const bundle = request.finalPromptBundle;
        return {
            prompt: bundle.actualInput,
            negativePrompt: bundle.actualNegativeInput,
            characterPrompts: bundle.characters.map(toGeneratorCharacterPrompt),
            bundle,
        };
    }
    const prompt = dedupeNovelAiPrompt(request.prompt ?? "");
    const negativePrompt = dedupeNovelAiPrompt(request.negativePrompt ?? "");
    const characterPrompts = (request.characterPrompts ?? []).map((item) => ({
        ...item,
        prompt: dedupeNovelAiPrompt(item.prompt),
        negativePrompt: dedupeNovelAiPrompt(item.negativePrompt),
    }));
    const bundleCharacters = characterPrompts.map((item) => ({
        positive: item.prompt,
        negative: item.negativePrompt,
        ...(item.centerX === undefined ? {} : {centerX: item.centerX}),
        ...(item.centerY === undefined ? {} : {centerY: item.centerY}),
    }));
    return {
        prompt,
        negativePrompt,
        characterPrompts,
        bundle: {
            version: 1,
            modelFamily: "nai4",
            basePositive: prompt,
            baseNegative: negativePrompt,
            characters: bundleCharacters,
            actualInput: prompt,
            actualNegativeInput: negativePrompt,
            appliedRuleLines: [],
        },
    };
}
