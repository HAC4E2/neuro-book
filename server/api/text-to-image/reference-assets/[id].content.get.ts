import {createReadStream} from "node:fs";
import {createError, getQuery, getRouterParam, sendStream, setResponseHeader} from "h3";
import {z} from "zod";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {throwReferenceAssetHttpError} from "nbook/server/text-to-image/reference-asset-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const ContentQuerySchema = z.object({
    projectPath: z.string().trim().min(1).max(300),
}).strict();

/** 完整复验通过后流式返回 source-image 字节；校验失败绝不输出任何字节。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    await requireCurrentUser(event);
    const assetId = getRouterParam(event, "id");
    const parsed = ContentQuerySchema.safeParse(getQuery(event));
    if (!assetId || !parsed.success) {
        throw createError({
            statusCode: 400,
            message: "content 参数不合法",
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
    }
    let content: Awaited<ReturnType<TextToImageReferenceAssetService["content"]>>;
    try {
        content = await new TextToImageReferenceAssetService().content(parsed.data.projectPath, assetId);
    } catch (error) {
        throwReferenceAssetHttpError(error);
    }
    setResponseHeader(event, "Content-Type", content.mimeType);
    setResponseHeader(event, "Cache-Control", "private, max-age=60");
    return sendStream(event, createReadStream(content.absolutePath));
}));
