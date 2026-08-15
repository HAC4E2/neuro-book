import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    sourceGroupId: z.string().trim().min(1),
    sourceCharacterId: z.string().trim().min(1),
    sourceVisualId: z.string().uuid(),
    targetGroupId: z.string().trim().min(1),
    targetCharacterId: z.string().trim().min(1).optional(),
    fileName: z.string().trim().optional(),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    return await new CharacterVisualLibraryService().createCopy(projectRoot, {
        groupId: body.sourceGroupId,
        characterId: body.sourceCharacterId,
        visualId: body.sourceVisualId,
    }, {
        groupId: body.targetGroupId,
        characterId: body.targetCharacterId,
    }, {fileName: body.fileName});
});
