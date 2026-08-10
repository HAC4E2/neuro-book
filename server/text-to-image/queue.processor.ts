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
import {applyPromptReplaceRules} from "nbook/server/text-to-image/prompt-replacement";
import {
    resolveNovelAiQualityPresets,
    resolveNovelAiUcPreset,
} from "nbook/server/text-to-image/novelai-quality";
import {dedupeNovelAiPrompt} from "nbook/shared/text-to-image-novelai-prompt";
import {resolveNovelAiGenerationSettings} from "nbook/server/text-to-image/novelai-settings-normalizer";

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
    characterPrompts?: NovelAiCharacterPromptInput[];
    novelAi?: Record<string, unknown>;
    inpaint?: NovelAiInpaintInput;
    /** 历史图片后处理传入最终组合 prompt，跳过固定前后缀与质量预设二次拼接。 */
    useFinalPrompt?: boolean;
};

/** 消费指定 Project 的所有 queued Job；单个 Job 失败不阻塞后续。 */
export async function processTextToImageJobs(
    projectPath: string,
    deps: TextToImageQueueDependencies,
): Promise<number> {
    const jobs = await deps.listQueued(projectPath);
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

async function processSingleJob(
    projectPath: string,
    job: TextToImageJobDto,
    deps: TextToImageQueueDependencies,
): Promise<void> {
    const request = JSON.parse(job.requestJson) as PersistedJobRequest;
    const runtime = await deps.resolveRuntime(job.providerOwnerUserId, job.providerId);
    const settings = resolveNovelAiGenerationSettings({
        ...runtime.settings,
        ...(request.novelAi ?? {}),
    });
    const basePrompt = applyPromptReplaceRules(request.prompt ?? "", settings.promptReplaceText);
    const mainPrompt = settings.furryDataset
        ? `fur dataset, ${basePrompt}`
        : basePrompt;
    const {aqt, ucp} = resolveNovelAiQualityPresets({
        model: settings.model,
        positiveEnabled: settings.positiveQualityPreset,
        negativePreset: settings.negativeQualityPreset,
    });
    const model = settings.furryDataset && !settings.model.includes("furry")
        ? "nai-diffusion-furry-3"
        : settings.model;
    const prompt = dedupeNovelAiPrompt(request.useFinalPrompt
        ? (request.prompt ?? "").trim()
        : joinPromptParts(
            settings.fixedPositivePrompt,
            mainPrompt,
            settings.fixedPositivePromptEnd,
            aqt,
        ));
    const negativePrompt = dedupeNovelAiPrompt(request.useFinalPrompt
        ? (request.negativePrompt ?? settings.fixedNegativePrompt).trim()
        : joinPromptParts(
            ucp,
            request.negativePrompt ?? settings.fixedNegativePrompt,
        ));
    const images = await deps.generate({
        credential: runtime.credential,
        baseUrl: settings.baseUrl,
        model,
        prompt,
        negativePrompt,
        characterPrompts: request.characterPrompts?.map((characterPrompt) => ({
            ...characterPrompt,
            prompt: dedupeNovelAiPrompt(characterPrompt.prompt),
            negativePrompt: dedupeNovelAiPrompt(characterPrompt.negativePrompt),
        })),
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
        requestIntervalMs: settings.requestIntervalMs,
        ucPreset: resolveNovelAiUcPreset(model, settings.negativeQualityPreset),
        positiveQualityPreset: settings.positiveQualityPreset,
        vibe: settings.vibe,
        vibeGroup: settings.vibeGroup,
        vibeGroups: settings.vibeGroups,
        characterReference: settings.characterReference,
        characterGroups: settings.characterGroups,
        inpaint: request.inpaint,
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

function joinPromptParts(...parts: Array<string | null | undefined>): string {
    return parts
        .map((part) => (part ?? "").trim().replace(/^,+|,+$/gu, ""))
        .filter((part) => part !== "")
        .join(", ");
}
