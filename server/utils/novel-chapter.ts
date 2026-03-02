import {consola} from "consola";
import type {H3Event} from "h3";
import type {Novel, Prisma, PrismaClient} from "nbook/server/generated/prisma/client";
import type {
    NovelListItemDto,
    UpdateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {z} from "zod";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;
type EntityIdLabel =
    | "novelId"
    | "storyId"
    | "phaseId"
    | "threadId"
    | "sceneId"
    | "plotId"
    | "entryId"
    | "parentId";
type NovelResponseDto = ReturnType<typeof toNovelResponse>;

/**
 * 将数据库整数 ID 转成对外字符串。
 */
export function stringifyEntityId(id: number): string {
    return String(id);
}

/**
 * 将外部传入的 ID 解析为数据库整数。
 */
export function parseEntityId(label: EntityIdLabel, value: string): number {
    const normalized = value.trim();
    if (!normalized) {
        throwBadRequest(`${label} 不能为空`);
    }

    if (!/^\d+$/.test(normalized)) {
        throwBadRequest(`${label} 必须是正整数`);
    }

    const parsedId = Number.parseInt(normalized, 10);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
        throwBadRequest(`${label} 必须是正整数`);
    }

    return parsedId;
}

/**
 * 将可空 ID 解析为数据库整数。
 * 空值表示客户端未提供该字段。
 */
export function parseNullableEntityId(label: EntityIdLabel, value: string | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    return parseEntityId(label, value);
}

/**
 * 抛出 404。
 */
const throwNotFound = (message: string): never => {
    throw createError({
        statusCode: 404,
        message,
    });
};

/**
 * 抛出 400。
 */
const throwBadRequest = (message: string): never => {
    throw createError({
        statusCode: 400,
        message,
    });
};

/**
 * 将小说实体映射为基础响应对象。
 */
export function toNovelResponse(novel: Novel) {
    return {
        id: stringifyEntityId(novel.id),
        title: novel.title,
        summary: novel.summary,
        workspaceSlug: novel.workspaceSlug,
        createdAt: novel.createdAt.toISOString(),
        updatedAt: novel.updatedAt.toISOString(),
    };
}

/**
 * 获取小说列表。
 * 章节内容已迁移到 manuscript 文件树，数据库列表只返回 Novel 基础信息。
 */
export async function listNovels(prismaClient: PrismaExecutor): Promise<NovelListItemDto[]> {
    const novels = await prismaClient.novel.findMany({
        orderBy: {updatedAt: "desc"},
    });

    return novels.map((novel) => ({
        ...toNovelResponse(novel),
        volumeCount: 0,
        chapterCount: 0,
        totalWords: 0,
    }));
}

/**
 * 校验小说存在。
 */
export async function assertNovel(prismaClient: PrismaExecutor, novelId: number): Promise<Novel> {
    const novel = await prismaClient.novel.findUnique({
        where: {id: novelId},
    });

    if (!novel) {
        throwNotFound("小说不存在");
    }

    return novel as Novel;
}

/**
 * 读取 novelId 路由参数。
 */
export function requireNovelId(event: H3Event): number {
    return parseEntityId("novelId", event.context.params?.novelId ?? "");
}

/**
 * 统一校验请求体。
 */
export async function validateBody<T>(event: H3Event, schema: z.ZodSchema<T>): Promise<T> {
    const body = await readBody(event);
    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        consola.warn({
            method: event.method,
            path: event.path,
            body,
            issues: parseResult.error.issues,
        }, "请求体验证失败");
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return parseResult.data;
}

/**
 * 通过 tool 更新小说基础信息。
 */
export async function updateNovelByTool(
    prismaClient: PrismaExecutor,
    novelId: number,
    input: UpdateNovelRequestDto,
): Promise<NovelResponseDto> {
    await assertNovel(prismaClient, novelId);
    const novel = await prismaClient.novel.update({
        where: {id: novelId},
        data: {
            title: input.title,
            summary: input.summary,
        },
    });
    return toNovelResponse(novel);
}
