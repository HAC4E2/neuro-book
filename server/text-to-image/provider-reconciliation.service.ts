import fs from "node:fs/promises";
import path from "node:path";
import {createClient} from "@libsql/client";
import type {TextToImageNovelAiReconciliationImpactDto, TextToImageProviderSnapshotDto} from "nbook/shared/dto/text-to-image.dto";
import {
    PROJECT_DATABASE_RELATIVE_PATH,
    ensureTextToImageJobProviderSnapshotColumn,
    isProjectRootDeleted,
    toSqliteFileUrl,
} from "nbook/server/workspace-files/project-workspace";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";
import type {TextToImageProviderRevisionInvalidationRecord} from "nbook/server/text-to-image/provider.service";

const CONFIGURATION_STALE_MESSAGE = "NovelAI Provider 已由用户显式移除；请基于当前配置重新预览并授权。";
const OUTCOME_UNKNOWN_MESSAGE = "NovelAI Provider 已由用户显式移除，原远端请求结果无法确认；系统不会自动重试。";

/**
 * 一次性处理所有可发现 Project Workspace 中指向已丢弃 NovelAI Provider 的未完成 Job。
 * 每个 Project 使用独立 SQLite 事务；全部 Project 成功后，上层才允许删除 App DB Provider。
 */
export class ProjectTextToImageProviderJobReconciler {
    /**
     * 把 Project 中尚未开始的旧 revision 标记为配置过期。
     * running/completing 已越过付费边界，必须保留原 attempt fence，不能终止或自动重发。
     */
    async invalidateRevision(target: TextToImageProviderRevisionInvalidationRecord): Promise<TextToImageNovelAiReconciliationImpactDto[]> {
        const project = await locateRevisionTarget(target);
        const client = createClient({url: toSqliteFileUrl(project.databasePath)});
        try {
            const table = await client.execute(`SELECT 1 FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'TextToImageJob' LIMIT 1`);
            if (table.rows.length === 0) return [];
            await ensureProviderRevisionColumns(client);
            await client.execute("BEGIN IMMEDIATE");
            try {
                const stale = await client.execute({
                    sql: `UPDATE "TextToImageJob"
                          SET "status" = 'configuration_stale',
                              "finishedAt" = COALESCE("finishedAt", CURRENT_TIMESTAMP),
                              "stableErrorCode" = ?,
                              "errorMessage" = ?
                          WHERE "providerOwnerUserId" = ?
                            AND "providerId" = ?
                            AND "providerCredentialRevision" = ?
                            AND "status" = 'queued'`,
                    args: [
                        "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE",
                        "NovelAI API token 已更新；旧配置生成任务必须重新预览并授权。",
                        target.ownerUserId,
                        target.providerId,
                        target.oldRevision,
                    ],
                });
                await client.execute("COMMIT");
                return Number(stale.rowsAffected) > 0
                    ? [{projectPath: project.projectPath, configurationStale: Number(stale.rowsAffected), outcomeUnknown: 0}]
                    : [];
            } catch (error) {
                await client.execute("ROLLBACK");
                throw error;
            }
        } finally {
            await client.close();
        }
    }

    /** 幂等失效 queued/running Job；已完成 Job 与 Asset 保持不可变。 */
    async invalidate(providers: TextToImageProviderSnapshotDto[]): Promise<TextToImageNovelAiReconciliationImpactDto[]> {
        const discardedProviders = [...new Map(providers.map((provider) => [provider.providerId, provider])).values()]
            .sort((left, right) => left.providerId - right.providerId);
        if (discardedProviders.length === 0) {
            return [];
        }
        const projects = await discoverProjectDatabases();
        const impacts: TextToImageNovelAiReconciliationImpactDto[] = [];
        for (const project of projects) {
            const impact = await this.invalidateProject(project, discardedProviders);
            if (impact && (impact.configurationStale > 0 || impact.outcomeUnknown > 0)) {
                impacts.push(impact);
            }
        }
        const {abortTextToImageProviderAttempts} = await import("nbook/server/text-to-image/queue.service");
        abortTextToImageProviderAttempts(discardedProviders.map((provider) => provider.providerId));
        return impacts;
    }

