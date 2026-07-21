import fs from "node:fs/promises";
import path from "node:path";
import {createClient, type Client} from "@libsql/client";
import {z} from "zod";
import {
    DispatchPreparationSnapshotSchema,
    type DispatchPreparationSnapshot,
} from "nbook/shared/text-to-image-dispatch";
import {
    IllustrationExecutionRegistrationReceiptSchema,
    type IllustrationExecutionRegistrationReceipt,
} from "nbook/shared/text-to-image-execution";
import {ILLUSTRATION_DISPATCH_REGISTRATION_VERSION} from "nbook/server/text-to-image/execution.repository";
import {
    PROJECT_DATABASE_RELATIVE_PATH,
    isProjectRootDeleted,
    toSqliteFileUrl,
} from "nbook/server/workspace-files/project-workspace";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";

export type ProjectDispatchInspection =
    | {kind: "committed"; projectPath: string; receipt: IllustrationExecutionRegistrationReceipt}
    | {kind: "stale_version"; projectPath: string}
    | {kind: "absent"; projectPath: string}
    | {kind: "unavailable"; projectPath: string; code: "TEXT_TO_IMAGE_PROJECT_UNAVAILABLE"; message: string}
    | {kind: "ambiguous"; projectPath: string; code: "TEXT_TO_IMAGE_PROJECT_RELOCATION_AMBIGUOUS"; message: string}
    | {kind: "corrupt"; projectPath: string; code: "TEXT_TO_IMAGE_PROJECT_DISPATCH_CORRUPT"; message: string};

type RepositoryOptions = {
    workspaceRoot?: string;
};

type LocatedProject = {
    projectPath: string;
    databasePath: string;
};

/** 不依赖 Project session 的短连接 outbox reader/rebinder。 */
export class ProjectDispatchRepository {
    private readonly workspaceRoot: string;

    constructor(options: RepositoryOptions = {}) {
        this.workspaceRoot = path.resolve(options.workspaceRoot ?? resolveWorkspaceContainerRoot());
    }

    /** 先尝试持久 projectPath，再仅按精确 ProjectMetadata.projectId 重定位。 */
    async inspect(snapshotInput: DispatchPreparationSnapshot): Promise<ProjectDispatchInspection> {
        const snapshot = DispatchPreparationSnapshotSchema.parse(snapshotInput);
        const located = await this.locate(snapshot);
        if (located.kind !== "located") return located.inspection;
        const client = createClient({url: toSqliteFileUrl(located.project.databasePath)});
        try {
            return await inspectClosure(client, snapshot, located.project.projectPath);
        } catch (error) {
            return unavailable(snapshot.projectPath, error instanceof Error ? error.message : "Project SQLite 不可读取");
        } finally {
            await client.close();
        }
    }

    /** 仅在 immutable closure 精确且 outbox 版本更旧时，原事务重绑当前 prepare identity/version。 */
    async rebind(snapshotInput: DispatchPreparationSnapshot, projectPathInput: string): Promise<ProjectDispatchInspection> {
        const snapshot = DispatchPreparationSnapshotSchema.parse(snapshotInput);
        const projectPath = ProjectPathSchema.parse(projectPathInput);
        const databasePath = this.databasePath(projectPath);
        const client = createClient({url: toSqliteFileUrl(databasePath)});
        try {
            await client.execute("BEGIN IMMEDIATE");
            try {
                const inspection = await inspectClosure(client, snapshot, projectPath);
                if (inspection.kind !== "stale_version") {
                    await client.execute("COMMIT");
                    return inspection;
                }
                const placeholders = snapshot.dispatchKeys.map(() => "?").join(", ");
                const updated = await client.execute({
                    sql: `UPDATE "TextToImageDispatchOutbox"
                        SET "prepareAttemptId" = ?, "prepareVersion" = ?, "updatedAt" = CURRENT_TIMESTAMP
                        WHERE "preparationId" = ? AND "prepareVersion" < ? AND "dispatchKey" IN (${placeholders})`,
                    args: [
                        snapshot.prepareAttemptId,
                        snapshot.prepareVersion,
                        snapshot.id,
                        snapshot.prepareVersion,
                        ...snapshot.dispatchKeys,
                    ],
                });
                if (Number(updated.rowsAffected) !== snapshot.dispatchKeys.length) {
                    await client.execute("ROLLBACK");
                    return corrupt(projectPath, "旧 prepareVersion outbox 未形成可原子重绑的完整闭包");
                }
                const rebound = await inspectClosure(client, snapshot, projectPath);
                if (rebound.kind !== "committed") {
                    await client.execute("ROLLBACK");
                    return corrupt(projectPath, "重绑后的 outbox 仍未形成当前 prepare closure");
                }
                await client.execute("COMMIT");
                return rebound;
            } catch (error) {
                await client.execute("ROLLBACK");
                throw error;
            }
        } catch (error) {
            return unavailable(projectPath, error instanceof Error ? error.message : "Project outbox 重绑失败");
        } finally {
            await client.close();
        }
    }

