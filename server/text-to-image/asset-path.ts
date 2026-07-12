import path from "node:path";

export const TEXT_TO_IMAGE_ASSET_ROOT = "assets/text-to-image";

const EXTENSION_TO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
} as const;

const RELATIVE_PATH_PATTERN = /^assets\/text-to-image\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\.(png|jpg|jpeg|webp)$/u;

/** 根据资产 ID 与创建月份生成唯一且受限的 Project 相对路径。 */
export function createTextToImageAssetRelativePath(assetId: string, extension: string, now = new Date()): string {
    const normalizedExtension = extension.toLowerCase();
    if (!(normalizedExtension in EXTENSION_TO_MIME)) {
        throw new Error("文生图资产扩展名不受支持");
    }
    if (!/^[A-Za-z0-9-]+$/u.test(assetId)) {
        throw new Error("文生图资产 ID 不合法");
    }
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${TEXT_TO_IMAGE_ASSET_ROOT}/${year}/${month}/${assetId}${normalizedExtension}`;
}

/** 验证持久化相对路径，并返回受 Project 根目录约束的绝对路径。 */
export function resolveTextToImageAssetPath(projectRoot: string, relativePath: string): string {
    if (!RELATIVE_PATH_PATTERN.test(relativePath) || relativePath.includes("\\") || /%2e|%2f|%5c/iu.test(relativePath)) {
        throw new Error("文生图资产路径不合法");
    }
    const assetRoot = path.resolve(projectRoot, TEXT_TO_IMAGE_ASSET_ROOT);
    const absolutePath = path.resolve(projectRoot, relativePath);
    if (!absolutePath.startsWith(`${assetRoot}${path.sep}`)) {
        throw new Error("文生图资产路径不合法");
    }
    return absolutePath;
}

/** 把受支持的 MIME 类型映射为资产扩展名。 */
export function textToImageAssetExtension(mimeType: string): keyof typeof EXTENSION_TO_MIME {
    const entry = Object.entries(EXTENSION_TO_MIME).find(([, supportedMimeType]) => supportedMimeType === mimeType);
    if (!entry) {
        throw new Error("文生图图片类型不受支持");
    }
    return entry[0] as keyof typeof EXTENSION_TO_MIME;
}
