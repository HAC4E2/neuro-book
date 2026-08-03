import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {readCharacterVisual} from "nbook/server/text-to-image/character-visual.service";

const CharacterVisualGetQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const query = CharacterVisualGetQuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        const firstIssue = query.error.issues[0];
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return {
        visual: await readCharacterVisual(query.data.projectRoot, query.data.characterId),
    };
});
