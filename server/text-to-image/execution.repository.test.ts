import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    createIllustrationCompiledRequestHash,
    createIllustrationExecutionManifestHash,
    type IllustrationCompiledRequest,
} from "nbook/shared/text-to-image-execution";
import {resolveProviderCapability} from "nbook/shared/text-to-image-provider-registry";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";
import {
    IllustrationExecutionRepository,
    prepareIllustrationExecutionRegistration,
    type PreparedIllustrationRegistration,
} from "nbook/server/text-to-image/execution.repository";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabaseAtRoot, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";

const H = (digit: string): string => `sha256:${digit.repeat(64)}`;

describe("IllustrationExecutionRepository", () => {
    let root = "";
    let adapter: TrackedPrismaLibSql;
    let client: PrismaClient;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-illustration-execution-"));
        const databasePath = await initProjectDatabaseAtRoot(root);
        adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
        client = new PrismaClient({adapter});
    });

    afterEach(async () => {
        await client.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles({force: true});
        await fs.rm(root, {recursive: true, force: true});
    });

    it("atomically registers one immutable manifest, approval, every Job and dispatch outbox", async () => {
        const repository = new IllustrationExecutionRepository(client);
        const input = registrationFixture(2);
        const prepared = prepareIllustrationExecutionRegistration(input);
        const receipt = await repository.register(prepared, preparationStamp(prepared));

        expect(receipt).toMatchObject({
            executionManifestHash: input.executionManifestHash,
            registrationState: "jobs_registered",
            jobIds: expect.any(Array),
            dispatchKeys: expect.any(Array),
        });
        expect(receipt.jobIds).toHaveLength(2);
        expect(receipt.dispatchKeys).toHaveLength(2);
        await expect(client.illustrationExecutionManifest.count()).resolves.toBe(1);
        await expect(client.illustrationExecutionApproval.count()).resolves.toBe(1);
        await expect(client.textToImageJob.count()).resolves.toBe(2);
        await expect(client.textToImageDispatchOutbox.count()).resolves.toBe(2);
        const jobs = await client.textToImageJob.findMany({orderBy: {outputIndex: "asc"}});
        expect(jobs.map((job) => ({
            kind: job.kind,
            providerOwnerUserId: job.providerOwnerUserId,
            providerCredentialRevision: job.providerCredentialRevision,
            executionManifestId: job.executionManifestId,
            sourceInsertStatus: job.sourceInsertStatus,
        }))).toEqual([
            expect.objectContaining({kind: "illustration", providerOwnerUserId: 7, providerCredentialRevision: 3, sourceInsertStatus: "pending"}),
            expect.objectContaining({kind: "illustration", providerOwnerUserId: 7, providerCredentialRevision: 3, sourceInsertStatus: "pending"}),
        ]);
        expect(JSON.parse(jobs[0]?.requestJson ?? "null")).toEqual(input.compiledRequests[0]);
    });

    it("rolls back every record when registration fails after approval creation", async () => {
        const repository = new IllustrationExecutionRepository(client, {
            onStage(stage) {
                if (stage === "approval_created") throw new Error("injected registration failure");
            },
        });

        const prepared = prepareIllustrationExecutionRegistration(registrationFixture(2));
        await expect(repository.register(prepared, preparationStamp(prepared))).rejects.toThrow("injected registration failure");
        await expect(client.illustrationExecutionManifest.count()).resolves.toBe(0);
        await expect(client.illustrationExecutionApproval.count()).resolves.toBe(0);
        await expect(client.textToImageJob.count()).resolves.toBe(0);
        await expect(client.textToImageDispatchOutbox.count()).resolves.toBe(0);
    });

    it("rolls back a late Project commit after the prepare lease is lost", async () => {
        let now = new Date("2026-07-21T00:00:00.000Z");
        const repository = new IllustrationExecutionRepository(client, {
            clock: () => now,
            onStage(stage) {
                if (stage === "outbox_created") now = new Date("2026-07-21T00:00:31.000Z");
            },
        });
        const prepared = prepareIllustrationExecutionRegistration(registrationFixture(2));
        const stamp = {
            preparationId: prepared.preparationId,
            prepareAttemptId: "prepare-attempt-late",
            prepareLeaseUntil: "2026-07-21T00:00:30.000Z",
            prepareVersion: 1,
        };

        await expect(repository.register(prepared, stamp)).rejects.toThrow("prepare lease 已失效");
        await expect(client.illustrationExecutionManifest.count()).resolves.toBe(0);
        await expect(client.textToImageJob.count()).resolves.toBe(0);
        await expect(client.textToImageDispatchOutbox.count()).resolves.toBe(0);
    });

    it("returns the same receipt for the same manifest/dispatch identity", async () => {
        const repository = new IllustrationExecutionRepository(client);
        const input = registrationFixture(2);
        const prepared = prepareIllustrationExecutionRegistration(input);
        const stamp = preparationStamp(prepared);
        const first = await repository.register(prepared, stamp);
        const duplicate = await repository.register(
            prepareIllustrationExecutionRegistration({...input, approvedAt: "2026-07-21T00:01:00.000Z"}),
            stamp,
        );

        expect(duplicate).toEqual(first);
        await expect(client.illustrationExecutionManifest.count()).resolves.toBe(1);
        await expect(client.illustrationExecutionApproval.count()).resolves.toBe(1);
        await expect(client.textToImageJob.count()).resolves.toBe(2);
        await expect(client.textToImageDispatchOutbox.count()).resolves.toBe(2);
    });

    it("immediately rebinds a complete late Project commit to the current prepare version", async () => {
        const repository = new IllustrationExecutionRepository(client);
        const prepared = prepareIllustrationExecutionRegistration(registrationFixture(2));
        const oldStamp = preparationStamp(prepared);
        const first = await repository.register(prepared, oldStamp);
        const currentStamp = {...oldStamp, prepareAttemptId: "prepare-attempt-2", prepareVersion: 2};

        await expect(repository.register(prepared, currentStamp)).resolves.toEqual(first);
        const outboxes = await client.textToImageDispatchOutbox.findMany({orderBy: {jobId: "asc"}});
        expect(outboxes).toHaveLength(2);
        expect(outboxes.every((outbox) => outbox.prepareAttemptId === "prepare-attempt-2" && outbox.prepareVersion === 2)).toBe(true);
    });

    it("rejects mixed old prepare versions instead of partially rebinding a Project closure", async () => {
        const repository = new IllustrationExecutionRepository(client);
        const prepared = prepareIllustrationExecutionRegistration(registrationFixture(2));
        const oldStamp = preparationStamp(prepared);
        await repository.register(prepared, oldStamp);
        await client.textToImageDispatchOutbox.update({
            where: {jobId: prepared.jobs[0]!.id},
            data: {prepareAttemptId: "mixed-attempt", prepareVersion: 2},
        });

        await expect(repository.register(prepared, {...oldStamp, prepareAttemptId: "prepare-attempt-3", prepareVersion: 3}))
            .rejects.toThrow("注册闭包不完整");
        const outboxes = await client.textToImageDispatchOutbox.findMany({orderBy: {jobId: "asc"}});
        expect(new Set(outboxes.map((outbox) => outbox.prepareVersion))).toEqual(new Set([1, 2]));
    });

    it("reuses the original receipt when a new preview manifest resolves to the same dispatch identities", async () => {
        const repository = new IllustrationExecutionRepository(client);
        const input = registrationFixture(2);
        const prepared = prepareIllustrationExecutionRegistration(input);
        const stamp = preparationStamp(prepared);
        const first = await repository.register(prepared, stamp);
        const replayInputHashes = [H("8"), H("9")];
        const recipeSnapshot = input.compiledRequests[0]?.recipeSnapshot;
        if (!recipeSnapshot) throw new Error("测试 fixture 缺少 Recipe snapshot");
        const replayManifestHash = createIllustrationExecutionManifestHash({
            executionInputHashes: replayInputHashes,
            recipeSnapshot,
            compiledRequests: input.compiledRequests,
            outputCount: input.outputCount,
            knownCost: input.knownCost,
            tokenLowerBound: input.tokenLowerBound,
        });

        const replay = await repository.register(prepareIllustrationExecutionRegistration({
            ...input,
            executionNonce: "nonce-2",
            executionInputHashes: replayInputHashes,
            executionManifestHash: replayManifestHash,
            approvedAt: "2026-07-21T00:02:00.000Z",
        }), stamp);

        expect(replay).toEqual(first);
        await expect(client.illustrationExecutionManifest.count()).resolves.toBe(1);
        await expect(client.illustrationExecutionApproval.count()).resolves.toBe(1);
        await expect(client.textToImageJob.count()).resolves.toBe(2);
        await expect(client.textToImageDispatchOutbox.count()).resolves.toBe(2);
    });
});

