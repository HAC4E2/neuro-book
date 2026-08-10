import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {processTextToImageJobs} from "nbook/server/text-to-image/queue.processor";
import {requestNovelAiImages} from "nbook/server/text-to-image/novelai-image-generation";
import {
    listTextToImageAssets,
    saveTextToImageAsset,
} from "nbook/server/text-to-image/asset.service";
import {readTextToImageReferenceImageBytes} from "nbook/server/text-to-image/reference-image.service";
import {
    readCharacterVisual,
    writeCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
import {generateCharacterPhotoPrompt} from "nbook/server/text-to-image/character-photo-llm";
import {resolveTextToImageContextEntries} from "nbook/server/text-to-image/llm-context";

export type GenerateCharacterAvatarInput = {
    userId: number;
    llmProviderId: number;
    novelAiProviderId: number;
    projectRoot: string;
    characterId: string;
    groupId?: string;
    characterText: string;
    outfitText: string;
    userRequirement: string;
};

/**
 * 角色头像闭环：LLM 生成照片 prompt → NovelAI 入队并消费 → 把最新照片写入
 * `visual.json` 的 `photos[]`。
 */
export async function generateCharacterAvatar(input: GenerateCharacterAvatarInput): Promise<{
    prompt: string;
    photo: string | null;
}> {
    const providerService = new TextToImageProviderService();
    const llmRuntime = await providerService.resolveRuntimeProvider(input.userId, input.llmProviderId);
    const llmSettings = TextToImageLlmProviderSettingsSchema.parse(llmRuntime.settings);
    const prompt = await generateCharacterPhotoPrompt({
        provider: {
            baseUrl: llmSettings.baseUrl,
            credential: llmRuntime.credential,
            settings: llmRuntime.settings,
        },
        characterText: input.characterText,
        outfitText: input.outfitText,
        userRequirement: input.userRequirement,
        contextEntries: await resolveTextToImageContextEntries("char_display"),
        runtime: {
            currentCharacter: input.characterText,
            currentOutfit: input.outfitText,
            userDemand: input.userRequirement,
        },
    });

    const providers = await providerService.list(input.userId);
    const novelAiProvider = providers.find((item) => item.id === input.novelAiProviderId);
    if (!novelAiProvider) {
        throw new Error("NovelAI Provider 不存在");
    }

    const projectPath = `workspace/${input.projectRoot}`;
    const queue = new TextToImageQueueService();
    const job = await queue.enqueue({
        projectPath,
        providerId: novelAiProvider.id,
        providerOwnerUserId: input.userId,
        providerCredentialRevision: novelAiProvider.credentialRevision,
        kind: "character",
        sourceAnchorId: input.characterId,
        requestJson: JSON.stringify({prompt, negativePrompt: "", novelAi: {}}),
        providerSnapshotJson: JSON.stringify({
            providerId: novelAiProvider.id,
            credentialRevision: novelAiProvider.credentialRevision,
        }),
    });
    await processTextToImageJobs(projectPath, {
        listQueued: (projectPath) => queue.list(projectPath, "queued"),
        markRunning: (projectPath, id) => queue.markRunning(projectPath, id),
        markSucceeded: (projectPath, id) => queue.markSucceeded(projectPath, id),
        markFailed: (projectPath, id, message) => queue.markFailed(projectPath, id, message),
        resolveRuntime: (ownerUserId, providerId) => providerService.resolveRuntimeProvider(ownerUserId, providerId),
        generate: (input) => requestNovelAiImages(input, {
            readReference: (relativePath) => readTextToImageReferenceImageBytes(relativePath),
        }),
        saveAsset: saveTextToImageAsset,
    });

    const completedJob = (await queue.list(projectPath)).find((item) => item.id === job.id);
    if (!completedJob) {
        throw new Error("队列处理完成但未找到角色照片任务");
    }
    if (completedJob.status === "failed") {
        throw new Error(completedJob.errorMessage ?? "NovelAI 生图失败");
    }
    const photo = await findLatestCharacterPhoto(projectPath, input.characterId);
    if (photo) {
        await appendCharacterPhoto(projectPath, input.characterId, photo, input.groupId);
    }
    return {prompt, photo};
}

async function findLatestCharacterPhoto(projectPath: string, characterId: string): Promise<string | null> {
    let page = 1;
    while (true) {
        const result = await listTextToImageAssets({projectPath, page, pageSize: 100});
        const match = result.items.find((item) => item.sourceAnchorId === characterId);
        if (match) return match.relativePath;
        if (!result.hasMore) return null;
        page += 1;
    }
}

async function appendCharacterPhoto(
    projectPath: string,
    characterId: string,
    photo: string,
    groupId?: string,
): Promise<void> {
    const projectRoot = resolveTextToImageProjectRoot(projectPath);
    const existing = await readCharacterVisual(projectRoot, characterId, groupId);
    const visual = existing ?? CharacterVisualFileSchema.parse({
        schema: "nbook.character-visual/v1",
        characterId,
        character: {},
        outfits: [],
    });
    const photos = visual.photos.filter((item) => item !== photo);
    photos.push(photo);
    await writeCharacterVisual(projectRoot, characterId, {...visual, photos}, groupId);
}
