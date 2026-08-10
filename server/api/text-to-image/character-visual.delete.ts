import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {deleteCharacterVisual} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const CharacterVisualDeleteQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = CharacterVisualDeleteQuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        const firstIssue = query.error.issues[0];
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "Invalid request",
        });
    }
    await deleteCharacterVisual(
        resolveTextToImageProjectRoot(query.data.projectRoot),
        query.data.characterId,
    );
    return {ok: true};
});
