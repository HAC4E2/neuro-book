import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabaseAtRoot, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {IllustrationWorkflowRepository} from "nbook/server/text-to-image/illustration-workflow.repository";
import {
    IllustrationWorkflowScheduler,
    type IllustrationPlanningAgentRuntime,
    type IllustrationPlanningPublisher,
} from "nbook/server/text-to-image/illustration-workflow.scheduler";
import {createIllustrationPlanningTestBundle} from "nbook/server/text-to-image/illustration-planning-test-fixture";

describe("IllustrationWorkflowScheduler", () => {
    let root = "";
    let adapter: TrackedPrismaLibSql;
    let client: PrismaClient;
    let repository: IllustrationWorkflowRepository;
    let nextId = 0;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-illustration-scheduler-"));
        const databasePath = await initProjectDatabaseAtRoot(root);
        adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
        client = new PrismaClient({adapter});
        repository = new IllustrationWorkflowRepository(client, {idFactory: (prefix) => `${prefix}-${String(++nextId)}`});
    });

    afterEach(async () => {
        await client.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles({force: true});
        await fs.rm(root, {recursive: true, force: true});
    });

    it("runs plan-only through an isolated Agent session and persists a validated ready result", async () => {
        const workflow = await repository.start(createIllustrationPlanningTestBundle());
        const runtime = successfulRuntime();
        const publisher = successfulPublisher(repository);
        const scheduler = new IllustrationWorkflowScheduler({repository, runtime, publisher});

        expect(await scheduler.tick({projectPath: "workspace/demo", projectId: "project-1", concurrency: 2})).toBe(1);
        await scheduler.drain();

        const result = await repository.read(workflow.id);
        expect(result.workflow.status).toBe("ready");
        expect(result.workflow.activeAttemptId).toBeNull();
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0]).toMatchObject({status: "succeeded", sessionId: 101, invocationId: "invocation-101"});
        expect(runtime.createAgent).toHaveBeenCalledWith(expect.objectContaining({
            operation: "plan-chapter",
            projectPath: "workspace/demo",
        }));
        expect(publisher.applyValidatedPlan).toHaveBeenCalledWith({
            projectPath: "workspace/demo",
            workflowId: workflow.id,
        });
    });

    it("starts two chapters concurrently with distinct sessions and leaves the third queued", async () => {
        await repository.start(createIllustrationPlanningTestBundle("manuscript/v1/c1/index.md"));
        await repository.start(createIllustrationPlanningTestBundle("manuscript/v1/c2/index.md"));
        await repository.start(createIllustrationPlanningTestBundle("manuscript/v1/c3/index.md"));
        const gates: Array<() => void> = [];
        let session = 200;
        const runtime = successfulRuntime({
            createAgent: vi.fn(async () => ({sessionId: ++session})),
            invoke: vi.fn(async ({sessionId}) => await new Promise((resolve) => {
                gates.push(() => resolve({sessionId, invocationId: `invocation-${String(sessionId)}`, status: "completed", data: chapterProposal()}));
            })),
        });
        const scheduler = new IllustrationWorkflowScheduler({repository, runtime, publisher: successfulPublisher(repository)});

        expect(await scheduler.tick({projectPath: "workspace/demo", projectId: "project-1", concurrency: 2})).toBe(2);
        await vi.waitFor(() => expect(gates).toHaveLength(2));
        expect(new Set((runtime.createAgent as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].bundle.requestIdentity.chapterPath)).size).toBe(2);
        expect(await client.illustrationPlanningWorkflow.count({where: {status: "queued"}})).toBe(1);
        gates.forEach((release) => release());
        await scheduler.drain();
    });

    it("fails closed when the proposal forges an unexposed anchor", async () => {
        const workflow = await repository.start(createIllustrationPlanningTestBundle());
        const runtime = successfulRuntime({
            invoke: vi.fn(async ({sessionId}) => ({
                sessionId,
                invocationId: `invocation-${String(sessionId)}`,
                status: "completed",
                data: {...chapterProposal(), shots: [{...chapterProposal().shots[0]!, anchorCandidateId: "p_9999_deadbeef"}]},
            })),
        });
        const scheduler = new IllustrationWorkflowScheduler({repository, runtime});

        await scheduler.tick({projectPath: "workspace/demo", projectId: "project-1", concurrency: 1});
        await scheduler.drain();
        const result = await repository.read(workflow.id);
        expect(result.workflow).toMatchObject({status: "failed", retryable: false, errorCode: "ILLUSTRATION_PLAN_INVALID"});
    });

    it("uses the validating failure exit after succeeded evidence has been persisted", async () => {
        const workflow = await repository.start(createIllustrationPlanningTestBundle());
        const complete = vi.spyOn(repository, "completeValidation").mockRejectedValueOnce(new Error("database write failed"));
        const scheduler = new IllustrationWorkflowScheduler({repository, runtime: successfulRuntime()});

        await scheduler.tick({projectPath: "workspace/demo", projectId: "project-1", concurrency: 1});
        await scheduler.drain();

        expect(complete).toHaveBeenCalledOnce();
        const result = await repository.read(workflow.id);
        expect(result.workflow).toMatchObject({status: "failed", activeAttemptId: null, retryable: true});
        expect(result.attempts[0]).toMatchObject({status: "succeeded", invocationId: "invocation-101"});
    });

    it("keeps a sealed plan applying when publisher infrastructure is interrupted", async () => {
        const workflow = await repository.start(createIllustrationPlanningTestBundle());
        const publisher: IllustrationPlanningPublisher = {
            applyValidatedPlan: vi.fn(async () => {
                throw new Error("filesystem unavailable");
            }),
        };
        const scheduler = new IllustrationWorkflowScheduler({repository, runtime: successfulRuntime(), publisher});

        await scheduler.tick({projectPath: "workspace/demo", projectId: "project-1", concurrency: 1});
        await scheduler.drain();

        const result = await repository.read(workflow.id);
        expect(result.workflow).toMatchObject({status: "applying", activeAttemptId: null, retryable: false});
        expect(result.workflow.validatedPlan).not.toBeNull();
        expect(result.attempts[0]).toMatchObject({status: "succeeded", invocationId: "invocation-101"});
    });

    it("aborts only the canceled workflow and ignores its delayed invocation result", async () => {
        const workflow = await repository.start(createIllustrationPlanningTestBundle());
        let releaseInvocation!: () => void;
        const runtime = successfulRuntime({
            invoke: vi.fn(async ({sessionId}) => await new Promise((resolve) => {
                releaseInvocation = () => resolve({
                    sessionId,
                    invocationId: `invocation-${String(sessionId)}`,
                    status: "canceled",
                    error: "aborted",
                });
            })),
        });
        const scheduler = new IllustrationWorkflowScheduler({repository, runtime});

        await scheduler.tick({projectPath: "workspace/demo", projectId: "project-1", concurrency: 1});
        await vi.waitFor(() => expect(runtime.invoke).toHaveBeenCalledOnce());
        const canceled = await repository.cancel({workflowId: workflow.id, reason: "用户取消"});
        await scheduler.cancel({workflowId: workflow.id, sessionId: canceled.sessionId, reason: "用户取消"});
        releaseInvocation();
        await scheduler.drain();

        expect(runtime.abort).toHaveBeenCalledWith({sessionId: 101, reason: "用户取消"});
        const detail = await repository.read(workflow.id);
        expect(detail.workflow).toMatchObject({status: "canceled", retryable: true, errorCode: "ILLUSTRATION_WORKFLOW_CANCELED"});
        expect(detail.attempts[0]).toMatchObject({status: "canceled", sessionId: 101});
    });
});

