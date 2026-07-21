import {getQuery} from "h3";
import {z} from "zod";
import {getIllustrationWorkflowService} from "nbook/server/text-to-image/illustration-workflow.service";
import {throwIllustrationWorkflowHttpError} from "nbook/server/text-to-image/illustration-workflow-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const QuerySchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    chapterPath: z.string().regex(/^manuscript\/.+\.md$/u).optional(),
}).strict();

/** 列出 Project/章节的 plan-only Workflow 预览状态。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const query = QuerySchema.safeParse(getQuery(event));
    if (!query.success) throw createError({statusCode: 400, message: "Workflow 查询参数不合法"});
    try {
        return await getIllustrationWorkflowService().list(query.data);
    } catch (error) {
        throwIllustrationWorkflowHttpError(error);
    }
}));
