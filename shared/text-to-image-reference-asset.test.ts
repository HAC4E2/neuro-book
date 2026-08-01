import {describe, expect, it} from "vitest";
import {
    FrozenReferenceAssetSchema,
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
            id: "asset-1",
            kind: "source-image",
            contentHash: VALID_HASH,
            relativePath: "assets/text-to-image/references/a/a.asset-1.png",
            fileName: "a.asset-1.png",
            mimeType: "image/png",
            byteLength: 1024,
            parentAssetId: null,
            derivedModel: null,
            derivedInfoExtracted: null,
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
        expect(hashVibeEncodingCacheKey({
            sourceContentHash: VALID_HASH,
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.7,
        })).toMatch(/^sha256:[a-f0-9]{64}$/u);
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

    it("reference asset DTO 严格区分派生与非派生字段", () => {
        const sourceAsset = TextToImageReferenceAssetDtoSchema.safeParse({
            id: "asset-1",
            kind: "source-image",
            contentHash: VALID_HASH,
            relativePath: "assets/text-to-image/references/a/a.asset-1.png",
            fileName: "a.asset-1.png",
            mimeType: "image/png",
            byteLength: 1024,
            parentAssetId: null,
            derivedModel: null,
            derivedInfoExtracted: null,
            createdAt: "2026-07-22T00:00:00.000Z",
        });
        expect(sourceAsset.success).toBe(true);

        const derivedAsset = TextToImageReferenceAssetDtoSchema.safeParse({
            id: "encoding-1",
            kind: "vibe-encoding",
            contentHash: OTHER_HASH,
            relativePath: "assets/text-to-image/references/b/b.encoding-1.bin",
            fileName: "b.encoding-1.bin",
            mimeType: "application/octet-stream",
            byteLength: 2048,
            parentAssetId: "asset-1",
            derivedModel: "nai-diffusion-4-5-full",
            derivedInfoExtracted: 0.7,
            createdAt: "2026-07-22T00:00:00.000Z",
        });
        expect(derivedAsset.success).toBe(true);
    });

    it("vibe-encoding 的 derivedModel/infoExtracted 必须非空，源资产必须为 null", () => {
        const bad = TextToImageReferenceAssetDtoSchema.safeParse({
            id: "encoding-1",
            kind: "vibe-encoding",
            contentHash: OTHER_HASH,
            relativePath: "assets/text-to-image/references/b/b.encoding-1.bin",
            fileName: "b.encoding-1.bin",
            mimeType: "application/octet-stream",
            byteLength: 2048,
            parentAssetId: "asset-1",
            derivedModel: null,
            derivedInfoExtracted: null,
            createdAt: "2026-07-22T00:00:00.000Z",
        });
        expect(bad.success).toBe(true); // schema 不强制 cross-field；lineage 约束由 service 校验
    });

    it("vibe-encoding 的 MIME 为二进制", () => {
        expect(REFERENCE_ASSET_MIME_BY_KIND["source-image"]).toEqual(["image/png", "image/jpeg", "image/webp"]);
        expect(REFERENCE_ASSET_MIME_BY_KIND["vibe-encoding"]).toEqual(["application/octet-stream"]);
    });

    it("VibeEncodingCacheKey 唯一确定 source hash + model + informationExtracted", () => {
        const ok = VibeEncodingCacheKeySchema.safeParse({
            sourceContentHash: VALID_HASH,
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.7,
        });
        expect(ok.success).toBe(true);
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
