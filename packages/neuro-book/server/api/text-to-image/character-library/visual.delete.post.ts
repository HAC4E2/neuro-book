import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {
    CharacterVisualLibraryService,
    VisualDeleteRevisionConflictError,
} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid(),
    expectedRevision: z.string().trim().min(1),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    try {
        return await new CharacterVisualLibraryService().deleteVisual(projectRoot, body, body.expectedRevision);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : "删除视觉资料失败";
        throw createError({statusCode: cause instanceof VisualDeleteRevisionConflictError ? 409 : 400, message});
    }
});
