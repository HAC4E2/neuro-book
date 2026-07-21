import {createError} from "h3";
import {ProjectOverlayError} from "nbook/server/text-to-image/project-overlay.service";

/** 把 Project overlay 领域错误映射为稳定 400/409 HTTP 出口。 */
export function throwProjectOverlayHttpError(error: unknown): never {
    if (error instanceof ProjectOverlayError) {
        throw createError({
            statusCode: error.code === "PROJECT_OVERLAY_INVALID" ? 400 : 409,
            message: error.message,
            data: {code: error.code},
        });
    }
    throw error;
}
