import {createError, defineEventHandler, getQuery, getRouterParam} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {findTextToImagePromptMarkdown} from "nbook/shared/text-to-image-markdown";
import {readChapterMarkdown} from "nbook/server/text-to-image/chapter.service";

const StatusQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    path: z.string().trim().min(1),
});

/** 查询正文占位符是否仍待生成；用于前端轮询卡片状态。 */
export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = StatusQuerySchema.parse(getQuery(event));
    const placeholderId = getRouterParam(event, "id") ?? "";
    if (placeholderId.trim() === "") {
        throw createError({statusCode: 400, message: "占位符 ID 不能为空"});
    }
    const projectRoot = resolveTextToImageProjectRoot(`workspace/${query.projectRoot}`);
    const content = await readChapterMarkdown(absoluteFsPath(projectRoot), query.path);
    return {
        found: findTextToImagePromptMarkdown(content, placeholderId) !== null,
    };
});
