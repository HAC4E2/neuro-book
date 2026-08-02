import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {consola} from "consola";
import type {
    PrismaClient,
    TextToImageReferenceAsset as ReferenceAssetRecord,
} from "nbook/server/generated/project-prisma/client";
import type {
    TextToImageReferenceAssetDto,
    TextToImageReferenceAssetPageDto,
} from "nbook/shared/text-to-image-reference-asset";
import {
    TextToImageReferenceAssetDtoSchema,
    TextToImageReferenceAssetPageDtoSchema,
    canonicalizeInformationExtracted,
    hashVibeEncodingCacheKey,
} from "nbook/shared/text-to-image-reference-asset";
import {
    NovelAiProviderModelIdSchema,
    NovelAiVibeEncoderVersionSchema,
    PROVIDER_GRAMMAR_REGISTRY,
    type NovelAiVibeEncoderVersion,
} from "nbook/shared/text-to-image-provider-registry";
import {IllustrationCompiledRequestSchema} from "nbook/shared/text-to-image-execution";
import {
    DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH,
    parseTextToImageRecipeMarkdown,
} from "nbook/server/text-to-image/recipe.codec";
import {
    createReferenceAssetRelativePath,
    resolveReferenceAssetPath,
    TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT,
} from "nbook/server/text-to-image/asset-path";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";
import {
    assertTextToImageReferenceMutationScope,
    withTextToImageReferenceMutationLock,
} from "nbook/server/text-to-image/reference-asset-lock";
import {
    readAndVerifyReferenceImage,
    verifyReferenceImageBytes,
    type VerifiedReferenceImage,
} from "nbook/server/text-to-image/reference-image";
import type {ParsedVibeContainer} from "nbook/server/text-to-image/vibe-container.parser";

type ServiceClient = (projectPath: string) => Promise<PrismaClient>;

type UploadInput = {
    projectPath: string;
    bytes: Uint8Array;
    /** 客户端文件名，只作为展示 hint；内容寻址路径与文件名无关。 */
    fileName?: string;
};

type ListInput = {
    projectPath: string;
    page?: number;
    pageSize?: number;
};

/** 参考资产不存在或跨 Project 误用的稳定业务错误。 */
export class TextToImageReferenceAssetNotFoundError extends Error {
    readonly code = "TEXT_TO_IMAGE_REFERENCE_ASSET_NOT_FOUND";
    constructor(readonly assetId: string) {
        super(`参考资产不存在：${assetId}`);
        this.name = "TextToImageReferenceAssetNotFoundError";
    }
}

/** 参考资产被 Vibe lineage/promotion 引用，删除前必须先解除引用。 */
export class TextToImageReferenceAssetInUseError extends Error {
    readonly code = "TEXT_TO_IMAGE_REFERENCE_ASSET_IN_USE";
    constructor(readonly contentHash: string) {
        super(`参考资产仍被引用，无法删除：${contentHash}`);
        this.name = "TextToImageReferenceAssetInUseError";
    }
}

/** Recipe/Manifest owner 证据损坏（解析失败）时的稳定错误；绝不当成“无 owner”。 */
export class TextToImageReferenceOwnerEvidenceError extends Error {
    readonly code = "REFERENCE_OWNER_EVIDENCE_INVALID";
    constructor() {
        super("参考资产 owner 证据无法解析，拒绝删除");
        this.name = "TextToImageReferenceOwnerEvidenceError";
    }
}

/**
 * Project 级参考资产读写服务：内容寻址 source-image 存储 + typed Vibe encoding lineage。
 *
 * - 公开方法只返回元数据或服务端已验证的文件句柄，永不接收/返回路径。
 * - upload/delete/storeVibeEncoding 必须在 Project mutation 锁内完成 atomic-pair 维护。
 * - 文件与数据库记录始终成对维护；不暴露 bytes 与 secret。
 */
export class TextToImageReferenceAssetService {
    private readonly client: ServiceClient;

    constructor(client: ServiceClient = textToImageProjectClient) {
        this.client = client;
    }