    private async locate(snapshot: DispatchPreparationSnapshot): Promise<
        {kind: "located"; project: LocatedProject}
        | {kind: "failed"; inspection: ProjectDispatchInspection}
    > {
        const storedProjectId = await this.readProjectId(snapshot.projectPath);
        if (storedProjectId === snapshot.projectId) {
            return {kind: "located", project: {projectPath: snapshot.projectPath, databasePath: this.databasePath(snapshot.projectPath)}};
        }
        const matches = await this.findProjects(snapshot.projectId);
        if (matches.length === 1) return {kind: "located", project: matches[0]!};
        if (matches.length > 1) {
            return {
                kind: "failed",
                inspection: {
                    kind: "ambiguous",
                    projectPath: snapshot.projectPath,
                    code: "TEXT_TO_IMAGE_PROJECT_RELOCATION_AMBIGUOUS",
                    message: `ProjectId ${snapshot.projectId} 同时命中 ${String(matches.length)} 个 Project Workspace`,
                },
            };
        }
        return {kind: "failed", inspection: unavailable(snapshot.projectPath, "Project Workspace 不可达、已移动或已删除")};
    }

    /** 扫描仅限 Workspace Root 下一层 Project DB，绝不按标题或目录名猜测。 */
    private async findProjects(projectId: string): Promise<LocatedProject[]> {
        let entries: Array<import("node:fs").Dirent>;
        try {
            entries = await fs.readdir(this.workspaceRoot, {withFileTypes: true});
        } catch (error) {
            if (isFileNotFound(error)) return [];
            throw error;
        }
        const matches: LocatedProject[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name === ".nbook") continue;
            const projectRoot = path.join(this.workspaceRoot, entry.name);
            if (await isProjectRootDeleted(projectRoot)) continue;
            const projectPath = ProjectPathSchema.parse(path.posix.join("workspace", entry.name));
            if (await this.readProjectId(projectPath) === projectId) {
                matches.push({projectPath, databasePath: this.databasePath(projectPath)});
            }
        }
        return matches.sort((left, right) => left.projectPath.localeCompare(right.projectPath));
    }

    private async readProjectId(projectPathInput: string): Promise<string | null> {
        const projectPath = ProjectPathSchema.parse(projectPathInput);
        const databasePath = this.databasePath(projectPath);
        try {
            const stat = await fs.stat(databasePath);
            if (!stat.isFile()) return null;
        } catch (error) {
            if (isFileNotFound(error)) return null;
            throw error;
        }
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

    private databasePath(projectPathInput: string): string {
        const projectPath = ProjectPathSchema.parse(projectPathInput);
        const slug = projectPath.slice("workspace/".length);
        return path.join(this.workspaceRoot, slug, PROJECT_DATABASE_RELATIVE_PATH);
    }
}

const ProjectPathSchema = z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u);

