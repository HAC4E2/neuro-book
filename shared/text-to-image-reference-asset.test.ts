import {describe, expect, it} from "vitest";
import {
    FrozenReferenceAssetSchema,
    CanonicalInformationExtractedSchema,
    REFERENCE_ASSET_MIME_BY_KIND,
    ReferenceContentHashSchema,
    TextToImageInpaintSelectionSchema,
    TextToImageReferenceAssetDtoSchema,
    TextToImageReferenceAssetPageDtoSchema,
    TextToImageReferenceSelectionSchema,
    VibeEncodingCacheKeySchema,
    canonicalizeInformationExtracted,
    hashVibeEncodingCacheKey,
    hashReferenceSelections,
} from "nbook/shared/text-to-image-reference-asset";

const VALID_HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

describe("TextToImageReferenceAsset shared contract", () => {
    it("新增严格冻结 source-image 证据，并拒绝 WebP、路径和原始字节", () => {
        expect(FrozenReferenceAssetSchema.safeParse({
            contentHash: VALID_HASH,
            kind: "source-image",
            mimeType: "image/png",
            byteLength: 1024,
            width: 768,
            height: 512,
        }).success).toBe(true);
        expect(FrozenReferenceAssetSchema.safeParse({
            contentHash: VALID_HASH,
            kind: "source-image",
            mimeType: "image/webp",
            byteLength: 1024,
            width: 768,
            height: 512,
        }).success).toBe(false);
        expect(FrozenReferenceAssetSchema.safeParse({
            contentHash: VALID_HASH,
            kind: "source-image",
            mimeType: "image/jpeg",
            byteLength: 1024,
            width: 768,
            height: 512,
            relativePath: "assets/private.jpg",
            bytes: [1, 2, 3],
        }).success).toBe(false);
    });

    it("Frozen/Public DTO 共享 20 MiB 与 6400 万像素预算", () => {
        const frozen = {
            contentHash: VALID_HASH,
            kind: "source-image",
            mimeType: "image/png",
            byteLength: 1024,
            width: 16_000,
            height: 5_000,
        };
        expect(FrozenReferenceAssetSchema.safeParse({...frozen, byteLength: 20 * 1024 * 1024 + 1}).success).toBe(false);
        expect(FrozenReferenceAssetSchema.safeParse(frozen).success).toBe(false);
        expect(TextToImageReferenceAssetDtoSchema.safeParse({
            id: VALID_HASH,
            ...frozen,
            fileName: `${VALID_HASH}.png`,
            status: "available",
            createdAt: "2026-07-22T00:00:00.000Z",
        }).success).toBe(false);
    });

    it("新增严格双哈希 Inpaint selection，拒绝旧单 contentHash 和额外字段", () => {
        expect(TextToImageInpaintSelectionSchema.safeParse({
            baseImageContentHash: VALID_HASH,
            maskContentHash: OTHER_HASH,
        }).success).toBe(true);
        expect(TextToImageInpaintSelectionSchema.safeParse(null).success).toBe(true);
        expect(TextToImageInpaintSelectionSchema.safeParse({contentHash: VALID_HASH}).success).toBe(false);
        expect(TextToImageInpaintSelectionSchema.safeParse({
            baseImageContentHash: VALID_HASH,
            maskContentHash: OTHER_HASH,
            dataUrl: "data:image/png;base64,AAAA",
        }).success).toBe(false);
    });

    it("新增严格引用资产分页 DTO，只接受 items/page/pageSize/hasMore", () => {
        const item = {
            id: VALID_HASH,
            kind: "source-image",
            contentHash: VALID_HASH,
            fileName: "a.asset-1.png",
            mimeType: "image/png",
            byteLength: 1024,
            width: 768,
            height: 512,
            status: "available",
            createdAt: "2026-07-22T00:00:00.000Z",
        };

        expect(TextToImageReferenceAssetPageDtoSchema.safeParse({items: [item], page: 1, pageSize: 30, hasMore: false}).success).toBe(true);
        expect(TextToImageReferenceAssetPageDtoSchema.safeParse([item]).success).toBe(false);
        expect(TextToImageReferenceAssetPageDtoSchema.safeParse({
            items: [item],
            page: 1,
            pageSize: 30,
            hasMore: false,
            nextCursor: "asset-2",
        }).success).toBe(false);
    });

    it("为存储层提供稳定的 informationExtracted 规范化与 cache key hash", () => {
        expect(canonicalizeInformationExtracted(0.70)).toBe("0.7");
        const tinyCanonicalInformation = canonicalizeInformationExtracted(1e-7);
        expect(tinyCanonicalInformation).toBe("1e-7");
        expect(CanonicalInformationExtractedSchema.safeParse(tinyCanonicalInformation).success).toBe(true);
        expect(() => CanonicalInformationExtractedSchema.safeParse("not-a-number")).not.toThrow();
        expect(CanonicalInformationExtractedSchema.safeParse("not-a-number").success).toBe(false);
        expect(CanonicalInformationExtractedSchema.safeParse(" 0.7").success).toBe(false);
        expect(CanonicalInformationExtractedSchema.safeParse("0.70").success).toBe(false);
        const key = {
            providerKind: "novelai" as const,
            sourceContentHash: VALID_HASH,
            providerModel: "nai-diffusion-4-5-full" as const,
            canonicalInformation: "0.7",
            encoderVersion: "novelai-vibe/v4-5full/v1" as const,
        };
        const hash = hashVibeEncodingCacheKey(key);
        expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(hashVibeEncodingCacheKey({...key, sourceContentHash: OTHER_HASH})).not.toBe(hash);
        expect(hashVibeEncodingCacheKey({...key, canonicalInformation: "0.8"})).not.toBe(hash);
        expect(VibeEncodingCacheKeySchema.safeParse({...key, providerKind: "other"}).success).toBe(false);
        expect(VibeEncodingCacheKeySchema.safeParse({...key, encoderVersion: "novelai-vibe/v4-5full/v2"}).success).toBe(false);
        expect(VibeEncodingCacheKeySchema.safeParse({
            ...key,
            providerModel: "nai-diffusion-4-full",
        }).success).toBe(false);
    });

    it("reference selection 只持久 contentHash/strength/informationExtracted，拒绝 dataUrl/bytes/token/assetId", () => {
        const ok = TextToImageReferenceSelectionSchema.safeParse({
            contentHash: VALID_HASH,
            strength: 0.6,
            informationExtracted: 0.7,
        });
        expect(ok.success).toBe(true);

        const leak = TextToImageReferenceSelectionSchema.safeParse({
            contentHash: VALID_HASH,
            strength: 0.6,
            informationExtracted: 0.7,
            dataUrl: "data:image/png;base64,AAAA",
            bytes: new Uint8Array([1, 2, 3]),
            token: "secret",
        });
        expect(leak.success).toBe(false);

        // assetId 不属于选择；内容寻址只认 contentHash
        const withAssetId = TextToImageReferenceSelectionSchema.safeParse({
            assetId: "asset-1",
            contentHash: VALID_HASH,
            strength: 0.6,
            informationExtracted: 0.7,
        });
        expect(withAssetId.success).toBe(false);
    });

    it("inpaint 引用的 informationExtracted 可为 null", () => {
        const ok = TextToImageReferenceSelectionSchema.safeParse({
            contentHash: VALID_HASH,
            strength: 1,
            informationExtracted: null,
        });
        expect(ok.success).toBe(true);
    });

    it("contentHash 必须是 64 位 hex，拒绝算法前缀或短 hash", () => {
        expect(ReferenceContentHashSchema.safeParse(`sha256:${VALID_HASH}`).success).toBe(false);
        expect(ReferenceContentHashSchema.safeParse("abcd").success).toBe(false);
        expect(ReferenceContentHashSchema.safeParse(VALID_HASH.toUpperCase()).success).toBe(false);
    });

    it("reference asset DTO 只公开 source metadata，不返回路径或派生字段", () => {
        const sourceAsset = TextToImageReferenceAssetDtoSchema.safeParse({
            id: VALID_HASH,
            kind: "source-image",
            contentHash: VALID_HASH,
            fileName: "a.asset-1.png",
            mimeType: "image/png",
            byteLength: 1024,
            width: 768,
            height: 512,
            status: "available",
            createdAt: "2026-07-22T00:00:00.000Z",
        });
        expect(sourceAsset.success).toBe(true);

        const leaked = TextToImageReferenceAssetDtoSchema.safeParse({
            ...sourceAsset.data,
            relativePath: ".nbook/text-to-image/references/aa/source.png",
            parentAssetId: null,
            derivedModel: null,
            derivedInfoExtracted: null,
        });
        expect(leaked.success).toBe(false);
        expect(TextToImageReferenceAssetDtoSchema.safeParse({
            ...sourceAsset.data,
            id: OTHER_HASH,
        }).success).toBe(false);
    });

    it("reference asset DTO 拒绝 WebP、vibe-encoding 与未知状态", () => {
        const base = {
            id: VALID_HASH,
            kind: "source-image",
            contentHash: VALID_HASH,
            fileName: `${VALID_HASH}.png`,
            mimeType: "image/png",
            byteLength: 2048,
            width: 64,
            height: 64,
            status: "available",
            createdAt: "2026-07-22T00:00:00.000Z",
        };
        expect(TextToImageReferenceAssetDtoSchema.safeParse({...base, mimeType: "image/webp"}).success).toBe(false);
        expect(TextToImageReferenceAssetDtoSchema.safeParse({...base, kind: "vibe-encoding"}).success).toBe(false);
        expect(TextToImageReferenceAssetDtoSchema.safeParse({...base, status: "unknown"}).success).toBe(false);
    });

    it("public source MIME 只允许 PNG/JPEG", () => {
        expect(REFERENCE_ASSET_MIME_BY_KIND["source-image"]).toEqual(["image/png", "image/jpeg"]);
    });

    it("VibeEncodingCacheKey 固定 provider/encoder，并持久完整 typed identity", () => {
        const ok = VibeEncodingCacheKeySchema.safeParse({
            providerKind: "novelai",
            sourceContentHash: VALID_HASH,
            providerModel: "nai-diffusion-4-5-full",
            canonicalInformation: "0.7",
            encoderVersion: "novelai-vibe/v4-5full/v1",
        });
        expect(ok.success).toBe(true);
        expect(VibeEncodingCacheKeySchema.safeParse({
            sourceContentHash: VALID_HASH,
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.7,
        }).success).toBe(false);
    });

    it("hashReferenceSelections 稳定且包含全部三类引用", () => {
        const hash = hashReferenceSelections({
            vibeReferences: [{contentHash: VALID_HASH, strength: 0.6, informationExtracted: 0.7}],
            characterReferences: [{contentHash: OTHER_HASH, strength: 0.5, informationExtracted: 0.6}],
            inpaint: {contentHash: "c".repeat(64), strength: 1, informationExtracted: null},
        });
        expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u);

        // 改变任意 strength 必须产生不同 hash
        const hash2 = hashReferenceSelections({
            vibeReferences: [{contentHash: VALID_HASH, strength: 0.7, informationExtracted: 0.7}],
            characterReferences: [{contentHash: OTHER_HASH, strength: 0.5, informationExtracted: 0.6}],
            inpaint: {contentHash: "c".repeat(64), strength: 1, informationExtracted: null},
        });
        expect(hash2).not.toBe(hash);
    });

    it("空引用集合也产生稳定 hash", () => {
        const hash = hashReferenceSelections({vibeReferences: [], characterReferences: [], inpaint: null});
        expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    });
});