    /** 内容寻址上传 source-image；相同字节收敛到同一资产，绝不复用/覆盖既有 final 文件。 */
    async upload(input: UploadInput): Promise<TextToImageReferenceAssetDto> {
        const evidence = await verifyReferenceImageBytes(input.bytes);
        return await withTextToImageReferenceMutationLock(input.projectPath, async (scope) => {
            assertTextToImageReferenceMutationScope(scope, {
                projectPath: input.projectPath,
                projectRoot: resolveProjectAbsolutePath(input.projectPath),
            });
            const db = await this.client(input.projectPath);
            return await publishSourceImage(input.projectPath, db, evidence, input.bytes, input.fileName);
        });
    }

    /** 按创建时间分页读取 source-image 元数据；只做 DB + stat 检查，不解码图片。 */
    async list(input: ListInput): Promise<TextToImageReferenceAssetPageDto> {
        const db = await this.client(input.projectPath);
        const page = Math.max(1, Math.floor(input.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 30)));
        const records = await db.textToImageReferenceAsset.findMany({
            orderBy: [{createdAt: "desc"}, {id: "desc"}],
            skip: (page - 1) * pageSize,
            take: pageSize + 1,
        });
        const items = await Promise.all(records.slice(0, pageSize).map(async (record) => {
            const status = await statReferenceAssetStatus(input.projectPath, record);
            return toDto(record, status);
        }));
        return TextToImageReferenceAssetPageDtoSchema.parse({
            items,
            page,
            pageSize,
            hasMore: records.length > pageSize,
        });
    }

    /** 按 assetId 读取 source-image 元数据；行或文件缺失时给出对应 status。 */
    async read(projectPath: string, assetId: string): Promise<TextToImageReferenceAssetDto> {
        const db = await this.client(projectPath);
        const record = await db.textToImageReferenceAsset.findUnique({where: {id: assetId}});
        if (!record) throw new TextToImageReferenceAssetNotFoundError(assetId);
        const status = await statReferenceAssetStatus(projectPath, record);
        return toDto(record, status);
    }

    /** 完整复验后返回服务端文件句柄；校验成功前绝不流式输出。 */
    async content(
        projectPath: string,
        assetId: string,
    ): Promise<{absolutePath: string; mimeType: "image/png" | "image/jpeg"; byteLength: number}> {
        const db = await this.client(projectPath);
        const record = await db.textToImageReferenceAsset.findUnique({where: {id: assetId}});
        if (!record) throw new TextToImageReferenceAssetNotFoundError(assetId);
        const absolutePath = resolveReferenceAssetPath(resolveProjectAbsolutePath(projectPath), record.relativePath);
        const expected: VerifiedReferenceImage = {
            contentHash: record.contentHash,
            mimeType: record.mimeType as VerifiedReferenceImage["mimeType"],
            byteLength: record.byteLength,
            width: record.width,
            height: record.height,
        };
        const verified = await readAndVerifyReferenceImage({absolutePath, expected});
        return {absolutePath, mimeType: verified.evidence.mimeType, byteLength: verified.evidence.byteLength};
    }

    /** 按 contentHash 批量读取，供 Compiler/dispatch 复验 Recipe 引用是否仍闭合。 */
    async readByContentHashes(
        projectPath: string,
        contentHashes: string[],
    ): Promise<Map<string, TextToImageReferenceAssetDto>> {
        const db = await this.client(projectPath);
        const records = contentHashes.length === 0
            ? []
            : await db.textToImageReferenceAsset.findMany({where: {contentHash: {in: contentHashes}}});
        const entries = await Promise.all(records.map(async (record) => {
            const status = await statReferenceAssetStatus(projectPath, record);
            return [record.contentHash, toDto(record, status)] as const;
        }));
        return new Map(entries);
    }

    /** 删除未被 Recipe/Manifest/Vibe/promotion 引用的 source-image；tombstone 崩溃可恢复。 */
    async delete(projectPath: string, assetId: string): Promise<void> {
        await withTextToImageReferenceMutationLock(projectPath, async (scope) => {
            assertTextToImageReferenceMutationScope(scope, {
                projectPath,
                projectRoot: resolveProjectAbsolutePath(projectPath),
            });
            const db = await this.client(projectPath);
            // 先恢复上次崩溃遗留的已识别 tombstone，再执行本次删除。
            await reconcileReferenceDeleteTombstones(projectPath, db);
            const record = await db.textToImageReferenceAsset.findUnique({where: {id: assetId}});
            if (!record) throw new TextToImageReferenceAssetNotFoundError(assetId);
            await assertSourceNotInUse(db, projectPath, record);

            const absolutePath = resolveReferenceAssetPath(resolveProjectAbsolutePath(projectPath), record.relativePath);
            // tombstone 命名携带 asset id 与内容哈希前缀，供崩溃恢复识别。
            const tombstonePath = referenceDeleteTombstonePath(absolutePath, record.id, record.contentHash);
            try {
                await fs.rename(absolutePath, tombstonePath);
            } catch (error) {
                if (!isMissingFileError(error)) throw error;
                // 文件已缺失：仍允许删除残留行，避免用户无法清理损坏记录。
            }
            try {
                await db.textToImageReferenceAsset.delete({where: {id: record.id}});
            } catch (error) {
                await fs.rename(tombstonePath, absolutePath).catch(() => undefined);
                throw error;
            }
            await fs.rm(tombstonePath, {force: true}).catch((error) => {
                consola.warn({assetId, tombstonePath, error}, "参考资产 tombstone 清理失败，将由后续维护处理");
            });
        });
    }

    /** 查询已缓存的 Vibe encoding 字节；cache key 未命中返回 null。 */
    async findVibeEncoding(input: {
        projectPath: string;
        sourceContentHash: string;
        model: string;
        informationExtracted: number;
    }): Promise<Uint8Array | null> {
        const {projectPath, sourceContentHash, model, informationExtracted} = input;
        const lineageId = vibeLineageId(sourceContentHash, model, informationExtracted);
        const db = await this.client(projectPath);
        const lineage = await db.textToImageVibeEncoding.findUnique({
            where: {id: lineageId},
            include: {blob: true},
        });
        if (!lineage) return null;
        const blob = lineage.blob;
        const absolutePath = resolveReferenceAssetPath(resolveProjectAbsolutePath(projectPath), blob.relativePath);
        return await readAndVerifyEncodingBytes(absolutePath, blob.contentHash, blob.byteLength);
    }

    /** 在锁内幂等写入 Vibe encoding lineage 与 blob 文件；Task 4 将接入容器导入与 wire 等价。 */
    async storeVibeEncoding(input: {
        projectPath: string;
        sourceContentHash: string;
        model: string;
        informationExtracted: number;
        bytes: Uint8Array;
    }): Promise<void> {
        const {projectPath, sourceContentHash, model, informationExtracted, bytes} = input;
        if (bytes.byteLength > MAX_ENCODING_BYTES) {
            throw new Error(`Vibe encoding 字节超过 ${MAX_ENCODING_BYTES} 上限`);
        }
        const parsedModel = NovelAiProviderModelIdSchema.parse(model);
        const encoderVersion = vibeEncoderVersionForModel(parsedModel);
        const canonicalInformation = canonicalizeInformationExtracted(informationExtracted);
        const lineageId = hashVibeEncodingCacheKey({
            providerKind: "novelai",
            sourceContentHash,
            providerModel: parsedModel,
            canonicalInformation,
            encoderVersion,
        });

        await withTextToImageReferenceMutationLock(projectPath, async (scope) => {
            assertTextToImageReferenceMutationScope(scope, {
                projectPath,
                projectRoot: resolveProjectAbsolutePath(projectPath),
            });
            const db = await this.client(projectPath);
            const source = await db.textToImageReferenceAsset.findUnique({where: {contentHash: sourceContentHash}});
            if (!source) throw new TextToImageReferenceAssetNotFoundError(sourceContentHash);

            const encodingHash = sha256Hex(bytes);
            const blobRelativePath = createReferenceAssetRelativePath(encodingHash, "application/octet-stream");
            await publishEncodingBlob(projectPath, db, encodingHash, blobRelativePath, bytes);
            await db.textToImageVibeEncoding.upsert({
                where: {id: lineageId},
                create: {
                    id: lineageId,
                    sourceContentHash,
                    providerKind: "novelai",
                    providerModel: parsedModel,
                    informationExtracted,
                    canonicalInformation,
                    encoderVersion,
                    encodingContentHash: encodingHash,
                    provenance: "remote-encode",
                },
                update: {
                    encodingContentHash: encodingHash,
                    informationExtracted,
                    canonicalInformation,
                },
            });
        });
    }

    /**
     * 锁内 all-or-nothing 导入 `.naiv4vibe` 解析结果：source 与全部 encoding 文件先行发布，
     * 再在同一锁内写入 blob 行与 typed lineage（provenance=naiv4vibe-import）。
     * 任何一步失败只留下内容寻址孤儿文件，重放可采纳，绝不留下部分逻辑导入。
     */
    async importVibeContainer(projectPath: string, container: ParsedVibeContainer): Promise<{
        source: TextToImageReferenceAssetDto;
        sourceAlreadyExists: boolean;
        encodingCount: number;
    }> {
        const {source, encodings} = container;
        return await withTextToImageReferenceMutationLock(projectPath, async (scope) => {
            assertTextToImageReferenceMutationScope(scope, {
                projectPath,
                projectRoot: resolveProjectAbsolutePath(projectPath),
            });
            const db = await this.client(projectPath);
            const existingSource = await db.textToImageReferenceAsset.findUnique({
                where: {contentHash: source.evidence.contentHash},
            });
            const published = await publishSourceImage(
                projectPath,
                db,
                source.evidence,
                source.bytes,
                container.display.name ?? undefined,
            );
            const parsedModel = NovelAiProviderModelIdSchema.parse(container.providerModel);
            const canonicalSeen = new Set<string>();
            for (const encoding of encodings) {
                if (canonicalSeen.has(encoding.canonicalInformation)) continue;
                canonicalSeen.add(encoding.canonicalInformation);
                const blobRelativePath = createReferenceAssetRelativePath(encoding.contentHash, "application/octet-stream");
                await publishEncodingBlob(projectPath, db, encoding.contentHash, blobRelativePath, encoding.bytes);
                const lineageId = hashVibeEncodingCacheKey({
                    providerKind: "novelai",
                    sourceContentHash: published.contentHash,
                    providerModel: parsedModel,
                    canonicalInformation: encoding.canonicalInformation,
                    encoderVersion: container.encoderVersion,
                });
                await db.textToImageVibeEncoding.upsert({
                    where: {id: lineageId},
                    create: {
                        id: lineageId,
                        sourceContentHash: published.contentHash,
                        providerKind: "novelai",
                        providerModel: parsedModel,
                        informationExtracted: encoding.informationExtracted,
                        canonicalInformation: encoding.canonicalInformation,
                        encoderVersion: container.encoderVersion,
                        encodingContentHash: encoding.contentHash,
                        provenance: "naiv4vibe-import",
                    },
                    // 同 key 重放幂等：encoding 内容不变，provenance 保留首次证据。
                    update: {},
                });
            }
            return {
                source: published,
                sourceAlreadyExists: existingSource !== null,
                encodingCount: encodings.length,
            };
        });
    }
}

