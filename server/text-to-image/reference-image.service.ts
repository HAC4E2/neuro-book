import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-runtime-root";

const REFERENCE_ROOT_RELATIVE = "text-to-image/reference-images";
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;

export type TextToImageReferenceImageMeta = {
    relativePath: string;
    fileName: string;
    byteLength: number;
    mimeType: string;
};

/** 保存一张全局参考图到 user-assets `.nbook/text-to-image/reference-images/`。 */
export async function saveTextToImageReferenceImage(input: {
    fileName: string;
    bytes: Uint8Array;
}): Promise<TextToImageReferenceImageMeta> {
    if (input.bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
        throw new Error(`参考图超过 ${MAX_REFERENCE_IMAGE_BYTES} 字节上限`);
    }
    const extension = resolveImageExtension(input.fileName);
    const root = await resolveReferenceImageRoot();
    const hash = createHash("sha256").update(input.bytes).digest("hex");
    const relativePath = `${REFERENCE_ROOT_RELATIVE}/${hash}.${extension}`;
    const target = path.join(root, `${hash}.${extension}`);
    await fs.mkdir(path.dirname(target), {recursive: true});
    const temporaryPath = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, input.bytes);
    await fs.rename(temporaryPath, target);
    return {
        relativePath,
        fileName: path.basename(relativePath),
        byteLength: input.bytes.byteLength,
        mimeType: mimeTypeForExtension(extension),
    };
}

/** 列出全部全局参考图，按写入时间倒序。 */
export async function listTextToImageReferenceImages(): Promise<TextToImageReferenceImageMeta[]> {
    const root = await resolveReferenceImageRoot();
    let entries;
    try {
        entries = await fs.readdir(root, {withFileTypes: true});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    const metas: Array<TextToImageReferenceImageMeta & {mtimeMs: number}> = [];
    for (const entry of entries) {
        const stat = await fs.stat(path.join(root, entry.name));
        if (!stat.isFile()) continue;
        const extension = path.extname(entry.name).slice(1).toLowerCase();
        metas.push({
            relativePath: `${REFERENCE_ROOT_RELATIVE}/${entry.name}`,
            fileName: entry.name,
            byteLength: stat.size,
            mimeType: mimeTypeForExtension(extension),
            mtimeMs: stat.mtimeMs,
        });
    }
    return metas
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .map(({mtimeMs: _mtimeMs, ...meta}) => meta);
}

/** 删除全局参考图；相对路径越界时拒绝。 */
export async function deleteTextToImageReferenceImage(relativePath: string): Promise<void> {
    const root = await resolveReferenceImageRoot();
    await fs.rm(resolveContainedPath(root, relativePath), {force: true});
}

/** 解析参考图绝对路径；相对路径越界时拒绝。 */
export async function resolveTextToImageReferenceImagePath(relativePath: string): Promise<string> {
    const root = await resolveReferenceImageRoot();
    return resolveContainedPath(root, relativePath);
}

async function resolveReferenceImageRoot(): Promise<string> {
    return path.join(resolveUserNbookRoot(), REFERENCE_ROOT_RELATIVE);
}

function resolveContainedPath(root: string, relativePath: string): string {
    const prefix = `${REFERENCE_ROOT_RELATIVE}/`;
    const stripped = relativePath.startsWith(prefix)
        ? relativePath.slice(prefix.length)
        : relativePath;
    const absolute = path.resolve(root, stripped);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("参考图路径越界");
    }
    return absolute;
}

function resolveImageExtension(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
        throw new Error("参考图只支持 png/jpg/jpeg/webp");
    }
    return extension.slice(1);
}

function mimeTypeForExtension(extension: string): string {
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    return "image/png";
}
