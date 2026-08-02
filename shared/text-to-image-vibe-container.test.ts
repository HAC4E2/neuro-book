import {describe, expect, it} from "vitest";
import {
    VIBE_CONTAINER_ACCEPTED_EXTENSIONS,
    VIBE_CONTAINER_MAX_BYTES,
    VIBE_ENCODING_MAX_BYTES,
    VIBE_SOURCE_MAX_BYTES,
    VIBE_THUMBNAIL_MAX_BYTES,
    VIBE_CONTAINER_BUCKET,
    VIBE_CONTAINER_MAX_JSON_DEPTH,
    VIBE_CONTAINER_MAX_JSON_KEYS,
    VIBE_CONTAINER_NAME_MAX,
    VibeImportResponseSchema,
} from "nbook/shared/text-to-image-vibe-container";

describe("Vibe 容器共享契约", () => {
    it("limits 与扩展名符合 spec", () => {
        expect(VIBE_CONTAINER_MAX_BYTES).toBe(32 * 1024 * 1024);
        expect(VIBE_CONTAINER_MAX_JSON_DEPTH).toBe(8);
        expect(VIBE_CONTAINER_MAX_JSON_KEYS).toBe(256);
        expect(VIBE_SOURCE_MAX_BYTES).toBe(20 * 1024 * 1024);
        expect(VIBE_ENCODING_MAX_BYTES).toBe(1024 * 1024);
        expect(VIBE_THUMBNAIL_MAX_BYTES).toBe(2 * 1024 * 1024);
        expect(VIBE_CONTAINER_NAME_MAX).toBe(256);
        expect(VIBE_CONTAINER_ACCEPTED_EXTENSIONS).toEqual([".vibe", ".naiv4vibe"]);
        expect(VIBE_CONTAINER_BUCKET).toBe("v4-5full");
    });

    it("导入响应是严格 DTO：不含 bytes/vendor id，只暴露脱敏结果", () => {
        const parsed = VibeImportResponseSchema.parse({
            schemaVersion: "nbook.vibe-import-response/v1",
            containerContentHash: "a".repeat(64),
            sourceContentHash: "b".repeat(64),
            sourceMimeType: "image/png",
            sourceWidth: 3,
            sourceHeight: 2,
            providerModel: "nai-diffusion-4-5-full",
            encoderVersion: "novelai-vibe/v4-5full/v1",
            suggestedStrength: 0,
            encodingCount: 1,
            displayName: "样本",
            displayCreatedAt: "2026-08-01T00:00:00.000Z",
            hasThumbnail: true,
            sourceAlreadyExists: true,
        });
        expect(parsed.suggestedStrength).toBe(0);
        expect(parsed.encodingCount).toBe(1);
    });

    it("导入响应拒绝多余字段与非法枚举", () => {
        expect(VibeImportResponseSchema.safeParse({
            schemaVersion: "nbook.vibe-import-response/v1",
            containerContentHash: "a".repeat(64),
            sourceContentHash: "b".repeat(64),
            sourceMimeType: "image/webp",
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
        }).success).toBe(false);
    });
});
