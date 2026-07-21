import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createClient} from "@libsql/client";
import {afterAll, afterEach, describe, expect, it} from "vitest";
import {PrismaClient} from "nbook/server/generated/prisma/client";
import {splitSqlStatements} from "nbook/scripts/db/sql-statements.mjs";
import {openTextToImageCredential, sealTextToImageCredential} from "nbook/server/text-to-image/provider-credential";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {
    PrismaTextToImageProviderStore,
    TextToImageProviderReconciliationInProgressError,
    TextToImageProviderService,
} from "nbook/server/text-to-image/provider.service";
import {ProviderLaneRepository} from "nbook/server/text-to-image/provider-lane.repository";

const temporaryDirectories: string[] = [];
const prismaClients: Array<{client: PrismaClient; adapter: TrackedPrismaLibSql}> = [];

describe("PrismaTextToImageProviderStore SQLite integration", () => {
    afterEach(async () => {
        await Promise.all(prismaClients.splice(0).map(async ({client, adapter}) => {
            await client.$disconnect();
            adapter.closeTrackedClients();
        }));
        collectReleasedSqliteHandles({force: true});
    });

    afterAll(async () => {
        for (const directory of temporaryDirectories.splice(0)) {
            await removeTemporaryDirectory(directory);
        }
    }, 30_000);

    it("两个真实 Prisma client 的并发首次 PUT 最终只保留一个 singleton id", async () => {
        const databaseUrl = await createAppDatabase(false);
        const firstClient = prismaClient(databaseUrl);
        const secondClient = prismaClient(databaseUrl);
        const sharedKeyPath = await keyPath();
        await sealTextToImageCredential("warm-key", sharedKeyPath);
        const first = new TextToImageProviderService(new PrismaTextToImageProviderStore(firstClient), sharedKeyPath);
        const second = new TextToImageProviderService(new PrismaTextToImageProviderStore(secondClient), sharedKeyPath);

        const [left, right] = await Promise.all([
            first.saveNovelAi(1, {name: "NovelAI A", credential: "first", requestIntervalMs: 0}),
            second.saveNovelAi(1, {name: "NovelAI B", credential: "second", requestIntervalMs: 0}),
        ]);

        expect(left.id).toBe(right.id);
        await expect(firstClient.textToImageProvider.count({where: {ownerUserId: 1, kind: "novelai"}})).resolves.toBe(1);
        const index = await firstClient.$queryRawUnsafe<Array<{sql: string}>>(`SELECT "sql" FROM "sqlite_master" WHERE "type" = 'index' AND "name" = 'one_novelai_provider_per_owner'`);
        expect(index[0]?.sql).toContain(`WHERE "kind" = 'novelai'`);
    }, 30_000);

    it("真实 App SQLite 在 Project 阶段失败后保留决定并拒绝改选", async () => {
        const databaseUrl = await createAppDatabase(true);
        const client = prismaClient(databaseUrl);
        let attempts = 0;
        const service = new TextToImageProviderService(new PrismaTextToImageProviderStore(client), undefined, {
            async invalidate() {
                attempts += 1;
                throw new Error("project two busy after project one committed");
            },
            async invalidateRevision() {
                return [];
            },
        });
        const inspection = await service.inspectNovelAi(1);

        await expect(service.reconcileNovelAi(1, {keepProviderId: 1, selectionToken: inspection.selectionToken!}))
            .rejects.toThrow("project two busy");
        await expect(client.textToImageProviderReconciliation.findUnique({where: {ownerUserId: 1}})).resolves.toMatchObject({
            keepProviderId: 1,
            selectionToken: inspection.selectionToken,
        });

        await expect(service.reconcileNovelAi(1, {keepProviderId: 2, selectionToken: inspection.selectionToken!}))
            .rejects.toBeInstanceOf(TextToImageProviderReconciliationInProgressError);
        expect(attempts).toBe(1);
    }, 30_000);

    it("换 token 在同一 App 事务隔离未发送旧 revision，并保留已开始 attempt 与 throttle", async () => {
        const databaseUrl = await createAppDatabase(false);
        const client = prismaClient(databaseUrl);
        const sharedKeyPath = await keyPath();
        const revisionCalls: number[] = [];
        const service = new TextToImageProviderService(new PrismaTextToImageProviderStore(client), sharedKeyPath, {
            async invalidate() {
                return [];
            },
            async invalidateRevision(target) {
                revisionCalls.push(target.oldRevision);
                return [];
            },
        });
        const provider = await service.saveNovelAi(1, {
            name: "NovelAI",
            credential: "token-one",
            requestIntervalMs: 15_000,
        });
        const leaseUntil = new Date("2026-07-22T00:00:00.000Z");
        await client.textToImageDispatchPreparation.create({
            data: {
                id: "preparation-revision-1",
                manifestHash: "a".repeat(64),
                ownerUserId: 1,
                providerId: provider.id,
                providerCredentialRevision: 1,
                projectId: "project-1",
                projectPath: "workspace/book",
                prepareAttemptId: "prepare-attempt-1",
                prepareLeaseUntil: leaseUntil,
                state: "ready",
                jobIdsJson: JSON.stringify(["job-ready", "job-leased", "job-started"]),
                dispatchKeysJson: JSON.stringify(["b".repeat(64), "c".repeat(64), "d".repeat(64)]),
            },
        });
        await client.textToImageProviderLaneItem.createMany({
            data: [
                laneItem("b".repeat(64), "job-ready", "ready"),
                {...laneItem("c".repeat(64), "job-leased", "leased"), claimId: "claim-1", claimLeaseUntil: leaseUntil},
                {
                    ...laneItem("d".repeat(64), "job-started", "attempt_started"),
                    claimId: "claim-2",
                    claimLeaseUntil: leaseUntil,
                    sendAttemptId: "send-1",
                    sendLeaseUntil: leaseUntil,
                    sendFence: 4,
                    attemptCount: 1,
                },
            ],
        });
        await client.textToImageProviderThrottle.create({
            data: {
                ownerUserId: 1,
                providerId: provider.id,
                nextAllowedAt: leaseUntil,
                activeAttemptId: "send-1",
                leaseUntil,
                fencingVersion: 4,
            },
        });

        await service.saveNovelAi(1, {name: "NovelAI", credential: "token-two", requestIntervalMs: 15_000});

        await expect(client.textToImageProvider.findUniqueOrThrow({where: {id: provider.id}})).resolves.toMatchObject({credentialRevision: 2});
        await expect(client.textToImageDispatchPreparation.findUniqueOrThrow({where: {id: "preparation-revision-1"}})).resolves.toMatchObject({
            state: "quarantined",
            quarantineCode: "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE",
        });
        const items = await client.textToImageProviderLaneItem.findMany({orderBy: {jobId: "asc"}});
        expect(items.map((item) => ({jobId: item.jobId, state: item.state, claimId: item.claimId}))).toEqual([
            {jobId: "job-leased", state: "quarantined", claimId: null},
            {jobId: "job-ready", state: "quarantined", claimId: null},
            {jobId: "job-started", state: "attempt_started", claimId: "claim-2"},
        ]);
        await expect(client.textToImageProviderThrottle.findUniqueOrThrow({
            where: {ownerUserId_providerId: {ownerUserId: 1, providerId: provider.id}},
        })).resolves.toMatchObject({activeAttemptId: "send-1", fencingVersion: 4});
        await expect(client.textToImageProviderRevisionInvalidation.findMany()).resolves.toMatchObject([
            {oldRevision: 1, newRevision: 2, projectId: "project-1", projectPath: "workspace/book", state: "completed", attemptCount: 0},
        ]);
        expect(revisionCalls).toEqual([1]);

        await service.saveNovelAi(1, {name: "NovelAI", credential: "token-two", requestIntervalMs: 20_000});
        await expect(client.textToImageProvider.findUniqueOrThrow({where: {id: provider.id}})).resolves.toMatchObject({credentialRevision: 2});
        await expect(client.textToImageProviderRevisionInvalidation.count()).resolves.toBe(1);
        expect(revisionCalls).toEqual([1]);

        function laneItem(dispatchKey: string, jobId: string, state: "ready" | "leased" | "attempt_started") {
            return {
                dispatchKey,
                preparationId: "preparation-revision-1",
                jobId,
                ownerUserId: 1,
                providerId: provider.id,
                providerCredentialRevision: 1,
                projectId: "project-1",
                projectPath: "workspace/book",
                manifestHash: "a".repeat(64),
                prepareAttemptId: "prepare-attempt-1",
                prepareVersion: 1,
                state,
            };
        }
    }, 30_000);

    it("provider save 与 lane start 共享 owner 锁，竞态只线性化为失效或已开始", async () => {
        const databaseUrl = await createAppDatabase(false);
        const providerClient = prismaClient(databaseUrl);
        const laneClient = prismaClient(databaseUrl);
        const sharedKeyPath = await keyPath();
        const service = new TextToImageProviderService(new PrismaTextToImageProviderStore(providerClient), sharedKeyPath, {
            async invalidate() { return []; },
            async invalidateRevision() { return []; },
        });
        const provider = await service.saveNovelAi(1, {
            name: "NovelAI",
            credential: "token-one",
            requestIntervalMs: 15_000,
        });
        const leaseUntil = new Date(Date.now() + 60_000);
        await providerClient.textToImageDispatchPreparation.create({
            data: {
                id: "preparation-race",
                manifestHash: `sha256:${"e".repeat(64)}`,
                ownerUserId: 1,
                providerId: provider.id,
                providerCredentialRevision: 1,
                projectId: "project-race",
                projectPath: "workspace/book",
                prepareAttemptId: "prepare-race",
                prepareLeaseUntil: leaseUntil,
                state: "ready",
                jobIdsJson: JSON.stringify(["job-race"]),
                dispatchKeysJson: JSON.stringify([`sha256:${"f".repeat(64)}`]),
            },
        });
        await providerClient.textToImageProviderLaneItem.create({
            data: {
                dispatchKey: `sha256:${"f".repeat(64)}`,
                preparationId: "preparation-race",
                jobId: "job-race",
                ownerUserId: 1,
                providerId: provider.id,
                providerCredentialRevision: 1,
                projectId: "project-race",
                projectPath: "workspace/book",
                manifestHash: `sha256:${"e".repeat(64)}`,
                prepareAttemptId: "prepare-race",
                prepareVersion: 1,
                state: "ready",
            },
        });
        const lane = new ProviderLaneRepository(laneClient, {
            credentialOpener: async (credential) => await openTextToImageCredential(credential, sharedKeyPath),
        });
        const leased = await lane.claimReady();
        expect(leased?.state).toBe("leased");

        const [, started] = await Promise.all([
            service.saveNovelAi(1, {name: "NovelAI", credential: "token-two", requestIntervalMs: 15_000}),
            lane.startAttempt(leased!),
        ]);

        const item = await providerClient.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: `sha256:${"f".repeat(64)}`}});
        expect(["quarantined", "attempt_started"]).toContain(item.state);
        expect(item.state === "attempt_started").toBe(started !== null);
        await expect(providerClient.textToImageProvider.findUniqueOrThrow({where: {id: provider.id}})).resolves.toMatchObject({credentialRevision: 2});
    }, 30_000);

    it("token replacement 与 503 settlement 的两种 owner-lock 顺序都留下精确 Project invalidation", async () => {
        for (const order of ["replacement-first", "retry-first"] as const) {
            const databaseUrl = await createAppDatabase(false);
            const client = prismaClient(databaseUrl);
            const sharedKeyPath = await keyPath();
            const revisionCalls: string[] = [];
            const service = new TextToImageProviderService(new PrismaTextToImageProviderStore(client), sharedKeyPath, {
                async invalidate() { return []; },
                async invalidateRevision(target) {
                    revisionCalls.push(target.projectId);
                    return [];
                },
            });
            const provider = await service.saveNovelAi(1, {
                name: "NovelAI",
                credential: "token-one",
                requestIntervalMs: 15_000,
            });
            const dispatchDigit = order === "replacement-first" ? "7" : "8";
            const normalizedDispatchKey = `sha256:${dispatchDigit.repeat(64)}`;
            const manifestHash = `sha256:${order === "replacement-first" ? "9".repeat(64) : "a".repeat(64)}`;
            await client.textToImageDispatchPreparation.create({
                data: {
                    id: `preparation-${order}`,
                    manifestHash,
                    ownerUserId: 1,
                    providerId: provider.id,
                    providerCredentialRevision: 1,
                    projectId: `project-${order}`,
                    projectPath: `workspace/${order}`,
                    prepareAttemptId: `prepare-${order}`,
                    prepareLeaseUntil: new Date("2099-07-22T00:00:00.000Z"),
                    state: "ready",
                    jobIdsJson: JSON.stringify([`job-${order}`]),
                    dispatchKeysJson: JSON.stringify([normalizedDispatchKey]),
                    laneItems: {
                        create: {
                            dispatchKey: normalizedDispatchKey,
                            jobId: `job-${order}`,
                            ownerUserId: 1,
                            providerId: provider.id,
                            providerCredentialRevision: 1,
                            projectId: `project-${order}`,
                            projectPath: `workspace/${order}`,
                            manifestHash,
                            prepareAttemptId: `prepare-${order}`,
                            prepareVersion: 1,
                            state: "ready",
                        },
                    },
                },
            });
            const lane = new ProviderLaneRepository(client, {
                clock: () => new Date("2026-07-21T00:00:00.000Z"),
                credentialOpener: async (credential) => await openTextToImageCredential(credential, sharedKeyPath),
            });
            const claim = await lane.claimReady();
            if (!claim) throw new Error("预期 claim");
            const start = await lane.startAttempt(claim);
            if (!start || start.kind !== "started") throw new Error("预期 started");

            if (order === "replacement-first") {
                await service.saveNovelAi(1, {name: "NovelAI", credential: "token-two", requestIntervalMs: 15_000});
                await expect(lane.retry(start.item, "NOVELAI_HTTP_503", "NovelAI 请求失败：503"))
                    .resolves.toBe("configuration_stale");
                expect(revisionCalls).toEqual([]);
            } else {
                await expect(lane.retry(start.item, "NOVELAI_HTTP_503", "NovelAI 请求失败：503"))
                    .resolves.toBe("retry_wait");
                await service.saveNovelAi(1, {name: "NovelAI", credential: "token-two", requestIntervalMs: 15_000});
                expect(revisionCalls).toEqual([`project-${order}`]);
            }

            await expect(client.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: normalizedDispatchKey}}))
                .resolves.toMatchObject({state: "quarantined", errorCode: "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE"});
            await expect(client.textToImageProviderRevisionInvalidation.findMany()).resolves.toMatchObject([{
                projectId: `project-${order}`,
                projectPath: `workspace/${order}`,
                state: order === "replacement-first" ? "pending" : "completed",
            }]);
        }
    }, 30_000);
});

