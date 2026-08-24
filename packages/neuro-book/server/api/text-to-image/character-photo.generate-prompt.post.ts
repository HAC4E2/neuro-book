import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {generateCharacterPhotoPrompt} from "nbook/server/text-to-image/character-photo-llm";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";

const CharacterPhotoGeneratePromptBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid(),
    selectedOutfitIndex: z.number().int().nonnegative().nullable().default(null),
    userRequirement: z.string().default(""),
}).strict();

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, CharacterPhotoGeneratePromptBodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    const visual = await new CharacterVisualLibraryService().read(projectRoot, body);
    if (!visual) throw new Error("未找到当前角色视觉资料");
    if (body.selectedOutfitIndex !== null && body.selectedOutfitIndex >= visual.outfits.length) {
        throw new Error(`selectedOutfitIndex 超出当前服装范围：${body.selectedOutfitIndex}`);
    }
    const characterText = JSON.stringify(visual.character);
    const outfitText = body.selectedOutfitIndex === null ? "" : JSON.stringify(visual.outfits[body.selectedOutfitIndex]);
    const runtime = await resolveBoundTextToImageLlmRuntime(user.id, "char_display");
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const trace = textToImageLlmTraceHub.start(user.id, {requestType: "char_display", profileId: runtime.profileId, model: settings.model});
    const prompt = await generateCharacterPhotoPrompt({
        provider: {
            baseUrl: settings.baseUrl,
            credential: runtime.credential,
            settings: runtime.settings,
        },
        characterText,
        outfitText,
        userRequirement: body.userRequirement,
        contextEntries: runtime.contextEntries,
        promptMode: runtime.promptMode,
        trace,
        runtime: {
            currentCharacter: characterText,
            currentOutfit: outfitText,
            outfitList: JSON.stringify(visual.outfits),
            userDemand: body.userRequirement,
            triggerText: `${characterText}\n${outfitText}\n${body.userRequirement}`,
        },
    });
    return {prompt};
});
