import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {listCharacterGroups} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const CharacterGroupsGetQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = CharacterGroupsGetQuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        const firstIssue = query.error.issues[0];
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "Invalid request",
        });
    }
    return {
        groups: await listCharacterGroups(resolveTextToImageProjectRoot(query.data.projectRoot)),
    };
});