const MAX_ENCODING_BYTES = 1024 * 1024;

/** 在锁内发布 source-image 文件与行的 atomic-pair，绝不覆盖/补偿删除既有 final 文件。 */
export async function publishSourceImage(
    projectPath: string,
    db: PrismaClient,
    evidence: VerifiedReferenceImage,
    inputBytes: Uint8Array,
    clientFileName: string | undefined,
): Promise<TextToImageReferenceAssetDto> {
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    const relativePath = createReferenceAssetRelativePath(evidence.contentHash, evidence.mimeType);
    const absolutePath = resolveReferenceAssetPath(projectRoot, relativePath);
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;

    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    const handle = await fs.open(temporaryPath, "wx");
    try {
        await handle.writeFile(Buffer.from(inputBytes));
        await handle.sync();
    } finally {
        await handle.close();
    }

    let finalCreatedByRequest = false;
    try {
        if (await fileExists(absolutePath)) {
            // 既有 final：完整复验，一致才采纳；篡改/缺失直接 fail closed。
            await verifyExistingFinal(absolutePath, evidence);
            await fs.rm(temporaryPath, {force: true});
            return await createOrReadSourceRow(db, evidence, relativePath, clientFileName);
        }

        // 无 final：no-overwrite 发布。hard link 在 Windows 与 POSIX 都不覆盖已存在目标。
        try {
            await fs.link(temporaryPath, absolutePath);
        } catch (error) {
            if (isEexistError(error)) {
                // 竞态窗口内 final 出现：复验并采纳，删除自己的 temp。
                await verifyExistingFinal(absolutePath, evidence);
                await fs.rm(temporaryPath, {force: true});
                return await createOrReadSourceRow(db, evidence, relativePath, clientFileName);
            }
            throw error;
        }
        await fs.rm(temporaryPath, {force: true});
        finalCreatedByRequest = true;

        try {
            return await createOrReadSourceRow(db, evidence, relativePath, clientFileName);
        } catch (error) {
            // DB 行创建失败：final 是本请求刚发布的，锁内无其它持有者，可安全回滚。
            await fs.rm(absolutePath, {force: true}).catch(() => undefined);
            throw error;
        }
    } finally {
        if (!finalCreatedByRequest) {
            await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
        }
    }
}