    /** 单个 Project 内先更新两类终态；任一语句失败时整体回滚。 */
    private async invalidateProject(project: ProjectDatabase, providers: TextToImageProviderSnapshotDto[]): Promise<TextToImageNovelAiReconciliationImpactDto | null> {
        const client = createClient({url: toSqliteFileUrl(project.databasePath)});
        try {
            const table = await client.execute(`SELECT 1 FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'TextToImageJob' LIMIT 1`);
            if (table.rows.length === 0) {
                return null;
            }
            const providerIds = providers.map((provider) => provider.providerId);
            const placeholders = providerIds.map(() => "?").join(", ");
            await client.execute("BEGIN IMMEDIATE");
            try {
                await ensureTextToImageJobProviderSnapshotColumn(client);
                for (const provider of providers) {
                    await client.execute({
                        sql: `UPDATE "TextToImageJob" SET "providerSnapshotJson" = ? WHERE "providerId" = ? AND "providerSnapshotJson" = '{}'`,
                        args: [JSON.stringify(provider), provider.providerId],
                    });
                }
                const stale = await client.execute({
                    sql: `UPDATE "TextToImageJob" SET "status" = 'configuration_stale', "finishedAt" = COALESCE("finishedAt", CURRENT_TIMESTAMP), "errorMessage" = ? WHERE "providerId" IN (${placeholders}) AND "status" = 'queued'`,
                    args: [CONFIGURATION_STALE_MESSAGE, ...providerIds],
                });
                const unknown = await client.execute({
                    sql: `UPDATE "TextToImageJob" SET "status" = 'outcome_unknown', "finishedAt" = COALESCE("finishedAt", CURRENT_TIMESTAMP), "errorMessage" = ? WHERE "providerId" IN (${placeholders}) AND "status" = 'running'`,
                    args: [OUTCOME_UNKNOWN_MESSAGE, ...providerIds],
                });
                await client.execute("COMMIT");
                return {
                    projectPath: project.projectPath,
                    configurationStale: Number(stale.rowsAffected),
                    outcomeUnknown: Number(unknown.rowsAffected),
                };
            } catch (error) {
                await client.execute("ROLLBACK");
                throw error;
            }
        } finally {
            await client.close();
        }
    }
}

/** 旧 Project 只补齐 revision 失效所需列，不依赖 outbox 是否已初始化。 */
async function ensureProviderRevisionColumns(client: ReturnType<typeof createClient>): Promise<void> {
    const result = await client.execute(`PRAGMA table_info("TextToImageJob")`);
    const columns = new Set(result.rows.map((row) => String(row.name ?? "")));
    const additions = [
        ["providerOwnerUserId", "INTEGER"],
        ["providerCredentialRevision", "INTEGER"],
        ["stableErrorCode", "TEXT"],
    ] as const;
    for (const [column, type] of additions) {
        if (!columns.has(column)) {
            await client.execute(`ALTER TABLE "TextToImageJob" ADD COLUMN "${column}" ${type}`);
        }
    }
}

type ProjectDatabase = {
    projectPath: string;
    databasePath: string;
};

/** 只接受唯一精确 ProjectMetadata.projectId；原路径不可达时允许确定性重定位。 */
async function locateRevisionTarget(target: TextToImageProviderRevisionInvalidationRecord): Promise<ProjectDatabase> {
    const projects = await discoverProjectDatabases();
    const stored = projects.find((project) => project.projectPath === target.projectPath);
    if (stored && await readProjectId(stored.databasePath) === target.projectId) return stored;
    const matches: ProjectDatabase[] = [];
    for (const project of projects) {
        if (await readProjectId(project.databasePath) === target.projectId) matches.push(project);
    }
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
        throw new Error(`ProjectId ${target.projectId} 同时命中 ${String(matches.length)} 个 Project Workspace`);
    }
    throw new Error(`ProjectId ${target.projectId} 对应的 Project Workspace 当前不可达`);
}

/** 读取 Project 身份失败视为不可达，不能用目录名或标题替代。 */
async function readProjectId(databasePath: string): Promise<string | null> {
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        const result = await client.execute(`SELECT "value" FROM "ProjectMetadata" WHERE "key" = 'projectId' LIMIT 1`);
        const value = result.rows[0]?.value;
        return typeof value === "string" && value.trim() ? value : null;
    } catch {
        return null;
    } finally {
        await client.close();
    }
}

/**
 * 直接发现 Workspace 容器下一层的 Project SQLite。
 * reconciliation 不能依赖有效 manifest，否则损坏但可修复的 Project 会遗留可重新调度的旧 Job。
 */
async function discoverProjectDatabases(): Promise<ProjectDatabase[]> {
    const workspaceRoot = resolveWorkspaceContainerRoot();
    let entries: Array<import("node:fs").Dirent>;
    try {
        entries = await fs.readdir(workspaceRoot, {withFileTypes: true});
    } catch (error) {
        if (isFileNotFound(error)) {
            return [];
        }
        throw error;
    }
    const projects: ProjectDatabase[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === ".nbook") {
            continue;
        }
        const projectRoot = path.join(workspaceRoot, entry.name);
        if (await isProjectRootDeleted(projectRoot)) {
            continue;
        }
        const databasePath = path.join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH);
        try {
            const stat = await fs.stat(databasePath);
            if (stat.isFile()) {
                projects.push({
                    projectPath: path.posix.join("workspace", entry.name),
                    databasePath,
                });
            }
        } catch (error) {
            if (!isFileNotFound(error)) {
                throw error;
            }
        }
    }
    return projects.sort((left, right) => left.projectPath.localeCompare(right.projectPath));
}

/** 判断文件系统错误是否为不存在。 */
function isFileNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
