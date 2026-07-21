import {getRouterParam, setResponseStatus} from "h3";
import {IllustrationPlanningWorkflowActionRequestSchema} from "nbook/shared/text-to-image-illustration-workflow";
import {throwIllustrationWorkflowHttpError} from "nbook/server/text-to-image/illustration-workflow-http-error";
import {getIllustrationWorkflowService} from "nbook/server/text-to-image/illustration-workflow.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 在当前真相源 hash 完全一致时，为旧 request 创建新 Attempt。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const request = await validateBody(event, IllustrationPlanningWorkflowActionRequestSchema);
    const workflowId = getRouterParam(event, "workflowId")?.trim() ?? "";
    if (!workflowId) throw createError({statusCode: 400, message: "Workflow ID 不合法"});
    try {
        const workflow = await getIllustrationWorkflowService().retry({projectPath: request.projectPath, workflowId});
        setResponseStatus(event, 202);
        return workflow;
    } catch (error) {
        throwIllustrationWorkflowHttpError(error);
    }
}));