/** 在锁内发布 Vibe encoding blob 文件与行的 atomic-pair；复用同一 no-overwrite 语义。 */
export async function publishEncodingBlob(
    projectPath: string,
    db: PrismaClient,
    encodingHash: string,
    relativePath: string,
    bytes: Uint8Array,
): Promise<void> {
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    const absolutePath = resolveReferenceAssetPath(projectRoot, relativePath);
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;

    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    const handle = await fs.open(temporaryPath, "wx");
    try {
        await handle.writeFile(Buffer.from(bytes));
        await handle.sync();
    } finally {
        await handle.close();
    }

    try {
        if (await fileExists(absolutePath)) {
            await fs.rm(temporaryPath, {force: true});
            await createOrReadBlobRow(db, encodingHash, relativePath, bytes.byteLength);
            return;
        }
        try {
            await fs.link(temporaryPath, absolutePath);
        } catch (error) {
            if (isEexistError(error)) {
                await fs.rm(temporaryPath, {force: true});
                await createOrReadBlobRow(db, encodingHash, relativePath, bytes.byteLength);
                return;
            }
            throw error;
        }
        await fs.rm(temporaryPath, {force: true});
        await createOrReadBlobRow(db, encodingHash, relativePath, bytes.byteLength);
    } catch (error) {
        await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
        throw error;
    }
}

