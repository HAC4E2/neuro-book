import {getQuery} from "h3";
import {z} from "zod";
import {listStoryboardImportSources} from "nbook/server/text-to-image/storyboard-import.service";
import {throwStoryboardImportHttpError} from "nbook/server/text-to-image/storyboard-import-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const QuerySchema = z.object({projectPath: z.string().trim().min(1).max(500)}).strict();

/** 列出当前 Project upload 顶层可显式选择的 JSON；不递归读取内容。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    await requireCurrentUser(event);
    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) throw createError({statusCode: 400, message: "projectPath 不合法"});
    try {
        return await listStoryboardImportSources(parsed.data);
    } catch (error) {
        throwStoryboardImportHttpError(error);
    }
}));
