import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {processTextToImageJobs} from "nbook/server/text-to-image/queue.processor";
import {requestNovelAiImages} from "nbook/server/text-to-image/novelai-image-generation";
import {
    listTextToImageAssets,
    saveTextToImageAsset,
} from "nbook/server/text-to-image/asset.service";
import {
    readCharacterVisual,
    writeCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
import {generateCharacterPhotoPrompt} from "nbook/server/text-to-image/character-photo-llm";
import {resolveTextToImageContextEntries} from "nbook/server/text-to-image/llm-context";

const CharacterPhotoGenerateBodySchema = z.object({
    llmProviderId: z.number().int().positive(),
    novelAiProviderId: z.number().int().positive(),
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    characterText: z.string().default(""),
    outfitText: z.string().default(""),
    userRequirement: z.string().default(""),
});

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CharacterPhotoGenerateBodySchema);
    const providerService = new TextToImageProviderService();

    const llmRuntime = await providerService.resolveRuntimeProvider(user.id, body.llmProviderId);
    const llmSettings = TextToImageLlmProviderSettingsSchema.parse(llmRuntime.settings);
    const prompt = await generateCharacterPhotoPrompt({
        provider: {
            baseUrl: llmSettings.baseUrl,
            credential: llmRuntime.credential,
            settings: llmRuntime.settings,
        },
        characterText: body.characterText,
        outfitText: body.outfitText,
        userRequirement: body.userRequirement,
        contextEntries: await resolveTextToImageContextEntries("char_display"),
        runtime: {
            currentCharacter: body.characterText,
            currentOutfit: body.outfitText,
            userDemand: body.userRequirement,
        },
    });

    const providers = await providerService.list(user.id);
    const novelAiProvider = providers.find((item) => item.id === body.novelAiProviderId);
    if (!novelAiProvider) {
        throw new Error("NovelAI Provider 不存在");
    }

    const projectPath = `workspace/${body.projectRoot}`;
    const queue = new TextToImageQueueService();
    await queue.enqueue({
        projectPath,
        providerId: novelAiProvider.id,
        providerOwnerUserId: user.id,
        providerCredentialRevision: novelAiProvider.credentialRevision,
        kind: "character",
        sourceAnchorId: body.characterId,
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
        generate: requestNovelAiImages,
        saveAsset: saveTextToImageAsset,
    });

    const photo = await findLatestCharacterPhoto(projectPath, body.characterId);
    if (photo) {
        await appendCharacterPhoto(projectPath, body.characterId, photo);
    }
    return {prompt, photo};
});

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

async function appendCharacterPhoto(projectPath: string, characterId: string, photo: string): Promise<void> {
    const projectRoot = resolveTextToImageProjectRoot(projectPath);
    const existing = await readCharacterVisual(projectRoot, characterId);
    const visual = existing ?? CharacterVisualFileSchema.parse({
        schema: "nbook.character-visual/v1",
        characterId,
        character: {},
        outfits: [],
    });
    const photos = visual.photos.filter((item) => item !== photo);
    photos.push(photo);
    await writeCharacterVisual(projectRoot, characterId, {...visual, photos});
}
