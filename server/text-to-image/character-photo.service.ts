import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {
    listTextToImageAssets,
} from "nbook/server/text-to-image/asset.service";
import {kickTextToImageQueue} from "nbook/server/text-to-image/queue-runtime";
import {
    CharacterVisualLibraryService,
    type CharacterVisualRef,
} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {generateCharacterPhotoPrompt} from "nbook/server/text-to-image/character-photo-llm";
import type {ResolvedBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import type {TextToImageLlmTraceHandle} from "nbook/server/text-to-image/llm-trace";

export type GenerateCharacterAvatarInput = {
    userId: number;
    llmRuntime: ResolvedBoundTextToImageLlmRuntime;
    projectRoot: string;
    groupId: string;
    characterId: string;
    visualId: string;
    selectedOutfitIndex: number | null;
    userRequirement: string;
    trace?: TextToImageLlmTraceHandle;
};

/**
 * 角色头像闭环：LLM 生成照片 prompt → NovelAI 入队并消费 → 把最新照片写入
 * 当前分组/视觉版本的 JSON `photos[]`。
 */
export async function generateCharacterAvatar(input: GenerateCharacterAvatarInput): Promise<{
    prompt: string;
    photo: string | null;
}> {
    const providerService = new TextToImageProviderService();
    const llmSettings = TextToImageLlmProviderSettingsSchema.parse(input.llmRuntime.settings);
    const visualRef: CharacterVisualRef = {
        groupId: input.groupId,
        characterId: input.characterId,
        visualId: input.visualId,
    };
    const projectRoot = resolveTextToImageProjectRoot(input.projectRoot);
    const library = new CharacterVisualLibraryService();
    const before = await library.readWithInfo(projectRoot, visualRef);
    if (!before) throw new Error("未找到当前角色视觉资料");
    if (input.selectedOutfitIndex !== null && input.selectedOutfitIndex >= before.visual.outfits.length) {
        throw new Error(`selectedOutfitIndex 超出当前服装范围：${input.selectedOutfitIndex}`);
    }
    const characterText = JSON.stringify(before.visual.character);
    const outfitText = input.selectedOutfitIndex === null
        ? ""
        : JSON.stringify(before.visual.outfits[input.selectedOutfitIndex]);
    const prompt = await generateCharacterPhotoPrompt({
        provider: {
            baseUrl: llmSettings.baseUrl,
            credential: input.llmRuntime.credential,
            settings: input.llmRuntime.settings,
        },
        characterText,
        outfitText,
        userRequirement: input.userRequirement,
        contextEntries: input.llmRuntime.contextEntries,
        promptMode: input.llmRuntime.promptMode,
        trace: input.trace,
        runtime: {
            currentCharacter: characterText,
            currentOutfit: outfitText,
            outfitList: JSON.stringify(before.visual.outfits),
            userDemand: input.userRequirement,
            triggerText: `${characterText}\n${outfitText}\n${input.userRequirement}`,
        },
    });

    const providers = await providerService.list(input.userId);
    const novelAiProvider = providers.find((item) => item.kind === "novelai");
    if (!novelAiProvider) {
        throw new Error("NovelAI Provider 不存在");
    }

    const projectPath = input.projectRoot.startsWith("workspace/")
        ? input.projectRoot
        : `workspace/${input.projectRoot}`;
    const queue = new TextToImageQueueService();
    const job = await queue.enqueue({
        projectPath,
        providerId: novelAiProvider.id,
        providerOwnerUserId: input.userId,
        providerCredentialRevision: novelAiProvider.credentialRevision,
        kind: "character",
        sourceAnchorId: buildCharacterVisualSourceAnchor(visualRef),
        requestJson: JSON.stringify({prompt, negativePrompt: "", novelAi: {}}),
        providerSnapshotJson: JSON.stringify({
            providerId: novelAiProvider.id,
            credentialRevision: novelAiProvider.credentialRevision,
        }),
    });
    await kickTextToImageQueue(projectPath);

    const completedJob = (await queue.list(projectPath)).find((item) => item.id === job.id);
    if (!completedJob) {
        throw new Error("队列处理完成但未找到角色照片任务");
    }
    if (completedJob.status === "failed") {
        throw new Error(completedJob.errorMessage ?? "NovelAI 生图失败");
    }
    const photo = await findLatestCharacterPhoto(projectPath, visualRef);
    if (photo) {
        await appendCharacterPhoto(projectRoot, visualRef, before.info.updatedAt, photo);
    }
    return {prompt, photo};
}

export function buildCharacterVisualSourceAnchor(ref: CharacterVisualRef): string {
    return `character:${encodeURIComponent(ref.groupId)}:${encodeURIComponent(ref.characterId)}:${ref.visualId}`;
}

async function findLatestCharacterPhoto(projectPath: string, ref: CharacterVisualRef): Promise<string | null> {
    let page = 1;
    while (true) {
        const result = await listTextToImageAssets({projectPath, page, pageSize: 100});
        const match = result.items.find((item) => item.sourceAnchorId === buildCharacterVisualSourceAnchor(ref));
        if (match) return match.relativePath;
        if (!result.hasMore) return null;
        page += 1;
    }
}

async function appendCharacterPhoto(
    projectRoot: string,
    ref: CharacterVisualRef,
    expectedUpdatedAt: string,
    photo: string,
): Promise<void> {
    const library = new CharacterVisualLibraryService();
    const visual = await library.read(projectRoot, ref);
    if (!visual) throw new Error("未找到当前角色视觉资料");
    const photos = visual.photos.filter((item) => item !== photo);
    photos.push(photo);
    await library.write(projectRoot, ref, {...visual, photos}, {
        expectedUpdatedAt,
        source: "manual",
        setActive: false,
    });
}
