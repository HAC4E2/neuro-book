import path from "node:path";
import {describe, expect, it} from "vitest";
import {
    createTextToImageAssetRelativePath,
    resolveTextToImageAssetPath,
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

