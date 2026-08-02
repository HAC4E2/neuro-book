import {createError, getRequestHeader, getQuery} from "h3";
import {z} from "zod";
import {VIBE_CONTAINER_MAX_BYTES} from "nbook/shared/text-to-image-vibe-container";
import {VibeImportService} from "nbook/server/text-to-image/vibe-import.service";
import {throwReferenceAssetHttpError} from "nbook/server/text-to-image/reference-asset-http-error";
import {readBoundedFileMultipart} from "nbook/server/utils/bounded-file-multipart";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const ImportQuerySchema = z.object({
    projectPath: z.string().trim().min(1).max(300),
}).strict();

/** 上传并严格解析 `.vibe` / `.naiv4vibe` 容器，all-or-nothing 导入到当前 Project。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    await requireCurrentUser(event);
    const parsed = ImportQuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "projectPath query 不合法",
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
    }
    const projectPath = parsed.data.projectPath;
    assertContentLengthLimit(event);

    let file: Awaited<ReturnType<typeof readBoundedFileMultipart>>;
    try {
        file = await readBoundedFileMultipart(event.node.req, {
            maxFileBytes: VIBE_CONTAINER_MAX_BYTES,
        });
    } catch (error) {
        throwReferenceAssetHttpError(error);
    }
    try {
        return await new VibeImportService().importContainer({
            projectPath,
            bytes: file.bytes,
        });
    } catch (error) {
        throwReferenceAssetHttpError(error);
    }
}));

function assertContentLengthLimit(event: Parameters<typeof getRequestHeader>[0]): void {
    const raw = getRequestHeader(event, "content-length");
    const contentLength = raw ? Number.parseInt(raw, 10) : null;
    if (contentLength !== null && Number.isFinite(contentLength) && contentLength > VIBE_CONTAINER_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
        throw createError({
            statusCode: 413,
            message: "Vibe 容器超过大小限制",
            data: {code: "VIBE_CONTAINER_TOO_LARGE"},
        });
    }
}
