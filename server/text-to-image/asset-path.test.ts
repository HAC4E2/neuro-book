import path from "node:path";
import {describe, expect, it} from "vitest";
import {
    createReferenceAssetRelativePath,
    createTextToImageAssetRelativePath,
    resolveReferenceAssetPath,
    resolveTextToImageAssetPath,
    TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT,
} from "nbook/server/text-to-image/asset-path";

describe("文生图资产路径", () => {
    it("按年月和资产 ID 创建受限的 Project 相对路径", () => {
        expect(createTextToImageAssetRelativePath("asset-1", ".png", new Date("2026-07-11T00:00:00.000Z")))
            .toBe("assets/text-to-image/2026/07/asset-1.png");
    });

    it("拒绝越界、绝对路径和不受支持的扩展名", () => {
        const projectRoot = path.join("C:\\", "temp", "project");
        expect(() => resolveTextToImageAssetPath(projectRoot, "assets/text-to-image/2026/07/asset-1.png"))
            .not.toThrow();
        expect(() => resolveTextToImageAssetPath(projectRoot, "assets/text-to-image/2026/07/../secret.png"))
            .toThrow("文生图资产路径不合法");
        expect(() => resolveTextToImageAssetPath(projectRoot, "C:/temp/asset.png"))
            .toThrow("文生图资产路径不合法");
        expect(() => createTextToImageAssetRelativePath("asset-1", ".svg"))
            .toThrow("文生图资产扩展名不受支持");
    });
});

describe("文生图引用资产路径", () => {
    const contentHash = "ab".repeat(32);

    it("把源图和 sidecar 固定到 Project .nbook 下的内容寻址目录", () => {
        expect(TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT).toBe(".nbook/text-to-image/references");
        expect(createReferenceAssetRelativePath(contentHash, "image/png"))
            .toBe(`.nbook/text-to-image/references/ab/${contentHash}.png`);
        expect(createReferenceAssetRelativePath(contentHash, "image/jpeg"))
            .toBe(`.nbook/text-to-image/references/ab/${contentHash}.jpg`);
        expect(createReferenceAssetRelativePath(contentHash, "application/octet-stream"))
            .toBe(`.nbook/text-to-image/references/ab/${contentHash}.bin`);
    });

    it("只接受 canonical hash、canonical 扩展名和匹配的二级目录", () => {
        const projectRoot = path.join("C:\\", "temp", "project");
        const valid = createReferenceAssetRelativePath(contentHash, "image/png");

        expect(resolveReferenceAssetPath(projectRoot, valid))
            .toBe(path.resolve(projectRoot, ...valid.split("/")));
        expect(() => createReferenceAssetRelativePath(contentHash, "image/webp"))
            .toThrow("引用资产 MIME 类型不受支持");
        expect(() => createReferenceAssetRelativePath(contentHash.toUpperCase(), "image/png"))
            .toThrow("引用资产内容哈希不合法");
        expect(() => resolveReferenceAssetPath(
            projectRoot,
            `.nbook/text-to-image/references/ff/${contentHash}.png`,
        )).toThrow("引用资产路径不合法");
        expect(() => resolveReferenceAssetPath(
            projectRoot,
            `.nbook/text-to-image/references/ab/${contentHash}.jpeg`,
        )).toThrow("引用资产路径不合法");
        expect(() => resolveReferenceAssetPath(projectRoot, "../secret.png"))
            .toThrow("引用资产路径不合法");
    });
});
