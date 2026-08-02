import {StoryboardGlobalPublishService} from "nbook/server/text-to-image/storyboard-publish.service";
import {throwStoryboardImportHttpError} from "nbook/server/text-to-image/storyboard-import-http-error";
import {StoryboardGlobalSelectorRetryRequestSchema} from "nbook/shared/text-to-image-storyboard-publish";
import {requireAdminAccess, requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const publishService = new StoryboardGlobalPublishService();

/** 两份 immutable files 已发布时，管理员只以新 config hash 重试 selector CAS。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    await requireCurrentUser(event);
    await requireAdminAccess(event);
    const body = await validateBody(event, StoryboardGlobalSelectorRetryRequestSchema);
    try {
        return await publishService.retrySelector(body);
    } catch (error) {
        throwStoryboardImportHttpError(error);
    }
}));
