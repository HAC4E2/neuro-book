import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {consola} from "consola";
import type {
    PrismaClient,
    TextToImageReferenceAsset as ReferenceAssetRecord,
} from "nbook/server/generated/project-prisma/client";
import type {TextToImageReferenceAssetDto} from "nbook/shared/text-to-image-reference-asset";
import {
    REFERENCE_ASSET_MIME_BY_KIND,
    TextToImageReferenceAssetDtoSchema,
    type TextToImageReferenceAssetKind,
} from "nbook/shared/text-to-image-reference-asset";
import {
    createReferenceAssetRelativePath,
    resolveReferenceAssetPath,
} from "nbook/server/text-to-image/asset-path";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";

type ServiceClient = (projectPath: string) => Promise<PrismaClient>;

type UploadInput = {
    projectPath: string;
    bytes: Uint8Array;
    mimeType: string;
    kind: TextToImageReferenceAssetKind;
    /** vibe-encoding 必填：派生源资产 ID；其余必须为 null。 */
    parentAssetId: string | null;
    /** vibe-encoding 必填：派生 model；其余必须为 null。 */
    derivedModel: string | null;
    /** vibe-encoding 必填：派生 infoExtracted；其余必须为 null。 */
    derivedInfoExtracted: number | null;
};

type ListInput = {
    projectPath: string;
    kind?: TextToImageReferenceAssetKind;
    page?: number;
    pageSize?: number;
};

type FindEncodingInput = {
    projectPath: string;
    sourceAssetId: string;
    model: string;
    infoExtracted: number;
};

/** 参考资产不存在或跨 Project 误用的稳定业务错误。 */
export class TextToImageReferenceAssetNotFoundError extends Error {
    readonly code = "TEXT_TO_IMAGE_REFERENCE_ASSET_NOT_FOUND";
    constructor(readonly assetId: string) {
        super(`参考资产不存在：${assetId}`);
        this.name = "TextToImageReferenceAssetNotFoundError";
    }
}

/** 参考资产被 Recipe/manifest 引用，删除前必须先解除引用。 */
export class TextToImageReferenceAssetInUseError extends Error {
    readonly code = "TEXT_TO_IMAGE_REFERENCE_ASSET_IN_USE";
    constructor(readonly contentHash: string) {
        super(`参考资产仍被引用，无法删除：${contentHash}`);
        this.name = "TextToImageReferenceAssetInUseError";
    }
}

/**
 * Project 级参考资产读写服务：内容寻址 dedup、衍生 Vibe encoding 缓存与 lineage。
 * 文件与数据库记录始终成对维护；不暴露 bytes 与 secret。
 */
export class TextToImageReferenceAssetService {
    private readonly client: ServiceClient;

    constructor(client: ServiceClient = textToImageProjectClient) {
        this.client = client;
    }

    /** 内容寻址上传；相同 contentHash+kind 已存在则直接返回既有记录。 */
    async upload(input: UploadInput): Promise<TextToImageReferenceAssetDto> {
        validateKindMime(input.kind, input.mimeType);
        validateDerivationFields(input);
        const contentHash = sha256Hex(input.bytes);
        const db = await this.client(input.projectPath);
        const existing = await db.textToImageReferenceAsset.findUnique({where: {contentHash}});
        if (existing) {
            return toDto(existing);
        }
        const relativePath = createReferenceAssetRelativePath(contentHash, input.mimeType);
        const absolutePath = resolveReferenceAssetPath(resolveProjectAbsolutePath(input.projectPath), relativePath);
        const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
        await fs.mkdir(path.dirname(absolutePath), {recursive: true});

        let finalFileWritten = false;
        try {
            const handle = await fs.open(temporaryPath, "wx");
            try {
                await handle.writeFile(input.bytes);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await fs.rename(temporaryPath, absolutePath);
            finalFileWritten = true;

            const record = await db.textToImageReferenceAsset.create({
                data: {
                    id: randomUUID(),
                    kind: input.kind,
                    contentHash,
                    relativePath,
                    fileName: path.posix.basename(relativePath),
                    mimeType: input.mimeType,
                    byteLength: input.bytes.byteLength,
                    parentAssetId: input.parentAssetId,
                    derivedModel: input.derivedModel,
                    derivedInfoExtracted: input.derivedInfoExtracted,
                },
            });
            return toDto(record);
        } catch (error) {
            await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
            if (finalFileWritten) {
                await fs.rm(absolutePath, {force: true}).catch(() => undefined);
            }
            throw error;
        }
    }

    /** 按种类分页读取参考资产元数据，不返回 bytes。 */
    async list(input: ListInput): Promise<{items: TextToImageReferenceAssetDto[]; page: number; pageSize: number; hasMore: boolean}> {
        const db = await this.client(input.projectPath);
        const page = Math.max(1, Math.floor(input.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 30)));
        const records = await db.textToImageReferenceAsset.findMany({
            where: {kind: input.kind},
            orderBy: [{createdAt: "desc"}, {id: "desc"}],
            skip: (page - 1) * pageSize,
            take: pageSize + 1,
        });
        const hasMore = records.length > pageSize;
        return {
            items: records.slice(0, pageSize).map(toDto),
            page,
            pageSize,
            hasMore,
        };
    }

