import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {generateCharacterVisualModifyPreview} from "nbook/server/text-to-image/character-visual-llm";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {readProjectSendData, readProjectSendDataSnapshot} from "nbook/server/text-to-image/project-send-data.service";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid(),
    selectedOutfitIndex: z.number().int().nonnegative().nullable().default(null),
    characterPage: z.string().default(""),
    userRequirement: z.string().default(""),
}).strict();

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    const service = new CharacterVisualLibraryService();
    const current = await service.readWithInfo(projectRoot, body);
    if (!current) throw new Error("未找到当前视觉资料");
    if (body.selectedOutfitIndex !== null && body.selectedOutfitIndex >= current.visual.outfits.length) {
        throw new Error(`selectedOutfitIndex 超出当前服装范围：${body.selectedOutfitIndex}`);
    }
    const runtime = await resolveBoundTextToImageLlmRuntime(user.id, "char_modify");
    const settings = runtime.settings;
    const trace = textToImageLlmTraceHub.start(user.id, {requestType: "char_modify", profileId: runtime.profileId, model: String(settings.model ?? "")});
    const sendData = await readProjectSendData(projectRoot);
    const sendSnapshot = await readProjectSendDataSnapshot(projectRoot, sendData);
    const worldBook = sendSnapshot.lorebookEntries.map((entry) => entry.content).join("\n\n");
    const currentOutfit = body.selectedOutfitIndex === null
        ? ""
        : JSON.stringify(current.visual.outfits[body.selectedOutfitIndex]);
    const draft = await generateCharacterVisualModifyPreview({
        provider: {
            baseUrl: String(runtime.settings.baseUrl ?? ""),
            credential: runtime.credential,
            settings: runtime.settings,
        },
        characterId: body.characterId,
        characterPage: body.characterPage,
        existingSummary: JSON.stringify(current.visual),
        mode: "modify_visual",
        userRequirement: body.userRequirement,
        contextEntries: runtime.contextEntries,
        promptMode: runtime.promptMode,
        selectedOutfitIndex: body.selectedOutfitIndex,
        trace,
        runtime: {
            body: body.characterPage,
            context: body.characterPage,
            characterSource: body.characterPage,
            worldBook,
            currentCharacter: JSON.stringify(current.visual.character),
            currentOutfit,
            outfitList: JSON.stringify(current.visual.outfits),
            userDemand: body.userRequirement,
            triggerText: `${body.characterPage}\n${current.visual.character.cnName}\n${current.visual.character.enName}\n${currentOutfit}\n${body.userRequirement}`,
        },
    });
    return {
        draft: draft.visual,
        warnings: draft.warnings,
        changedFields: draft.changedFields,
        mode: draft.mode,
        outfitCandidates: draft.outfitCandidates ?? [],
        baseRevision: current.info.updatedAt,
        current: current.visual,
        currentFile: current.info,
    };
});
