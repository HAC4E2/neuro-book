import {getQuery} from "h3";
import {TagIndexSearchRequestSchema} from "nbook/shared/text-to-image-tag-index";
import {getTagIndexRuntime} from "nbook/server/text-to-image/tag-index/tag-index-runtime";
import {throwTagIndexHttpError} from "nbook/server/text-to-image/tag-index/tag-index-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";

/** 查询 active SQLite 的有限候选；不读取浏览器词库，也不触发同步。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const parsed = TagIndexSearchRequestSchema.safeParse(getQuery(event));
    if (!parsed.success) throw createError({statusCode: 400, message: "Tag index 搜索参数不合法"});
    try {
        return await getTagIndexRuntime().search(parsed.data);
    } catch (error) {
        throwTagIndexHttpError(error);
    }
});
