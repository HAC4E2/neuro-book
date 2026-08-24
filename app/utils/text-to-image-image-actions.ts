import {triggerBrowserDownload} from "nbook/app/utils/browser-download";

export async function readImageBlob(
    url: string,
    fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
    let response: Response;
    try {
        response = await fetchImpl(url);
    } catch {
        throw new Error("无法读取原图，请刷新资产后重试");
    }
    if (!response.ok) {
        throw new Error("无法读取原图，请刷新资产后重试");
    }
    try {
        const blob = await response.blob();
        const responseMimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        const mimeType = responseMimeType || blob.type.toLowerCase();
        if (blob.size <= 0 || (mimeType !== "" && !mimeType.startsWith("image/"))) {
            throw new Error("invalid image response");
        }
        return blob;
    } catch {
        throw new Error("无法读取原图，请刷新资产后重试");
    }
}

export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard || typeof clipboard.write !== "function" || typeof globalThis.ClipboardItem !== "function") {
        throw new Error("当前环境不支持复制图片，请使用下载");
    }
    try {
        // ClipboardItem 接受 Promise，保留点击产生的用户激活链；非 PNG 在写入前转成原尺寸 PNG。
        const png = toClipboardPng(blob);
        await clipboard.write([new globalThis.ClipboardItem({"image/png": png})]);
    } catch (error) {
        if (error instanceof ImageClipboardUnsupportedError) throw error;
        throw new Error("图片复制被系统拒绝，请检查剪贴板权限");
    }
}

export function downloadImageBlob(blob: Blob, fileName: string): void {
    if (blob.size <= 0) {
        throw new Error("下载失败：图片文件为空");
    }
    triggerBrowserDownload(blob, resolveImageDownloadFileName(fileName, blob.type));
}

export function resolveImageDownloadFileName(fileName: string, mimeType: string): string {
    const basename = fileName.split(/[\\/]/u).pop()?.trim() || "text-to-image";
    const sanitized = basename
        .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
        .replace(/[. ]+$/gu, "")
        || "text-to-image";
    const extension = imageMimeExtension(mimeType);
    if (!extension) return sanitized;
    const stem = sanitized.replace(/\.[^./\\]*$/u, "") || "text-to-image";
    return `${stem}${extension}`;
}

class ImageClipboardUnsupportedError extends Error {
    constructor() {
        super("当前环境不支持复制图片，请使用下载");
        this.name = "ImageClipboardUnsupportedError";
    }
}

async function toClipboardPng(blob: Blob): Promise<Blob> {
    if (blob.type.toLowerCase() === "image/png") return blob;
    if (typeof document === "undefined") throw new ImageClipboardUnsupportedError();

    if (typeof globalThis.createImageBitmap === "function") {
        try {
            const bitmap = await globalThis.createImageBitmap(blob);
            try {
                const canvas = document.createElement("canvas");
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const context = canvas.getContext("2d");
                if (!context) throw new ImageClipboardUnsupportedError();
                context.drawImage(bitmap, 0, 0);
                return await canvasToPng(canvas);
            } finally {
                bitmap.close();
            }
        } catch (error) {
            if (error instanceof ImageClipboardUnsupportedError) throw error;
        }
    }

    if (typeof globalThis.Image !== "function") throw new ImageClipboardUnsupportedError();
    const url = URL.createObjectURL(blob);
    try {
        const image = new globalThis.Image();
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new ImageClipboardUnsupportedError());
            image.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new ImageClipboardUnsupportedError();
        context.drawImage(image, 0, 0);
        return await canvasToPng(canvas);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
            if (!result || result.size <= 0) {
                reject(new ImageClipboardUnsupportedError());
                return;
            }
            resolve(result);
        }, "image/png");
    });
}

function imageMimeExtension(mimeType: string): string {
    const normalized = mimeType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
        "image/avif": ".avif",
    }[normalized] ?? "";
}
