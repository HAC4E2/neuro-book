import {createReadStream} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {createError, sendStream, setResponseHeader} from "h3";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
};

/**
 * 读取 NovelAI 已保存的本地图片，供正文 Markdown 图片预览使用。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const rawPath = typeof query.path === "string" ? query.path : "";
    const imagePath = rawPath.trim();
    if (!imagePath || !path.isAbsolute(imagePath)) {
        throw createError({statusCode: 400, message: "图片路径必须是本地绝对路径"});
    }

    const extension = path.extname(imagePath).toLocaleLowerCase();
    const mimeType = IMAGE_MIME_BY_EXTENSION[extension];
    if (!mimeType) {
        throw createError({statusCode: 400, message: "只支持 png、jpg、jpeg、webp 图片"});
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
        stat = await fs.stat(imagePath);
    } catch {
        throw createError({statusCode: 404, message: "图片不存在"});
    }
    if (!stat.isFile()) {
        throw createError({statusCode: 400, message: "图片路径不是文件"});
    }

    setResponseHeader(event, "Content-Type", mimeType);
    setResponseHeader(event, "Cache-Control", "private, max-age=60");
    return sendStream(event, createReadStream(imagePath));
});