/** Project 注册测试共享的有效 App preparation identity。 */
function preparationStamp(projection: PreparedIllustrationRegistration) {
    return {
        preparationId: projection.preparationId,
        prepareAttemptId: "prepare-attempt-1",
        prepareLeaseUntil: "2099-07-21T00:10:00.000Z",
        prepareVersion: 1,
    };
}

/** 构造两个不同 placeholder、共享 Recipe/Provider 的完整注册输入。 */
function registrationFixture(outputCount: number) {
    const compiledRequests = Array.from({length: outputCount}, (_, outputIndex) => compiledRequest(outputIndex));
    const executionInputHashes = compiledRequests.map((request, outputIndex) => hashTextToImageContract({
        schemaVersion: "test.execution-input/v1",
        source: request.source,
        outputIndex,
        seed: request.parameters.seed,
    }));
    const recipeSnapshot = compiledRequests[0]?.recipeSnapshot;
    if (!recipeSnapshot) throw new Error("测试 fixture 缺少 Recipe snapshot");
    const executionManifestHash = createIllustrationExecutionManifestHash({
        executionInputHashes,
        recipeSnapshot,
        compiledRequests,
        outputCount,
        knownCost: null,
        tokenLowerBound: null,
    });
    return {
        projectPath: "workspace/demo",
        targetHash: H("f"),
        executionNonce: "nonce-1",
        executionInputHashes,
        executionManifestHash,
        compiledRequests,
        outputCount,
        knownCost: null,
        tokenLowerBound: null,
        authorization: {authorizedOutputCount: outputCount, authorizedCostLimit: null, authorizedTokenLimit: null},
        actorUserId: 7,
        approvedAt: "2026-07-21T00:00:00.000Z",
    };
}

