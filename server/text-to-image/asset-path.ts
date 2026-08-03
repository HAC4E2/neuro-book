import path from "node:path";

const TEXT_TO_IMAGE_ASSET_EXTENSIONS: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
};

/** MIME 类型到文生图资产文件扩展名的映射；不支持的 MIME 直接抛错。*/
export function textToImageAssetExtension(mimeType: string): string {
    const extension = TEXT_TO_IMAGE_ASSET_EXTENSIONS[mimeType];
    if (!extension) {
        throw new Error(`不支持的文生图资产 MIME 类型：${mimeType}`);
    }
    return extension;
}

/** 生成 assets/tti 下的资产相对路径。*/
export function createTextToImageAssetRelativePath(id: string, extension: string): string {
    return `assets/tti/${id}.${extension}`;
}

/** 解析资产绝对路径，并用词法校验阻止相对路径逃逸出项目根目录。*/
export function resolveTextToImageAssetPath(projectRoot: string, relativePath: string): string {
    const resolved = path.resolve(projectRoot, relativePath);
    const relative = path.relative(projectRoot, resolved);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`文生图资产路径越过项目根目录：${relativePath}`);
    }
    return resolved;
}
