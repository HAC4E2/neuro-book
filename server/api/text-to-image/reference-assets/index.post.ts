import {createError, getRequestHeader, readMultipartFormData, type MultiPartData} from "h3";
import {z} from "zod";
import {
    REFERENCE_ASSET_MIME_BY_KIND,
    TEXT_TO_IMAGE_REFERENCE_ASSET_KINDS,
    type TextToImageReferenceAssetKind,
} from "nbook/shared/text-to-image-reference-asset";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";

const MAX_REFERENCE_ASSET_BYTES = 50 * 1024 * 1024;

const DerivationSchema = z.object({
    parentAssetId: z.string().trim().min(1).max(200).nullable(),
    derivedModel: z.string().trim().min(1).max(80).nullable(),
    derivedInfoExtracted: z.number().min(0).max(1).nullable(),
}).strict();

/**
 * 上传参考资产；内容寻址 dedup，相同 bytes 复用同一记录。
 * 派生 Vibe encoding 必须同时提供 parentAssetId/derivedModel/derivedInfoExtracted。
 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    assertContentLengthLimit(event);
    const parts = await readMultipartFormData(event);
    if (!parts?.length) {
        throw createError({statusCode: 400, message: "multipart 表单不能为空"});
    }
    const projectPath = readTextPart(parts, "projectPath");
    if (!projectPath) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }
    assertProjectOpen(projectPath);
    const kind = readKindPart(parts);
    const file = parts.find((part) => part.name === "file" && part.filename);
    if (!file) {
        throw createError({statusCode: 400, message: "缺少上传文件"});
    }
    if (file.data.byteLength > MAX_REFERENCE_ASSET_BYTES) {
        throw createError({statusCode: 413, message: "参考资产超过 50MB 限制"});
    }
    const mimeType = (file.type ?? "").trim() || sniffMime(file.data);
    if (!isMimeSupported(kind, mimeType)) {
        throw createError({statusCode: 415, message: `参考资产 kind=${kind} 不支持 MIME ${mimeType}`});
    }
    const derivation = DerivationSchema.parse({
        parentAssetId: readTextPart(parts, "parentAssetId") ?? null,
        derivedModel: readTextPart(parts, "derivedModel") ?? null,
        derivedInfoExtracted: readNumberPart(parts, "derivedInfoExtracted"),
    });

    return new TextToImageReferenceAssetService().upload({
        projectPath,
        bytes: new Uint8Array(file.data),
        mimeType,
        kind,
        ...derivation,
    });
});

function readKindPart(parts: MultiPartData[]): TextToImageReferenceAssetKind {
    const raw = readTextPart(parts, "kind");
    if (!raw || !(TEXT_TO_IMAGE_REFERENCE_ASSET_KINDS as readonly string[]).includes(raw)) {
        throw createError({statusCode: 400, message: "参考资产 kind 不合法"});
    }
    return raw as TextToImageReferenceAssetKind;
}

function readTextPart(parts: MultiPartData[], name: string): string | undefined {
    const part = parts.find((item) => item.name === name && !item.filename);
    const value = part?.data.toString("utf-8").trim();
    return value || undefined;
}

function readNumberPart(parts: MultiPartData[], name: string): number | null {
    const raw = readTextPart(parts, name);
    if (raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function isMimeSupported(kind: TextToImageReferenceAssetKind, mimeType: string): boolean {
    return (REFERENCE_ASSET_MIME_BY_KIND[kind] as readonly string[]).includes(mimeType);
}

/** 不依赖外部类型库的最小 PNG/JPEG/WebP 嗅探；multipart type 缺失时兜底。 */
function sniffMime(bytes: Uint8Array): string {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return "image/webp";
    }
    return "application/octet-stream";
}

function assertContentLengthLimit(event: Parameters<typeof getRequestHeader>[0]): void {
    const raw = getRequestHeader(event, "content-length");
    const contentLength = raw ? Number.parseInt(raw, 10) : null;
    if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAX_REFERENCE_ASSET_BYTES + 1024 * 1024) {
        throw createError({statusCode: 413, message: "参考资产上传超过大小限制"});
    }
}
