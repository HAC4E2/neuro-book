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
    finalPromptBundleJson?: string | null;
    sourceKind: string;
    sourcePath: string | null;
    sourceAnchorId: string | null;
    client?: (projectPath: string) => Promise<PrismaClient>;
};

export type ListTextToImageAssetsInput = {
    projectPath: string;
    page?: number;
    pageSize?: number;
    sourceAnchorId?: string | null;
    client?: (projectPath: string) => Promise<PrismaClient>;
};

export type TextToImageAssetPage = {
    items: TextToImageAssetDto[];
    page: number;
    pageSize: number;
    hasMore: boolean;
};

export type TextToImageAssetJobSnapshot = {
    asset: TextToImageAssetDto;
    job: {
        providerId: number;
        providerOwnerUserId: number;
        providerCredentialRevision: number;
        requestJson: string;
        providerSnapshotJson: string;
    };
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
                    finalPromptBundleJson: input.finalPromptBundleJson ?? null,
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
        const sourceAnchorId = input.sourceAnchorId?.trim() || undefined;
        const where = sourceAnchorId ? {sourceAnchorId} : undefined;
        const [records, total] = await Promise.all([
            client.textToImageAsset.findMany({
                ...(where ? {where} : {}),
                orderBy: {createdAt: "desc"},
                skip,
                take: pageSize,
            }),
            sourceAnchorId
                ? client.textToImageAsset.count({where})
                : client.textToImageAsset.count(),
        ]);
        return {
            items: records.map(toTextToImageAssetDto),
            page,
            pageSize,
            hasMore: skip + records.length < total,
        };
    });
}

/** 按来源锚点查找最新资产；占位符生成完成后用它定位最终图片。 */
export async function findLatestTextToImageAssetBySourceAnchorId(
    projectPath: string,
    sourceAnchorId: string,
): Promise<TextToImageAssetDto | null> {
    return await withTextToImageAssetClient(projectPath, undefined, async (client) => {
        const record = await client.textToImageAsset.findFirst({
            where: {sourceAnchorId},
            orderBy: {createdAt: "desc"},
        });
        return record ? toTextToImageAssetDto(record) : null;
    });
}

/** 按来源锚点列出成功资产，供正文写回识别重复插入和免生图恢复。 */
export async function listTextToImageAssetsBySourceAnchorId(
    projectPath: string,
    sourceAnchorId: string,
): Promise<TextToImageAssetDto[]> {
    return await withTextToImageAssetClient(projectPath, undefined, async (client) => {
        const records = await client.textToImageAsset.findMany({
            where: {sourceAnchorId},
            orderBy: {createdAt: "desc"},
            take: 100,
        });
        return records.map(toTextToImageAssetDto);
    });
}

/** 按相对路径查找资产记录，供角色照片按路径读取内容。 */
export async function findTextToImageAssetByRelativePath(
    projectPath: string,
    relativePath: string,
    client?: (projectPath: string) => Promise<PrismaClient>,
): Promise<TextToImageAssetDto | null> {
    return await withTextToImageAssetClient(projectPath, client, async (prisma) => {
        const record = await prisma.textToImageAsset.findFirst({
            where: {relativePath},
            orderBy: {createdAt: "desc"},
        });
        return record ? toTextToImageAssetDto(record) : null;
    });
}

/** 按资产 ID 读取单个图片，供正文免生图恢复使用。 */
export async function findTextToImageAssetById(
    projectPath: string,
    assetId: string,
): Promise<TextToImageAssetDto | null> {
    return await withTextToImageAssetClient(projectPath, undefined, async (client) => {
        const record = await client.textToImageAsset.findUnique({where: {id: assetId}});
        return record ? toTextToImageAssetDto(record) : null;
    });
}

/** 按后处理 Job 查找新写入的资产，作为 sourceAnchorId 缺失时的回退。 */
export async function findTextToImageAssetByJobId(
    projectPath: string,
    jobId: string,
): Promise<TextToImageAssetDto | null> {
    return await withTextToImageAssetClient(projectPath, undefined, async (client) => {
        const record = await client.textToImageAsset.findFirst({
            where: {jobId},
            orderBy: {createdAt: "desc"},
        });
        return record ? toTextToImageAssetDto(record) : null;
    });
}

/** 鎸夌浉瀵硅矾寰勮鍙栬祫浜у師濮嬪瓧鑺傦紱鐢ㄤ簬 Vibe/瑙掕壊鍙傝€冧笌灞€閮ㄩ噸缁樸€?*/
export async function readTextToImageAssetBytesByRelativePath(
    projectPath: string,
    relativePath: string,
): Promise<Uint8Array> {
    const projectRoot = resolveTextToImageProjectRoot(projectPath);
    return new Uint8Array(await fs.readFile(resolveTextToImageAssetPath(projectRoot, relativePath)));
}

/** 鑾峰彇璧勪骇鍙婂叾鏉ュ巻 Job 蹇叓锛屼緵 reroll / Tag 淇敼 / 灞€閮ㄩ噸缁樺叆闃熶娇鐢ㄣ€?*/
export async function findTextToImageAssetJobSnapshot(
    projectPath: string,
    assetId: string,
): Promise<TextToImageAssetJobSnapshot | null> {
    return await withTextToImageAssetClient(projectPath, undefined, async (client) => {
        const asset = await client.textToImageAsset.findUnique({where: {id: assetId}});
        if (!asset) {
            return null;
        }
        const job = await client.textToImageJob.findUnique({where: {id: asset.jobId}});
        if (!job) {
            throw new Error(`鏂囩敓鍥句换鍔′笉瀛樺湪锛?{asset.jobId}`);
        }
        return {
            asset: toTextToImageAssetDto(asset),
            job: {
                providerId: job.providerId,
                providerOwnerUserId: job.providerOwnerUserId,
                providerCredentialRevision: job.providerCredentialRevision,
                requestJson: job.requestJson,
                providerSnapshotJson: job.providerSnapshotJson,
            },
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
        finalPromptBundleJson: record.finalPromptBundleJson,
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
