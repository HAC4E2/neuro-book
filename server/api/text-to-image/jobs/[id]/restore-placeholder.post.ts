import {createError, getRouterParam} from "h3";
import {z} from "zod";
import {IllustrationResultError, IllustrationResultService} from "nbook/server/text-to-image/illustration-result.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {textToImageProjectRef} from "nbook/server/text-to-image/compat";

const BodySchema = z.object({
    projectPath: z.string().trim().min(1),
    assetId: z.string().trim().min(1).max(200),
}).strict();

/**
 * 重roll第一步：把已插入正文的插图结果还原为 V2 placeholder。
 * 之后前端走标准 status → execution-preview → generate 链路重新生成；
 * 旧 Asset 与图片文件保留在历史中，不做删除。
 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const user = await requireCurrentUser(event);
    const jobId = getRouterParam(event, "id");
    const parsed = BodySchema.safeParse(await readBody(event));
    if (!jobId || !parsed.success) {
        throw createError({statusCode: 400, message: "还原插图占位块参数不合法"});
    }
    assertProjectOpen(textToImageProjectRef(parsed.data.projectPath));
    try {
        return await new IllustrationResultService().restoreAssetPlaceholder({
            projectPath: parsed.data.projectPath,
            ownerUserId: user.id,
            jobId,
            assetId: parsed.data.assetId,
        });
    } catch (error) {
        if (error instanceof IllustrationResultError) {
            throw createError({statusCode: 409, message: error.message, data: {code: error.code}});
        }
        throw error;
    }
}));
