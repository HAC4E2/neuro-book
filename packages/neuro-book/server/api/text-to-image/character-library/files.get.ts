import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid().optional(),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues[0]?.message ?? "请求参数不合法"});
    }
    const query = parsed.data;
    const projectRoot = resolveTextToImageProjectRoot(query.projectRoot);
    const service = new CharacterVisualLibraryService();
    const result = await service.readWithInfo(projectRoot, query);
    return {
        visual: result?.visual ?? null,
        file: result?.info ?? null,
        files: await service.listVisualFiles(projectRoot, query),
    };
});
