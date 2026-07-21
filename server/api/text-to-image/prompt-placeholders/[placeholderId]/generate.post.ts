import {setResponseStatus} from "h3";
import {z} from "zod";
import {
    IllustrationExecutionAuthorizationSchema,
} from "nbook/shared/text-to-image-execution";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {throwIllustrationExecutionHttpError} from "nbook/server/text-to-image/illustration-execution-http-error";
import {getIllustrationExecutionService} from "nbook/server/text-to-image/illustration-execution.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const AuthorizeRequestSchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    previewToken: z.string().trim().min(1).max(4_096),
    manifestHash: TextToImageContractHashSchema,
    authorization: IllustrationExecutionAuthorizationSchema,
}).strict();

/** 验签并把一个已展示 Preview 原子注册为 immutable Manifest/approval/Job/outbox。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const user = await requireCurrentUser(event);
    const placeholderId = StoryboardStableIdSchema.safeParse(getRouterParam(event, "placeholderId")?.trim() ?? "");
    if (!placeholderId.success) throw createError({statusCode: 400, message: "placeholderId 不合法"});
    const request = await validateBody(event, AuthorizeRequestSchema);
    try {
        const receipt = await getIllustrationExecutionService().authorizeOne({
            projectPath: request.projectPath,
            ownerUserId: user.id,
            placeholderId: placeholderId.data,
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
