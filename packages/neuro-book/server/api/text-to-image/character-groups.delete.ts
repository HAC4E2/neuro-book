import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {deleteCharacterGroup} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const CharacterGroupDeleteQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = CharacterGroupDeleteQuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        const firstIssue = query.error.issues[0];
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "Invalid request",
        });
    }
    await deleteCharacterGroup(
        resolveTextToImageProjectRoot(query.data.projectRoot),
        query.data.groupId,
    );
    return {ok: true};
});
