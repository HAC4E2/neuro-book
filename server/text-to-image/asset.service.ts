import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {consola} from "consola";
import type {
    TextToImageAsset,
    TextToImageJob,
    PrismaClient,
} from "nbook/server/generated/project-prisma/client";
import type {
    TextToImageAssetDto,
    TextToImageAssetListItemDto,
    TextToImageAssetPageDto,
    TextToImageJobStatus,
} from "nbook/shared/dto/text-to-image.dto";
import {
    createTextToImageAssetRelativePath,
    resolveTextToImageAssetPath,
    textToImageAssetExtension,
} from "nbook/server/text-to-image/asset-path";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";

type SaveTextToImageAssetInput = {
    projectPath: string;
    jobId: string;
    bytes: Uint8Array;
    mimeType: string;
    width: number;
    height: number;
    model: string;
    seed: number;
    prompt: string;
    negativePrompt: string;
    sourceKind: string;
    sourcePath: string | null;
    sourceAnchorId: string | null;
};

type ListTextToImageAssetsInput = {
    projectPath: string;
    page?: number;
    pageSize?: number;
    sourceKind?: string;
    sourcePath?: string;
    jobStatus?: TextToImageJobStatus;
};

type TextToImageAssetWithJob = TextToImageAsset & {
    job: Pick<TextToImageJob, "status" | "sourceInsertStatus">;
};

type AssetServiceOptions = {
    client?: (projectPath: string) => Promise<PrismaClient>;
};

/** 正文仍引用图片时用于阻止删除的稳定业务错误。 */
export class TextToImageAssetReferencedError extends Error {
    readonly code = "TEXT_TO_IMAGE_ASSET_REFERENCED";

    constructor(readonly relativePath: string) {
        super(`图片仍被正文引用：${relativePath}`);
        this.name = "TextToImageAssetReferencedError";
    }
}

/** Project 级文生图资产读写服务，文件与数据库记录始终成对维护。 */
export class TextToImageAssetService {
    private readonly client: (projectPath: string) => Promise<PrismaClient>;

    constructor(options: AssetServiceOptions = {}) {
        this.client = options.client ?? textToImageProjectClient;
    }

