import {getRouterParam} from "h3";
import {z} from "zod";
import {getTagIndexRuntime} from "nbook/server/text-to-image/tag-index/tag-index-runtime";
import {throwTagIndexHttpError} from "nbook/server/text-to-image/tag-index/tag-index-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";

const OperationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/u);

/** 读取一个稳定 operation；不以客户端状态覆盖 active selector。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const operationId = OperationIdSchema.safeParse(getRouterParam(event, "operationId"));
    if (!operationId.success) throw createError({statusCode: 400, message: "Tag index operationId 不合法"});
    try {
        return await getTagIndexRuntime().operation(operationId.data);
    } catch (error) {
        throwTagIndexHttpError(error);
    }
});
