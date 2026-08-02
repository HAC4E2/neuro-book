import {createError, getQuery, getRouterParam} from "h3";
import {z} from "zod";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {throwReferenceAssetHttpError} from "nbook/server/text-to-image/reference-asset-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const ReadQuerySchema = z.object({
    projectPath: z.string().trim().min(1).max(300),
}).strict();

/** 按 assetId 读取 source-image 元数据；不返回 bytes。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const assetId = getRouterParam(event, "id");
    const parsed = ReadQuerySchema.safeParse(getQuery(event));
    if (!assetId || !parsed.success) {
        throw createError({
            statusCode: 400,
            message: "read 参数不合法",
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
    }
    try {
        return await new TextToImageReferenceAssetService().read(parsed.data.projectPath, assetId);
    } catch (error) {
        throwReferenceAssetHttpError(error);
    }
}));
