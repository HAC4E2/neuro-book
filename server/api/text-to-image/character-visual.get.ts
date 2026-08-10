import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {readCharacterVisual} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const CharacterVisualGetQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    groupId: z.string().trim().min(1).optional(),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = CharacterVisualGetQuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        const firstIssue = query.error.issues[0];
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return {
        visual: await readCharacterVisual(
            resolveTextToImageProjectRoot(query.data.projectRoot),
            query.data.characterId,
            query.data.groupId,
        ),
    };
});
