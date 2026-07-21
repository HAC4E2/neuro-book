import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createClient} from "@libsql/client";
import {PrismaClient} from "nbook/server/generated/prisma/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {splitSqlStatements} from "nbook/scripts/db/sql-statements.mjs";
import {ProviderLaneRepository} from "nbook/server/text-to-image/provider-lane.repository";
import {createProviderRevisionInvalidationId} from "nbook/server/text-to-image/provider-revision-invalidation";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";

const H = (digit: string): string => `sha256:${digit.repeat(64)}`;

describe("ProviderLaneRepository", () => {
    let directory = "";
    let adapter: TrackedPrismaLibSql;
    let prisma: PrismaClient;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(tmpdir(), "nbook-provider-lane-"));
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
                args: [11, 7, 3, JSON.stringify({allowPrivateNetwork: false, requestIntervalMs: 0})],
            });
        } finally {
            await client.close();
        }
        adapter = new TrackedPrismaLibSql({url: databaseUrl});
        prisma = new PrismaClient({adapter});
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

    it("allows only one coordinator to lease the oldest item in one owner/provider lane", async () => {
        await seedReadyItems(2);
        const left = repositoryAt("2026-07-21T00:00:00.000Z", "left");
        const right = repositoryAt("2026-07-21T00:00:00.000Z", "right");

        const claims = await Promise.all([left.claimReady(), right.claimReady()]);

        expect(claims.filter(Boolean)).toHaveLength(1);
        expect(claims.find(Boolean)?.jobId).toBe("job-1");
        await expect(prisma.textToImageProviderLaneItem.count({where: {state: "leased"}})).resolves.toBe(1);
    });

    it("filters blocked lanes in SQLite so 1000 throttled items cannot starve a later eligible Provider lane", async () => {
        await prisma.textToImageProvider.create({
            data: {
                id: 12,
                ownerUserId: 8,
                kind: "novelai",
                name: "NovelAI second owner",
                baseUrl: "https://image.novelai.net",
                credentialCiphertext: "eligible-cipher",
                credentialIv: "iv",
                credentialTag: "tag",
                credentialRevision: 3,
                settings: {allowPrivateNetwork: false, requestIntervalMs: 0},
            },
        });
        const preparations = Array.from({length: 1001}, (_, index) => ({
            id: `page-preparation-${String(index)}`,
            manifestHash: hashFor(index + 1),
            ownerUserId: index < 1000 ? 7 : 8,
            providerId: index < 1000 ? 11 : 12,
            providerCredentialRevision: 3,
            projectId: `page-project-${String(index)}`,
            projectPath: `workspace/page-${String(index)}`,
            prepareAttemptId: `page-prepare-${String(index)}`,
            prepareLeaseUntil: new Date("2099-07-21T00:00:00.000Z"),
            prepareVersion: 1,
            stateVersion: 2,
            state: "ready" as const,
            jobIdsJson: JSON.stringify([`page-job-${String(index)}`]),
            dispatchKeysJson: JSON.stringify([hashFor(index + 200)]),
            createdAt: new Date(1_700_000_000_000 + index),
        }));
        await prisma.textToImageDispatchPreparation.createMany({data: preparations});
        await prisma.textToImageProviderLaneItem.createMany({
            data: preparations.map((preparation, index) => ({
                dispatchKey: hashFor(index + 200),
                preparationId: preparation.id,
                jobId: `page-job-${String(index)}`,
                ownerUserId: preparation.ownerUserId,
                providerId: preparation.providerId,
                providerCredentialRevision: 3,
                projectId: preparation.projectId,
                projectPath: preparation.projectPath,
                manifestHash: preparation.manifestHash,
                prepareAttemptId: preparation.prepareAttemptId,
                prepareVersion: 1,
                state: "ready" as const,
                stateVersion: 2,
                createdAt: preparation.createdAt,
            })),
        });
        await prisma.textToImageProviderThrottle.create({
            data: {ownerUserId: 7, providerId: 11, nextAllowedAt: new Date("2099-07-21T00:00:00.000Z")},
        });

        await expect(repositoryAt("2026-07-21T00:00:00.000Z", "paged").claimReady()).resolves.toMatchObject({
            ownerUserId: 8,
            providerId: 12,
            state: "leased",
        });
    });

    it("persists the 15 second minimum across completion and repository restart", async () => {
        await seedReadyItems(2);
        const firstRepository = repositoryAt("2026-07-21T00:00:00.000Z", "first");
        const firstClaim = await firstRepository.claimReady();
        if (!firstClaim) throw new Error("预期第一条 claim");
        const firstAttempt = await firstRepository.startAttempt(firstClaim);
        if (!firstAttempt) throw new Error("预期第一条 attempt");
        await expect(firstRepository.complete(firstAttempt.item)).resolves.toBe(true);

        await expect(repositoryAt("2026-07-21T00:00:14.999Z", "early").claimReady()).resolves.toBeNull();
        const secondRepository = repositoryAt("2026-07-21T00:00:15.000Z", "second");
        const secondClaim = await secondRepository.claimReady();
        if (!secondClaim) throw new Error("预期第二条 claim");
        const secondAttempt = await secondRepository.startAttempt(secondClaim);

        expect(secondAttempt?.item.sendFence).toBe(2);
        if (!secondAttempt) throw new Error("预期第二条 attempt");
        await expect(secondRepository.complete(secondAttempt.item)).resolves.toBe(true);
        const throttle = await prisma.textToImageProviderThrottle.findUniqueOrThrow({
            where: {ownerUserId_providerId: {ownerUserId: 7, providerId: 11}},
        });
        expect(throttle.nextAllowedAt.toISOString()).toBe("2026-07-21T00:00:30.000Z");
        await expect(repositoryAt("2026-07-21T00:00:30.000Z", "cleanup").cleanupIdle(10)).resolves.toBe(1);
        await expect(prisma.textToImageProviderThrottle.count()).resolves.toBe(0);
    });

    it("uses a longer configured interval and never overlaps a long active request", async () => {
        await prisma.textToImageProvider.update({
            where: {id: 11},
            data: {settings: {allowPrivateNetwork: false, requestIntervalMs: 30_000}},
        });
        await seedReadyItems(2);
        const firstRepository = repositoryAt("2026-07-21T00:00:00.000Z", "first");
        const claim = await firstRepository.claimReady();
        if (!claim) throw new Error("预期 claim");
        const attempt = await firstRepository.startAttempt(claim);
        if (!attempt) throw new Error("预期 attempt");

        await expect(repositoryAt("2026-07-21T00:00:40.000Z", "overlap").claimReady()).resolves.toBeNull();
        await expect(firstRepository.complete(attempt.item)).resolves.toBe(true);
        await expect(repositoryAt("2026-07-21T00:00:29.999Z", "early").claimReady()).resolves.toBeNull();
        await expect(repositoryAt("2026-07-21T00:00:30.000Z", "next").claimReady()).resolves.not.toBeNull();
    });

    it("recovers a leased crash to ready but an expired attempt_started only to outcome_unknown", async () => {
        await seedReadyItems(2);
        const repository = repositoryAt("2026-07-21T00:00:00.000Z", "initial", {claimLeaseMs: 5_000, sendLeaseMs: 10_000});
        const leased = await repository.claimReady();
        if (!leased) throw new Error("预期 leased item");
        const firstRecovery = repositoryAt("2026-07-21T00:00:06.000Z", "recover-lease");

        await expect(firstRecovery.recoverExpired(10)).resolves.toEqual({leasedRecovered: 1, attemptsRetried: 0, attemptsUnknown: 0});
        const claimedAgain = await firstRecovery.claimReady();
        if (!claimedAgain) throw new Error("预期重新 claim");
        const attempt = await firstRecovery.startAttempt(claimedAgain);
        if (!attempt) throw new Error("预期 attempt_started");
        const secondRecovery = repositoryAt("2026-07-21T00:02:07.000Z", "recover-attempt");

        await expect(secondRecovery.recoverExpired(10)).resolves.toEqual({leasedRecovered: 0, attemptsRetried: 0, attemptsUnknown: 1});
        await expect(prisma.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: attempt.item.dispatchKey}}))
            .resolves.toMatchObject({state: "outcome_unknown", claimId: null, errorCode: "TEXT_TO_IMAGE_OUTCOME_UNKNOWN"});
    });

    it("mirrors a matching Project terminal after an App post-result crash", async () => {
        await seedReadyItems(1);
        const repository = repositoryAt("2026-07-21T00:00:00.000Z", "initial", {sendLeaseMs: 10_000});
        const claim = await repository.claimReady();
        if (!claim) throw new Error("预期 claim");
        const attempt = await repository.startAttempt(claim);
        if (!attempt) throw new Error("预期 attempt");
        const recovery = repositoryAt("2026-07-21T00:00:11.000Z", "recovery");

        await expect(recovery.recoverExpiredWith(10, async () => ({kind: "completed"}))).resolves.toEqual({
            leasedRecovered: 0,
            attemptsRetried: 0,
            attemptsUnknown: 0,
        });
        await expect(prisma.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: attempt.item.dispatchKey}}))
            .resolves.toMatchObject({state: "completed", claimId: null});
    });

    it("captures the credential inside the start fence and keeps a 503 retry on the persistent throttle", async () => {
        await seedReadyItems(1);
        const first = repositoryAt("2026-07-21T00:00:00.000Z", "first");
        const claim = await first.claimReady();
        if (!claim) throw new Error("预期 claim");
        const start = await first.startAttempt(claim);
        if (!start) throw new Error("预期 start");
        if (start.kind !== "started") throw new Error("预期凭据成功解密");
        expect(start.credential).toBe("cipher");

        await prisma.textToImageProvider.update({where: {id: 11}, data: {credentialCiphertext: "new-cipher", credentialRevision: 4}});
        expect(start.credential).toBe("cipher");
        await prisma.textToImageProvider.update({where: {id: 11}, data: {credentialRevision: 3}});
        await expect(first.retry(start.item, "NOVELAI_HTTP_503", "NovelAI 请求失败：503")).resolves.toBe("retry_wait");
        await expect(prisma.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: start.item.dispatchKey}}))
            .resolves.toMatchObject({state: "retry_wait", sendFence: 1, errorCode: "NOVELAI_HTTP_503"});
        await expect(repositoryAt("2026-07-21T00:00:14.999Z", "early").claimReady()).resolves.toBeNull();

        const retryClaim = await repositoryAt("2026-07-21T00:00:15.000Z", "retry").claimReady();
        expect(retryClaim?.state).toBe("retry_leased");
        if (!retryClaim) throw new Error("预期 retry claim");
        const retryStart = await repositoryAt("2026-07-21T00:00:15.000Z", "retry-start").startAttempt(retryClaim);
        if (retryStart?.kind !== "started") throw new Error("预期 retry start");
        expect(retryStart?.item).toMatchObject({state: "attempt_started", sendFence: 2, attemptCount: 2, errorCode: null});
        expect(retryStart?.credential).toBe("new-cipher");
    });

    it("turns a post-replacement 503 settlement into configuration stale and creates the missing exact Project saga", async () => {
        await seedReadyItems(1);
        const repository = repositoryAt("2026-07-21T00:00:00.000Z", "revision-race");
        const claim = await repository.claimReady();
        if (!claim) throw new Error("预期 claim");
        const start = await repository.startAttempt(claim);
        if (!start || start.kind !== "started") throw new Error("预期 started");
        await prisma.textToImageProvider.update({where: {id: 11}, data: {credentialRevision: 4}});

        await expect(repository.retry(start.item, "NOVELAI_HTTP_503", "NovelAI 请求失败：503"))
            .resolves.toBe("configuration_stale");
        await expect(prisma.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: start.item.dispatchKey}}))
            .resolves.toMatchObject({state: "quarantined", errorCode: "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE"});
        await expect(prisma.textToImageProviderThrottle.findUniqueOrThrow({
            where: {ownerUserId_providerId: {ownerUserId: 7, providerId: 11}},
        })).resolves.toMatchObject({activeAttemptId: null, fencingVersion: 1});
        await expect(prisma.textToImageProviderRevisionInvalidation.findMany()).resolves.toMatchObject([{
            ownerUserId: 7,
            providerId: 11,
            oldRevision: 3,
            newRevision: 4,
            projectId: "project-1",
            projectPath: "workspace/project-1",
            state: "pending",
        }]);
    });

    it("reopens an already completed Project revision saga when a later in-flight job becomes stale", async () => {
        await seedReadyItems(1);
        const repository = repositoryAt("2026-07-21T00:00:00.000Z", "completed-saga-race");
        const claim = await repository.claimReady();
        if (!claim) throw new Error("预期 claim");
        const start = await repository.startAttempt(claim);
        if (!start || start.kind !== "started") throw new Error("预期 started");
        await prisma.textToImageProvider.update({where: {id: 11}, data: {credentialRevision: 4}});
        const identity = {
            ownerUserId: 7,
            providerId: 11,
            oldRevision: 3,
            newRevision: 4,
            projectId: "project-1",
        };
        const invalidationId = createProviderRevisionInvalidationId(identity);
        await prisma.textToImageProviderRevisionInvalidation.create({
            data: {
                id: invalidationId,
                ...identity,
                projectPath: "workspace/project-1-before-move",
                state: "completed",
                attemptCount: 2,
                lastError: "previous transient failure",
            },
        });

        await expect(repository.retry(start.item, "NOVELAI_HTTP_503", "NovelAI 请求失败：503"))
            .resolves.toBe("configuration_stale");
        await expect(prisma.textToImageProviderRevisionInvalidation.findUniqueOrThrow({where: {id: invalidationId}}))
            .resolves.toMatchObject({
                projectPath: "workspace/project-1",
                state: "pending",
                attemptCount: 2,
                lastError: null,
            });
    });

    it("builds the revision saga identity independently from caller property insertion order", () => {
        const canonical = createProviderRevisionInvalidationId({
            ownerUserId: 7,
            providerId: 11,
            oldRevision: 3,
            newRevision: 4,
            projectId: "project-1",
        });
        const reordered = createProviderRevisionInvalidationId({
            projectId: "project-1",
            newRevision: 4,
            oldRevision: 3,
            providerId: 11,
            ownerUserId: 7,
        });

        expect(reordered).toBe(canonical);
    });

    it("keeps a credential opener failure leased until Project terminal propagation succeeds", async () => {
        await seedReadyItems(1);
        const repository = new ProviderLaneRepository(prisma, {
            clock: () => new Date("2026-07-21T00:00:00.000Z"),
            claimFactory: () => "claim-invalid-credential",
            credentialOpener: async () => { throw new Error("credential authentication failed"); },
        });
        const claim = await repository.claimReady();
        if (!claim) throw new Error("预期 claim");

        await expect(repository.startAttempt(claim)).resolves.toMatchObject({
            kind: "configuration_error",
            code: "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID",
            message: "credential authentication failed",
        });
        await expect(prisma.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: claim.dispatchKey}}))
            .resolves.toMatchObject({state: "leased", claimId: "claim-invalid-credential", errorCode: null});
        await expect(prisma.textToImageProviderThrottle.count()).resolves.toBe(0);
    });

    async function seedReadyItems(count: number): Promise<void> {
        for (let index = 0; index < count; index += 1) {
            const suffix = String(index + 1);
            await prisma.textToImageDispatchPreparation.create({
                data: {
                    id: `preparation-${suffix}`,
                    manifestHash: H(suffix),
                    ownerUserId: 7,
                    providerId: 11,
                    providerCredentialRevision: 3,
                    projectId: `project-${suffix}`,
                    projectPath: `workspace/project-${suffix}`,
                    prepareAttemptId: `prepare-${suffix}`,
                    prepareLeaseUntil: new Date("2099-07-21T00:00:00.000Z"),
                    prepareVersion: 1,
                    stateVersion: 2,
                    state: "ready",
                    jobIdsJson: JSON.stringify([`job-${suffix}`]),
                    dispatchKeysJson: JSON.stringify([H(suffix === "1" ? "a" : "b")]),
                    createdAt: new Date(`2026-07-21T00:00:0${suffix}.000Z`),
                    laneItems: {
                        create: {
                            dispatchKey: H(suffix === "1" ? "a" : "b"),
                            jobId: `job-${suffix}`,
                            ownerUserId: 7,
                            providerId: 11,
                            providerCredentialRevision: 3,
                            projectId: `project-${suffix}`,
                            projectPath: `workspace/project-${suffix}`,
                            manifestHash: H(suffix),
                            prepareAttemptId: `prepare-${suffix}`,
                            prepareVersion: 1,
                            state: "ready",
                            stateVersion: 2,
                            createdAt: new Date(`2026-07-21T00:00:0${suffix}.000Z`),
                        },
                    },
                },
            });
        }
    }

    function repositoryAt(
        timestamp: string,
        identity: string,
        options: {claimLeaseMs?: number; sendLeaseMs?: number} = {},
    ): ProviderLaneRepository {
        let attempt = 0;
        return new ProviderLaneRepository(prisma, {
            clock: () => new Date(timestamp),
            claimFactory: () => `claim-${identity}-${String(++attempt)}`,
            attemptFactory: () => `attempt-${identity}-${String(++attempt)}`,
            claimLeaseMs: options.claimLeaseMs,
            sendLeaseMs: options.sendLeaseMs,
            credentialOpener: async (credential) => credential.ciphertext,
        });
    }
});

/** 为分页夹具生成互不冲突的合法 contract hash。 */
function hashFor(value: number): string {
    return `sha256:${value.toString(16).padStart(64, "0")}`;
}
