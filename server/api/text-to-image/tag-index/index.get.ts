import {getTagIndexRuntime} from "nbook/server/text-to-image/tag-index/tag-index-runtime";
import {throwTagIndexHttpError} from "nbook/server/text-to-image/tag-index/tag-index-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";

/** 返回 Workspace Root active index 与当前 operation 的只读状态；不会访问官方网络。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    try {
        return await getTagIndexRuntime().status();
    } catch (error) {
        throwTagIndexHttpError(error);
    }
});
