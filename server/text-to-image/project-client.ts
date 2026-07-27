import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {TEXT_TO_IMAGE_PROJECT_CLIENT_MODULE_TOKEN} from "nbook/server/text-to-image/project-client-module";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";
import {activateReadyProjectModule, requireReadyProjectPath} from "nbook/server/workspace-files/project-session";
import {resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

/**
 * 后台 worker 的短连接 Project 客户端；不要求 Project session 已打开，也绝不进入进程缓存。
 */
export async function withEphemeralTextToImageProjectClient<T>(
    projectPath: string,
    operation: (client: PrismaClient) => Promise<T>,
): Promise<T> {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const databasePath = resolveProjectDatabasePath(resolveRuntimeWorkspaceRoot(), normalizedProjectPath);
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

/**
 * 获取当前已打开 Project 的文生图 Prisma client。
 *
 * client 由当前 ProjectSession generation 的 lazy Module handle 持有：同一 generation 内复用，
 * Project close/重开时由 Session 统一关闭，调用方不需要（也不应该）自行管理连接生命周期。
 */
export async function textToImageProjectClient(projectPath: string): Promise<PrismaClient> {
    const ready = requireReadyProjectPath(normalizeProjectPath(projectPath));
    const handle = await activateReadyProjectModule(ready, TEXT_TO_IMAGE_PROJECT_CLIENT_MODULE_TOKEN);
    return handle.client();
}
