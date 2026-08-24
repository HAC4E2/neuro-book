import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid(),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues[0]?.message ?? "请求参数不合法"});
    }
    const projectRoot = resolveTextToImageProjectRoot(parsed.data.projectRoot);
    try {
        return await new CharacterVisualLibraryService().previewDeleteVisual(projectRoot, parsed.data);
    } catch (cause) {
        throw createError({statusCode: 400, message: cause instanceof Error ? cause.message : "读取删除影响摘要失败"});
    }
});
