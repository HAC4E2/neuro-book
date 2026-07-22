import {createReadStream} from "node:fs";
import {createError, getRouterParam, getQuery, sendStream, setResponseHeader} from "h3";
import {TextToImageReferenceAssetNotFoundError, TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";

/** 流式返回参考资产字节，供 Recipe 预览与 adapter 内部消费。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const assetId = getRouterParam(event, "id");
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath.trim() : "";
    if (!assetId || !projectPath) {
        throw createError({statusCode: 400, message: "参数不合法"});
    }
    assertProjectOpen(projectPath);
    try {
        const content = await new TextToImageReferenceAssetService().content(projectPath, assetId);
        setResponseHeader(event, "Content-Type", content.mimeType);
        setResponseHeader(event, "Cache-Control", "private, max-age=60");
        return sendStream(event, createReadStream(content.absolutePath));
    } catch (error) {
        if (error instanceof TextToImageReferenceAssetNotFoundError) {
            throw createError({statusCode: 404, data: {code: error.code}, message: error.message});
        }
        throw error;
    }
});
