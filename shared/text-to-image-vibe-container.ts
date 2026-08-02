import {z} from "zod";
import {ReferenceContentHashSchema} from "nbook/shared/text-to-image-reference-asset";
import {
    NovelAiVibeEncoderVersionSchema,
    type NovelAiVibeEncoderVersion,
} from "nbook/shared/text-to-image-provider-registry";

/** `.naiv4vibe` / `.vibe` 容器文件上限（32 MiB）。 */
export const VIBE_CONTAINER_MAX_BYTES = 32 * 1024 * 1024;
/** JSON 最大深度；超过即拒绝整个容器。 */
export const VIBE_CONTAINER_MAX_JSON_DEPTH = 8;
/** JSON 总 object key 数上限。 */
export const VIBE_CONTAINER_MAX_JSON_KEYS = 256;
/** 容器内原图解码后字节上限（20 MiB）。 */
export const VIBE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** 单个 encoding 解码后字节上限（1 MiB）。 */
export const VIBE_ENCODING_MAX_BYTES = 1024 * 1024;
/** thumbnail data URL 解码后字节上限（2 MiB）。 */
export const VIBE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
/** 展示用 name 最大字符数。 */
export const VIBE_CONTAINER_NAME_MAX = 256;
/** 原图宽高与总像素沿用 reference source 上限。 */
export const VIBE_SOURCE_MAX_SIDE = 16_384;
export const VIBE_SOURCE_MAX_PIXELS = 64_000_000;

/** UI 可广告的容器扩展名；解析按内容而非扩展名。 */
export const VIBE_CONTAINER_ACCEPTED_EXTENSIONS = [".vibe", ".naiv4vibe"] as const;

/** 导入源固定唯一的 bucket → model 映射（与 Provider registry 容器一致）。 */
export const VIBE_CONTAINER_BUCKET = "v4-5full" as const;

/** 导入响应：只暴露脱敏结果，不含 bytes、vendor id 或容器内部。 */
export const VibeImportResponseSchema = z.object({
    schemaVersion: z.literal("nbook.vibe-import-response/v1"),
    containerContentHash: ReferenceContentHashSchema,
    sourceContentHash: ReferenceContentHashSchema,
    sourceMimeType: z.enum(["image/png", "image/jpeg"]),
    sourceWidth: z.number().int().positive(),
    sourceHeight: z.number().int().positive(),
    providerModel: z.literal("nai-diffusion-4-5-full"),
    encoderVersion: NovelAiVibeEncoderVersionSchema,
    suggestedStrength: z.number().min(0).max(1),
    encodingCount: z.number().int().min(1).max(16),
    displayName: z.string().max(VIBE_CONTAINER_NAME_MAX).nullable(),
    displayCreatedAt: z.string().nullable(),
    hasThumbnail: z.boolean(),
    sourceAlreadyExists: z.boolean(),
}).strict();

export type VibeImportResponse = z.infer<typeof VibeImportResponseSchema>;

/** 导入服务端口：解析并原子导入一个受信字节容器。 */
export type VibeContainerImportPort = {
    importContainer(input: {
        projectPath: string;
        bytes: Uint8Array;
    }): Promise<VibeImportResponse>;
};

/** parser 返回的 encoding 类型（server-only，不含 public DTO）。 */
export type ParsedVibeEncoding = {
    informationExtracted: number;
    canonicalInformation: string;
    bytes: Uint8Array;
    contentHash: string;
};

/** 供 import 服务与 parser 共享的 encoder version 别名。 */
export type VibeEncoderVersion = NovelAiVibeEncoderVersion;