/** create-or-read blob 行；唯一冲突时读取胜者行。 */
export async function createOrReadBlobRow(
    db: PrismaClient,
    encodingHash: string,
    relativePath: string,
    byteLength: number,
): Promise<void> {
    const existing = await db.textToImageVibeEncodingBlob.findUnique({where: {contentHash: encodingHash}});
    if (existing) return;
    try {
        await db.textToImageVibeEncodingBlob.create({
            data: {
                id: encodingHash,
                contentHash: encodingHash,
                relativePath,
                byteLength,
            },
        });
    } catch (error) {
        if (!isUniqueConflict(error)) throw error;
    }
}

/** create-or-read source 行；并发唯一冲突时读取胜者行。 */
async function createOrReadSourceRow(
    db: PrismaClient,
    evidence: VerifiedReferenceImage,
    relativePath: string,
    clientFileName: string | undefined,
): Promise<TextToImageReferenceAssetDto> {
    const existing = await db.textToImageReferenceAsset.findUnique({where: {contentHash: evidence.contentHash}});
    if (existing) return toDto(existing, "available");
    const fileName = sanitizeClientFileName(clientFileName, evidence);
    try {
        const created = await db.textToImageReferenceAsset.create({
            data: {
                id: evidence.contentHash,
                contentHash: evidence.contentHash,
                relativePath,
                fileName,
                mimeType: evidence.mimeType,
                byteLength: evidence.byteLength,
                width: evidence.width,
                height: evidence.height,
            },
        });
        return toDto(created, "available");
    } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        const winner = await db.textToImageReferenceAsset.findUnique({where: {contentHash: evidence.contentHash}});
        if (!winner) throw error;
        return toDto(winner, "available");
    }
}

