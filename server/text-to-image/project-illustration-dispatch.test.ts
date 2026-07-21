import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {ProviderLaneItemSnapshot} from "nbook/shared/text-to-image-dispatch";
import {
    IllustrationExecutionRepository,
    prepareIllustrationExecutionRegistration,
    type PreparedIllustrationRegistration,
} from "nbook/server/text-to-image/execution.repository";
import {illustrationRegistrationFixture} from "nbook/server/text-to-image/execution.test-fixtures";
import {NovelAiHttpError} from "nbook/server/text-to-image/novelai-image-generation";
import {
    ProjectIllustrationDispatch,
    type ProjectResultWriteInput,
} from "nbook/server/text-to-image/project-illustration-dispatch";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabaseAtRoot, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";

describe("ProjectIllustrationDispatch", () => {
    let root = "";
    let adapter: TrackedPrismaLibSql;
    let prisma: PrismaClient;
    let projection: PreparedIllustrationRegistration;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-project-illustration-dispatch-"));
        const databasePath = await initProjectDatabaseAtRoot(root);
        adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
        prisma = new PrismaClient({adapter});
        projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(1));
        await new IllustrationExecutionRepository(prisma).register(projection, {
            preparationId: projection.preparationId,
            prepareAttemptId: "prepare-attempt-1",
            prepareLeaseUntil: "2099-07-21T00:00:30.000Z",
            prepareVersion: 1,
        });
    });

    afterEach(async () => {
        await prisma.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles({force: true});
        try {
            await fs.rm(root, {recursive: true, force: true});
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) throw error;
        }
    });

    it("preflights exact Project closure and executes the strict adapter once with matching fence", async () => {
        const requestImage = vi.fn(async () => ({
            image: {bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const, width: 832, height: 1216, seed: 100},
            request: {model: "nai-diffusion-4-5-full", seed: 100, compiledRequestHash: projection.jobs[0]!.request.compiledRequestHash},
        }));
        const writeResult = vi.fn(async ({client, item}: ProjectResultWriteInput) => {
            await client.textToImageJob.update({where: {id: item.jobId}, data: {status: "succeeded", finishedAt: new Date()}});
            return "completed" as const;
        });
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
            writeResult,
        });

        await expect(dispatch.preflight(item("leased"))).resolves.toEqual({kind: "valid"});
        await expect(dispatch.execute(item("attempt_started"), "captured-token")).resolves.toEqual({kind: "completed"});
        expect(requestImage).toHaveBeenCalledTimes(1);
        expect(requestImage.mock.calls[0]?.[0]).toEqual(projection.jobs[0]?.request);
        expect(requestImage.mock.calls[0]?.[1]).toBe("captured-token");
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({status: "succeeded", activeAttemptId: "attempt-1", activeAttemptFence: 1});
        await expect(dispatch.inspectExpiredAttempt(item("attempt_started"))).resolves.toEqual({kind: "completed"});
    });

    it("rejects a stale prepareVersion before start and never calls the adapter", async () => {
        await prisma.textToImageDispatchOutbox.update({
            where: {jobId: projection.jobs[0]!.id},
            data: {prepareVersion: 0},
        });
        const requestImage = vi.fn();
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
        });

        await expect(dispatch.preflight(item("leased"))).resolves.toMatchObject({
            kind: "invalid",
            code: "TEXT_TO_IMAGE_PROJECT_JOB_STALE",
        });
        expect(requestImage).not.toHaveBeenCalled();
    });

    it("persists a paid-boundary credential failure as Project configuration stale", async () => {
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
        });

        await expect(dispatch.configurationError(
            item("leased"),
            "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID",
            "Provider 凭据无法解密",
        )).resolves.toBeUndefined();
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({
                status: "configuration_stale",
                stableErrorCode: "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID",
                errorMessage: "Provider 凭据无法解密",
            });
    });

    it("persists explicit HTTP failure and does not retry inside the adapter", async () => {
        const requestImage = vi.fn(async () => { throw new NovelAiHttpError(503); });
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
        });

        await expect(dispatch.execute(item("attempt_started"), "captured-token")).resolves.toEqual({
            kind: "retryable",
            code: "NOVELAI_HTTP_503",
            message: "NovelAI 请求失败：503",
        });
        expect(requestImage).toHaveBeenCalledTimes(1);
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({status: "queued", activeAttemptId: "attempt-1", activeAttemptFence: 1, stableErrorCode: "NOVELAI_HTTP_503"});
        await expect(dispatch.inspectExpiredAttempt(item("attempt_started"))).resolves.toEqual({
            kind: "retryable",
            code: "NOVELAI_HTTP_503",
            message: "NovelAI 请求失败：503",
        });

        await expect(dispatch.preflight(item("retry_leased"))).resolves.toEqual({kind: "valid"});
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({status: "queued", activeAttemptId: null, activeAttemptFence: null, stableErrorCode: null});
    });

    function item(state: "leased" | "retry_leased" | "attempt_started"): ProviderLaneItemSnapshot {
        const job = projection.jobs[0]!;
        const started = state === "attempt_started";
        const retry = state === "retry_leased";
        return {
            schemaVersion: "nbook.text-to-image-provider-lane-item/v1",
            dispatchKey: job.dispatchKey,
            preparationId: projection.preparationId,
            jobId: job.id,
            ownerUserId: 7,
            providerId: 11,
            providerCredentialRevision: 3,
            projectId: "project-1",
            projectPath: "workspace/demo",
            manifestHash: projection.input.executionManifestHash,
            prepareAttemptId: "prepare-attempt-1",
            prepareVersion: 1,
            state,
            stateVersion: retry ? 6 : started ? 4 : 3,
            claimId: "claim-1",
            claimLeaseUntil: "2099-07-21T00:00:30.000Z",
            sendAttemptId: started || retry ? "attempt-1" : null,
            sendLeaseUntil: started || retry ? "2099-07-21T00:02:00.000Z" : null,
            sendFence: started || retry ? 1 : null,
            attemptCount: started || retry ? 1 : 0,
            errorCode: retry ? "NOVELAI_HTTP_503" : null,
            errorMessage: retry ? "NovelAI 请求失败：503" : null,
            createdAt: "2026-07-21T00:00:00.000Z",
            updatedAt: "2026-07-21T00:00:00.000Z",
        };
    }
});
