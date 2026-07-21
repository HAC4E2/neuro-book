import {StoryboardGlobalPublishService} from "nbook/server/text-to-image/storyboard-publish.service";
import {throwStoryboardImportHttpError} from "nbook/server/text-to-image/storyboard-import-http-error";
import {StoryboardGlobalPublishRequestSchema} from "nbook/shared/text-to-image-storyboard-publish";
import {requireAdminAccess, requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const publishService = new StoryboardGlobalPublishService();

/** 管理员显式发布 approved pair；actor 始终由当前用户身份生成。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const user = await requireCurrentUser(event);
    await requireAdminAccess(event);
    const body = await validateBody(event, StoryboardGlobalPublishRequestSchema);
    try {
        return await publishService.publish(body, `user-${user.id}`);
    } catch (error) {
        throwStoryboardImportHttpError(error);
    }
}));