/** 最小合法、可自校验的 button CompiledRequest。 */
function compiledRequest(outputIndex: number): IllustrationCompiledRequest {
    const recipeSnapshot = createTextToImageRecipeSnapshot(createDefaultTextToImageRecipeSource());
    const source = {
        projectId: "project-1",
        chapterPath: `manuscript/v1/c${String(outputIndex + 1)}/index.md`,
        placeholderId: `placeholder-${String(outputIndex + 1)}`,
        shotId: `shot-${String(outputIndex + 1)}`,
        shotOrigin: "chapter-plan" as const,
        anchorId: `p_000${String(outputIndex + 1)}_abcdef12`,
        shotIntentHash: H("a"),
        sourceChapterHash: H("b"),
    };
    const base = {
        schemaVersion: "nbook.illustration-compiled-request/v1" as const,
        compilerVersion: "route-b-compiler-v1",
        executionPolicyVersion: "route-b-execution-v1",
        providerKind: "novelai" as const,
        source,
        provider: {ownerUserId: 7, providerId: 11, credentialRevision: 3},
        capabilitySnapshot: resolveProviderCapability({kind: "novelai-model", modelId: "nai-diffusion-4-5-full"}),
        model: "nai-diffusion-4-5-full" as const,
        action: "generate" as const,
        prompt: "rain",
        negativePrompt: "lowres",
        characterPrompts: [],
        parameters: {
            sampler: "k_euler_ancestral",
            noiseSchedule: "karras",
            steps: 28,
            promptGuidance: 5,
            promptGuidanceRescale: 0,
            width: 832,
            height: 1216,
            seed: outputIndex + 100,
            count: 1 as const,
            aiDefaultCharacterPosition: true,
            variety: false,
            smeaMode: "auto" as const,
            smeaDyn: false,
            decrisper: false,
            qualityToggle: true,
            ucPreset: 4,
        },
        recipeSnapshot,
        references: {normalizeVibeStrengths: true, vibeReferences: [], characterReferences: [], inpaint: null},
        expansion: {
            patternSnapshots: [],
            characterSnapshots: [],
            resolutionValidationHash: H("e"),
            positive: [],
            negative: [],
            characters: [],
        },
    };
    return {...base, compiledRequestHash: createIllustrationCompiledRequestHash(base)};
}
