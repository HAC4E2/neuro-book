import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createClient} from "@libsql/client";
import {describe, expect, it} from "vitest";
import {
    assertProjectWorkspaceDirectory,
    ensureIllustrationExecutionRegistrationSchema,
    ensureTextToImageP5ExecutionSchema,
    ensureTextToImageP5ReferenceSchema,
    initProjectDatabaseAtRoot,
    toSqliteFileUrl,
} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

describe("assertProjectWorkspaceDirectory", () => {
    it("Project root 指向不存在目录时返回稳定 404", async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-project-workspace-root-"));
        const projectRoot = `missing-${randomUUID()}`;
        try {
            await expect(assertProjectWorkspaceDirectory(
                absoluteFsPath(workspaceRoot),
                projectWorkspaceRef(projectRoot),
            )).rejects.toMatchObject({
                statusCode: 404,
                message: "Project Workspace 不存在",
            });
        } finally {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
        }
    });
});

describe("initProjectDatabaseAtRoot", () => {
    it("为旧 Job 表幂等补齐 immutable registration columns 与 idempotency unique", async () => {
        const client = createClient({url: ":memory:"});
        try {
            await client.execute(`CREATE TABLE "TextToImageJob" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "providerId" INTEGER NOT NULL,
                "status" TEXT NOT NULL
            )`);
            await client.execute(`CREATE TABLE "TextToImageDispatchOutbox" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "dispatchKey" TEXT NOT NULL,
                "jobId" TEXT NOT NULL,
                "manifestId" TEXT NOT NULL,
                "manifestHash" TEXT NOT NULL,
                "registrationVersion" TEXT NOT NULL,
                "state" TEXT NOT NULL DEFAULT 'pending'
            )`);
            await ensureIllustrationExecutionRegistrationSchema(client);
            await ensureIllustrationExecutionRegistrationSchema(client);
            const columns = await client.execute(`PRAGMA table_info("TextToImageJob")`);
            expect(columns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                "originJson",
                "sourceIdentityHash",
                "providerOwnerUserId",
                "providerCredentialRevision",
                "executionManifestId",
                "executionApprovalId",
                "compiledRequestHash",
                "idempotencyKey",
                "variantIndex",
                "activeAttemptId",
                "activeAttemptFence",
                "outputIndex",
            ]));
            const outboxColumns = await client.execute(`PRAGMA table_info("TextToImageDispatchOutbox")`);
            expect(outboxColumns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                "preparationId",
                "prepareAttemptId",
                "prepareVersion",
            ]));
            await client.execute(`INSERT INTO "TextToImageJob" ("id", "providerId", "status", "idempotencyKey") VALUES ('job-1', 1, 'queued', 'same-key')`);
            await expect(client.execute(`INSERT INTO "TextToImageJob" ("id", "providerId", "status", "idempotencyKey") VALUES ('job-2', 1, 'queued', 'same-key')`)).rejects.toThrow();
        } finally {
            client.close();
        }
    });

    it("创建和升级 Project SQLite 时都会提供文生图任务与资产表", async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-text-to-image-project-"));
        try {
            await initProjectDatabaseAtRoot(projectRoot);
            const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
            const client = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const tables = await client.execute(`
                    SELECT "name" FROM sqlite_schema
                    WHERE type = 'table' AND "name" IN (
                        'TextToImageJob', 'TextToImageAsset',
                        'IllustrationPlanningWorkflow', 'IllustrationPlanningAttempt',
                        'IllustrationExecutionManifest', 'IllustrationExecutionApproval', 'TextToImageDispatchOutbox'
                    )
                    ORDER BY "name"
                `);
                expect(tables.rows.map((row) => String(row.name))).toEqual([
                    "IllustrationExecutionApproval",
                    "IllustrationExecutionManifest",
                    "IllustrationPlanningAttempt",
                    "IllustrationPlanningWorkflow",
                    "TextToImageAsset",
                    "TextToImageDispatchOutbox",
                    "TextToImageJob",
                ]);

                const projectId = (await client.execute(`SELECT "value" FROM "ProjectMetadata" WHERE "key" = 'projectId'`)).rows[0]?.value;
                expect(String(projectId)).toMatch(/^project-[a-f0-9]{32}$/u);

                const columns = await client.execute(`PRAGMA table_info("TextToImageJob")`);
                expect(columns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                    "id",
                    "providerId",
                    "kind",
                    "status",
                    "sourcePath",
                    "sourceAnchorId",
                    "sourceInsertStatus",
                    "providerSnapshotJson",
                    "requestJson",
                    "originJson",
                    "sourceIdentityHash",
                    "providerOwnerUserId",
                    "providerCredentialRevision",
                    "executionManifestId",
                    "executionApprovalId",
                    "compiledRequestHash",
                    "idempotencyKey",
                    "variantIndex",
                    "activeAttemptId",
                    "activeAttemptFence",
                    "outputIndex",
                    "resultAssetIdsJson",
                    "attemptCount",
                ]));
                const outboxColumns = await client.execute(`PRAGMA table_info("TextToImageDispatchOutbox")`);
                expect(outboxColumns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                    "preparationId",
                    "prepareAttemptId",
                    "prepareVersion",
                ]));
            } finally {
                client.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("新 Project 初始化时一次创建四张 typed P5 reference 表", async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-p5-reference-new-"));
        try {
            await initProjectDatabaseAtRoot(projectRoot);
            const client = createClient({url: toSqliteFileUrl(path.join(projectRoot, ".nbook", "project.sqlite"))});
            try {
                const tables = await client.execute(`SELECT "name" FROM sqlite_schema
                    WHERE type = 'table' AND "name" IN (
                        'TextToImageReferenceAsset',
                        'TextToImageVibeEncodingBlob',
                        'TextToImageVibeEncoding',
                        'TextToImageReferencePromotion'
                    )
                    ORDER BY "name"`);
                expect(tables.rows.map((row) => String(row.name))).toEqual([
                    "TextToImageReferenceAsset",
                    "TextToImageReferencePromotion",
                    "TextToImageVibeEncoding",
                    "TextToImageVibeEncodingBlob",
                ]);
                const sourceColumns = await client.execute(`PRAGMA table_info("TextToImageReferenceAsset")`);
                expect(sourceColumns.rows.map((row) => String(row.name))).toEqual([
                    "id", "contentHash", "relativePath", "fileName", "mimeType", "byteLength",
                    "width", "height", "createdAt",
                ]);
                const lineageColumns = await client.execute(`PRAGMA table_info("TextToImageVibeEncoding")`);
                expect(lineageColumns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                    "sourceContentHash", "providerKind", "providerModel", "informationExtracted",
                    "canonicalInformation", "encoderVersion", "encodingContentHash", "provenance",
                    "importContainerContentHash",
                ]));
                const foreignKeyViolations = await client.execute("PRAGMA foreign_key_check");
                expect(foreignKeyViolations.rows).toEqual([]);
            } finally {
                client.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("新 Project 初始化的 generated-asset 三列（contentHash/compiledRequestHash/compiledRevision）直接存在", async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-p5-asset-new-"));
        try {
            await initProjectDatabaseAtRoot(projectRoot);
            const client = createClient({url: toSqliteFileUrl(path.join(projectRoot, ".nbook", "project.sqlite"))});
            try {
                const columns = await client.execute(`PRAGMA table_info("TextToImageAsset")`);
                expect(columns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                    "contentHash", "compiledRequestHash", "compiledRevision",
                ]));
            } finally {
                client.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("旧 Project 初始化幂等补齐 generated-asset 完整性证据三列", async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-p5-asset-old-"));
        const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
        try {
            await fs.mkdir(path.dirname(databasePath), {recursive: true});
            const oldClient = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                await oldClient.execute(`CREATE TABLE "TextToImageAsset" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "jobId" TEXT NOT NULL,
                    "relativePath" TEXT NOT NULL,
                    "fileName" TEXT NOT NULL,
                    "mimeType" TEXT NOT NULL,
                    "byteLength" INTEGER NOT NULL,
                    "width" INTEGER NOT NULL,
                    "height" INTEGER NOT NULL,
                    "model" TEXT NOT NULL,
                    "seed" INTEGER NOT NULL,
                    "prompt" TEXT NOT NULL,
                    "negativePrompt" TEXT NOT NULL,
                    "sourceKind" TEXT NOT NULL,
                    "sourcePath" TEXT,
                    "sourceAnchorId" TEXT,
                    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )`);
                await oldClient.execute(`INSERT INTO "TextToImageAsset" ("id", "jobId", "relativePath", "fileName", "mimeType", "byteLength", "width", "height", "model", "seed", "prompt", "negativePrompt", "sourceKind") VALUES ('old-asset', 'job-1', 'assets/text-to-image/2026/08/old.png', 'old.png', 'image/png', 4, 1, 1, 'm', 1, 'p', 'n', 'manual')`);
            } finally {
                oldClient.close();
            }

            await initProjectDatabaseAtRoot(projectRoot);
            await initProjectDatabaseAtRoot(projectRoot);

            const migrated = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const columns = await migrated.execute(`PRAGMA table_info("TextToImageAsset")`);
                expect(columns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                    "contentHash", "compiledRequestHash", "compiledRevision",
                ]));
                // 旧行保留且三列为 NULL（不会伪造证据）。
                const row = await migrated.execute(`SELECT "contentHash", "compiledRequestHash", "compiledRevision" FROM "TextToImageAsset" WHERE "id" = 'old-asset'`);
                expect(row.rows[0]).toMatchObject({contentHash: null, compiledRequestHash: null, compiledRevision: null});
            } finally {
                migrated.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("旧 Project 初始化会幂等 hard cut mixed stub，且不触碰其它表与历史文件", async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-p5-reference-old-"));
        const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
        const historicalPath = path.join(projectRoot, "assets", "text-to-image", "references", "old.bin");
        try {
            await fs.mkdir(path.dirname(databasePath), {recursive: true});
            await fs.mkdir(path.dirname(historicalPath), {recursive: true});
            await fs.writeFile(historicalPath, "inert-history", "utf8");
            const oldClient = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                await createOldReferenceStub(oldClient);
                await oldClient.execute(`CREATE TABLE "KeepMe" ("id" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)`);
                await oldClient.execute(`INSERT INTO "KeepMe" ("id", "value") VALUES ('keep', 'unchanged')`);
            } finally {
                oldClient.close();
            }

            await initProjectDatabaseAtRoot(projectRoot);
            await initProjectDatabaseAtRoot(projectRoot);

            const migrated = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const sourceColumns = await migrated.execute(`PRAGMA table_info("TextToImageReferenceAsset")`);
                expect(sourceColumns.rows.map((row) => String(row.name))).toEqual([
                    "id", "contentHash", "relativePath", "fileName", "mimeType", "byteLength",
                    "width", "height", "createdAt",
                ]);
                expect((await migrated.execute(`SELECT COUNT(*) AS count FROM "TextToImageReferenceAsset"`)).rows[0]?.count).toBe(0);
                expect((await migrated.execute(`SELECT "value" FROM "KeepMe" WHERE "id" = 'keep'`)).rows[0]?.value).toBe("unchanged");
                const typedTables = await migrated.execute(`SELECT "name" FROM sqlite_schema WHERE type = 'table' AND "name" IN (
                    'TextToImageReferenceAsset', 'TextToImageVibeEncodingBlob',
                    'TextToImageVibeEncoding', 'TextToImageReferencePromotion'
                ) ORDER BY "name"`);
                expect(typedTables.rows).toHaveLength(4);
            } finally {
                migrated.close();
            }
            await expect(fs.readFile(historicalPath, "utf8")).resolves.toBe("inert-history");
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("旧 stub hard cut 任一步失败时回滚，不留下半升级 schema", async () => {
        const client = createClient({url: ":memory:"});
        try {
            await createOldReferenceStub(client);
            await client.execute(`CREATE VIEW "TextToImageReferencePromotion" AS SELECT 1 AS id`);

            await expect(ensureTextToImageP5ReferenceSchema(client)).rejects.toThrow();

            const oldColumns = await client.execute(`PRAGMA table_info("TextToImageReferenceAsset")`);
            expect(oldColumns.rows.map((row) => String(row.name))).toContain("kind");
            expect((await client.execute(`SELECT COUNT(*) AS count FROM "TextToImageReferenceAsset"`)).rows[0]?.count).toBe(1);
            const lineages = await client.execute(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'TextToImageVibeEncoding'`);
            expect(lineages.rows).toHaveLength(0);
        } finally {
            client.close();
        }
    });

    it("同名但非精确旧 shape 的 reference 表 fail closed，绝不删除未知列或行", async () => {
        const client = createClient({url: ":memory:"});
        try {
            await createOldReferenceStub(client);
            await client.execute(`ALTER TABLE "TextToImageReferenceAsset" ADD COLUMN "unexpectedOwner" TEXT`);
            await client.execute(`UPDATE "TextToImageReferenceAsset" SET "unexpectedOwner" = 'keep-me'`);

            await expect(ensureTextToImageP5ReferenceSchema(client)).rejects.toMatchObject({
                code: "TEXT_TO_IMAGE_REFERENCE_SCHEMA_UNKNOWN",
            });

            const columns = await client.execute(`PRAGMA table_info("TextToImageReferenceAsset")`);
            expect(columns.rows.map((row) => String(row.name))).toContain("unexpectedOwner");
            expect((await client.execute(`SELECT "unexpectedOwner" FROM "TextToImageReferenceAsset"`)).rows[0]?.unexpectedOwner)
                .toBe("keep-me");
        } finally {
            client.close();
        }
    });

    it("旧 Project 初始化会 hard cut v2 dispatch/Manifest/Approval 并保留 terminal Job 历史", async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-p5-execution-old-"));
        const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
        try {
            await fs.mkdir(path.dirname(databasePath), {recursive: true});
            const oldClient = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                await createLegacyP5ExecutionSchema(oldClient);
            } finally {
                oldClient.close();
            }

            // 幂等初始化两次：旧闭包 hard cut 后再次运行必须收敛且不重复破坏。
            await initProjectDatabaseAtRoot(projectRoot);
            await initProjectDatabaseAtRoot(projectRoot);

            const migrated = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const manifestColumns = await migrated.execute(`PRAGMA table_info("IllustrationExecutionManifest")`);
                const names = manifestColumns.rows.map((row) => String(row.name));
                expect(names).toContain("additionalCostLowerBound");
                expect(names).not.toContain("knownCost");
                const approvalColumns = await migrated.execute(`PRAGMA table_info("IllustrationExecutionApproval")`);
                const approvalNames = approvalColumns.rows.map((row) => String(row.name));
                expect(approvalNames).toContain("acceptedAdditionalCostLowerBound");
                expect(approvalNames).not.toContain("authorizedCostLimit");
                // 旧 queued strict Job 被标记 failed，terminal 历史保留。
                const terminal = await migrated.execute(`SELECT "id", "status" FROM "TextToImageJob" WHERE "kind" = 'illustration' ORDER BY "id"`);
                const statuses = terminal.rows.map((row) => String(row.status)).sort();
                expect(statuses).toEqual(["failed", "outcome_unknown", "succeeded"]);
                const assets = await migrated.execute(`SELECT COUNT(*) AS count FROM "TextToImageAsset"`);
                expect(assets.rows[0]?.count).toBe(1);
                const outbox = await migrated.execute(`SELECT COUNT(*) AS count FROM "TextToImageDispatchOutbox"`);
                expect(outbox.rows[0]?.count).toBe(0);
                expect((await migrated.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
            } finally {
                migrated.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("旧 Manifest/Approval 结构不精确时 fail closed，绝不删除未知列", async () => {
        const client = createClient({url: ":memory:"});
        try {
            await createLegacyP5ExecutionSchema(client);
            await client.execute(`ALTER TABLE "IllustrationExecutionManifest" ADD COLUMN "unexpectedOwner" TEXT`);

            await expect(ensureTextToImageP5ExecutionSchema(client)).rejects.toMatchObject({
                code: "TEXT_TO_IMAGE_REFERENCE_SCHEMA_UNKNOWN",
            });

            const columns = await client.execute(`PRAGMA table_info("IllustrationExecutionManifest")`);
            expect(columns.rows.map((row) => String(row.name))).toContain("unexpectedOwner");
        } finally {
            client.close();
        }
    });

    it("旧 v2 outbox 在初始化时被清除，Manifest 不保留悬空 owner", async () => {
        const client = createClient({url: ":memory:"});
        try {
            await createLegacyP5ExecutionSchema(client);

            await ensureTextToImageP5ExecutionSchema(client);

            const outbox = await client.execute(`SELECT COUNT(*) AS count FROM "TextToImageDispatchOutbox"`);
            expect(outbox.rows[0]?.count).toBe(0);
            const orphanJobs = await client.execute(`SELECT COUNT(*) AS count FROM "TextToImageJob" WHERE "executionManifestId" IS NOT NULL`);
            expect(orphanJobs.rows[0]?.count).toBe(0);
        } finally {
            client.close();
        }
    });

    it("会把旧 StoryPlot 备份并合并到 Scene，同时清理 plot ref", async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-project-migration-"));
        try {
            const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
            await fs.mkdir(path.dirname(databasePath), {recursive: true});
            const client = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                await createLegacyPlotSchema(client);
            } finally {
                client.close();
            }

            await initProjectDatabaseAtRoot(projectRoot);

            const migratedClient = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const sceneColumns = await migratedClient.execute(`PRAGMA table_info("StoryScene")`);
                expect(sceneColumns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                    "startInstant",
                    "endInstant",
                    "subjectIdsJson",
                    "locationSubjectId",
                ]));

                const plotTable = await migratedClient.execute(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'StoryPlot'`);
                expect(plotTable.rows).toHaveLength(0);

                const scene = (await migratedClient.execute(`SELECT "summary", "purpose", "writingTip" FROM "StoryScene" WHERE "id" = 1`)).rows[0];
                expect(String(scene.summary)).toContain("## 原 Plot 摘要");
                expect(String(scene.summary)).toContain("- #0 conflict：旧 Plot 摘要");
                expect(String(scene.purpose)).toContain("## 原 Plot 效果");
                expect(String(scene.purpose)).toContain("- #0：旧 Plot 效果");
                expect(String(scene.writingTip)).toContain("## 原 Plot 写作提示");
                expect(String(scene.writingTip)).toContain("- #0：旧 Plot 提示");

                const refs = await migratedClient.execute(`SELECT "rawTarget", "targetKind" FROM "StorySceneRef" ORDER BY "id"`);
                expect(refs.rows).toEqual([
                    expect.objectContaining({rawTarget: "scene://2", targetKind: "scene"}),
                ]);
            } finally {
                migratedClient.close();
            }

            const backupText = await fs.readFile(path.join(projectRoot, ".nbook", "story-plot-backup.json"), "utf-8");
            expect(backupText).toContain("\"sourceTable\": \"StoryPlot\"");
            expect(backupText).toContain("旧 Plot 摘要");
        } finally {
            await removeTempProject(projectRoot);
        }
    });
});