/** 在同一个短连接/事务中严格读取 Manifest/approval/Job/outbox 闭包。 */
async function inspectClosure(
    client: Client,
    snapshot: DispatchPreparationSnapshot,
    projectPath: string,
): Promise<ProjectDispatchInspection> {
    const manifestResult = await client.execute({
        sql: `SELECT "id", "projectId", "executionManifestHash", "outputCount", "registrationState", "createdAt"
            FROM "IllustrationExecutionManifest" WHERE "executionManifestHash" = ? LIMIT 1`,
        args: [snapshot.manifestHash],
    });
    const manifest = manifestResult.rows[0];
    if (!manifest) {
        const placeholders = snapshot.jobIds.map(() => "?").join(", ");
        const evidence = await client.execute({
            sql: `SELECT COUNT(*) AS "count" FROM "TextToImageJob" WHERE "id" IN (${placeholders})`,
            args: snapshot.jobIds,
        });
        return Number(evidence.rows[0]?.count) === 0
            ? {kind: "absent", projectPath}
            : corrupt(projectPath, "Project 中存在部分 Job，但缺少对应 immutable Manifest");
    }
    const manifestId = String(manifest.id);
    if (String(manifest.projectId) !== snapshot.projectId
        || String(manifest.executionManifestHash) !== snapshot.manifestHash
        || String(manifest.registrationState) !== "jobs_registered"
        || Number(manifest.outputCount) !== snapshot.jobIds.length) {
        return corrupt(projectPath, "Execution Manifest 与 App preparation identity 不一致");
    }
    const [approvalResult, jobsResult, outboxesResult] = await Promise.all([
        client.execute({
            sql: `SELECT "id", "approvalHash" FROM "IllustrationExecutionApproval" WHERE "manifestId" = ? LIMIT 1`,
            args: [manifestId],
        }),
        client.execute({
            sql: `SELECT "id", "outputIndex" FROM "TextToImageJob" WHERE "executionManifestId" = ? ORDER BY "outputIndex" ASC, "id" ASC`,
            args: [manifestId],
        }),
        client.execute({
            sql: `SELECT "dispatchKey", "jobId", "manifestHash", "registrationVersion", "preparationId", "prepareAttemptId", "prepareVersion"
                FROM "TextToImageDispatchOutbox" WHERE "manifestId" = ?`,
            args: [manifestId],
        }),
    ]);
    const approval = approvalResult.rows[0];
    if (!approval || jobsResult.rows.length !== snapshot.jobIds.length || outboxesResult.rows.length !== snapshot.jobIds.length) {
        return corrupt(projectPath, "Project dispatch closure 缺少 approval、Job 或 outbox");
    }
    const jobIds = jobsResult.rows.map((row) => String(row.id));
    if (!sameList(jobIds, snapshot.jobIds)) return corrupt(projectPath, "Project Job 闭包与 preparation 顺序不一致");
    const outboxByJob = new Map(outboxesResult.rows.map((row) => [String(row.jobId), row]));
    const outboxes = snapshot.jobIds.map((jobId) => outboxByJob.get(jobId));
    if (outboxes.some((outbox) => !outbox)) return corrupt(projectPath, "Project outbox 未覆盖全部 Job");
    const exactOutboxes = outboxes.filter((outbox): outbox is NonNullable<typeof outbox> => Boolean(outbox));
    if (!sameList(exactOutboxes.map((outbox) => String(outbox.dispatchKey)), snapshot.dispatchKeys)
        || exactOutboxes.some((outbox) => String(outbox.manifestHash) !== snapshot.manifestHash
            || String(outbox.registrationVersion) !== ILLUSTRATION_DISPATCH_REGISTRATION_VERSION
            || String(outbox.preparationId) !== snapshot.id)) {
        return corrupt(projectPath, "Project outbox identity 与 preparation 不一致");
    }
    const exactVersion = exactOutboxes.every((outbox) => String(outbox.prepareAttemptId) === snapshot.prepareAttemptId
        && Number(outbox.prepareVersion) === snapshot.prepareVersion);
    if (!exactVersion) {
        const safelyOld = exactOutboxes.every((outbox) => Number(outbox.prepareVersion) < snapshot.prepareVersion);
        return safelyOld
            ? {kind: "stale_version", projectPath}
            : corrupt(projectPath, "Project outbox 携带冲突或未来 prepareVersion");
    }
    if (manifest.createdAt === undefined) return corrupt(projectPath, "Execution Manifest 缺少 createdAt");
    const registeredAt = toIsoTimestamp(manifest.createdAt);
    return {
        kind: "committed",
        projectPath,
        receipt: IllustrationExecutionRegistrationReceiptSchema.parse({
            schemaVersion: "nbook.illustration-execution-registration-receipt/v1",
            manifestId,
            executionManifestHash: snapshot.manifestHash,
            approvalId: String(approval.id),
            approvalHash: String(approval.approvalHash),
            registrationState: "jobs_registered",
            dispatchState: "dispatch_pending",
            jobIds,
            dispatchKeys: exactOutboxes.map((outbox) => String(outbox.dispatchKey)),
            registeredAt,
        }),
    };
}

function toIsoTimestamp(value: string | number | bigint | null | ArrayBuffer | Uint8Array): string {
    const date = typeof value === "number" || typeof value === "bigint"
        ? new Date(Number(value))
        : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new Error("Project createdAt 不是有效时间");
    return date.toISOString();
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unavailable(projectPath: string, message: string): ProjectDispatchInspection {
    return {kind: "unavailable", projectPath, code: "TEXT_TO_IMAGE_PROJECT_UNAVAILABLE", message};
}

function corrupt(projectPath: string, message: string): ProjectDispatchInspection {
    return {kind: "corrupt", projectPath, code: "TEXT_TO_IMAGE_PROJECT_DISPATCH_CORRUPT", message};
}

function isFileNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
