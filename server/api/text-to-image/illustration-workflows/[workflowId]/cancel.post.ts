import {getRouterParam} from "h3";
import {IllustrationPlanningWorkflowActionRequestSchema} from "nbook/shared/text-to-image-illustration-workflow";
import {throwIllustrationWorkflowHttpError} from "nbook/server/text-to-image/illustration-workflow-http-error";
import {getIllustrationWorkflowService} from "nbook/server/text-to-image/illustration-workflow.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 取消单条持久 Planning Workflow；不会影响其它章节或写入正文。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const request = await validateBody(event, IllustrationPlanningWorkflowActionRequestSchema);
    const workflowId = getRouterParam(event, "workflowId")?.trim() ?? "";
    if (!workflowId) throw createError({statusCode: 400, message: "Workflow ID 不合法"});
    try {
        return await getIllustrationWorkflowService().cancel({projectPath: request.projectPath, workflowId});
    } catch (error) {
        throwIllustrationWorkflowHttpError(error);
    }
}));
