import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabaseAtRoot, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {IllustrationWorkflowRepository} from "nbook/server/text-to-image/illustration-workflow.repository";
import {createIllustrationPlanningTestBundle} from "nbook/server/text-to-image/illustration-planning-test-fixture";

const H = (digit: string) => `sha256:${digit.repeat(64)}`;

describe("IllustrationWorkflowRepository", () => {
    let root = "";
    let adapter: TrackedPrismaLibSql;
    let client: PrismaClient;
    let nextId = 0;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-illustration-workflow-"));
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

    it("atomically converges duplicate starts before any attempt exists", async () => {
        const repository = new IllustrationWorkflowRepository(client, {idFactory: (prefix) => `${prefix}-${String(++nextId)}`});
        const bundle = createIllustrationPlanningTestBundle("manuscript/v1/c1/index.md");
        const results = await Promise.all(Array.from({length: 16}, () => repository.start(bundle)));

        expect(new Set(results.map((item) => item.id))).toEqual(new Set([results[0]!.id]));
        expect(results[0]).toMatchObject({status: "queued", activeAttemptId: null});
        expect(await client.illustrationPlanningWorkflow.count()).toBe(1);
        expect(await client.illustrationPlanningAttempt.count()).toBe(0);
    });

    it("claims at most the configured concurrency and creates isolated attempts", async () => {
        const repository = new IllustrationWorkflowRepository(client, {idFactory: (prefix) => `${prefix}-${String(++nextId)}`});
        await repository.start(createIllustrationPlanningTestBundle("manuscript/v1/c1/index.md"));
        await repository.start(createIllustrationPlanningTestBundle("manuscript/v1/c2/index.md"));
        await repository.start(createIllustrationPlanningTestBundle("manuscript/v1/c3/index.md"));

        const claimed = await Promise.all([
            repository.claimNext({projectId: "project-1", concurrency: 2}),
            repository.claimNext({projectId: "project-1", concurrency: 2}),
            repository.claimNext({projectId: "project-1", concurrency: 2}),
        ]);
        const attempts = claimed.filter((item) => item !== null);
        expect(attempts).toHaveLength(2);
        expect(new Set(attempts.map((item) => item!.attempt.id)).size).toBe(2);
        expect(await client.illustrationPlanningWorkflow.count({where: {status: "running"}})).toBe(2);
        expect(await client.illustrationPlanningWorkflow.count({where: {status: "queued"}})).toBe(1);
    });

    it("requires explicit retry and exact frozen input after a retryable failure", async () => {
        const repository = new IllustrationWorkflowRepository(client, {idFactory: (prefix) => `${prefix}-${String(++nextId)}`});
        const bundle = createIllustrationPlanningTestBundle("manuscript/v1/c1/index.md");
        const workflow = await repository.start(bundle);
        const claimed = await repository.claimNext({projectId: "project-1", concurrency: 1});
        await repository.failAttempt({
            workflowId: workflow.id,
            attemptId: claimed!.attempt.id,
            retryable: true,
            errorCode: "DIRECTOR_TEMPORARY_FAILURE",
            errorMessage: "temporary",
        });

        expect((await repository.start(bundle)).status).toBe("failed");
        await expect(repository.retry({workflowId: workflow.id, planningInputHash: H("f")})).rejects.toThrow(/ILLUSTRATION_WORKFLOW_STALE/u);
        expect((await repository.retry({workflowId: workflow.id, planningInputHash: bundle.planningInputHash})).status).toBe("queued");
        const retried = await repository.claimNext({projectId: "project-1", concurrency: 1});
        expect(retried!.attempt.id).not.toBe(claimed!.attempt.id);
    });

    it("cancels only the targeted workflow and closes its active attempt", async () => {
        const repository = new IllustrationWorkflowRepository(client, {idFactory: (prefix) => `${prefix}-${String(++nextId)}`});
        const first = await repository.start(createIllustrationPlanningTestBundle("manuscript/v1/c1/index.md"));
        const second = await repository.start(createIllustrationPlanningTestBundle("manuscript/v1/c2/index.md"));
        const firstClaim = await repository.claimNext({projectId: "project-1", concurrency: 2});
        const secondClaim = await repository.claimNext({projectId: "project-1", concurrency: 2});
        await repository.bindAttempt({workflowId: first.id, attemptId: firstClaim!.attempt.id, sessionId: 101});
        await repository.bindAttempt({workflowId: second.id, attemptId: secondClaim!.attempt.id, sessionId: 202});

        const canceled = await repository.cancel({workflowId: first.id, reason: "用户取消"});

        expect(canceled).toMatchObject({sessionId: 101, workflow: {status: "canceled", retryable: true, activeAttemptId: null}});
        expect((await repository.read(first.id)).attempts[0]).toMatchObject({status: "canceled", sessionId: 101});
        expect((await repository.read(second.id)).workflow).toMatchObject({status: "running", activeAttemptId: secondClaim!.attempt.id});
        expect((await repository.cancel({workflowId: first.id, reason: "重复取消"})).workflow.status).toBe("canceled");
    });

    it("interrupts restart attempts and requeues only exact rebuilt inputs", async () => {
        const repository = new IllustrationWorkflowRepository(client, {idFactory: (prefix) => `${prefix}-${String(++nextId)}`});
        const exactBundle = createIllustrationPlanningTestBundle("manuscript/v1/c1/index.md");
        const staleBundle = createIllustrationPlanningTestBundle("manuscript/v1/c2/index.md");
        const exact = await repository.start(exactBundle);
        const stale = await repository.start(staleBundle);
        const exactClaim = await repository.claimNext({projectId: "project-1", concurrency: 2});
        const staleClaim = await repository.claimNext({projectId: "project-1", concurrency: 2});
        await repository.bindAttempt({workflowId: exact.id, attemptId: exactClaim!.attempt.id, sessionId: 301});
        await repository.bindAttempt({workflowId: stale.id, attemptId: staleClaim!.attempt.id, sessionId: 302});

        expect(await repository.listRecoverable({projectId: "project-1"})).toHaveLength(2);
        const recovered = await repository.recover({
            workflowId: exact.id,
            attemptId: exactClaim!.attempt.id,
            planningRequestHash: exactBundle.planningRequestHash,
            planningInputHash: exactBundle.planningInputHash,
            staleReason: "Planning 真相源已变化",
        });
        const invalidated = await repository.recover({
            workflowId: stale.id,
            attemptId: staleClaim!.attempt.id,
            planningRequestHash: H("e"),
            planningInputHash: H("f"),
            staleReason: "Planning 真相源已变化",
        });

        expect(recovered).toMatchObject({status: "queued", activeAttemptId: null, staleReason: null});
        expect((await repository.read(exact.id)).attempts[0]).toMatchObject({status: "interrupted", sessionId: 301});
        expect(invalidated).toMatchObject({status: "stale", activeAttemptId: null, retryable: false, staleReason: "Planning 真相源已变化"});
        expect((await repository.read(stale.id)).attempts[0]).toMatchObject({status: "interrupted", sessionId: 302});
        expect(await repository.listRecoverable({projectId: "project-1"})).toHaveLength(0);
    });

    it("preserves succeeded attempt evidence when validation fails", async () => {
        const repository = new IllustrationWorkflowRepository(client, {idFactory: (prefix) => `${prefix}-${String(++nextId)}`});
        const bundle = createIllustrationPlanningTestBundle("manuscript/v1/c1/index.md");
        const workflow = await repository.start(bundle);
        const claimed = await repository.claimNext({projectId: "project-1", concurrency: 1});
        await repository.bindAttempt({workflowId: workflow.id, attemptId: claimed!.attempt.id, sessionId: 101});
        await repository.succeedAttempt({
            workflowId: workflow.id,
            attemptId: claimed!.attempt.id,
            invocationId: "invocation-101",
            proposal: {
                operation: "plan-chapter",
                shots: [{
                    anchorCandidateId: "p_0001_abcdef12",
                    purpose: "正文视觉节拍",
                    characterIds: [],
                    outfitRefs: [],
                    action: {},
                    composition: {
                        shotSize: "wide",
                        cameraAngle: "eye-level",
                        viewpoint: "third-person",
                        canvasIntent: "landscape",
                        subjectPlacement: "center",
                    },
                    continuity: {timeOfDay: "day", palette: "neutral"},
                    tagPatternRefs: [],
                    tagDelta: {prefer: [], avoid: []},
                }],
                continuityReview: {status: "passed", summary: "单镜头连续性通过。"},
            },
            planningEvidenceHash: H("a"),
            evidenceJson: JSON.stringify({planningEvidenceHash: H("a")}),
        });

        await repository.failValidation({
            workflowId: workflow.id,
            attemptId: claimed!.attempt.id,
            retryable: true,
            errorCode: "ILLUSTRATION_PLAN_PERSIST_FAILED",
            errorMessage: "validation persistence failed",
        });

        const result = await repository.read(workflow.id);
        expect(result.workflow).toMatchObject({
            status: "failed",
            activeAttemptId: null,
            retryable: true,
            errorCode: "ILLUSTRATION_PLAN_PERSIST_FAILED",
        });
        expect(result.attempts[0]).toMatchObject({
            status: "succeeded",
            invocationId: "invocation-101",
            planningEvidenceHash: H("a"),
        });
    });
});
