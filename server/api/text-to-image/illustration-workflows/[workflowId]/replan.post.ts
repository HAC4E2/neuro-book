import {getRouterParam, setResponseStatus} from "h3";
import {IllustrationPlanningWorkflowReplanRequestSchema} from "nbook/shared/text-to-image-illustration-workflow";
import {throwIllustrationWorkflowHttpError} from "nbook/server/text-to-image/illustration-workflow-http-error";
import {getIllustrationWorkflowService} from "nbook/server/text-to-image/illustration-workflow.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

/** 由服务端生成 revision nonce，并从当前真相源建立新的 Planning request。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    await requireCurrentUser(event);
    const request = await validateBody(event, IllustrationPlanningWorkflowReplanRequestSchema);
    const workflowId = getRouterParam(event, "workflowId")?.trim() ?? "";
    if (!workflowId) throw createError({statusCode: 400, message: "Workflow ID 不合法"});
    try {
        const workflow = await getIllustrationWorkflowService().replan({
            projectPath: request.projectPath,
            workflowId,
            reason: request.reason,
        });
        setResponseStatus(event, 202);
        return workflow;
    } catch (error) {
        throwIllustrationWorkflowHttpError(error);
    }
}));
