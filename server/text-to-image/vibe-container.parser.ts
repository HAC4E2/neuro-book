import {createHash} from "node:crypto";
import {z} from "zod";
import type {FrozenReferenceAsset} from "nbook/shared/text-to-image-reference-asset";
import {
    VIBE_CONTAINER_MAX_BYTES,
    VIBE_CONTAINER_MAX_JSON_DEPTH,
    VIBE_CONTAINER_MAX_JSON_KEYS,
    VIBE_ENCODING_MAX_BYTES,
    VIBE_SOURCE_MAX_BYTES,
    VIBE_THUMBNAIL_MAX_BYTES,
    VIBE_CONTAINER_NAME_MAX,
    type ParsedVibeEncoding,
} from "nbook/shared/text-to-image-vibe-container";
import {
    PROVIDER_GRAMMAR_REGISTRY,
    type NovelAiVibeEncoderVersion,
} from "nbook/shared/text-to-image-provider-registry";
import {
    canonicalizeInformationExtracted,
    ReferenceContentHashSchema,
} from "nbook/shared/text-to-image-reference-asset";
import {
    verifyReferenceImageBytes,
    type VerifiedReferenceImage,
} from "nbook/server/text-to-image/reference-image";

/** `.naiv4vibe` / `.vibe` v1 严格解析后的完整结果；只存在于 server 层。 */
export type ParsedVibeContainer = {
    containerContentHash: string;
    source: {
        bytes: Uint8Array;
        evidence: FrozenReferenceAsset;
    };
    providerModel: "nai-diffusion-4-5-full";
    encoderVersion: NovelAiVibeEncoderVersion;
    suggestedStrength: number;
    encodings: ParsedVibeEncoding[];
    display: {
        name: string | null;
        createdAt: string | null;
        thumbnail: Uint8Array | null;
    };
};

export type VibeContainerErrorCode =
    | "VIBE_CONTAINER_TOO_LARGE"
    | "VIBE_CONTAINER_JSON_DEPTH_EXCEEDED"
    | "VIBE_CONTAINER_JSON_KEYS_EXCEEDED"
    | "VIBE_CONTAINER_MALFORMED"
    | "VIBE_CONTAINER_VERSION_UNSUPPORTED"
    | "VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED"
    | "VIBE_CONTAINER_IMAGE_INVALID"
    | "VIBE_CONTAINER_ENCODING_INVALID"
    | "VIBE_CONTAINER_ENCODING_DUPLICATE"
    | "VIBE_CONTAINER_DISPLAY_INVALID";

/** Vibe 容器解析/导入的稳定领域错误。 */
export class VibeContainerError extends Error {
    readonly code: VibeContainerErrorCode;

    constructor(code: VibeContainerErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "VibeContainerError";
        this.code = code;
    }
}