/** 行存在但文件缺失/尺寸不符时返回对应 status；只做 stat，不解码图片。 */
async function statReferenceAssetStatus(
    projectPath: string,
    record: ReferenceAssetRecord,
): Promise<"available" | "missing" | "tampered"> {
    const absolutePath = resolveReferenceAssetPath(resolveProjectAbsolutePath(projectPath), record.relativePath);
    try {
        const stat = await fs.stat(absolutePath);
        return stat.isFile() && stat.size === record.byteLength ? "available" : "tampered";
    } catch (error) {
        if (isMissingFileError(error)) return "missing";
        throw error;
    }
}

/** 复验既有 final 文件与登记证据完全一致；任何不一致都 fail closed。 */
async function verifyExistingFinal(absolutePath: string, expected: VerifiedReferenceImage): Promise<void> {
    await readAndVerifyReferenceImage({absolutePath, expected});
}

/** 按注册哈希与字节长度复验 encoding blob；不做图片解码。 */
export async function readAndVerifyEncodingBytes(
    absolutePath: string,
    expectedContentHash: string,
    expectedByteLength: number,
): Promise<Uint8Array> {
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(absolutePath);
    } catch (error) {
        if (isMissingFileError(error)) {
            throw new TextToImageReferenceAssetNotFoundError(expectedContentHash);
        }
        throw error;
    }
    const actualHash = sha256Hex(bytes);
    if (actualHash !== expectedContentHash || bytes.byteLength !== expectedByteLength) {
        throw new TextToImageReferenceAssetNotFoundError(expectedContentHash);
    }
    return bytes;
}

/** 由 source hash + model + infoExtracted 推导 lineage 稳定 id。 */
export function vibeLineageId(sourceContentHash: string, model: string, informationExtracted: number): string {
    const parsedModel = NovelAiProviderModelIdSchema.parse(model);
    const encoderVersion = vibeEncoderVersionForModel(parsedModel);
    return hashVibeEncodingCacheKey({
        providerKind: "novelai",
        sourceContentHash,
        providerModel: parsedModel,
        canonicalInformation: canonicalizeInformationExtracted(informationExtracted),
        encoderVersion,
    });
}

/** registry 固定 model → Vibe encoder 映射；未登记 model 拒绝进入 lineage。 */
export function vibeEncoderVersionForModel(model: string): NovelAiVibeEncoderVersion {
    const parsed = NovelAiProviderModelIdSchema.parse(model);
    const container = PROVIDER_GRAMMAR_REGISTRY.advanced.vibeTransfer.containers.find(
        (entry) => entry.model === parsed,
    );
    if (!container) {
        throw new Error(`model=${model} 没有登记 Vibe 容器映射`);
    }
    return NovelAiVibeEncoderVersionSchema.parse(container.encoderVersion);
}

/** 被 Vibe lineage、promotion、Recipe 或已提交 Manifest 引用时拒绝删除。 */
async function assertSourceNotInUse(
    db: PrismaClient,
    projectPath: string,
    record: ReferenceAssetRecord,
): Promise<void> {
    const [lineageCount, promotionCount, manifests] = await Promise.all([
        db.textToImageVibeEncoding.count({where: {sourceContentHash: record.contentHash}}),
        db.textToImageReferencePromotion.count({where: {referenceContentHash: record.contentHash}}),
        db.illustrationExecutionManifest.findMany({select: {compiledRequestsJson: true}}),
    ]);
    if (lineageCount > 0 || promotionCount > 0) {
        throw new TextToImageReferenceAssetInUseError(record.contentHash);
    }
    // Manifest：每个 CompiledRequest 都必须通过严格 schema；解析失败是 owner 证据无效，绝非“无 owner”。
    for (const manifest of manifests) {
        if (strictManifestReferencesHash(manifest.compiledRequestsJson, record.contentHash)) {
            throw new TextToImageReferenceAssetInUseError(record.contentHash);
        }
    }
    // Recipe：通过 codec 严格解析当前 Recipe；文件缺失视为无 Recipe owner，损坏则 fail closed。
    const recipeMarkdown = await readRecipeMarkdown(projectPath);
    if (recipeMarkdown !== null) {
        const recipeReferences = recipeReferencesOf(recipeMarkdown);
        if (recipeReferences.some((contentHash) => contentHash === record.contentHash)) {
            throw new TextToImageReferenceAssetInUseError(record.contentHash);
        }
    }
}

