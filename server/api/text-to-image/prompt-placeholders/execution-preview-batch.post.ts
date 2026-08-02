import {z} from "zod";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {throwIllustrationExecutionHttpError} from "nbook/server/text-to-image/illustration-execution-http-error";
import {getIllustrationExecutionService} from "nbook/server/text-to-image/illustration-execution.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const BatchPreviewRequestSchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    placeholderIds: z.array(StoryboardStableIdSchema).min(1).max(32),
}).strict().superRefine((request, context) => {
    if (new Set(request.placeholderIds).size !== request.placeholderIds.length) {
        context.addIssue({code: "custom", path: ["placeholderIds"], message: "placeholderIds 不能重复"});
    }
});

/** 批量只读预编译；任一 target 阻断时整批零 Manifest、零 Job。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const user = await requireCurrentUser(event);
    const request = await validateBody(event, BatchPreviewRequestSchema);
    try {
        return await getIllustrationExecutionService().previewBatch({
            projectPath: request.projectPath,
            ownerUserId: user.id,
            placeholderIds: request.placeholderIds,
        });
    } catch (error) {
        throwIllustrationExecutionHttpError(error);
    }
}));
