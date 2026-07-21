import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    IllustrationPlanningInputBundleSchema,
    createIllustrationPlanningInputHash,
    createIllustrationPlanningRequestHash,
    type IllustrationPlanningInputBundle,
} from "nbook/shared/text-to-image-illustration-workflow";
import {IllustrationWorkflowService} from "nbook/server/text-to-image/illustration-workflow.service";
import {IllustrationWorkflowRepository} from "nbook/server/text-to-image/illustration-workflow.repository";
import {createIllustrationPlanningTestBundle} from "nbook/server/text-to-image/illustration-planning-test-fixture";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabaseAtRoot, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

describe("IllustrationWorkflowService", () => {
    let root = "";
    let adapter: TrackedPrismaLibSql;
    let client: PrismaClient;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-illustration-service-"));
        const databasePath = await initProjectDatabaseAtRoot(root);
        adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
        client = new PrismaClient({adapter});
        await client.projectMetadata.update({where: {key: "projectId"}, data: {value: "project-1"}});
    });

    afterEach(async () => {
        await client.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles({force: true});
        await fs.rm(root, {recursive: true, force: true});
    });

    it("atomically reuses duplicate starts and returns only the public preview projection", async () => {
        const bundle = createIllustrationPlanningTestBundle();
        const tick = vi.fn(async () => 0);
        const recoverApply = vi.fn(async () => undefined);
        const service = new IllustrationWorkflowService({
            builder: {build: vi.fn(async () => bundle), rebuild: vi.fn(async () => bundle)},
            client: async () => client,
            readConcurrency: async () => 2,
            createScheduler: () => ({tick}),
            createPlanningApply: () => ({recoverProject: recoverApply}),
        });
        const request = {
            projectPath: "workspace/demo",
            chapterPath: bundle.requestIdentity.chapterPath,
            operation: "plan-chapter" as const,
            userIntent: "",
            replan: null,
        };

        const first = await service.start(request);
        const second = await service.start(request);

        expect(second.id).toBe(first.id);
        expect(first).toMatchObject({status: "queued", queuePosition: 1, attempts: [], validatedPlan: null});
        expect(tick).toHaveBeenCalledWith({projectPath: "workspace/demo", projectId: "project-1", concurrency: 2});
        expect(recoverApply).toHaveBeenCalledOnce();
        expect(JSON.stringify(first)).not.toContain("requestIdentity");
        expect(await service.list({projectPath: "workspace/demo", chapterPath: bundle.requestIdentity.chapterPath})).toHaveLength(1);
    });

    it("recovers interrupted attempts once per Project and queues only an exact rebuilt bundle", async () => {
        const bundle = createIllustrationPlanningTestBundle();
        const repository = new IllustrationWorkflowRepository(client);
        const workflow = await repository.start(bundle);
        const claimed = await repository.claimNext({projectId: "project-1", concurrency: 1});
        await repository.bindAttempt({workflowId: workflow.id, attemptId: claimed!.attempt.id, sessionId: 401});
        const rebuild = vi.fn(async () => bundle);
        const tick = vi.fn(async () => 0);
        const recoverApply = vi.fn(async () => undefined);
        const service = new IllustrationWorkflowService({
            builder: {build: vi.fn(async () => bundle), rebuild},
            client: async () => client,
            readConcurrency: async () => 2,
            createScheduler: () => ({tick}),
            createPlanningApply: () => ({recoverProject: recoverApply}),
        });

        const first = await service.list({projectPath: "workspace/demo"});
        const second = await service.list({projectPath: "workspace/demo"});

        expect(first[0]).toMatchObject({id: workflow.id, status: "queued", activeAttemptId: null});
        expect(second[0]).toMatchObject({id: workflow.id, status: "queued"});
        expect((await repository.read(workflow.id)).attempts[0]).toMatchObject({status: "interrupted", sessionId: 401});
        expect(rebuild).toHaveBeenCalledOnce();
        expect(recoverApply).toHaveBeenCalledOnce();
        expect(tick).toHaveBeenCalledWith({projectPath: "workspace/demo", projectId: "project-1", concurrency: 2});
    });

    it("uses explicit retry for the same request and explicit replan for a new request identity", async () => {
        const bundle = createIllustrationPlanningTestBundle();
        const repository = new IllustrationWorkflowRepository(client);
        const original = await repository.start(bundle);
        const claimed = await repository.claimNext({projectId: "project-1", concurrency: 1});
        await repository.failAttempt({
            workflowId: original.id,
            attemptId: claimed!.attempt.id,
            retryable: true,
            errorCode: "DIRECTOR_TEMPORARY_FAILURE",
            errorMessage: "temporary",
        });
        const rebuild = vi.fn(async (input: {bundle: IllustrationPlanningInputBundle; replan?: {reason: string; nonce: string} | null}) => (
            input.replan ? withReplan(input.bundle, input.replan) : input.bundle
        ));
        const tick = vi.fn(async () => 0);
        const service = new IllustrationWorkflowService({
            builder: {build: vi.fn(async () => bundle), rebuild},
            client: async () => client,
            readConcurrency: async () => 2,
            createScheduler: () => ({tick}),
            createPlanningApply: () => ({recoverProject: vi.fn(async () => undefined)}),
            nonceFactory: () => "revision-1",
        });

        const replanned = await service.replan({projectPath: "workspace/demo", workflowId: original.id, reason: "调整构图节奏"});
        const retried = await service.retry({projectPath: "workspace/demo", workflowId: original.id});

        expect(retried).toMatchObject({id: original.id, status: "queued"});
        expect(replanned.id).not.toBe(original.id);
        expect(replanned.planningRequestHash).not.toBe(bundle.planningRequestHash);
        expect(rebuild).toHaveBeenCalledWith(expect.objectContaining({
            projectPath: "workspace/demo",
            replan: {reason: "调整构图节奏", nonce: "revision-1"},
        }));
        expect(await client.illustrationPlanningWorkflow.count()).toBe(2);
    });
});

function withReplan(
    bundle: IllustrationPlanningInputBundle,
    replan: {reason: string; nonce: string},
): IllustrationPlanningInputBundle {
    const requestIdentity = {...bundle.requestIdentity, replan};
    const planningRequestHash = createIllustrationPlanningRequestHash(requestIdentity);
    const {planningInputHash: _planningInputHash, ...base} = bundle;
    const draft = {
        ...base,
        requestIdentity,
        planningRequestHash,
        userRequest: {...bundle.userRequest, replan},
        toolContext: {...bundle.toolContext, runId: `planning-${planningRequestHash.slice(7, 39)}`},
    };
    return IllustrationPlanningInputBundleSchema.parse({...draft, planningInputHash: createIllustrationPlanningInputHash(draft)});
}
