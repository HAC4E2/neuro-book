import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {createClient, type Client} from "@libsql/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {ProjectTextToImageProviderJobReconciler} from "nbook/server/text-to-image/provider-reconciliation.service";
import type {TextToImageProviderRevisionInvalidationRecord} from "nbook/server/text-to-image/provider.service";
import type {TextToImageProviderSnapshotDto} from "nbook/shared/dto/text-to-image.dto";
import {
    resolveProjectDatabasePath,
    toSqliteFileUrl,
    writeProjectManifest,
} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {
    createIsolatedWorkspaceAssets,
    type IsolatedWorkspaceAssets,
} from "nbook/server/workspace-files/workspace-assets-test-helper";

describe("ProjectTextToImageProviderJobReconciler", () => {
    let assets: IsolatedWorkspaceAssets | undefined;
    const clients: Client[] = [];

    beforeEach(async () => {
        assets = await createIsolatedWorkspaceAssets();
    }, 30_000);

    afterEach(async () => {
        await Promise.all(clients.splice(0).map(async (client) => client.close()));
        await assets?.dispose();
        assets = undefined;
    }, 30_000);

    it("只失效未保留 Provider 的 queued/running Job，并保留完成记录", async () => {
        const firstProject = await createProject("first");
        const secondProject = await createProject("second");
        const missingManifestProject = await createDatabaseOnlyProject();
        await seedJob(firstProject, "discarded-queued", 2, "queued");
        await seedJob(firstProject, "discarded-running", 2, "running");
        await seedJob(firstProject, "discarded-succeeded", 2, "succeeded");
        await seedJob(firstProject, "kept-queued", 1, "queued");
        await seedJob(secondProject, "second-discarded", 2, "queued");
        await seedJob(missingManifestProject, "missing-manifest-discarded", 2, "queued");

        const impacts = await new ProjectTextToImageProviderJobReconciler().invalidate([providerSnapshot(2)]);

        expect(impacts).toEqual([
            {projectPath: firstProject, configurationStale: 1, outcomeUnknown: 1},
            {projectPath: missingManifestProject, configurationStale: 1, outcomeUnknown: 0},
            {projectPath: secondProject, configurationStale: 1, outcomeUnknown: 0},
        ]);
        await expect(readJob(firstProject, "discarded-queued")).resolves.toMatchObject({
            status: "configuration_stale",
            errorMessage: "NovelAI Provider 已由用户显式移除；请基于当前配置重新预览并授权。",
        });
        await expect(readJob(firstProject, "discarded-running")).resolves.toMatchObject({
            status: "outcome_unknown",
            errorMessage: "NovelAI Provider 已由用户显式移除，原远端请求结果无法确认；系统不会自动重试。",
        });
        await expect(readJob(firstProject, "discarded-succeeded")).resolves.toMatchObject({
            status: "succeeded",
            providerSnapshotJson: JSON.stringify(providerSnapshot(2)),
        });
        await expect(readJob(firstProject, "kept-queued")).resolves.toMatchObject({status: "queued"});
        await expect(readJob(missingManifestProject, "missing-manifest-discarded")).resolves.toMatchObject({status: "configuration_stale"});
    }, 30_000);

    it("后续 Project 失败时保留此前 Project 的幂等提交，供持久化 saga 恢复", async () => {
        const committedProject = await createProject("a-committed");
        const brokenProject = await createProject("z-broken");
        await seedJob(committedProject, "already-committed", 2, "queued");
        const brokenClient = await database(brokenProject);
        await brokenClient.execute(`DROP TABLE "TextToImageJob"`);
        await brokenClient.execute(`CREATE TABLE "TextToImageJob" ("id" TEXT PRIMARY KEY, "providerId" INTEGER NOT NULL, "status" TEXT NOT NULL)`);
        await brokenClient.execute(`INSERT INTO "TextToImageJob" ("id", "providerId", "status") VALUES ('broken', 2, 'queued')`);
        await brokenClient.close();
        clients.splice(clients.indexOf(brokenClient), 1);

        await expect(new ProjectTextToImageProviderJobReconciler().invalidate([providerSnapshot(2)]))
            .rejects.toThrow();

        await expect(readJob(committedProject, "already-committed")).resolves.toMatchObject({
            status: "configuration_stale",
            providerSnapshotJson: JSON.stringify(providerSnapshot(2)),
        });
    }, 30_000);

    it("token replacement 只失效同 owner/provider 的 queued 旧 revision，保留 running fence", async () => {
        const project = await createProject("revision");
        await seedJob(project, "old-queued", 2, "queued", {ownerUserId: 7, revision: 3});
        await seedJob(project, "old-running", 2, "running", {ownerUserId: 7, revision: 3});
        await seedJob(project, "new-queued", 2, "queued", {ownerUserId: 7, revision: 4});
        await seedJob(project, "other-owner", 2, "queued", {ownerUserId: 8, revision: 3});
        const projectId = await readProjectId(project);

        await expect(new ProjectTextToImageProviderJobReconciler().invalidateRevision(revisionTarget({
            projectId,
            projectPath: "workspace/old-location",
        }))).resolves.toEqual([
            {projectPath: project, configurationStale: 1, outcomeUnknown: 0},
        ]);

        await expect(readJob(project, "old-queued")).resolves.toMatchObject({
            status: "configuration_stale",
            stableErrorCode: "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE",
        });
        await expect(readJob(project, "old-running")).resolves.toMatchObject({status: "running"});
        await expect(readJob(project, "new-queued")).resolves.toMatchObject({status: "queued"});
        await expect(readJob(project, "other-owner")).resolves.toMatchObject({status: "queued"});
    }, 30_000);

    it("精确目标 Project 暂不可达时拒绝完成 revision saga", async () => {
        await expect(new ProjectTextToImageProviderJobReconciler().invalidateRevision(revisionTarget({
            projectId: `missing-${randomUUID()}`,
            projectPath: `workspace/missing-${randomUUID()}`,
        }))).rejects.toThrow("当前不可达");
    }, 30_000);

    async function createProject(label: string): Promise<string> {
        const projectPath = `workspace/provider-reconcile-${label}-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "novel", title: label, summary: ""});
        await createJobTable(projectPath);
        return projectPath;
    }

    async function createDatabaseOnlyProject(): Promise<string> {
        const slug = `provider-reconcile-missing-manifest-${randomUUID()}`;
        const projectRoot = path.join(resolveRuntimeWorkspaceRoot(), slug);
        await fs.mkdir(projectRoot, {recursive: true});
        const projectPath = `workspace/${slug}`;
        await createJobTable(projectPath);
        return projectPath;
    }

    async function createJobTable(projectPath: string): Promise<void> {
        const databasePath = resolveProjectDatabasePath(resolveRuntimeWorkspaceRoot(), projectPath);
        await fs.mkdir(path.dirname(databasePath), {recursive: true});
        const client = await database(projectPath);
        await client.execute(`CREATE TABLE "ProjectMetadata" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)`);
        await client.execute({
            sql: `INSERT INTO "ProjectMetadata" ("key", "value") VALUES ('projectId', ?)`,
            args: [`project-id:${projectPath}`],
        });
        await client.execute(`CREATE TABLE "TextToImageJob" ("id" TEXT PRIMARY KEY, "providerId" INTEGER NOT NULL, "providerOwnerUserId" INTEGER, "providerCredentialRevision" INTEGER, "providerSnapshotJson" TEXT NOT NULL DEFAULT '{}', "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "sourceInsertStatus" TEXT NOT NULL, "requestJson" TEXT NOT NULL, "resultAssetIdsJson" TEXT NOT NULL, "errorMessage" TEXT, "stableErrorCode" TEXT, "attemptCount" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" DATETIME, "finishedAt" DATETIME)`);
        await client.close();
        clients.splice(clients.indexOf(client), 1);
    }

    async function database(projectPath: string): Promise<Client> {
        const client = createClient({url: toSqliteFileUrl(resolveProjectDatabasePath(resolveRuntimeWorkspaceRoot(), projectPath))});
        clients.push(client);
        return client;
    }

    async function seedJob(
        projectPath: string,
        id: string,
        providerId: number,
        status: string,
        binding?: {ownerUserId: number; revision: number},
    ): Promise<void> {
        const client = await database(projectPath);
        await client.execute({
            sql: `INSERT INTO "TextToImageJob" ("id", "providerId", "providerOwnerUserId", "providerCredentialRevision", "kind", "status", "sourceInsertStatus", "requestJson", "resultAssetIdsJson", "attemptCount", "createdAt") VALUES (?, ?, ?, ?, 'manual', ?, 'not_applicable', '{}', '[]', 0, CURRENT_TIMESTAMP)`,
            args: [id, providerId, binding?.ownerUserId ?? null, binding?.revision ?? null, status],
        });
        await client.close();
        clients.splice(clients.indexOf(client), 1);
    }

    async function readJob(projectPath: string, id: string): Promise<{status: string; errorMessage: string | null; providerSnapshotJson: string | null; stableErrorCode: string | null}> {
        const client = await database(projectPath);
        const result = await client.execute({
            sql: `SELECT "status", "errorMessage", "providerSnapshotJson", "stableErrorCode" FROM "TextToImageJob" WHERE "id" = ?`,
            args: [id],
        });
        const row = result.rows[0];
        return {
            status: String(row?.status ?? ""),
            errorMessage: typeof row?.errorMessage === "string" ? row.errorMessage : null,
            providerSnapshotJson: typeof row?.providerSnapshotJson === "string" ? row.providerSnapshotJson : null,
            stableErrorCode: typeof row?.stableErrorCode === "string" ? row.stableErrorCode : null,
        };
    }

    async function readProjectId(projectPath: string): Promise<string> {
        const client = await database(projectPath);
        const result = await client.execute(`SELECT "value" FROM "ProjectMetadata" WHERE "key" = 'projectId' LIMIT 1`);
        await client.close();
        clients.splice(clients.indexOf(client), 1);
        const value = result.rows[0]?.value;
        if (typeof value !== "string" || !value) throw new Error("测试 Project 缺少 projectId");
        return value;
    }
});

/** 构造单一精确 Project 目标的 revision saga 快照。 */
function revisionTarget(input: {projectId: string; projectPath: string}): TextToImageProviderRevisionInvalidationRecord {
    const now = new Date("2026-07-21T00:00:00.000Z");
    return {
        id: "revision-target",
        ownerUserId: 7,
        providerId: 2,
        oldRevision: 3,
        newRevision: 4,
        projectId: input.projectId,
        projectPath: input.projectPath,
        state: "pending",
        attemptCount: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
    };
}

function providerSnapshot(providerId: number): TextToImageProviderSnapshotDto {
    return {
        ownerUserId: 1,
        providerId,
        credentialRevision: 1,
        kind: "novelai",
        name: `NovelAI ${providerId}`,
        baseUrl: "https://image.novelai.net",
        settings: {allowPrivateNetwork: false, requestIntervalMs: 15_000},
        updatedAt: "2026-07-19T00:00:00.000Z",
    };
}
