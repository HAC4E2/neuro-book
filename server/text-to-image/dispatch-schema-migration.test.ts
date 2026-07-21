import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createClient} from "@libsql/client";
import {afterEach, describe, expect, it} from "vitest";
import {splitSqlStatements} from "nbook/scripts/db/sql-statements.mjs";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

const temporaryDirectories: string[] = [];

describe("persistent provider lane SQLite migration", () => {
    afterEach(async () => {
        await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
            await removeTemporaryDirectory(directory);
        }));
    });

    it("creates preparation, lane item and one throttle row per owner/provider", async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "nbook-dispatch-migration-"));
        temporaryDirectories.push(directory);
        const client = createClient({url: pathToFileURL(path.join(directory, "app.sqlite")).toString()});
        try {
            const migration = await readFile("prisma/migrations/sqlite/20260721220000_text_to_image_persistent_lane/migration.sql", "utf8");
            for (const statement of splitSqlStatements(migration)) await client.execute(statement);

            const tables = await client.execute(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name"`);
            expect(tables.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                "TextToImageDispatchPreparation",
                "TextToImageProviderLaneItem",
                "TextToImageProviderThrottle",
                "TextToImageProviderRevisionInvalidation",
            ]));
            const preparationColumns = await client.execute(`PRAGMA table_info("TextToImageDispatchPreparation")`);
            const preparationNames = preparationColumns.rows.map((row) => String(row.name));
            expect(preparationNames).toEqual(expect.arrayContaining([
                "prepareAttemptId",
                "prepareLeaseUntil",
                "prepareVersion",
                "stateVersion",
                "projectId",
                "projectPath",
                "manifestHash",
            ]));
            expect(preparationNames).not.toEqual(expect.arrayContaining(["compiledRequest", "recipeSnapshot", "credential"]));

            await client.execute(`INSERT INTO "TextToImageProviderThrottle" ("ownerUserId", "providerId", "nextAllowedAt", "fencingVersion") VALUES (7, 11, CURRENT_TIMESTAMP, 0)`);
            await expect(client.execute(`INSERT INTO "TextToImageProviderThrottle" ("ownerUserId", "providerId", "nextAllowedAt", "fencingVersion") VALUES (7, 11, CURRENT_TIMESTAMP, 0)`))
                .rejects.toThrow();
            await expect(client.execute(`INSERT INTO "TextToImageProviderThrottle" ("ownerUserId", "providerId", "nextAllowedAt", "activeAttemptId", "fencingVersion") VALUES (8, 11, CURRENT_TIMESTAMP, 'partial', 1)`))
                .rejects.toThrow();
            await client.execute(`INSERT INTO "TextToImageProviderRevisionInvalidation" ("id", "ownerUserId", "providerId", "oldRevision", "newRevision", "projectId", "projectPath") VALUES ('revision-1', 7, 11, 1, 2, 'project-1', 'workspace/book')`);
            await expect(client.execute(`INSERT INTO "TextToImageProviderRevisionInvalidation" ("id", "ownerUserId", "providerId", "oldRevision", "newRevision", "projectId", "projectPath") VALUES ('revision-duplicate', 7, 11, 1, 2, 'project-1', 'workspace/moved')`))
                .rejects.toThrow();
            await expect(client.execute(`INSERT INTO "TextToImageProviderRevisionInvalidation" ("id", "ownerUserId", "providerId", "oldRevision", "newRevision", "projectId", "projectPath") VALUES ('revision-backwards', 7, 11, 2, 2, 'project-2', 'workspace/book')`))
                .rejects.toThrow();

            await expect(client.execute(`INSERT INTO "TextToImageDispatchPreparation" ("id", "manifestHash", "ownerUserId", "providerId", "providerCredentialRevision", "projectId", "projectPath", "prepareAttemptId", "prepareLeaseUntil", "jobIdsJson", "dispatchKeysJson", "state") VALUES ('bad-quarantine', 'manifest-bad', 7, 11, 1, 'project-1', 'workspace/book', 'prepare-1', CURRENT_TIMESTAMP, '[]', '[]', 'quarantined')`))
                .rejects.toThrow();
            await client.execute(`INSERT INTO "TextToImageDispatchPreparation" ("id", "manifestHash", "ownerUserId", "providerId", "providerCredentialRevision", "projectId", "projectPath", "prepareAttemptId", "prepareLeaseUntil", "jobIdsJson", "dispatchKeysJson", "state") VALUES ('preparation-1', 'manifest-1', 7, 11, 1, 'project-1', 'workspace/book', 'prepare-1', CURRENT_TIMESTAMP, '["job-1"]', '["dispatch-1"]', 'ready')`);
            await expect(client.execute(`INSERT INTO "TextToImageProviderLaneItem" ("dispatchKey", "preparationId", "jobId", "ownerUserId", "providerId", "providerCredentialRevision", "projectId", "projectPath", "manifestHash", "prepareAttemptId", "prepareVersion", "state", "attemptCount") VALUES ('dispatch-1', 'preparation-1', 'job-1', 7, 11, 1, 'project-1', 'workspace/book', 'manifest-1', 'prepare-1', 1, 'attempt_started', 1)`))
                .rejects.toThrow();
        } finally {
            await client.close();
        }
    });

    it("keeps the distribution migration in parity with retry and state-closure constraints", async () => {
        const migration = await readFile("prisma/migrations/20260721220000_text_to_image_persistent_lane/migration.sql", "utf8");
        expect(migration).toContain("'retry_wait'");
        expect(migration).toContain("'retry_leased'");
        expect(migration).toContain("`projectId` VARCHAR(200) NOT NULL");
        expect(migration).toContain("`providerCredentialRevision` INTEGER NOT NULL CHECK (`providerCredentialRevision` >= 1)");
        expect(migration).toContain("`prepareVersion` INTEGER NOT NULL DEFAULT 1 CHECK (`prepareVersion` >= 1)");
        expect(migration).toContain("`stateVersion` INTEGER NOT NULL DEFAULT 1 CHECK (`stateVersion` >= 1)");
        expect(migration).toContain("CHECK (`state` IN ('prepared', 'project_committed', 'ready', 'abandoned', 'quarantined'))");
        expect(migration).toContain("CHECK (`state` IN ('prepared', 'ready', 'leased', 'retry_wait', 'retry_leased', 'attempt_started', 'completed', 'failed', 'outcome_unknown', 'quarantined'))");
        expect(migration).toContain("`attemptCount` INTEGER NOT NULL DEFAULT 0 CHECK (`attemptCount` >= 0)");
        expect(migration).toContain("`fencingVersion` INTEGER NOT NULL DEFAULT 0 CHECK (`fencingVersion` >= 0)");
        expect(migration).toContain("CHECK ((`claimId` IS NULL) = (`claimLeaseUntil` IS NULL))");
        expect(migration).toContain("CHECK ((`activeAttemptId` IS NULL) = (`leaseUntil` IS NULL))");
        expect(migration).toContain("CHECK (`oldRevision` >= 1 AND `newRevision` > `oldRevision`)");
    });
});

/** Windows/libsql 关闭后 native handle 可能短暂滞留；仅对测试临时目录做有界清理重试。 */
async function removeTemporaryDirectory(directory: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            collectReleasedSqliteHandles({force: true});
            await rm(directory, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!isBusyError(error)) throw error;
            if (attempt === 9) {
                // Vitest worker 退出前 libsql 仍可能持有 OS 临时数据库；不让清理噪音掩盖迁移断言。
                return;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
    }
}

/** 只识别 Windows 文件句柄短锁。 */
function isBusyError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY";
}
