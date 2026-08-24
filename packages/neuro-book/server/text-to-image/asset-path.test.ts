import path from "node:path";
import {describe, expect, it} from "vitest";
import {
    createTextToImageAssetRelativePath,
    resolveTextToImageAssetPath,
    textToImageAssetExtension,
} from "nbook/server/text-to-image/asset-path";

describe("textToImageAssetExtension", () => {
    it("支持 png、jpeg、webp 的扩展名映射", () => {
        expect(textToImageAssetExtension("image/png")).toBe("png");
        expect(textToImageAssetExtension("image/jpeg")).toBe("jpg");
        expect(textToImageAssetExtension("image/webp")).toBe("webp");
    });

    it("不支持的 MIME 类型直接抛错", () => {
        expect(() => textToImageAssetExtension("image/gif")).toThrow(/不支持/);
    });
});

describe("createTextToImageAssetRelativePath", () => {
    it("返回 assets/tti 下的相对路径", () => {
        expect(createTextToImageAssetRelativePath("asset-1", "png")).toBe("assets/tti/asset-1.png");
    });
});

describe("resolveTextToImageAssetPath", () => {
    it("在项目根目录内解析相对路径", () => {
        const root = path.resolve("asset-root");
        expect(resolveTextToImageAssetPath(root, "assets/tti/a.png")).toBe(
            path.join(root, "assets", "tti", "a.png"),
        );
    });

    it("拒绝越过项目根目录的路径", () => {
        const root = path.resolve("asset-root");
        expect(() => resolveTextToImageAssetPath(root, "../secret.png")).toThrow(/越过项目根目录/);
        expect(() => resolveTextToImageAssetPath(root, path.resolve("elsewhere", "x.png"))).toThrow(
            /越过项目根目录/,
        );
    });
});