/** 严格解析 `.naiv4vibe` / `.vibe` v1 容器；第一个非法边界就拒绝整个容器。 */
export async function parseVibeContainer(bytes: Uint8Array): Promise<ParsedVibeContainer> {
    if (bytes.byteLength > VIBE_CONTAINER_MAX_BYTES) {
        throw new VibeContainerError("VIBE_CONTAINER_TOO_LARGE", "Vibe 容器超过 32 MiB 上限");
    }
    let text: string;
    try {
        text = Buffer.from(bytes).toString("utf8");
    } catch {
        throw new VibeContainerError("VIBE_CONTAINER_MALFORMED", "Vibe 容器不是合法 UTF-8 JSON");
    }
    const parsedJson = parseBoundedJson(text);

    const json = VibeContainerJsonSchema.safeParse(parsedJson);
    if (!json.success) {
        console.error("VIBE_PARSE_ISSUES", JSON.stringify(json.error.issues));
        const issue = json.error.issues[0];
        if (issue?.path[0] === "identifier" || issue?.path[0] === "version" || issue?.path[0] === "type") {
            throw new VibeContainerError("VIBE_CONTAINER_VERSION_UNSUPPORTED", "Vibe 容器 identifier/version/type 不受支持");
        }
        throw new VibeContainerError("VIBE_CONTAINER_MALFORMED", `Vibe 容器结构不合法：${issue?.message ?? "未知"}`);
    }
    const container = json.data;
    // bucket 只允许恰一个且必须是 v4-5full；检查移到 schema 外以保留自定义错误码。
    const bucketKeys = Object.keys(container.encodings);
    if (bucketKeys.length !== 1 || bucketKeys[0] !== "v4-5full") {
        throw new VibeContainerError("VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED", "Vibe 容器必须且只能包含 v4-5full bucket");
    }
    const bucketEncodings = container.encodings["v4-5full"];
    if (!bucketEncodings) {
        throw new VibeContainerError("VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED", "Vibe 容器缺少 v4-5full bucket");
    }
    const encodingEntries = Object.entries(bucketEncodings);
    if (encodingEntries.length === 0 || encodingEntries.length > 16) {
        throw new VibeContainerError("VIBE_CONTAINER_ENCODING_INVALID", "Vibe encoding 数量必须在 1..16");
    }
    for (const [vendorId] of encodingEntries) {
        if (!ReferenceContentHashSchema.safeParse(vendorId).success) {
            throw new VibeContainerError("VIBE_CONTAINER_ENCODING_INVALID", `encoding vendor id 必须是无前缀 64 位 hex：${vendorId}`);
        }
    }
    if (!Number.isFinite(container.importInfo.strength) || container.importInfo.strength < 0 || container.importInfo.strength > 1) {
        throw new VibeContainerError("VIBE_CONTAINER_ENCODING_INVALID", "importInfo.strength 必须是 0..1 的有限数");
    }
    if (!Number.isFinite(container.importInfo.information_extracted) || container.importInfo.information_extracted < 0 || container.importInfo.information_extracted > 1) {
        throw new VibeContainerError("VIBE_CONTAINER_ENCODING_INVALID", "importInfo.information_extracted 必须是 0..1 的有限数");
    }

    // 先解析 bucket → registry 唯一映射，再解析任何 bytes。
    const containerEntry = PROVIDER_GRAMMAR_REGISTRY.advanced.vibeTransfer.containers.find(
        (entry) => entry.bucket === bucketKeys[0],
    );
    if (!containerEntry) {
        throw new VibeContainerError(
            "VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED",
            `Vibe model bucket 不支持：${bucketKeys[0]}`,
        );
    }
    if (container.importInfo.model !== containerEntry.model) {
        throw new VibeContainerError(
            "VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED",
            `importInfo.model=${container.importInfo.model} 与 bucket 映射不一致`,
        );
    }

    // 严格解码原图并完整验证（magic/MIME/尺寸/SHA-256）。
    const sourceBytes = decodeBase64Bytes(container.image, "VIBE_CONTAINER_IMAGE_INVALID");
    if (sourceBytes.byteLength > VIBE_SOURCE_MAX_BYTES) {
        throw new VibeContainerError("VIBE_CONTAINER_IMAGE_INVALID", "Vibe 原图超过 20 MiB 上限");
    }
    let sourceEvidence: VerifiedReferenceImage;
    try {
        sourceEvidence = await verifyReferenceImageBytes(sourceBytes);
    } catch (error) {
        throw new VibeContainerError("VIBE_CONTAINER_IMAGE_INVALID", "Vibe 原图无法通过完整解码验证", {cause: error});
    }

    // 解码每个 encoding 并独立 SHA-256；重复 canonical information 拒绝。
    const encodings: ParsedVibeEncoding[] = [];
    const canonicalSeen = new Set<string>();
    for (const [vendorId, entry] of encodingEntries) {
        const informationExtracted = entry.params.information_extracted;
        if (!Number.isFinite(informationExtracted) || informationExtracted < 0 || informationExtracted > 1) {
            throw new VibeContainerError("VIBE_CONTAINER_ENCODING_INVALID", `encoding ${vendorId} 的 informationExtracted 非法`);
        }
        const canonicalInformation = canonicalizeInformationExtracted(informationExtracted);
        if (canonicalSeen.has(canonicalInformation)) {
            throw new VibeContainerError("VIBE_CONTAINER_ENCODING_DUPLICATE", `重复的 informationExtracted：${canonicalInformation}`);
        }
        canonicalSeen.add(canonicalInformation);
        const encodingBytes = decodeBase64Bytes(entry.encoding, "VIBE_CONTAINER_ENCODING_INVALID");
        if (encodingBytes.byteLength === 0 || encodingBytes.byteLength > VIBE_ENCODING_MAX_BYTES) {
            throw new VibeContainerError("VIBE_CONTAINER_ENCODING_INVALID", `encoding ${vendorId} 字节数越界`);
        }
        encodings.push({
            informationExtracted,
            canonicalInformation,
            bytes: encodingBytes,
            contentHash: sha256Hex(encodingBytes),
        });
    }
    if (encodings.length === 0 || encodings.length > 16) {
        throw new VibeContainerError("VIBE_CONTAINER_ENCODING_INVALID", "Vibe encoding 数量必须在 1..16");
    }

    // 展示元数据只在安全校验后解析，绝不参与 identity/cache key。
    const displayName = container.name === undefined ? null : container.name.trim() || null;
    const displayCreatedAt = container.createdAt === undefined
        ? null
        : typeof container.createdAt === "number"
            ? new Date(container.createdAt).toISOString()
            : new Date(container.createdAt).toISOString();
    const thumbnail = container.thumbnail === undefined
        ? null
        : decodeThumbnail(container.thumbnail);

    return {
        containerContentHash: sha256Hex(bytes),
        source: {
            bytes: sourceBytes,
            evidence: {
                contentHash: sourceEvidence.contentHash,
                kind: "source-image",
                mimeType: sourceEvidence.mimeType,
                byteLength: sourceEvidence.byteLength,
                width: sourceEvidence.width,
                height: sourceEvidence.height,
            },
        },
        providerModel: containerEntry.model,
        encoderVersion: containerEntry.encoderVersion,
        suggestedStrength: container.importInfo.strength,
        encodings,
        display: {
            name: displayName,
            createdAt: displayCreatedAt,
            thumbnail,
        },
    };
}

