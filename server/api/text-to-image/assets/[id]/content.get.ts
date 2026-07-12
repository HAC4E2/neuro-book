import {createError, getQuery, getRouterParam, sendStream, setResponseHeader} from "h3";
import {createReadStream} from "node:fs";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const assetId = getRouterParam(event, "id");
    const projectPath = getQuery(event).projectPath;
    if (!assetId || typeof projectPath !== "string" || !projectPath) {
        throw createError({statusCode: 400, message: "读取文生图图片参数不合法"});
    }
    assertProjectOpenForRoot(projectPath);
    const content = await new TextToImageAssetService().content(projectPath, assetId);
    setResponseHeader(event, "Content-Type", content.mimeType);
    setResponseHeader(event, "Cache-Control", "private, max-age=300");
    return sendStream(event, createReadStream(content.absolutePath));
});
