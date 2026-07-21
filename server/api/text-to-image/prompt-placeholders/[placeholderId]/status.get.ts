import {getQuery, getRouterParam} from "h3";
import {z} from "zod";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {throwIllustrationExecutionHttpError} from "nbook/server/text-to-image/illustration-execution-http-error";
import {getIllustrationPlaceholderStatusService} from "nbook/server/text-to-image/illustration-placeholder.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const QuerySchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
}).strict();

/** 查询 Project SQLite/当前发布事实拥有的 placeholder 状态；不创建 Preview 或 Job。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const user = await requireCurrentUser(event);
    const query = QuerySchema.safeParse(getQuery(event));
    const placeholderId = StoryboardStableIdSchema.safeParse(getRouterParam(event, "placeholderId")?.trim() ?? "");
    if (!query.success || !placeholderId.success) {
        throw createError({statusCode: 400, message: "Placeholder status 查询参数不合法"});
    }
    try {
        return await getIllustrationPlaceholderStatusService().read({
            projectPath: query.data.projectPath,
            ownerUserId: user.id,
            placeholderId: placeholderId.data,
        });
    } catch (error) {
        throwIllustrationExecutionHttpError(error);
    }
}));