    /** 按 assetId 读取参考资产 DTO；跨 Project 不复用。 */
    async read(projectPath: string, assetId: string): Promise<TextToImageReferenceAssetDto> {
        const db = await this.client(projectPath);
        const record = await db.textToImageReferenceAsset.findUnique({where: {id: assetId}});
        if (!record) throw new TextToImageReferenceAssetNotFoundError(assetId);
        return toDto(record);
    }

    /** 解析已登记参考资产的实际文件路径，永不接收 HTTP 提供的路径。 */
    async content(projectPath: string, assetId: string): Promise<{absolutePath: string; mimeType: string; byteLength: number}> {
        const db = await this.client(projectPath);
        const record = await db.textToImageReferenceAsset.findUnique({where: {id: assetId}});
        if (!record) throw new TextToImageReferenceAssetNotFoundError(assetId);
        const absolutePath = resolveReferenceAssetPath(resolveProjectAbsolutePath(projectPath), record.relativePath);
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) throw new TextToImageReferenceAssetNotFoundError(assetId);
        return {absolutePath, mimeType: record.mimeType, byteLength: record.byteLength};
    }

    /** 按 contentHash 批量读取，供 Compiler 复验 Recipe 引用是否仍闭合。 */
    async readByContentHashes(projectPath: string, contentHashes: string[]): Promise<Map<string, TextToImageReferenceAssetDto>> {
        const db = await this.client(projectPath);
        const records = contentHashes.length === 0
            ? []
            : await db.textToImageReferenceAsset.findMany({where: {contentHash: {in: contentHashes}}});
        return new Map(records.map((record) => [record.contentHash, toDto(record)]));
    }

    /** Vibe encoding 缓存查询：源资产 + model + infoExtracted 唯一确定一份派生 encoding。 */
    async findVibeEncoding(input: FindEncodingInput): Promise<TextToImageReferenceAssetDto | null> {
        const db = await this.client(input.projectPath);
        const record = await db.textToImageReferenceAsset.findFirst({
            where: {
                kind: "vibe-encoding",
                parentAssetId: input.sourceAssetId,
                derivedModel: input.model,
                derivedInfoExtracted: input.infoExtracted,
            },
        });
        return record ? toDto(record) : null;
    }

    /** 删除未被引用的参考资产；派生 encoding 没有源引用检查，可直接删。 */
    async delete(projectPath: string, assetId: string): Promise<void> {
        const db = await this.client(projectPath);
        const record = await db.textToImageReferenceAsset.findUnique({where: {id: assetId}});
        if (!record) throw new TextToImageReferenceAssetNotFoundError(assetId);
        // 派生 encoding 的源资产删除时，先阻止（必须先删派生 encoding）。
        if (record.kind !== "vibe-encoding") {
            const dependents = await db.textToImageReferenceAsset.count({where: {parentAssetId: assetId}});
            if (dependents > 0) throw new TextToImageReferenceAssetInUseError(record.contentHash);
        }

        const absolutePath = resolveReferenceAssetPath(resolveProjectAbsolutePath(projectPath), record.relativePath);
        const tombstonePath = `${absolutePath}.${randomUUID()}.delete`;
        await fs.rename(absolutePath, tombstonePath);
        try {
            await db.textToImageReferenceAsset.delete({where: {id: record.id}});
        } catch (error) {
            await fs.rename(tombstonePath, absolutePath);
            throw error;
        }
        await fs.rm(tombstonePath, {force: true}).catch((error) => {
            consola.warn({assetId, tombstonePath, error}, "参考资产 tombstone 清理失败，将由后续维护处理");
        });
    }
}

function validateKindMime(kind: TextToImageReferenceAssetKind, mimeType: string): void {
    const allowed: readonly string[] = REFERENCE_ASSET_MIME_BY_KIND[kind];
    if (!allowed.includes(mimeType)) {
        throw new Error(`参考资产 kind=${kind} 不支持 MIME ${mimeType}`);
    }
}

/** vibe-encoding 必须三字段齐全；非派生资产三字段必须为 null。 */
function validateDerivationFields(input: UploadInput): void {
    const isEncoding = input.kind === "vibe-encoding";
    const hasParent = input.parentAssetId !== null;
    const hasModel = input.derivedModel !== null;
    const hasInfo = input.derivedInfoExtracted !== null;
    if (isEncoding && (!hasParent || !hasModel || !hasInfo)) {
        throw new Error("vibe-encoding 必须同时提供 parentAssetId、derivedModel 与 derivedInfoExtracted");
    }
    if (!isEncoding && (hasParent || hasModel || hasInfo)) {
        throw new Error(`参考资产 kind=${input.kind} 不得携带派生字段`);
    }
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function toDto(record: ReferenceAssetRecord): TextToImageReferenceAssetDto {
    const dto = {
        id: record.id,
        kind: record.kind as TextToImageReferenceAssetKind,
        contentHash: record.contentHash,
        relativePath: record.relativePath,
        fileName: record.fileName,
        mimeType: record.mimeType,
        byteLength: record.byteLength,
        parentAssetId: record.parentAssetId,
        derivedModel: record.derivedModel,
        derivedInfoExtracted: record.derivedInfoExtracted,
        createdAt: record.createdAt.toISOString(),
    };
    return TextToImageReferenceAssetDtoSchema.parse(dto);
}