    /** 原子写入图片文件，并在数据库写入失败时补偿删除该文件。 */
    async save(input: SaveTextToImageAssetInput): Promise<TextToImageAssetDto> {
        const client = await this.client(input.projectPath);
        const job = await client.textToImageJob.findUnique({where: {id: input.jobId}, select: {id: true}});
        if (!job) {
            throw new Error("文生图任务不存在");
        }

        const assetId = randomUUID();
        const relativePath = createTextToImageAssetRelativePath(assetId, textToImageAssetExtension(input.mimeType));
        const absolutePath = resolveTextToImageAssetPath(resolveProjectAbsolutePath(input.projectPath), relativePath);
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

            const asset = await client.textToImageAsset.create({
                data: {
                    id: assetId,
                    jobId: input.jobId,
                    relativePath,
                    fileName: path.posix.basename(relativePath),
                    mimeType: input.mimeType,
                    byteLength: input.bytes.byteLength,
                    width: input.width,
                    height: input.height,
                    model: input.model,
                    seed: input.seed,
                    prompt: input.prompt,
                    negativePrompt: input.negativePrompt,
                    sourceKind: input.sourceKind,
                    sourcePath: input.sourcePath,
                    sourceAnchorId: input.sourceAnchorId,
                },
            });
            return assetDto(asset);
        } catch (error) {
            await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
            if (finalFileWritten) {
                await fs.rm(absolutePath, {force: true}).catch(() => undefined);
            }
            throw error;
        }
    }

    /** 以稳定创建时间倒序分页读取历史资产，不暴露任务原始请求。 */
    async list(input: ListTextToImageAssetsInput): Promise<TextToImageAssetPageDto> {
        const client = await this.client(input.projectPath);
        const page = Math.max(1, Math.floor(input.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 30)));
        const assets = await client.textToImageAsset.findMany({
            where: {
                sourceKind: input.sourceKind,
                sourcePath: input.sourcePath,
                job: input.jobStatus ? {status: input.jobStatus} : undefined,
            },
            include: {
                job: {
                    select: {
                        status: true,
                        sourceInsertStatus: true,
                    },
                },
            },
            orderBy: [
                {createdAt: "desc"},
                {id: "desc"},
            ],
            skip: (page - 1) * pageSize,
            take: pageSize + 1,
        });
        const hasMore = assets.length > pageSize;
        return {
            items: assets.slice(0, pageSize).map(assetListItemDto),
            page,
            pageSize,
            hasMore,
        };
    }

    /** 按 Project/assetId 读取完整持久 Asset DTO；不接受路径或浏览器 metadata。 */
    async read(projectPath: string, assetId: string): Promise<TextToImageAssetDto> {
        const client = await this.client(projectPath);
        const asset = await client.textToImageAsset.findUnique({where: {id: assetId}});
        if (!asset) throw new Error("文生图图片不存在");
        return assetDto(asset);
    }

    /** 根据资产 ID 解析已登记的实际文件，永不接收 HTTP 提供的文件路径。 */
    async content(projectPath: string, assetId: string): Promise<{absolutePath: string; mimeType: string}> {
        const client = await this.client(projectPath);
        const asset = await client.textToImageAsset.findUnique({where: {id: assetId}});
        if (!asset) {
            throw new Error("文生图图片不存在");
        }
        const absolutePath = resolveTextToImageAssetPath(resolveProjectAbsolutePath(projectPath), asset.relativePath);
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) {
            throw new Error("文生图图片文件不存在");
        }
        return {absolutePath, mimeType: asset.mimeType};
    }

    /** 删除未被 Markdown 引用的资产；文件与数据库删除采用 tombstone 回滚策略。 */
    async delete(projectPath: string, assetId: string): Promise<void> {
        const client = await this.client(projectPath);
        const asset = await client.textToImageAsset.findUnique({where: {id: assetId}});
        if (!asset) {
            throw new Error("文生图图片不存在");
        }
        const projectRoot = resolveProjectAbsolutePath(projectPath);
        if (await markdownReferencesAsset(projectRoot, asset.relativePath)) {
            throw new TextToImageAssetReferencedError(asset.relativePath);
        }

        const absolutePath = resolveTextToImageAssetPath(projectRoot, asset.relativePath);
        const tombstonePath = `${absolutePath}.${randomUUID()}.delete`;
        await fs.rename(absolutePath, tombstonePath);
        try {
            await client.textToImageAsset.delete({where: {id: asset.id}});
        } catch (error) {
            await fs.rename(tombstonePath, absolutePath);
            throw error;
        }
        await fs.rm(tombstonePath, {force: true}).catch((error) => {
            consola.warn({assetId, tombstonePath, error}, "文生图图片 tombstone 清理失败，将由后续维护处理");
        });
    }
}

function assetDto(asset: TextToImageAsset): TextToImageAssetDto {
    return {
        id: asset.id,
        jobId: asset.jobId,
        relativePath: asset.relativePath,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        byteLength: asset.byteLength,
        width: asset.width,
        height: asset.height,
        model: asset.model,
        seed: asset.seed,
        prompt: asset.prompt,
        negativePrompt: asset.negativePrompt,
        sourceKind: asset.sourceKind,
        sourcePath: asset.sourcePath,
        sourceAnchorId: asset.sourceAnchorId,
        createdAt: asset.createdAt.toISOString(),
    };
}

function assetListItemDto(asset: TextToImageAssetWithJob): TextToImageAssetListItemDto {
    return {
        ...assetDto(asset),
        jobStatus: asset.job.status,
        sourceInsertStatus: asset.job.sourceInsertStatus,
    };
}

async function markdownReferencesAsset(directory: string, relativePath: string): Promise<boolean> {
    const entries = await fs.readdir(directory, {withFileTypes: true});
    for (const entry of entries) {
        if ([".nbook", ".git", ".agent"].includes(entry.name)) {
            continue;
        }
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (await markdownReferencesAsset(absolutePath, relativePath)) {
                return true;
            }
            continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
            continue;
        }
        if ((await fs.readFile(absolutePath, "utf8")).includes(relativePath)) {
            return true;
        }
    }
    return false;
}