/** 严格解析 Manifest 的 compiledRequestsJson；任一条目非法都抛 owner 证据无效。 */
function strictManifestReferencesHash(compiledRequestsJson: string, contentHash: string): boolean {
    let raw: unknown;
    try {
        raw = JSON.parse(compiledRequestsJson);
    } catch {
        throw new TextToImageReferenceOwnerEvidenceError();
    }
    if (!Array.isArray(raw)) throw new TextToImageReferenceOwnerEvidenceError();
    for (const item of raw) {
        const parsed = IllustrationCompiledRequestSchema.safeParse(item);
        if (!parsed.success) throw new TextToImageReferenceOwnerEvidenceError();
        if (manifestReferencesHash(parsed.data, contentHash)) return true;
    }
    return false;
}

/** 读取当前 Project Recipe markdown；缺失返回 null，读取失败抛 owner 证据无效。 */
async function readRecipeMarkdown(projectPath: string): Promise<string | null> {
    const absolutePath = path.join(resolveProjectAbsolutePath(projectPath), DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH);
    try {
        return await fs.readFile(absolutePath, "utf8");
    } catch (error) {
        if (isMissingFileError(error)) return null;
        throw error;
    }
}

/** 用 recipe codec 严格解析并提取所有参考 contentHash；解析失败抛 owner 证据无效。 */
function recipeReferencesOf(markdown: string): string[] {
    let source: ReturnType<typeof parseTextToImageRecipeMarkdown>;
    try {
        source = parseTextToImageRecipeMarkdown(markdown);
    } catch {
        throw new TextToImageReferenceOwnerEvidenceError();
    }
    const references = source.references;
    return [
        ...references.vibeReferences.map((reference) => reference.contentHash),
        ...references.characterReferences.map((reference) => reference.contentHash),
        ...(references.inpaint ? [references.inpaint.baseImageContentHash, references.inpaint.maskContentHash] : []),
    ];
}

/** CompiledRequest references 是否引用目标 contentHash。 */
function manifestReferencesHash(request: unknown, contentHash: string): boolean {
    if (typeof request !== "object" || request === null) return false;
    const references = (request as {references?: unknown}).references;
    if (typeof references !== "object" || references === null) return false;
    const refs = references as {
        vibeReferences?: Array<{contentHash?: string}>;
        characterReferences?: Array<{contentHash?: string}>;
        inpaint?: {baseImageContentHash?: string; maskContentHash?: string} | null;
    };
    return (refs.vibeReferences ?? []).some((item) => item.contentHash === contentHash)
        || (refs.characterReferences ?? []).some((item) => item.contentHash === contentHash)
        || (refs.inpaint !== null && refs.inpaint !== undefined
            && (refs.inpaint.baseImageContentHash === contentHash || refs.inpaint.maskContentHash === contentHash));
}

/** 客户端文件名只作为展示 hint：取 basename、截断、空值回退为 contentHash 扩展名。 */
function sanitizeClientFileName(fileName: string | undefined, evidence: VerifiedReferenceImage): string {
    const base = (fileName ?? "").trim().split(/[\\/]/u).pop() ?? "";
    if (!base || base.length > 300) {
        const extension = evidence.mimeType === "image/png" ? "png" : "jpg";
        return `${evidence.contentHash}.${extension}`;
    }
    return base;
}

