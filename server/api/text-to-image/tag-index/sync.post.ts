import {setResponseStatus} from "h3";
import {TagIndexSyncRequestSchema} from "nbook/shared/text-to-image-tag-index";
import {getTagIndexRuntime} from "nbook/server/text-to-image/tag-index/tag-index-runtime";
import {throwTagIndexHttpError} from "nbook/server/text-to-image/tag-index/tag-index-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";

/** 用户显式确认当前 terms 后启动/恢复唯一官方同步 operation。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const body = await validateBody(event, TagIndexSyncRequestSchema);
    try {
        const operation = await getTagIndexRuntime().start(body);
        setResponseStatus(event, 202);
        return operation;
    } catch (error) {
        throwTagIndexHttpError(error);
    }
});
