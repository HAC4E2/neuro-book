import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {
    projectWorkspaceRef,
    resolveProjectWorkspaceRoot,
} from "nbook/server/workspace-files/project-identity";
import {
    resolveProjectDatabasePath,
    toSqliteFileUrl,
} from "nbook/server/workspace-files/project-workspace";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

/** 把 `workspace/<project>` 或单段 projectRoot 归一化为 ProjectWorkspaceRef。 */
export function textToImageProjectRef(projectPath: string): ReturnType<typeof projectWorkspaceRef> {
    const normalized = projectPath.startsWith("workspace/")
        ? projectPath.slice("workspace/".length)
        : projectPath;
    return projectWorkspaceRef(normalized);
}

/** 返回 Project Workspace 绝对根目录。 */
export function resolveTextToImageProjectRoot(projectPath: string): string {
    return resolveProjectWorkspaceRoot(resolveRuntimeWorkspaceRoot(), textToImageProjectRef(projectPath));
}

/**
 * 后台 worker 的短连接 Project 客户端；不要求 Project session 已打开。
 */
export async function withEphemeralTextToImageProjectClient<T>(
    projectPath: string,
    operation: (client: PrismaClient) => Promise<T>,
): Promise<T> {
    const databasePath = resolveProjectDatabasePath(resolveRuntimeWorkspaceRoot(), textToImageProjectRef(projectPath));
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
