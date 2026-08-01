import {z} from "zod";
import {hashTextToImageContract, type TextToImageContractValue} from "nbook/shared/text-to-image-contract-hash";
import {
    NovelAiProviderModelIdSchema,
    NovelAiVibeEncoderVersionSchema,
} from "nbook/shared/text-to-image-provider-registry";

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

/**
 * P5 编译边界使用的不可变 source-image 证据。
 *
 * 该 schema 暂不替换现有公开 DTO；存储与编译完成原子切换后才会由消费者接入。
 */
export const FrozenReferenceAssetSchema = z.object({
    contentHash: ReferenceContentHashSchema,
    kind: z.literal("source-image"),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    byteLength: z.number().int().positive().max(50_000_000),
    width: z.number().int().positive().max(16_384),
    height: z.number().int().positive().max(16_384),
}).strict();

export type FrozenReferenceAsset = z.infer<typeof FrozenReferenceAssetSchema>;

/** P5 Inpaint 的完整内容寻址对；两张图缺一不可。 */
export const TextToImageInpaintSelectionSchema = z.object({
    baseImageContentHash: ReferenceContentHashSchema,
    maskContentHash: ReferenceContentHashSchema,
}).strict().nullable();

export type TextToImageInpaintSelection = z.infer<typeof TextToImageInpaintSelectionSchema>;

/** 引用资产的固定分页外形；Task 2 会让公开 DTO 消费此 schema。 */
export const TextToImageReferenceAssetPageDtoSchema = z.object({
    items: z.array(TextToImageReferenceAssetDtoSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
}).strict();

export type TextToImageReferenceAssetPageDto = z.infer<typeof TextToImageReferenceAssetPageDtoSchema>;

/** Vibe informationExtracted 的严格数值边界。 */
export const ReferenceInformationExtractedSchema = z.number().finite().min(0).max(1);

/** 将同一数值的不同文本表示归一为稳定的缓存键片段。 */
export function canonicalizeInformationExtracted(value: number): string {
    return ReferenceInformationExtractedSchema.parse(value).toString();
}

/** 已规范化的 Vibe informationExtracted，避免相同数值以不同文本参与缓存身份。 */
export const CanonicalInformationExtractedSchema = z.string()
    .regex(/^(?:0|1|0\.[0-9]+)$/u, "canonicalInformation 必须是 0..1 的十进制数")
    .superRefine((value, context) => {
        if (canonicalizeInformationExtracted(Number(value)) !== value) {
            context.addIssue({
                code: "custom",
                message: "canonicalInformation 必须使用标准数值表示",
            });
        }
    });

/** Recipe 参考资源区引用：只持久 contentHash + 权重 + infoExtracted，绝不存 bytes/Data URL。 */
export const TextToImageReferenceSelectionSchema = z.object({
    contentHash: ReferenceContentHashSchema,
    strength: z.number().min(0).max(1),
    /** NovelAI informationExtracted 参数，0–1；inpaint 不使用。 */
    informationExtracted: z.number().min(0).max(1).nullable(),
}).strict();

export type TextToImageReferenceSelection = z.infer<typeof TextToImageReferenceSelectionSchema>;

/** Vibe encoding 缓存的完整、非敏感 typed identity。 */
export const VibeEncodingCacheKeySchema = z.object({
    providerKind: z.literal("novelai"),
    sourceContentHash: ReferenceContentHashSchema,
    providerModel: NovelAiProviderModelIdSchema,
    canonicalInformation: CanonicalInformationExtractedSchema,
    encoderVersion: NovelAiVibeEncoderVersionSchema,
}).strict();

export type VibeEncodingCacheKey = z.infer<typeof VibeEncodingCacheKeySchema>;

/** 为后续 encoding lineage 提供完整 typed identity 的确定性缓存键 hash。 */
export function hashVibeEncodingCacheKey(input: VibeEncodingCacheKey): string {
    const key = VibeEncodingCacheKeySchema.parse(input);
    return hashTextToImageContract({
        schemaVersion: "nbook.vibe-encoding-cache-key/v2",
        providerKind: key.providerKind,
        sourceContentHash: key.sourceContentHash,
        providerModel: key.providerModel,
        canonicalInformation: key.canonicalInformation,
        encoderVersion: key.encoderVersion,
    });
}

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
