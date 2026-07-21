import {z} from "zod";
import {hashTextToImageContract, type TextToImageContractValue} from "nbook/shared/text-to-image-contract-hash";

/**
 * 参考资产内容寻址的种类。
 *
 * - `source-image`：用户上传的图片，可用作 Vibe Transfer 源、Character Reference 或 Inpaint 蒙版；
 *   具体用途由 Recipe 参考槽决定，Compiler 按 slot 校验 MIME（inpaint 蒙版必须是 PNG）。
 * - `vibe-encoding`：由 `source-image` 调用 `/ai/encode-vibe` 派生的 NovelAI encoding 产物，
 *   按源 contentHash + model + infoExtracted 缓存，lineage 经 parentAssetId 追溯。
 */
export const TEXT_TO_IMAGE_REFERENCE_ASSET_KINDS = [
    "source-image",
    "vibe-encoding",
] as const;
export type TextToImageReferenceAssetKind = (typeof TEXT_TO_IMAGE_REFERENCE_ASSET_KINDS)[number];

export const TextToImageReferenceAssetKindSchema = z.enum(TEXT_TO_IMAGE_REFERENCE_ASSET_KINDS);

/** 受支持的 MIME；source-image 接受常见图片，vibe-encoding 只接受二进制。 */
export const REFERENCE_ASSET_MIME_BY_KIND = {
    "source-image": ["image/png", "image/jpeg", "image/webp"],
    "vibe-encoding": ["application/octet-stream"],
} as const satisfies Record<TextToImageReferenceAssetKind, readonly string[]>;

/** 内容寻址用裸 SHA-256 hex（无算法前缀），与 Project 文件路径与 dedup key 共用。 */
export const ReferenceContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/u, "参考资产 contentHash 必须是 64 位 hex");

/** 参考资产 DTO；不含 bytes 与 secret，可安全回传前端。 */
export const TextToImageReferenceAssetDtoSchema = z.object({
    id: z.string().trim().min(1).max(200),
    kind: TextToImageReferenceAssetKindSchema,
    contentHash: ReferenceContentHashSchema,
    relativePath: z.string().trim().min(1).max(500),
    fileName: z.string().trim().min(1).max(300),
    mimeType: z.string().trim().min(1).max(80),
    byteLength: z.number().int().positive().max(50_000_000),
    /** 仅 vibe-encoding 非空：派生自哪个源资产；其余为 null。 */
    parentAssetId: z.string().trim().min(1).max(200).nullable(),
    /** 仅 vibe-encoding 非空：派生时所用的 NovelAI model；其余为 null。 */
    derivedModel: z.string().trim().min(1).max(80).nullable(),
    /** 仅 vibe-encoding 非空：派生时所用的 infoExtracted；其余为 null。 */
    derivedInfoExtracted: z.number().min(0).max(1).nullable(),
    createdAt: z.string().datetime(),
}).strict();

export type TextToImageReferenceAssetDto = z.infer<typeof TextToImageReferenceAssetDtoSchema>;

/** Recipe 参考资源区引用：只持久 contentHash + 权重 + infoExtracted，绝不存 bytes/Data URL。 */
export const TextToImageReferenceSelectionSchema = z.object({
    contentHash: ReferenceContentHashSchema,
    strength: z.number().min(0).max(1),
    /** NovelAI informationExtracted 参数，0–1；inpaint 不使用。 */
    informationExtracted: z.number().min(0).max(1).nullable(),
}).strict();

export type TextToImageReferenceSelection = z.infer<typeof TextToImageReferenceSelectionSchema>;

/** Vibe encoding 缓存查询 key：源 contentHash + model + informationExtracted 唯一确定一份派生 encoding。 */
export const VibeEncodingCacheKeySchema = z.object({
    sourceContentHash: ReferenceContentHashSchema,
    model: z.string().trim().min(1).max(80),
    informationExtracted: z.number().min(0).max(1),
}).strict();

export type VibeEncodingCacheKey = z.infer<typeof VibeEncodingCacheKeySchema>;

/** 对参考资产引用选择计算稳定 content hash，进入 executionInputHash。 */
export function hashReferenceSelections(input: {
    vibeReferences: TextToImageReferenceSelection[];
    characterReferences: TextToImageReferenceSelection[];
    inpaint: TextToImageReferenceSelection | null;
}): string {
    const payload: TextToImageContractValue = {
        schemaVersion: "nbook.reference-selection-hash/v1",
        vibeReferences: input.vibeReferences.map((reference) => TextToImageReferenceSelectionSchema.parse(reference)),
        characterReferences: input.characterReferences.map((reference) => TextToImageReferenceSelectionSchema.parse(reference)),
        inpaint: input.inpaint ? TextToImageReferenceSelectionSchema.parse(input.inpaint) : null,
    };
    return hashTextToImageContract(payload);
}
