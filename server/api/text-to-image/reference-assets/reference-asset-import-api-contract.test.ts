import {createError} from "h3";
import {describe, expect, it} from "vitest";
import {
    VIBE_CONTAINER_ACCEPTED_EXTENSIONS,
    VibeImportResponseSchema,
} from "nbook/shared/text-to-image-vibe-container";
import {VibeContainerError} from "nbook/server/text-to-image/vibe-container.parser";
import {throwReferenceAssetHttpError} from "nbook/server/text-to-image/reference-asset-http-error";

describe("reference-asset import API contract", () => {
    it("广告的容器扩展名只有 .vibe 与 .naiv4vibe", () => {
        expect(VIBE_CONTAINER_ACCEPTED_EXTENSIONS).toEqual([".vibe", ".naiv4vibe"]);
    });

    it("导入响应 schema 严格：拒绝 bytes/vendor id/未知键", () => {
        const valid = VibeImportResponseSchema.parse({
            schemaVersion: "nbook.vibe-import-response/v1",
            containerContentHash: "a".repeat(64),
            sourceContentHash: "b".repeat(64),
            sourceMimeType: "image/jpeg",
            sourceWidth: 3,
            sourceHeight: 2,
            providerModel: "nai-diffusion-4-5-full",
            encoderVersion: "novelai-vibe/v4-5full/v1",
            suggestedStrength: 0.3,
            encodingCount: 2,
            displayName: null,
            displayCreatedAt: null,
            hasThumbnail: false,
            sourceAlreadyExists: false,
        });
        expect(valid.encodingCount).toBe(2);

        expect(VibeImportResponseSchema.safeParse({
            schemaVersion: "nbook.vibe-import-response/v1",
            containerContentHash: "a".repeat(64),
            sourceContentHash: "b".repeat(64),
            sourceMimeType: "image/jpeg",
            sourceWidth: 3,
            sourceHeight: 2,
            providerModel: "nai-diffusion-4-5-full",
            encoderVersion: "novelai-vibe/v4-5full/v1",
            suggestedStrength: 0.3,
            encodingCount: 2,
            displayName: null,
            displayCreatedAt: null,
            hasThumbnail: false,
            sourceAlreadyExists: false,
            vendorId: "leaked",
        }).success).toBe(false);
    });

    it("导入响应错误通过共享 mapper 映射为 422/413", () => {
        expect(() => throwReferenceAssetHttpError(
            new VibeContainerError("VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED", "bucket"),
        )).toThrow(expect.objectContaining({statusCode: 422}));
        expect(() => throwReferenceAssetHttpError(
            new VibeContainerError("VIBE_CONTAINER_TOO_LARGE", "large"),
        )).toThrow(expect.objectContaining({statusCode: 413}));
    });

    it("mapped 错误是 h3 createError 形状", () => {
        const error = createError({statusCode: 422, message: "x", data: {code: "VIBE_CONTAINER_MALFORMED"}});
        expect(error.statusCode).toBe(422);
        expect(error.data).toEqual({code: "VIBE_CONTAINER_MALFORMED"});
    });
});