function successfulRuntime(overrides: Partial<IllustrationPlanningAgentRuntime> = {}): IllustrationPlanningAgentRuntime {
    return {
        isDirectorConfigured: vi.fn(async () => true),
        createAgent: vi.fn(async () => ({sessionId: 101})),
        invoke: vi.fn(async ({sessionId}) => ({
            sessionId,
            invocationId: `invocation-${String(sessionId)}`,
            status: "completed",
            data: chapterProposal(),
        })),
        readEvidence: vi.fn(async () => ({calls: [], terminalResolutions: []})),
        releaseEvidence: vi.fn(),
        abort: vi.fn(async () => undefined),
        ...overrides,
    };
}

/** 测试发布器只模拟 apply journal 已完成后的最终 Workflow CAS。 */
function successfulPublisher(repository: IllustrationWorkflowRepository): IllustrationPlanningPublisher {
    return {
        applyValidatedPlan: vi.fn(async ({workflowId}) => {
            await repository.completeApply(workflowId);
        }),
    };
}

function chapterProposal() {
    return {
        operation: "plan-chapter" as const,
        shots: [{
            anchorCandidateId: "p_0001_abcdef12",
            purpose: "正文视觉节拍",
            characterIds: [],
            outfitRefs: [],
            action: {},
            composition: {
                shotSize: "wide" as const,
                cameraAngle: "eye-level" as const,
                viewpoint: "third-person" as const,
                canvasIntent: "landscape" as const,
                subjectPlacement: "center",
            },
            continuity: {timeOfDay: "day", palette: "neutral"},
            tagPatternRefs: [],
            tagDelta: {prefer: [], avoid: []},
        }],
        continuityReview: {status: "passed" as const, summary: "单镜头连续性通过。"},
    };
}
