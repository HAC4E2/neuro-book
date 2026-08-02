import {setResponseStatus} from "h3";
import {IllustrationPlanningStartRequestSchema} from "nbook/shared/text-to-image-illustration-workflow";
import {getIllustrationWorkflowService} from "nbook/server/text-to-image/illustration-workflow.service";
import {throwIllustrationWorkflowHttpError} from "nbook/server/text-to-image/illustration-workflow-http-error";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageRecipeService} from "nbook/server/text-to-image/recipe.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

/** 以浏览器语义意图启动 plan-only Workflow；所有配置/事实由服务端冻结。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const user = await requireCurrentUser(event);
    const request = await validateBody(event, IllustrationPlanningStartRequestSchema);
    try {
        // 首开自动落盘：新 Project 第一次点正文生图不再因 Recipe 缺失 409；无效文件仍 fail-closed。
        // 存在旧 Provider 实际模型迁移证据时不抢先写默认盘，保留用户在文生图分页的显式迁移确认权。
        const inspection = await new TextToImageProviderService().inspectNovelAi(user.id);
        if (inspection.recipeMigrationModels.length === 0) {
            await new TextToImageRecipeService().ensurePersistedDefault(request.projectPath);
        }
        const workflow = await getIllustrationWorkflowService().start(request);
        setResponseStatus(event, 202);
        return workflow;
    } catch (error) {
        throwIllustrationWorkflowHttpError(error);
    }
}));
