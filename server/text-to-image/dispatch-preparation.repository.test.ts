import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createClient} from "@libsql/client";
import {PrismaClient} from "nbook/server/generated/prisma/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {splitSqlStatements} from "nbook/scripts/db/sql-statements.mjs";
import {PrismaDispatchPreparationRepository} from "nbook/server/text-to-image/dispatch-preparation.repository";
import {prepareIllustrationExecutionRegistration} from "nbook/server/text-to-image/execution.repository";
import {illustrationRegistrationFixture} from "nbook/server/text-to-image/execution.test-fixtures";
import {toPreparedDispatchBatch} from "nbook/server/text-to-image/illustration-registration.coordinator";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";

describe("PrismaDispatchPreparationRepository", () => {
    let directory = "";
    let adapter: TrackedPrismaLibSql;
    let prisma: PrismaClient;
    let attempt = 0;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(tmpdir(), "nbook-dispatch-preparation-"));
        const databaseUrl = pathToFileURL(path.join(directory, "app.sqlite")).toString();
        const client = createClient({url: databaseUrl});
        try {
            await client.execute(`CREATE TABLE "DatabaseLock" ("key" INTEGER NOT NULL PRIMARY KEY, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
            await client.execute(`CREATE TABLE "TextToImageProvider" (
                "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "ownerUserId" INTEGER NOT NULL,
                "kind" TEXT NOT NULL,
                "name" TEXT NOT NULL,
                "baseUrl" TEXT NOT NULL,
                "model" TEXT,
                "recipeMigrationModel" TEXT,
                "credentialCiphertext" TEXT NOT NULL,
                "credentialIv" TEXT NOT NULL,
                "credentialTag" TEXT NOT NULL,
                "credentialRevision" INTEGER NOT NULL DEFAULT 1,
                "settings" JSONB NOT NULL,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`);
            const migration = await readFile("prisma/migrations/sqlite/20260721220000_text_to_image_persistent_lane/migration.sql", "utf8");
            for (const statement of splitSqlStatements(migration)) await client.execute(statement);
            await client.execute({
                sql: `INSERT INTO "TextToImageProvider" (
                    "id", "ownerUserId", "kind", "name", "baseUrl", "credentialCiphertext", "credentialIv", "credentialTag", "credentialRevision", "settings"
                ) VALUES (?, ?, 'novelai', 'NovelAI', 'https://image.novelai.net', 'cipher', 'iv', 'tag', ?, ?)` ,
                args: [11, 7, 3, JSON.stringify({allowPrivateNetwork: false, requestIntervalMs: 15_000})],
            });
        } finally {
            await client.close();
        }
        adapter = new TrackedPrismaLibSql({url: databaseUrl});
        prisma = new PrismaClient({adapter});
        attempt = 0;
    });

    afterEach(async () => {
        await prisma.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles({force: true});
        try {
            await rm(directory, {recursive: true, force: true});
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) throw error;
        }
    });

    it("creates an all-or-none inert batch and converges exact duplicate preparation", async () => {
        const repository = createRepository();
        const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(2));
        const batch = toPreparedDispatchBatch(projection);

        const first = await repository.prepare(batch);
        const duplicate = await repository.prepare(batch);

        expect(duplicate).toEqual(first);
        await expect(prisma.textToImageDispatchPreparation.count()).resolves.toBe(1);
        await expect(prisma.textToImageProviderLaneItem.count()).resolves.toBe(2);
        const items = await prisma.textToImageProviderLaneItem.findMany({orderBy: {jobId: "asc"}});
        expect(items.every((item) => item.state === "prepared" && item.prepareAttemptId === first.prepareAttemptId)).toBe(true);
    });

    it("rejects a stale provider revision without writing any preparation or item", async () => {
        const repository = createRepository();
        const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(2));
        const batch = {...toPreparedDispatchBatch(projection), providerCredentialRevision: 2};

        await expect(repository.prepare(batch)).rejects.toMatchObject({code: "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE"});
        await expect(prisma.textToImageDispatchPreparation.count()).resolves.toBe(0);
        await expect(prisma.textToImageProviderLaneItem.count()).resolves.toBe(0);
    });

    it("promotes only an exact Project closure from prepared to project_committed to ready", async () => {
        const repository = createRepository();
        const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(2));
        const batch = toPreparedDispatchBatch(projection);
        const stamp = await repository.prepare(batch);
        const receipt = {
            schemaVersion: "nbook.illustration-execution-registration-receipt/v1" as const,
            manifestId: projection.manifestId,
            executionManifestHash: projection.input.executionManifestHash,
            approvalId: projection.approvalId,
            approvalHash: projection.approvalHash,
            registrationState: "jobs_registered" as const,
            dispatchState: "dispatch_pending" as const,
            jobIds: projection.jobs.map((job) => job.id),
            dispatchKeys: projection.jobs.map((job) => job.dispatchKey),
            registeredAt: "2026-07-21T00:00:00.000Z",
        };

        await expect(repository.projectCommitted(stamp, {...receipt, dispatchKeys: [receipt.dispatchKeys[0] ?? ""]})).resolves.toBe(false);
        await expect(repository.projectCommitted(stamp, receipt)).resolves.toBe(true);
        await expect(repository.ready(stamp, receipt)).resolves.toBe(true);
        const preparation = await prisma.textToImageDispatchPreparation.findUniqueOrThrow({where: {id: stamp.preparationId}});
        expect(preparation.state).toBe("ready");
        expect((await prisma.textToImageProviderLaneItem.findMany()).every((item) => item.state === "ready")).toBe(true);
    });

    it("rearms only abandoned closure with the same identities and a higher prepareVersion", async () => {
        const repository = createRepository();
        const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(2));
        const batch = toPreparedDispatchBatch(projection);
        const first = await repository.prepare(batch);
        await prisma.textToImageDispatchPreparation.update({where: {id: first.preparationId}, data: {state: "abandoned"}});

        const rearmed = await repository.prepare(batch);

        expect(rearmed.preparationId).toBe(first.preparationId);
        expect(rearmed.prepareAttemptId).not.toBe(first.prepareAttemptId);
        expect(rearmed.prepareVersion).toBe(2);
        const items = await prisma.textToImageProviderLaneItem.findMany();
        expect(items.every((item) => item.prepareVersion === 2 && item.state === "prepared")).toBe(true);
    });

    it("claims only expired preparations and abandons with the claimed CAS snapshot", async () => {
        const repository = createRepository();
        const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(2));
        await repository.prepare(toPreparedDispatchBatch(projection));

        await expect(repository.claimExpired(10)).resolves.toEqual([]);
        const recovery = new PrismaDispatchPreparationRepository(prisma, {
            clock: () => new Date("2026-07-21T00:00:31.000Z"),
            attemptFactory: () => "unused",
            leaseMs: 30_000,
        });
        const claimed = await recovery.claimExpired(10);

        expect(claimed).toHaveLength(1);
        expect(claimed[0]).toMatchObject({state: "prepared", stateVersion: 2, prepareAttemptId: "prepare-attempt-1"});
        if (!claimed[0]) throw new Error("预期 claimed preparation");
        await expect(recovery.abandon(claimed[0])).resolves.toBe(true);
        await expect(prisma.textToImageDispatchPreparation.findUniqueOrThrow({where: {id: claimed[0].id}}))
            .resolves.toMatchObject({state: "abandoned", stateVersion: 3});
    });

    it("relocates and quarantines the entire claimed closure atomically", async () => {
        const repository = createRepository();
        const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(2));
        await repository.prepare(toPreparedDispatchBatch(projection));
        const recovery = new PrismaDispatchPreparationRepository(prisma, {
            clock: () => new Date("2026-07-21T00:00:31.000Z"),
            leaseMs: 30_000,
        });
        const [claimed] = await recovery.claimExpired(1);
        if (!claimed) throw new Error("预期 claimed preparation");

        const relocated = await recovery.relocate(claimed, "workspace/moved");
        await expect(recovery.quarantine(
            relocated,
            "TEXT_TO_IMAGE_PROJECT_UNAVAILABLE",
            "Project 暂不可达",
        )).resolves.toBe(true);

        await expect(prisma.textToImageDispatchPreparation.findUniqueOrThrow({where: {id: claimed.id}}))
            .resolves.toMatchObject({projectPath: "workspace/moved", state: "quarantined"});
        const items = await prisma.textToImageProviderLaneItem.findMany();
        expect(items.every((item) => item.projectPath === "workspace/moved"
            && item.state === "quarantined"
            && item.errorCode === "TEXT_TO_IMAGE_PROJECT_UNAVAILABLE")).toBe(true);
    });

    function createRepository(): PrismaDispatchPreparationRepository {
        return new PrismaDispatchPreparationRepository(prisma, {
            clock: () => new Date("2026-07-21T00:00:00.000Z"),
            attemptFactory: () => `prepare-attempt-${String(++attempt)}`,
            leaseMs: 30_000,
        });
    }
});
