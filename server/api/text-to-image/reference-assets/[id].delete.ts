import {createError, getRouterParam, readBody} from "h3";
import {z} from "zod";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {throwReferenceAssetHttpError} from "nbook/server/text-to-image/reference-asset-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const DeleteBodySchema = z.object({
    projectPath: z.string().trim().min(1).max(300),
}).strict();

/** 删除未被 Vibe lineage/promotion 引用的 source-image；文件与行在 Project 锁内成对清理。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    await requireCurrentUser(event);
    const assetId = getRouterParam(event, "id");
    const parsed = DeleteBodySchema.safeParse(await readBody(event));
    if (!assetId || !parsed.success) {
        throw createError({
            statusCode: 400,
            message: "delete 参数不合法",
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
    }
    try {
        await new TextToImageReferenceAssetService().delete(parsed.data.projectPath, assetId);
        return {ok: true};
    } catch (error) {
        throwReferenceAssetHttpError(error);
    }
}));
