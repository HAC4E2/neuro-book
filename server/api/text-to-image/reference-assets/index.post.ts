import {createError, getRequestHeader, getQuery} from "h3";
import {z} from "zod";
import {MAX_REFERENCE_IMAGE_BYTES} from "nbook/server/text-to-image/reference-image";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {throwReferenceAssetHttpError} from "nbook/server/text-to-image/reference-asset-http-error";
import {readBoundedFileMultipart} from "nbook/server/utils/bounded-file-multipart";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** 公开 source-image 上传：query 只允许非空 projectPath；multipart 只允许一个 file part、零字段。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const projectPath = parseStrictProjectPathQuery(event);
    assertContentLengthLimit(event);

    let file: Awaited<ReturnType<typeof readBoundedFileMultipart>>;
    try {
        file = await readBoundedFileMultipart(event.node.req, {
            maxFileBytes: MAX_REFERENCE_IMAGE_BYTES,
        });
    } catch (error) {
        throwReferenceAssetHttpError(error);
    }
    try {
        return await new TextToImageReferenceAssetService().upload({
            projectPath,
            bytes: file.bytes,
            fileName: file.name,
        });
    } catch (error) {
        throwReferenceAssetHttpError(error);
    }
}));

/** query 严格解析：只有非空 projectPath，拒绝 kind/parent/derived 等 Vibe 派生字段。 */
function parseStrictProjectPathQuery(event: Parameters<typeof getQuery>[0]): string {
    const parsed = StrictProjectPathQuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "projectPath query 不合法",
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
    }
    return parsed.data.projectPath;
}

const StrictProjectPathQuerySchema = z.object({
    projectPath: z.string().trim().min(1).max(300),
}).strict();

function assertContentLengthLimit(event: Parameters<typeof getRequestHeader>[0]): void {
    const raw = getRequestHeader(event, "content-length");
    const contentLength = raw ? Number.parseInt(raw, 10) : null;
    if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAX_REFERENCE_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES) {
        throw createError({
            statusCode: 413,
            message: "参考图片上传超过大小限制",
            data: {code: "REFERENCE_IMAGE_TOO_LARGE"},
        });
    }
}