/**
 * Windows 上 libsql native handle 可能延迟释放，测试清理需要短重试。
 */
async function removeTempProject(projectRoot: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            collectReleasedSqliteHandles({force: true});
            await fs.rm(projectRoot, {recursive: true, force: true});
            return;
        } catch (error) {
            if (attempt === 4) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}

/** 构造 P5 typed schema 之前的 mixed pre-release stub。 */
async function createOldReferenceStub(client: ReturnType<typeof createClient>): Promise<void> {
    await client.execute(`CREATE TABLE "TextToImageReferenceAsset" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "kind" TEXT NOT NULL,
        "contentHash" TEXT NOT NULL UNIQUE,
        "relativePath" TEXT NOT NULL UNIQUE,
        "fileName" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "byteLength" INTEGER NOT NULL,
        "parentAssetId" TEXT,
        "derivedModel" TEXT,
        "derivedInfoExtracted" REAL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.execute(`INSERT INTO "TextToImageReferenceAsset" (
        "id", "kind", "contentHash", "relativePath", "fileName", "mimeType", "byteLength"
    ) VALUES ('old-row', 'source-image', '${"a".repeat(64)}', 'assets/text-to-image/references/aa/old.png', 'old.png', 'image/png', 8)`);
}

/**
 * 构造 Task 78 前的最小旧 Plot schema。
 */
async function createLegacyPlotSchema(client: ReturnType<typeof createClient>): Promise<void> {
    await client.execute(`CREATE TABLE "Story" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "title" TEXT NOT NULL, "summary" TEXT NOT NULL DEFAULT '', "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StoryThread" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "storyId" INTEGER NOT NULL, "storyPhaseId" INTEGER, "sortOrder" INTEGER NOT NULL, "name" TEXT NOT NULL, "title" TEXT NOT NULL, "isMainThread" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'draft', "summary" TEXT NOT NULL DEFAULT '', "tags" TEXT NOT NULL DEFAULT '[]', "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StoryScene" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "storyId" INTEGER NOT NULL, "threadId" INTEGER NOT NULL, "chapterPath" TEXT, "threadSortOrder" INTEGER NOT NULL, "chapterSortOrder" INTEGER, "title" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft', "summary" TEXT NOT NULL DEFAULT '', "purpose" TEXT, "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StoryPlot" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "sceneId" INTEGER NOT NULL, "sortOrder" INTEGER NOT NULL, "kind" TEXT NOT NULL, "summary" TEXT NOT NULL DEFAULT '', "effect" TEXT, "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StorySceneRef" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "sceneId" INTEGER NOT NULL, "sortOrder" INTEGER NOT NULL, "relation" TEXT NOT NULL, "rawTarget" TEXT NOT NULL, "targetKind" TEXT NOT NULL, "targetThreadId" INTEGER, "targetSceneId" INTEGER, "targetPlotId" INTEGER, "visibility" TEXT NOT NULL DEFAULT 'author', "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`INSERT INTO "Story" ("id", "title", "summary") VALUES (1, '故事', '')`);
    await client.execute(`INSERT INTO "StoryThread" ("id", "storyId", "sortOrder", "name", "title") VALUES (1, 1, 0, 'main', '主线')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "threadSortOrder", "title", "summary", "purpose", "writingTip") VALUES (1, 1, 1, 0, '场景一', '原 Scene 摘要', '原 Scene 目的', '原 Scene 提示')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "threadSortOrder", "title", "summary") VALUES (2, 1, 1, 1, '场景二', '')`);
    await client.execute(`INSERT INTO "StoryPlot" ("id", "sceneId", "sortOrder", "kind", "summary", "effect", "writingTip") VALUES (1, 1, 0, 'conflict', '旧 Plot 摘要', '旧 Plot 效果', '旧 Plot 提示')`);
    await client.execute(`INSERT INTO "StorySceneRef" ("id", "sceneId", "sortOrder", "relation", "rawTarget", "targetKind", "targetPlotId") VALUES (1, 1, 0, 'foreshadows', 'plot://1', 'plot', 1)`);
    await client.execute(`INSERT INTO "StorySceneRef" ("id", "sceneId", "sortOrder", "relation", "rawTarget", "targetKind", "targetSceneId") VALUES (2, 1, 1, 'pays_off', 'scene://2', 'scene', 2)`);
}

/** 构造 P5 执行合同 hard cut 之前的旧 v2 dispatch/Manifest/Approval/Job/Asset 闭包。 */
async function createLegacyP5ExecutionSchema(client: ReturnType<typeof createClient>): Promise<void> {
    await client.execute(`CREATE TABLE "TextToImageJob" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "providerId" INTEGER NOT NULL,
        "kind" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "requestJson" TEXT NOT NULL,
        "sourcePath" TEXT,
        "sourceAnchorId" TEXT,
        "sourceInsertStatus" TEXT NOT NULL DEFAULT 'not_applicable',
        "providerSnapshotJson" TEXT NOT NULL DEFAULT '{}',
        "executionManifestId" TEXT,
        "executionApprovalId" TEXT,
        "resultAssetIdsJson" TEXT NOT NULL DEFAULT '[]',
        "errorMessage" TEXT,
        "stableErrorCode" TEXT,
        "activeAttemptId" TEXT,
        "activeAttemptFence" INTEGER,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "startedAt" DATETIME,
        "finishedAt" DATETIME
    )`);
    await client.execute(`CREATE TABLE "TextToImageAsset" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "jobId" TEXT NOT NULL,
        "relativePath" TEXT NOT NULL UNIQUE,
        "fileName" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "byteLength" INTEGER NOT NULL,
        "width" INTEGER NOT NULL,
        "height" INTEGER NOT NULL,
        "model" TEXT NOT NULL,
        "seed" INTEGER NOT NULL,
        "prompt" TEXT NOT NULL,
        "negativePrompt" TEXT NOT NULL,
        "sourceKind" TEXT NOT NULL,
        "sourcePath" TEXT,
        "sourceAnchorId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TextToImageAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TextToImageJob" ("id")
    )`);
    await client.execute(`CREATE TABLE "IllustrationExecutionManifest" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "projectId" TEXT NOT NULL,
        "targetHash" TEXT NOT NULL,
        "executionNonce" TEXT NOT NULL,
        "executionInputHashesJson" TEXT NOT NULL,
        "executionManifestHash" TEXT NOT NULL,
        "recipeSnapshotJson" TEXT NOT NULL,
        "compiledRequestsJson" TEXT NOT NULL,
        "outputCount" INTEGER NOT NULL,
        "knownCost" REAL,
        "tokenLowerBound" INTEGER,
        "registrationState" TEXT NOT NULL DEFAULT 'jobs_registered',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.execute(`CREATE TABLE "IllustrationExecutionApproval" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "manifestId" TEXT NOT NULL,
        "executionManifestHash" TEXT NOT NULL,
        "approvalHash" TEXT NOT NULL,
        "authorizedOutputCount" INTEGER NOT NULL,
        "authorizedCostLimit" REAL,
        "authorizedTokenLimit" INTEGER,
        "actorUserId" INTEGER NOT NULL,
        "approvedAt" DATETIME NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "IllustrationExecutionApproval_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "IllustrationExecutionManifest" ("id")
    )`);
    await client.execute(`CREATE TABLE "TextToImageDispatchOutbox" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "dispatchKey" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "manifestId" TEXT NOT NULL,
        "manifestHash" TEXT NOT NULL,
        "registrationVersion" TEXT NOT NULL,
        "preparationId" TEXT NOT NULL,
        "prepareAttemptId" TEXT NOT NULL,
        "prepareVersion" INTEGER NOT NULL,
        "state" TEXT NOT NULL DEFAULT 'pending',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.execute(`INSERT INTO "TextToImageJob" ("id", "providerId", "kind", "status", "requestJson", "sourcePath") VALUES ('queued-1', 1, 'illustration', 'queued', '{}', 'manuscript/v1/c1/index.md')`);
    await client.execute(`INSERT INTO "TextToImageJob" ("id", "providerId", "kind", "status", "requestJson", "sourcePath") VALUES ('running-1', 1, 'illustration', 'running', '{}', 'manuscript/v1/c2/index.md')`);
    await client.execute(`INSERT INTO "TextToImageJob" ("id", "providerId", "kind", "status", "requestJson", "sourcePath") VALUES ('terminal-1', 1, 'illustration', 'succeeded', '{}', 'manuscript/v1/c3/index.md')`);
    await client.execute(`INSERT INTO "TextToImageAsset" ("id", "jobId", "relativePath", "fileName", "mimeType", "byteLength", "width", "height", "model", "seed", "prompt", "negativePrompt", "sourceKind") VALUES ('asset-1', 'terminal-1', 'assets/text-to-image/2026/08/asset-1.png', 'asset-1.png', 'image/png', 10, 3, 2, 'nai-diffusion-4-5-full', 1, '', '', 'illustration')`);
    await client.execute(`INSERT INTO "IllustrationExecutionManifest" ("id", "projectId", "targetHash", "executionNonce", "executionInputHashesJson", "executionManifestHash", "recipeSnapshotJson", "compiledRequestsJson", "outputCount", "knownCost") VALUES ('manifest-1', 'project-1', 'target', 'nonce', '[]', 'hash', '{}', '[]', 1, 1.0)`);
    await client.execute(`INSERT INTO "IllustrationExecutionApproval" ("id", "manifestId", "executionManifestHash", "approvalHash", "authorizedOutputCount", "actorUserId", "approvedAt") VALUES ('approval-1', 'manifest-1', 'hash', 'approval-hash', 1, 7, '2026-07-21T00:00:00.000Z')`);
    await client.execute(`INSERT INTO "TextToImageDispatchOutbox" ("id", "dispatchKey", "jobId", "manifestId", "manifestHash", "registrationVersion", "preparationId", "prepareAttemptId", "prepareVersion") VALUES ('outbox-1', 'key', 'queued-1', 'manifest-1', 'hash', 'route-b-dispatch-registration-v2', 'prep-1', 'attempt-1', 1)`);
    await client.execute(`UPDATE "TextToImageJob" SET "executionManifestId" = 'manifest-1', "executionApprovalId" = 'approval-1' WHERE "id" = 'queued-1'`);
}
