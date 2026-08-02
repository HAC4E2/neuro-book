import {createError, getQuery} from "h3";
import {z} from "zod";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const ListQuerySchema = z.object({
    projectPath: z.string().trim().min(1).max(300),
    page: z.string().regex(/^[1-9]\d*$/u).transform(Number).optional(),
    pageSize: z.string().regex(/^[1-9]\d*$/u).transform(Number).optional(),
}).strict();

/** 列出 Project source-image 元数据；只做 DB + stat 检查，不返回 bytes。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    await requireCurrentUser(event);
    const parsed = ListQuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "list query 不合法",
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
    }
    return await new TextToImageReferenceAssetService().list(parsed.data);
}));