export const VibeContainerJsonSchema = z.object({
    identifier: z.literal("novelai-vibe-transfer"),
    version: z.literal(1),
    type: z.literal("image"),
    image: z.string().min(1),
    id: z.string().trim().min(1).max(300).optional(),
    encodings: z.record(
        z.string().trim().min(1),
        z.record(z.string().trim().min(1).max(200), z.object({
            encoding: z.string().min(1),
            params: z.object({
                information_extracted: z.number(),
            }).strict(),
        }).strict()),
    ),
    name: z.string().max(VIBE_CONTAINER_NAME_MAX).optional(),
    thumbnail: z.string().optional(),
    createdAt: z.union([z.number().int().positive(), z.string().datetime()]).optional(),
    importInfo: z.object({
        model: z.string().trim().min(1).max(80),
        information_extracted: z.number(),
        strength: z.number(),
    }).strict(),
}).strict();

/** 先做 JSON 深度与总 key 数边界检查，再进入严格 schema。 */
function parseBoundedJson(text: string): unknown {
    let depthExceeded = false;
    let keyCount = 0;
    const depthChecker = (value: unknown, depth: number): void => {
        if (depth > VIBE_CONTAINER_MAX_JSON_DEPTH) {
            depthExceeded = true;
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) depthChecker(item, depth + 1);
            return;
        }
        if (typeof value === "object" && value !== null) {
            const entries = Object.entries(value as Record<string, unknown>);
            keyCount += entries.length;
            if (keyCount > VIBE_CONTAINER_MAX_JSON_KEYS) return;
            for (const [, item] of entries) depthChecker(item, depth + 1);
        }
    };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch {
        throw new VibeContainerError("VIBE_CONTAINER_MALFORMED", "Vibe 容器不是合法 JSON");
    }
    depthChecker(parsed, 0);
    if (depthExceeded) {
        throw new VibeContainerError("VIBE_CONTAINER_JSON_DEPTH_EXCEEDED", `Vibe 容器 JSON 深度超过 ${VIBE_CONTAINER_MAX_JSON_DEPTH}`);
    }
    if (keyCount > VIBE_CONTAINER_MAX_JSON_KEYS) {
        throw new VibeContainerError("VIBE_CONTAINER_JSON_KEYS_EXCEEDED", `Vibe 容器 JSON key 数超过 ${VIBE_CONTAINER_MAX_JSON_KEYS}`);
    }
    return parsed;
}

function decodeBase64Bytes(input: string, code: VibeContainerErrorCode): Uint8Array {
    const normalized = input.replace(/\s+/gu, "");
    let buffer: Buffer;
    try {
        buffer = Buffer.from(normalized, "base64");
    } catch {
        throw new VibeContainerError(code, "Base64 解码失败");
    }
    // 严格 round-trip：重编码必须与输入完全一致，拒绝多余填充/非规范形式。
    if (buffer.toString("base64") !== normalized) {
        throw new VibeContainerError(code, "Base64 编码不严格");
    }
    return new Uint8Array(buffer);
}

/** thumbnail data URL 严格解码（data:image/...;base64,...）。 */
function decodeThumbnail(input: string): Uint8Array {
    const match = /^data:image\/(?:jpeg|png|webp);base64,(.+)$/u.exec(input.trim());
    if (!match?.[1]) {
        throw new VibeContainerError("VIBE_CONTAINER_DISPLAY_INVALID", "thumbnail 必须是 data URL");
    }
    const bytes = decodeBase64Bytes(match[1], "VIBE_CONTAINER_DISPLAY_INVALID");
    if (bytes.byteLength > VIBE_THUMBNAIL_MAX_BYTES) {
        throw new VibeContainerError("VIBE_CONTAINER_DISPLAY_INVALID", "thumbnail 超过 2 MiB 上限");
    }
    return bytes;
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
