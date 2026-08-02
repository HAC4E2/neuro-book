import {createHash} from "node:crypto";
import type {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {
    canonicalizeInformationExtracted,
    FrozenReferenceAssetSchema,
    hashVibeEncodingCacheKey,
    type FrozenReferenceAsset,
} from "nbook/shared/text-to-image-reference-asset";
import {
    isNovelAiVibeEncodingPair,
    NovelAiProviderModelIdSchema,
    NovelAiVibeEncoderVersionSchema,
    type NovelAiProviderModelId,
    type NovelAiVibeEncoderVersion,
} from "nbook/shared/text-to-image-provider-registry";
import {createReferenceAssetRelativePath, resolveReferenceAssetPath} from "nbook/server/text-to-image/asset-path";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {
    assertTextToImageReferenceMutationScope,
    withTextToImageReferenceMutationLock,
} from "nbook/server/text-to-image/reference-asset-lock";
import {
    publishEncodingBlob,
    readAndVerifyEncodingBytes,
    TextToImageReferenceAssetNotFoundError,
} from "nbook/server/text-to-image/reference-asset.service";

type ServiceClient = (projectPath: string) => Promise<PrismaClient>;

const MAX_ENCODING_BYTES = 1024 * 1024;

/** Vibe encoding 缓存访问的稳定领域错误；dispatch 据此把确定性失败映射为不可重试 failed。 */
export type TextToImageVibeEncodingErrorCode =
    | "TEXT_TO_IMAGE_VIBE_ENCODING_LINEAGE_MISMATCH"
    | "TEXT_TO_IMAGE_VIBE_ENCODING_PAIR_UNREGISTERED";

/** Vibe encoding lineage 身份或配对校验失败的稳定错误。 */
export class TextToImageVibeEncodingError extends Error {
    readonly code: TextToImageVibeEncodingErrorCode;

    constructor(code: TextToImageVibeEncodingErrorCode, message: string) {
        super(message);
        this.name = "TextToImageVibeEncodingError";
        this.code = code;
    }
}

/** 按完整 typed key 解析 Vibe encoding 缓存所需的最小输入；providerModel 必须是登记枚举值。 */
export type ReadVibeEncodingInput = {
    projectPath: string;
    sourceContentHash: string;
    providerModel: NovelAiProviderModelId;
    informationExtracted: number;
    encoderVersion: NovelAiVibeEncoderVersion;
};

/** 远程派生 encoding 的缓存写入输入；source 必须是已复验的冻结证据。 */
export type StoreRemoteVibeEncodingInput = {
    projectPath: string;
    source: FrozenReferenceAsset;
    providerModel: NovelAiProviderModelId;
    informationExtracted: number;
    encoderVersion: NovelAiVibeEncoderVersion;
    bytes: Uint8Array;
};

/**
 * Project 级 typed Vibe encoding cache resolution 服务。
 *
 * - cache key = sourceContentHash + providerModel + canonicalInformation + encoderVersion；
 * - 命中时验证 lineage 全部身份字段与 blob 的 hash/长度，任何不一致 fail closed；
 * - 未命中返回 null，由调用方（adapter）调用远端 encode 后再 storeRemoteVibeEncoding；
 * - 写入在 Project reference mutation 锁内完成，但后台 Provider lane（closed-Project）
 *   场景不要求 Project session 打开：锁目标是同一磁盘文件，仍与上传/删除/导入串行。
 *
 * client factory 由调用方注入：dispatch 传当前 ephemeral client，绝不 fallback
 * 到 active-Project 单例。
 */
export class TextToImageVibeEncodingService {
    private readonly client: ServiceClient;

    constructor(client: ServiceClient = textToImageProjectClient) {
        this.client = client;
    }

    /** 按完整 typed key 读取已缓存 encoding；未命中返回 null，证据不一致抛稳定错误。 */
    async readVibeEncoding(input: ReadVibeEncodingInput): Promise<Uint8Array | null> {
        const lineageId = parseAndHashCacheKey(input);
        const db = await this.client(input.projectPath);
        const lineage = await db.textToImageVibeEncoding.findUnique({
            where: {id: lineageId},
            include: {blob: true},
        });
        if (!lineage) return null;
        assertLineageMatchesKey(lineage, input);
        const absolutePath = resolveReferenceAssetPath(
            resolveProjectAbsolutePath(input.projectPath),
            lineage.blob.relativePath,
        );
        return await readAndVerifyEncodingBytes(absolutePath, lineage.blob.contentHash, lineage.blob.byteLength);
    }

    /** 在锁内幂等持久化远端派生 encoding；source evidence 必须与登记 source 行一致。 */
    async storeRemoteVibeEncoding(input: StoreRemoteVibeEncodingInput): Promise<void> {
        const source = FrozenReferenceAssetSchema.parse(input.source);
        const lineageId = parseAndHashCacheKey({
            projectPath: input.projectPath,
            sourceContentHash: source.contentHash,
            providerModel: input.providerModel,
            informationExtracted: input.informationExtracted,
            encoderVersion: input.encoderVersion,
        });
        if (input.bytes.byteLength > MAX_ENCODING_BYTES) {
            throw new Error(`Vibe encoding 字节超过 ${MAX_ENCODING_BYTES} 上限`);
        }
        await withTextToImageReferenceMutationLock(
            input.projectPath,
            async (scope) => {
                assertTextToImageReferenceMutationScope(scope, {
                    projectPath: input.projectPath,
                    projectRoot: resolveProjectAbsolutePath(input.projectPath),
                });
                const db = await this.client(input.projectPath);
                const sourceRow = await db.textToImageReferenceAsset.findUnique({
                    where: {contentHash: source.contentHash},
                });
                if (!sourceRow) throw new TextToImageReferenceAssetNotFoundError(source.contentHash);

                const encodingHash = sha256Hex(input.bytes);
                const blobRelativePath = createReferenceAssetRelativePath(encodingHash, "application/octet-stream");
                await publishEncodingBlob(input.projectPath, db, encodingHash, blobRelativePath, input.bytes);
                await db.textToImageVibeEncoding.upsert({
                    where: {id: lineageId},
                    create: {
                        id: lineageId,
                        sourceContentHash: source.contentHash,
                        providerKind: "novelai",
                        providerModel: input.providerModel,
                        informationExtracted: input.informationExtracted,
                        canonicalInformation: canonicalizeInformationExtracted(input.informationExtracted),
                        encoderVersion: input.encoderVersion,
                        encodingContentHash: encodingHash,
                        provenance: "remote-encode",
                    },
                    update: {
                        encodingContentHash: encodingHash,
                        informationExtracted: input.informationExtracted,
                        canonicalInformation: canonicalizeInformationExtracted(input.informationExtracted),
                    },
                });
            },
            // 后台 Provider lane 缓存写入不要求 Project session 打开；锁文件本身保证串行。
            {requireOpenProject: false},
        );
    }
}

/** 解析并校验 typed key，返回确定性 lineage id；model/encoder 非登记配对直接拒绝。 */
function parseAndHashCacheKey(input: ReadVibeEncodingInput): string {
    const providerModel = NovelAiProviderModelIdSchema.parse(input.providerModel);
    const encoderVersion = NovelAiVibeEncoderVersionSchema.parse(input.encoderVersion);
    if (!isNovelAiVibeEncodingPair(providerModel, encoderVersion)) {
        throw new TextToImageVibeEncodingError(
            "TEXT_TO_IMAGE_VIBE_ENCODING_PAIR_UNREGISTERED",
            "providerModel 与 encoderVersion 必须是已登记的 Vibe 容器配对",
        );
    }
    return hashVibeEncodingCacheKey({
        providerKind: "novelai",
        sourceContentHash: input.sourceContentHash,
        providerModel,
        canonicalInformation: canonicalizeInformationExtracted(input.informationExtracted),
        encoderVersion,
    });
}

/** 校验 lineage 行身份字段与本次 cache key 完全一致；损坏/旧数据 fail closed。 */
function assertLineageMatchesKey(
    lineage: {
        sourceContentHash: string;
        providerKind: string;
        providerModel: string;
        canonicalInformation: string;
        encoderVersion: string;
    },
    input: ReadVibeEncodingInput,
): void {
    const canonicalInformation = canonicalizeInformationExtracted(input.informationExtracted);
    if (lineage.providerKind !== "novelai"
        || lineage.sourceContentHash !== input.sourceContentHash
        || lineage.providerModel !== input.providerModel
        || lineage.canonicalInformation !== canonicalInformation
        || lineage.encoderVersion !== input.encoderVersion) {
        throw new TextToImageVibeEncodingError(
            "TEXT_TO_IMAGE_VIBE_ENCODING_LINEAGE_MISMATCH",
            "Vibe encoding lineage 身份与 cache key 不一致",
        );
    }
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
