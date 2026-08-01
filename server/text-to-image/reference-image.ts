import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import sharp from "sharp";

export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_SIDE = 16_384;
export const MAX_REFERENCE_IMAGE_PIXELS = 64_000_000;

export type ReferenceImageMimeType = "image/png" | "image/jpeg";

/** 从原始上传字节独立推导的不可变图片证据。 */
export type VerifiedReferenceImage = Readonly<{
    contentHash: string;
    mimeType: ReferenceImageMimeType;
    byteLength: number;
    width: number;
    height: number;
}>;

export type TextToImageReferenceImageErrorCode =
    | "REFERENCE_IMAGE_TOO_LARGE"
    | "REFERENCE_IMAGE_UNSUPPORTED"
    | "REFERENCE_IMAGE_INVALID"
    | "REFERENCE_IMAGE_MIME_MISMATCH"
    | "REFERENCE_IMAGE_DIMENSIONS_INVALID"
    | "REFERENCE_ASSET_MISSING"
    | "REFERENCE_ASSET_TAMPERED";

/** 供 API mapper 稳定映射的引用图片领域错误。 */
export class TextToImageReferenceImageError extends Error {
    readonly code: TextToImageReferenceImageErrorCode;

    constructor(code: TextToImageReferenceImageErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "TextToImageReferenceImageError";
        this.code = code;
    }
}

/**
 * 校验精确输入字节，不改写图片；魔数、完整解码结果与尺寸预算必须同时成立。
 */
export async function verifyReferenceImageBytes(bytes: Uint8Array): Promise<VerifiedReferenceImage> {
    if (bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
        throw new TextToImageReferenceImageError("REFERENCE_IMAGE_TOO_LARGE", "引用图片超过 20 MiB 上限");
    }
    const magicMimeType = sniffReferenceImageMimeType(bytes);
    if (!magicMimeType) {
        throw new TextToImageReferenceImageError("REFERENCE_IMAGE_UNSUPPORTED", "引用图片只支持 PNG 或 JPEG");
    }
    if (magicMimeType === "image/png" && bytes.byteLength >= 24) {
        const declaredWidth = readUint32BigEndian(bytes, 16);
        const declaredHeight = readUint32BigEndian(bytes, 20);
        verifiedReferenceImageDimensions(declaredWidth, declaredHeight);
    }

    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = sharp(input, {
        failOn: "error",
        limitInputPixels: MAX_REFERENCE_IMAGE_PIXELS,
    });
    let metadata: Awaited<ReturnType<typeof decoder.metadata>>;
    try {
        metadata = await decoder.metadata();
    } catch (error) {
        if (error instanceof Error && /pixel limit/iu.test(error.message)) {
            throw new TextToImageReferenceImageError(
                "REFERENCE_IMAGE_DIMENSIONS_INVALID",
                "引用图片像素数超过上限",
                {cause: error},
            );
        }
        throw new TextToImageReferenceImageError("REFERENCE_IMAGE_INVALID", "引用图片无法完整解码", {cause: error});
    }

    const decodedMimeType = metadata.format === "png"
        ? "image/png"
        : metadata.format === "jpeg" ? "image/jpeg" : undefined;
    if (!decodedMimeType) {
        throw new TextToImageReferenceImageError("REFERENCE_IMAGE_UNSUPPORTED", "引用图片只支持 PNG 或 JPEG");
    }
    if (decodedMimeType !== magicMimeType) {
        throw new TextToImageReferenceImageError(
            "REFERENCE_IMAGE_MIME_MISMATCH",
            "引用图片魔数与解码格式不一致",
        );
    }

    const {width, height} = metadata;
    const dimensions = verifiedReferenceImageDimensions(width, height);

    try {
        await decoder.clone().raw().toBuffer();
    } catch (error) {
        throw new TextToImageReferenceImageError("REFERENCE_IMAGE_INVALID", "引用图片无法完整解码", {cause: error});
    }

    return Object.freeze({
        contentHash: createHash("sha256").update(input).digest("hex"),
        mimeType: decodedMimeType,
        byteLength: bytes.byteLength,
        width: dimensions.width,
        height: dimensions.height,
    });
}

/** 读取已持久化源图，并用数据库中的期望证据重新校验磁盘字节。 */
export async function readAndVerifyReferenceImage(input: {
    absolutePath: string;
    expected: VerifiedReferenceImage;
}): Promise<Readonly<{bytes: Uint8Array; evidence: VerifiedReferenceImage}>> {
    let bytes: Buffer;
    try {
        bytes = await readFile(input.absolutePath);
    } catch (error) {
        if (isMissingFileError(error)) {
            throw new TextToImageReferenceImageError("REFERENCE_ASSET_MISSING", "引用图片文件不存在", {cause: error});
        }
        throw error;
    }

    let evidence: VerifiedReferenceImage;
    try {
        evidence = await verifyReferenceImageBytes(bytes);
    } catch (error) {
        throw new TextToImageReferenceImageError("REFERENCE_ASSET_TAMPERED", "引用图片文件校验失败", {cause: error});
    }
    if (evidence.contentHash !== input.expected.contentHash
        || evidence.mimeType !== input.expected.mimeType
        || evidence.byteLength !== input.expected.byteLength
        || evidence.width !== input.expected.width
        || evidence.height !== input.expected.height) {
        throw new TextToImageReferenceImageError("REFERENCE_ASSET_TAMPERED", "引用图片文件与登记证据不一致");
    }
    return Object.freeze({bytes, evidence});
}

/** 只根据输入前缀识别 canonical PNG/JPEG 魔数。 */
function sniffReferenceImageMimeType(bytes: Uint8Array): ReferenceImageMimeType | undefined {
    if (bytes.byteLength >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a) {
        return "image/png";
    }
    if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    return undefined;
}

/** 返回类型明确的已验证尺寸，避免把 decoder 的 optional metadata 泄漏到领域类型。 */
function verifiedReferenceImageDimensions(
    width: number | undefined,
    height: number | undefined,
): Readonly<{width: number; height: number}> {
    if (!width || !height
        || width > MAX_REFERENCE_IMAGE_SIDE
        || height > MAX_REFERENCE_IMAGE_SIDE
        || width * height > MAX_REFERENCE_IMAGE_PIXELS) {
        throw new TextToImageReferenceImageError(
            "REFERENCE_IMAGE_DIMENSIONS_INVALID",
            "引用图片尺寸超过上限",
        );
    }
    return {width, height};
}

/** 避免为了读取不可信 PNG IHDR 创建额外 DataView/Buffer 副本。 */
function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
    return (bytes[offset]! * 0x1000000)
        + (bytes[offset + 1]! << 16)
        + (bytes[offset + 2]! << 8)
        + bytes[offset + 3]!;
}

/** Node 文件系统错误来自外部边界，只读取稳定的 code。 */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
