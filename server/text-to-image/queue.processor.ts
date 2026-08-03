import {TextToImageNovelAiSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageJobDto} from "nbook/server/text-to-image/queue.service";
import {
    requestNovelAiImages,
    type NovelAiImageInput,
} from "nbook/server/text-to-image/novelai-image-generation";
import {
    saveTextToImageAsset,
    type SaveTextToImageAssetInput,
} from "nbook/server/text-to-image/asset.service";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {applyPromptReplaceRules} from "nbook/server/text-to-image/prompt-replacement";
import {resolveNovelAiQualityPresets} from "nbook/server/text-to-image/novelai-quality";

export type TextToImageQueueDependencies = {
    listQueued: (projectPath: string) => Promise<TextToImageJobDto[]>;
    markRunning: (projectPath: string, id: string) => Promise<boolean>;
    markSucceeded: (projectPath: string, id: string) => Promise<boolean>;
    markFailed: (projectPath: string, id: string, message: string) => Promise<boolean>;
    resolveRuntime: (ownerUserId: number, providerId: number) => Promise<{settings: Record<string, unknown>; credential: string}>;
    generate: (input: NovelAiImageInput) => Promise<Uint8Array[]>;
    saveAsset: (input: SaveTextToImageAssetInput) => Promise<TextToImageAssetDto>;
};

type PersistedJobRequest = {
    prompt?: string;
    negativePrompt?: string;
    novelAi?: Record<string, unknown>;
};

/** 消费指定 Project 的所有 queued Job；单个 Job 失败不阻塞后续。 */
export async function processTextToImageJobs(
    projectPath: string,
    deps: TextToImageQueueDependencies,
): Promise<number> {
    const jobs = await deps.listQueued(projectPath);
    for (const job of jobs) {
        await deps.markRunning(projectPath, job.id);
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

async function processSingleJob(
    projectPath: string,
    job: TextToImageJobDto,
    deps: TextToImageQueueDependencies,
): Promise<void> {
    const request = JSON.parse(job.requestJson) as PersistedJobRequest;
    const runtime = await deps.resolveRuntime(job.providerOwnerUserId, job.providerId);
    const settings = TextToImageNovelAiSettingsSchema.parse({
        ...runtime.settings,
        ...(request.novelAi ?? {}),
    });
    const basePrompt = applyPromptReplaceRules(request.prompt ?? "", settings.promptReplaceText);
    const {aqt, ucp} = resolveNovelAiQualityPresets({
        model: settings.model,
        positiveEnabled: settings.positiveQualityPreset,
        negativePreset: settings.negativeQualityPreset,
    });
    const prompt = aqt === "" ? basePrompt : `${aqt}, ${basePrompt}`;
    const negativePrompt = [ucp, request.negativePrompt ?? settings.fixedNegativePrompt]
        .filter((item) => item !== "")
        .join(", ");
    const images = await deps.generate({
        credential: runtime.credential,
        baseUrl: settings.baseUrl,
        model: settings.model,
        prompt,
        negativePrompt,
        width: settings.width,
        height: settings.height,
        steps: settings.steps,
        seed: settings.seed,
        sampler: settings.sampler,
        noiseSchedule: settings.noiseSchedule,
        scale: settings.promptGuidance,
        cfgRescale: settings.promptGuidanceRescale,
        smea: settings.smea,
        smeaDyn: settings.smeaDyn,
        variety: settings.variety,
        decrisp: settings.decrisp,
        aiDefaultCharacterPosition: settings.aiDefaultCharacterPosition,
    });
    for (const bytes of images) {
        await deps.saveAsset({
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
            sourceKind: job.kind,
            sourcePath: job.sourcePath,
            sourceAnchorId: job.sourceAnchorId,
        });
    }
}
