import {getQuery, getRouterParam} from "h3";
import {z} from "zod";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {throwIllustrationExecutionHttpError} from "nbook/server/text-to-image/illustration-execution-http-error";
import {getIllustrationExecutionService} from "nbook/server/text-to-image/illustration-execution.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const QuerySchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
}).strict();

/** 为一个已发布 V2 placeholder 返回零持久化副作用的签名 Execution Preview。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const user = await requireCurrentUser(event);
    const query = QuerySchema.safeParse(getQuery(event));
    const placeholderId = StoryboardStableIdSchema.safeParse(getRouterParam(event, "placeholderId")?.trim() ?? "");
    if (!query.success || !placeholderId.success) {
        throw createError({statusCode: 400, message: "Execution Preview 查询参数不合法"});
    }
    try {
        return await getIllustrationExecutionService().previewOne({
            projectPath: query.data.projectPath,
            ownerUserId: user.id,
            placeholderId: placeholderId.data,
        });
    } catch (error) {
        throwIllustrationExecutionHttpError(error);
    }
}));
