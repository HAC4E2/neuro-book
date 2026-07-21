import {createError, getRouterParam, getQuery} from "h3";
import {TextToImageReferenceAssetNotFoundError, TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";

/** 按 assetId 读取参考资产 DTO；不返回 bytes。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const assetId = getRouterParam(event, "id");
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath.trim() : "";
    if (!assetId || !projectPath) {
        throw createError({statusCode: 400, message: "参数不合法"});
    }
    assertProjectOpenForRoot(projectPath);
    try {
        return await new TextToImageReferenceAssetService().read(projectPath, assetId);
    } catch (error) {
        if (error instanceof TextToImageReferenceAssetNotFoundError) {
            throw createError({statusCode: 404, data: {code: error.code}, message: error.message});
        }
        throw error;
    }
});
