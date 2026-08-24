import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {readCharacterIdentitySummary} from "nbook/server/text-to-image/character-identity.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const projectRoot = resolveTextToImageProjectRoot(query.projectRoot);
    try {
        return await readCharacterIdentitySummary(projectRoot, query.characterId);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : "读取角色身份摘要失败";
        throw createError({statusCode: 404, message});
    }
});
