import {setResponseStatus} from "h3";
import {IllustrationPlanningStartRequestSchema} from "nbook/shared/text-to-image-illustration-workflow";
import {getIllustrationWorkflowService} from "nbook/server/text-to-image/illustration-workflow.service";
import {throwIllustrationWorkflowHttpError} from "nbook/server/text-to-image/illustration-workflow-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 以浏览器语义意图启动 plan-only Workflow；所有配置/事实由服务端冻结。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const request = await validateBody(event, IllustrationPlanningStartRequestSchema);
    try {
        const workflow = await getIllustrationWorkflowService().start(request);
        setResponseStatus(event, 202);
        return workflow;
    } catch (error) {
        throwIllustrationWorkflowHttpError(error);
    }
}));
