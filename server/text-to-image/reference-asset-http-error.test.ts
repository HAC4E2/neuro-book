import {createError} from "h3";
import {
    BoundedFileMultipartError,
} from "nbook/server/utils/bounded-file-multipart";
import {
    TextToImageReferenceAssetInUseError,
    TextToImageReferenceAssetNotFoundError,
} from "nbook/server/text-to-image/reference-asset.service";
import {TextToImageReferenceLockError} from "nbook/server/text-to-image/reference-asset-lock";
import {TextToImageReferenceImageError} from "nbook/server/text-to-image/reference-image";
import {describe, expect, it} from "vitest";
import {throwReferenceAssetHttpError} from "nbook/server/text-to-image/reference-asset-http-error";

describe("reference-asset HTTP 错误映射", () => {
    it.each([
        [
            new TextToImageReferenceImageError("REFERENCE_IMAGE_TOO_LARGE", "too large"),
            413,
            "REFERENCE_IMAGE_TOO_LARGE",
        ],
        [
            new TextToImageReferenceImageError("REFERENCE_IMAGE_UNSUPPORTED", "unsupported"),
            400,
            "REFERENCE_IMAGE_UNSUPPORTED",
        ],
        [
            new TextToImageReferenceImageError("REFERENCE_IMAGE_INVALID", "invalid"),
            400,
            "REFERENCE_IMAGE_INVALID",
        ],
        [
            new TextToImageReferenceImageError("REFERENCE_IMAGE_MIME_MISMATCH", "mime"),
            400,
            "REFERENCE_IMAGE_MIME_MISMATCH",
        ],
        [
            new TextToImageReferenceImageError("REFERENCE_IMAGE_DIMENSIONS_INVALID", "dimensions"),
            400,
            "REFERENCE_IMAGE_DIMENSIONS_INVALID",
        ],
        [
            new TextToImageReferenceImageError("REFERENCE_ASSET_MISSING", "missing"),
            404,
            "REFERENCE_ASSET_MISSING",
        ],
        [
            new TextToImageReferenceImageError("REFERENCE_ASSET_TAMPERED", "tampered"),
            409,
            "REFERENCE_ASSET_TAMPERED",
        ],
    ] as const)("图片领域错误 %s → %i %s", (error, statusCode, code) => {
        expect(() => throwReferenceAssetHttpError(error)).toThrow(expect.objectContaining({
            statusCode,
            data: {code},
        }));
    });

    it("multipart 错误映射为稳定 400/413", () => {
        expect(() => throwReferenceAssetHttpError(
            new BoundedFileMultipartError("INVALID_FILE_MULTIPART", "invalid", 400),
        )).toThrow(expect.objectContaining({
            statusCode: 400,
            data: {code: "INVALID_REFERENCE_ASSET_MULTIPART"},
        }));
        expect(() => throwReferenceAssetHttpError(
            new BoundedFileMultipartError("FILE_MULTIPART_LIMIT_EXCEEDED", "limit", 413),
        )).toThrow(expect.objectContaining({
            statusCode: 413,
            data: {code: "REFERENCE_IMAGE_TOO_LARGE"},
        }));
        expect(() => throwReferenceAssetHttpError(
            new BoundedFileMultipartError("FILE_MULTIPART_ABORTED", "aborted", 400),
        )).toThrow(expect.objectContaining({
            statusCode: 400,
            data: {code: "FILE_MULTIPART_ABORTED"},
        }));
    });

    it("NotFound/InUse 映射为 404/409", () => {
        expect(() => throwReferenceAssetHttpError(
            new TextToImageReferenceAssetNotFoundError("a".repeat(64)),
        )).toThrow(expect.objectContaining({
            statusCode: 404,
            data: {code: "TEXT_TO_IMAGE_REFERENCE_ASSET_NOT_FOUND"},
        }));
        expect(() => throwReferenceAssetHttpError(
            new TextToImageReferenceAssetInUseError("a".repeat(64)),
        )).toThrow(expect.objectContaining({
            statusCode: 409,
            data: {code: "TEXT_TO_IMAGE_REFERENCE_ASSET_IN_USE"},
        }));
    });

    it("锁不可用映射为 503，锁内部错误映射为 500", () => {
        expect(() => throwReferenceAssetHttpError(
            new TextToImageReferenceLockError("REFERENCE_MUTATION_LOCK_UNAVAILABLE", "unavailable"),
        )).toThrow(expect.objectContaining({
            statusCode: 503,
            data: {code: "REFERENCE_MUTATION_LOCK_UNAVAILABLE"},
        }));
        expect(() => throwReferenceAssetHttpError(
            new TextToImageReferenceLockError("REFERENCE_MUTATION_LOCK_NESTED", "nested"),
        )).toThrow(expect.objectContaining({
            statusCode: 500,
            data: {code: "REFERENCE_MUTATION_LOCK_NESTED"},
        }));
    });

    it("未知错误原样传播", () => {
        const boom = new Error("boom");
        expect(() => throwReferenceAssetHttpError(boom)).toThrow(boom);
    });

    it("mapped 错误是可被 h3 消费的 createError 形状", () => {
        const error = createError({statusCode: 409, message: "tampered", data: {code: "REFERENCE_ASSET_TAMPERED"}});
        expect(error.statusCode).toBe(409);
        expect(error.data).toEqual({code: "REFERENCE_ASSET_TAMPERED"});
    });
});
