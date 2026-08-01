import path from "node:path";
import {ReferenceContentHashSchema} from "nbook/shared/text-to-image-reference-asset";

export const TEXT_TO_IMAGE_ASSET_ROOT = "assets/text-to-image";
export const TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT = ".nbook/text-to-image/references";

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

const REFERENCE_EXTENSION_BY_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "application/octet-stream": ".bin",
} as const;

const REFERENCE_RELATIVE_PATH_PATTERN = /^\.nbook\/text-to-image\/references\/([0-9a-f]{2})\/([0-9a-f]{64})\.(png|jpg|bin)$/u;

/** 按内容寻址的 SHA-256 前缀创建受限 Project 相对路径。 */
export function createReferenceAssetRelativePath(contentHash: string, mimeType: string): string {
    if (!ReferenceContentHashSchema.safeParse(contentHash).success) {
        throw new Error("引用资产内容哈希不合法");
    }
    const extension = referenceExtension(mimeType);
    return `${TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT}/${contentHash.slice(0, 2)}/${contentHash}${extension}`;
}

/** 验证内容寻址相对路径，返回受 Project 根目录约束的绝对路径。 */
export function resolveReferenceAssetPath(projectRoot: string, relativePath: string): string {
    const match = REFERENCE_RELATIVE_PATH_PATTERN.exec(relativePath);
    if (!match || match[1] !== match[2]?.slice(0, 2) || relativePath.includes("\\") || /%2e|%2f|%5c/iu.test(relativePath)) {
        throw new Error("引用资产路径不合法");
    }
    const assetRoot = path.resolve(projectRoot, TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT);
    const absolutePath = path.resolve(projectRoot, relativePath);
    if (!absolutePath.startsWith(`${assetRoot}${path.sep}`)) {
        throw new Error("引用资产路径不合法");
    }
    return absolutePath;
}

function referenceExtension(mimeType: string): ".png" | ".jpg" | ".bin" {
    const extension = REFERENCE_EXTENSION_BY_MIME[mimeType as keyof typeof REFERENCE_EXTENSION_BY_MIME];
    if (!extension) {
        throw new Error("引用资产 MIME 类型不受支持");
    }
    return extension;
}
