import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {normalizeProjectPath, resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {assertProjectOpen, markProjectActivity, registerProjectResourceOwner, type ProjectResourceOwner} from "nbook/server/workspace-files/project-session";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

type ProjectClientEntry = {
    client: PrismaClient;
    adapter: TrackedPrismaLibSql;
};

/**
 * 后台 worker 的短连接 Project 客户端；不要求 Project session 已打开，也绝不进入进程缓存。
 */
export async function withEphemeralTextToImageProjectClient<T>(
    projectPath: string,
    operation: (client: PrismaClient) => Promise<T>,
): Promise<T> {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
    const adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
    const client = new PrismaClient({adapter});
    try {
        return await operation(client);
    } finally {
        await client.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles();
    }
}

const clients = new Map<string, ProjectClientEntry>();

/** 获取当前已打开 Project 的文生图 Prisma client。 */
export async function textToImageProjectClient(projectPath: string): Promise<PrismaClient> {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    assertProjectOpen(normalizedProjectPath);
    markProjectActivity(normalizedProjectPath);
    const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
    const cacheKey = databasePath.replaceAll("\\", "/");
    const existing = clients.get(cacheKey);
    if (existing) {
        return existing.client;
    }
    const adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
    const client = new PrismaClient({adapter});
    clients.set(cacheKey, {client, adapter});
    return client;
}

/** 关闭指定 Project 的文生图 Prisma client；未创建时为幂等 no-op。 */
export async function closeTextToImageProjectClient(projectPath: string): Promise<void> {
    const databasePath = resolveProjectDatabasePath(projectPath);
    const cacheKey = databasePath.replaceAll("\\", "/");
    const entry = clients.get(cacheKey);
    if (!entry) {
        return;
    }
    clients.delete(cacheKey);
    try {
        await entry.client.$disconnect();
    } finally {
        entry.adapter.closeTrackedClients();
        collectReleasedSqliteHandles();
    }
}

export const textToImageProjectClientResourceOwner: ProjectResourceOwner = {
    name: "text-to-image-project-client",
    close: closeTextToImageProjectClient,
    async closeAll() {
        for (const cacheKey of [...clients.keys()]) {
            const entry = clients.get(cacheKey);
            if (!entry) {
                continue;
            }
            clients.delete(cacheKey);
            try {
                await entry.client.$disconnect();
            } finally {
                entry.adapter.closeTrackedClients();
            }
        }
        collectReleasedSqliteHandles();
    },
};

registerProjectResourceOwner(textToImageProjectClientResourceOwner);
