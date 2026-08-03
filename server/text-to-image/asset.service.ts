import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {PrismaClient, TextToImageAsset} from "nbook/server/generated/project-prisma/client";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {
    createTextToImageAssetRelativePath,
    resolveTextToImageAssetPath,
    textToImageAssetExtension,
} from "nbook/server/text-to-image/asset-path";
import {
    resolveTextToImageProjectRoot,
    withEphemeralTextToImageProjectClient,
} from "nbook/server/text-to-image/project-client";

export type SaveTextToImageAssetInput = {
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
    client?: (projectPath: string) => Promise<PrismaClient>;
};

export type ListTextToImageAssetsInput = {
    projectPath: string;
    page?: number;
    pageSize?: number;
    client?: (projectPath: string) => Promise<PrismaClient>;
};

export type TextToImageAssetPage = {
    items: TextToImageAssetDto[];
    page: number;
    pageSize: number;
    hasMore: boolean;
};

/**
 * 校验 job 存在后原子写入资产文件，再创建 DB 记录；
 * DB 写入失败时删除已落盘文件，避免留下孤儿资产。
 */
export async function saveTextToImageAsset(input: SaveTextToImageAssetInput): Promise<TextToImageAssetDto> {
    const extension = textToImageAssetExtension(input.mimeType);
    const id = randomUUID();
    const relativePath = createTextToImageAssetRelativePath(id, extension);
    const projectRoot = resolveTextToImageProjectRoot(input.projectPath);
    const targetPath = resolveTextToImageAssetPath(projectRoot, relativePath);
    const contentHash = createHash("sha256").update(input.bytes).digest("hex");

    return await withTextToImageAssetClient(input.projectPath, input.client, async (client) => {
        const job = await client.textToImageJob.findUnique({where: {id: input.jobId}});
        if (!job) {
            throw new Error(`文生图任务不存在：${input.jobId}`);
        }

        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporaryPath, input.bytes);
            await fs.rename(temporaryPath, targetPath);
        } catch (error) {
            await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
            throw error;
        }

        try {
            const created = await client.textToImageAsset.create({
                data: {
                    id,
                    jobId: input.jobId,
                    relativePath,
                    fileName: path.basename(relativePath),
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
                    contentHash,
                },
            });
            return toTextToImageAssetDto(created);
        } catch (error) {
            await fs.rm(targetPath, {force: true}).catch(() => undefined);
            throw error;
        }
    });
}

/** 按 createdAt 倒序分页列出资产，pageSize 上限 100。*/
export async function listTextToImageAssets(input: ListTextToImageAssetsInput): Promise<TextToImageAssetPage> {
    const page = typeof input.page === "number" && Number.isFinite(input.page)
        ? Math.max(1, Math.floor(input.page))
        : 1;
    const requestedPageSize = typeof input.pageSize === "number" && Number.isFinite(input.pageSize)
        ? Math.floor(input.pageSize)
        : 20;
    const pageSize = Math.min(100, Math.max(1, requestedPageSize));

    return await withTextToImageAssetClient(input.projectPath, input.client, async (client) => {
        const skip = (page - 1) * pageSize;
        const [records, total] = await Promise.all([
            client.textToImageAsset.findMany({
                orderBy: {createdAt: "desc"},
                skip,
                take: pageSize,
            }),
            client.textToImageAsset.count(),
        ]);
        return {
            items: records.map(toTextToImageAssetDto),
            page,
            pageSize,
            hasMore: skip + records.length < total,
        };
    });
}

function toTextToImageAssetDto(record: TextToImageAsset): TextToImageAssetDto {
    return {
        id: record.id,
        jobId: record.jobId,
        relativePath: record.relativePath,
        fileName: record.fileName,
        mimeType: record.mimeType,
        byteLength: record.byteLength,
        width: record.width,
        height: record.height,
        model: record.model,
        seed: record.seed,
        prompt: record.prompt,
        negativePrompt: record.negativePrompt,
        sourceKind: record.sourceKind,
        sourcePath: record.sourcePath,
        sourceAnchorId: record.sourceAnchorId,
        createdAt: record.createdAt.toISOString(),
    };
}

async function withTextToImageAssetClient<T>(
    projectPath: string,
    clientFactory: ((projectPath: string) => Promise<PrismaClient>) | undefined,
    operation: (client: PrismaClient) => Promise<T>,
): Promise<T> {
    if (clientFactory) {
        return await operation(await clientFactory(projectPath));
    }
    return await withEphemeralTextToImageProjectClient(projectPath, operation);
}