function toDto(record: ReferenceAssetRecord, status: "available" | "missing" | "tampered"): TextToImageReferenceAssetDto {
    const dto = {
        id: record.id,
        kind: "source-image" as const,
        contentHash: record.contentHash,
        fileName: record.fileName,
        mimeType: record.mimeType as "image/png" | "image/jpeg",
        byteLength: record.byteLength,
        width: record.width,
        height: record.height,
        status,
        createdAt: record.createdAt.toISOString(),
    };
    return TextToImageReferenceAssetDtoSchema.parse(dto);
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function fileExists(absolutePath: string): Promise<boolean> {
    return fs.stat(absolutePath).then(
        (stat) => stat.isFile(),
        (error) => {
            if (isMissingFileError(error)) return false;
            throw error;
        },
    );
}

function isMissingFileError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isEexistError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isUniqueConflict(error: unknown): boolean {
    if (error instanceof Error && "code" in error) {
        return error.code === "P2002" || error.code === "SQLITE_CONSTRAINT_UNIQUE";
    }
    return false;
}

/** 参考删除 tombstone 的稳定命名：`<final>.<assetId>.<hash16>.delete`。 */
function referenceDeleteTombstonePath(absolutePath: string, assetId: string, contentHash: string): string {
    return `${absolutePath}.${assetId}.${contentHash.slice(0, 16)}.delete`;
}

/**
 * 崩溃恢复：在锁内检查 references 目录的已识别 tombstone。
 *
 * - 行存在 + tombstone 存在（final 缺失）→ 复验 tombstone 与登记证据一致后恢复为 final；
 * - 行不存在 + tombstone 存在 → 删除 tombstone；
 * - 无法识别的 tombstone（命名不符）一律不动，绝不猜测。
 */
async function reconcileReferenceDeleteTombstones(projectPath: string, db: PrismaClient): Promise<void> {
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    const referenceRoot = path.join(projectRoot, TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT);
    let files: string[] = [];
    try {
        files = await listFilesRecursively(referenceRoot);
    } catch (error) {
        if (isMissingFileError(error)) return;
        throw error;
    }
    for (const absolutePath of files) {
        if (!absolutePath.endsWith(".delete")) continue;
        const parsed = parseReferenceTombstoneName(absolutePath);
        if (!parsed) continue;  // 未识别 tombstone：不猜测。
        const {finalPath, assetId, contentHash} = parsed;
        const record = await db.textToImageReferenceAsset.findUnique({where: {id: assetId}});
        if (record && !record.contentHash.startsWith(contentHash)) continue;  // 身份不符：不猜测。
        if (await fileExists(finalPath)) {
            // final 已恢复（或从未离开）：tombstone 是残留，直接清理。
            await fs.rm(absolutePath, {force: true}).catch(() => undefined);
            continue;
        }
        if (!record) {
            // 行已删除：tombstone 对应已提交删除，安全清理。
            await fs.rm(absolutePath, {force: true}).catch(() => undefined);
            continue;
        }
        // 行存在 + final 缺失：复验 tombstone 字节与登记证据一致后恢复。
        await verifyExistingFinal(absolutePath, {
            contentHash: record.contentHash,
            mimeType: record.mimeType as VerifiedReferenceImage["mimeType"],
            byteLength: record.byteLength,
            width: record.width,
            height: record.height,
        });
        await fs.rename(absolutePath, finalPath);
    }
}

/** 解析 `<final>.<assetId>.<hash16>.delete` 形式；命名不符返回 null。 */
function parseReferenceTombstoneName(absolutePath: string): {finalPath: string; assetId: string; contentHash: string} | null {
    const match = /^(.*)\.([0-9a-fA-F-]{8,64})\.([0-9a-fA-F]{16})\.delete$/u.exec(absolutePath);
    if (!match?.[1] || !match[2] || !match[3]) return null;
    const finalPath = match[1];
    // final 必须是 references 目录内的合法内容寻址文件，防止 path 注入。
    if (!/^[0-9a-f]{64}\.(png|jpg|bin)$/u.test(path.basename(finalPath))) return null;
    return {finalPath, assetId: match[2], contentHash: match[3]};
}

async function listFilesRecursively(directory: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(directory, {withFileTypes: true});
    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFilesRecursively(absolutePath));
        } else if (entry.isFile()) {
            files.push(absolutePath);
        }
    }
    return files;
}
