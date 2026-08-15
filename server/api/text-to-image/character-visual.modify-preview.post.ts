import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {generateCharacterVisualDraft} from "nbook/server/text-to-image/character-visual-llm";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid(),
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
    const runtime = await resolveBoundTextToImageLlmRuntime(user.id, "char_modify");
    const draft = await generateCharacterVisualDraft({
        provider: {
            baseUrl: String(runtime.settings.baseUrl ?? ""),
            credential: runtime.credential,
            settings: runtime.settings,
        },
        characterId: body.characterId,
        characterPage: body.characterPage,
        existingSummary: JSON.stringify(current.visual),
        mode: "replace_visual",
        userRequirement: body.userRequirement,
        contextEntries: runtime.contextEntries,
        runtime: {
            body: body.characterPage,
            currentCharacter: JSON.stringify(current.visual.character),
            currentOutfit: JSON.stringify(current.visual.outfits),
            userDemand: body.userRequirement,
        },
    });
    return {
        draft,
        baseRevision: current.info.updatedAt,
        current: current.visual,
        currentFile: current.info,
    };
});
