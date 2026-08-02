import {createError} from "h3";
import {BoundedFileMultipartError} from "nbook/server/utils/bounded-file-multipart";
import {
    TextToImageReferenceAssetInUseError,
    TextToImageReferenceAssetNotFoundError,
} from "nbook/server/text-to-image/reference-asset.service";
import {TextToImageReferenceLockError} from "nbook/server/text-to-image/reference-asset-lock";
import {TextToImageReferenceImageError} from "nbook/server/text-to-image/reference-image";
import {VibeContainerError} from "nbook/server/text-to-image/vibe-container.parser";

/**
 * 把 reference-asset 领域错误统一映射为 API 稳定 HTTP contract。
 * 所有 reference 路由都必须使用本 mapper，禁止局部重复 instanceof 映射。
 */
export function throwReferenceAssetHttpError(error: unknown): never {
    if (error instanceof VibeContainerError) {
        const statusCode = error.code === "VIBE_CONTAINER_TOO_LARGE" ? 413 : 422;
        throw createError({
            statusCode,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof BoundedFileMultipartError) {
        if (error.code === "FILE_MULTIPART_LIMIT_EXCEEDED") {
            throw createError({
                statusCode: 413,
                message: "参考图片超过允许大小",
                data: {code: "REFERENCE_IMAGE_TOO_LARGE"},
            });
        }
        if (error.code === "FILE_MULTIPART_ABORTED") {
            throw createError({
                statusCode: 400,
                message: "上传请求已中止",
                data: {code: "FILE_MULTIPART_ABORTED"},
            });
        }
        throw createError({
            statusCode: 400,
            message: "multipart 必须且只能包含一个 file",
            data: {code: "INVALID_REFERENCE_ASSET_MULTIPART"},
        });
    }
    if (error instanceof TextToImageReferenceImageError) {
        switch (error.code) {
            case "REFERENCE_IMAGE_TOO_LARGE":
                throw createError({statusCode: 413, message: error.message, data: {code: error.code}});
            case "REFERENCE_ASSET_MISSING":
                throw createError({statusCode: 404, message: error.message, data: {code: error.code}});
            case "REFERENCE_ASSET_TAMPERED":
                throw createError({statusCode: 409, message: error.message, data: {code: error.code}});
            default:
                throw createError({statusCode: 400, message: error.message, data: {code: error.code}});
        }
    }
    if (error instanceof TextToImageReferenceAssetNotFoundError) {
        throw createError({statusCode: 404, message: error.message, data: {code: error.code}});
    }
    if (error instanceof TextToImageReferenceAssetInUseError) {
        throw createError({statusCode: 409, message: error.message, data: {code: error.code}});
    }
    if (error instanceof TextToImageReferenceLockError) {
        if (error.code === "REFERENCE_MUTATION_LOCK_UNAVAILABLE") {
            throw createError({
                statusCode: 503,
                message: "参考资产变更锁暂不可用，请稍后重试",
                data: {code: error.code},
            });
        }
        throw createError({
            statusCode: 500,
            message: error.message,
            data: {code: error.code},
        });
    }
    throw error;
}
