import {StoryboardGlobalPublishService} from "nbook/server/text-to-image/storyboard-publish.service";
import {throwStoryboardImportHttpError} from "nbook/server/text-to-image/storyboard-import-http-error";
import {StoryboardGlobalPublishPreviewRequestSchema} from "nbook/shared/text-to-image-storyboard-publish";
import {requireAdminAccess, requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const publishService = new StoryboardGlobalPublishService();

/** 管理员读取 global companion 发布预览；该入口无副作用并冻结全部 expected hash。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    await requireAdminAccess(event);
    const body = await validateBody(event, StoryboardGlobalPublishPreviewRequestSchema);
    try {
        return await publishService.preview(body);
    } catch (error) {
        throwStoryboardImportHttpError(error);
    }
}));
