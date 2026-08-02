import {setResponseStatus} from "h3";
import {z} from "zod";
import {IllustrationExecutionAuthorizationSchema} from "nbook/shared/text-to-image-execution";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {throwIllustrationExecutionHttpError} from "nbook/server/text-to-image/illustration-execution-http-error";
import {getIllustrationExecutionService} from "nbook/server/text-to-image/illustration-execution.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const BatchAuthorizeRequestSchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    placeholderIds: z.array(StoryboardStableIdSchema).min(1).max(32),
    previewToken: z.string().trim().min(1).max(4_096),
    manifestHash: TextToImageContractHashSchema,
    authorization: IllustrationExecutionAuthorizationSchema,
}).strict().superRefine((request, context) => {
    if (new Set(request.placeholderIds).size !== request.placeholderIds.length) {
        context.addIssue({code: "custom", path: ["placeholderIds"], message: "placeholderIds 不能重复"});
    }
});

/** 同一 token/nonce 复编译全部 target，并在一个 Project transaction 注册整批。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const user = await requireCurrentUser(event);
    const request = await validateBody(event, BatchAuthorizeRequestSchema);
    try {
        const receipt = await getIllustrationExecutionService().authorizeBatch({
            projectPath: request.projectPath,
            ownerUserId: user.id,
            placeholderIds: request.placeholderIds,
            previewToken: request.previewToken,
            manifestHash: request.manifestHash,
            authorization: request.authorization,
        });
        setResponseStatus(event, 202);
        return receipt;
    } catch (error) {
        throwIllustrationExecutionHttpError(error);
    }
}));