async function createAppDatabase(withDuplicates: boolean): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-provider-sqlite-"));
    temporaryDirectories.push(directory);
    const databaseUrl = pathToFileURL(path.join(directory, "app.sqlite")).toString();
    const client = createClient({url: databaseUrl});
    try {
        await client.execute(`CREATE TABLE "User" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "username" TEXT NOT NULL, "displayName" TEXT NOT NULL DEFAULT '', "passwordHash" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'user', "status" TEXT NOT NULL DEFAULT 'active', "sessionVersion" INTEGER NOT NULL DEFAULT 1, "lastLoginAt" DATETIME, "lastSeenAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
        await client.execute(`CREATE TABLE "DatabaseLock" ("key" INTEGER NOT NULL PRIMARY KEY, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
        await client.execute(`CREATE TABLE "TextToImageProvider" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "ownerUserId" INTEGER NOT NULL, "kind" TEXT NOT NULL, "name" TEXT NOT NULL, "baseUrl" TEXT NOT NULL, "model" TEXT, "recipeMigrationModel" TEXT, "credentialCiphertext" TEXT NOT NULL, "credentialIv" TEXT NOT NULL, "credentialTag" TEXT NOT NULL, "credentialRevision" INTEGER NOT NULL DEFAULT 1 CHECK ("credentialRevision" >= 1), "settings" JSON NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`);
        await client.execute(`CREATE UNIQUE INDEX "TextToImageProvider_ownerUserId_name_key" ON "TextToImageProvider"("ownerUserId", "name")`);
        await client.execute(`CREATE INDEX "TextToImageProvider_ownerUserId_kind_idx" ON "TextToImageProvider"("ownerUserId", "kind")`);
        await client.execute(`INSERT INTO "User" ("id", "username", "passwordHash") VALUES (1, 'owner', 'test')`);
        if (withDuplicates) {
            await client.execute(`INSERT INTO "TextToImageProvider" ("ownerUserId", "kind", "name", "baseUrl", "model", "credentialCiphertext", "credentialIv", "credentialTag", "settings") VALUES (1, 'novelai', 'NovelAI A', 'https://image.novelai.net', NULL, 'a', 'a', 'a', '{"allowPrivateNetwork":false,"requestIntervalMs":0}'), (1, 'novelai', 'NovelAI B', 'https://image.novelai.net', NULL, 'b', 'b', 'b', '{"allowPrivateNetwork":false,"requestIntervalMs":0}')`);
        }
        const migration = await readFile("prisma/migrations/sqlite/20260719140000_novelai_provider_singleton_transition/migration.sql", "utf8");
        for (const statement of splitSqlStatements(migration)) {
            await client.execute(statement);
        }
        const laneMigration = await readFile("prisma/migrations/sqlite/20260721220000_text_to_image_persistent_lane/migration.sql", "utf8");
        for (const statement of splitSqlStatements(laneMigration)) {
            await client.execute(statement);
        }
    } finally {
        await client.close();
    }
    return databaseUrl;
}

function prismaClient(databaseUrl: string): PrismaClient {
    const adapter = new TrackedPrismaLibSql({url: databaseUrl});
    const client = new PrismaClient({adapter});
    prismaClients.push({client, adapter});
    return client;
}

async function keyPath(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-provider-key-"));
    temporaryDirectories.push(directory);
    return path.join(directory, "workspace", ".nbook", "secrets", "text-to-image.key");
}

/** Windows 上 libsql native handle 可能延迟释放，测试清理做短重试。 */
async function removeTemporaryDirectory(directory: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            collectReleasedSqliteHandles({force: true});
            await rm(directory, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!isBusyError(error)) {
                throw error;
            }
            if (attempt === 9) {
                // Vitest 多文件并行时 Windows/libsql 可能直到 worker 退出才释放 native handle；仅忽略 OS 临时目录的最终 EBUSY。
                return;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
    }
}

function isBusyError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY";
}
