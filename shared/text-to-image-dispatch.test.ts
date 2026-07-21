import {describe, expect, it} from "vitest";
import {
    DispatchPreparationSnapshotSchema,
    ProviderLaneItemSnapshotSchema,
    ProviderThrottleSnapshotSchema,
} from "nbook/shared/text-to-image-dispatch";

const H = (digit: string): string => `sha256:${digit.repeat(64)}`;

describe("persistent text-to-image dispatch contracts", () => {
    it("accepts a strict prepared batch without carrying execution truth", () => {
        const parsed = DispatchPreparationSnapshotSchema.parse({
            schemaVersion: "nbook.text-to-image-dispatch-preparation/v1",
            id: "dispatch-preparation-123",
            ownerUserId: 7,
            providerId: 11,
            providerCredentialRevision: 3,
            projectId: "project-1",
            projectPath: "workspace/demo",
            manifestHash: H("1"),
            prepareAttemptId: "prepare-attempt-1",
            prepareLeaseUntil: "2026-07-21T12:00:30.000Z",
            prepareVersion: 1,
            stateVersion: 1,
            state: "prepared",
            jobIds: ["illustration-job-1", "illustration-job-2"],
            dispatchKeys: [H("2"), H("3")],
            quarantineCode: null,
            quarantineMessage: null,
            createdAt: "2026-07-21T12:00:00.000Z",
            updatedAt: "2026-07-21T12:00:00.000Z",
        });

        expect(parsed.state).toBe("prepared");
        expect(() => DispatchPreparationSnapshotSchema.parse({...parsed, compiledRequests: []})).toThrow();
        expect(() => DispatchPreparationSnapshotSchema.parse({...parsed, recipeSnapshot: {}})).toThrow();
        expect(() => DispatchPreparationSnapshotSchema.parse({...parsed, credential: "secret"})).toThrow();
    });

    it("rejects partial batches and invalid quarantine evidence", () => {
        const base = preparationFixture();
        expect(() => DispatchPreparationSnapshotSchema.parse({...base, dispatchKeys: [H("2")]})).toThrow();
        expect(() => DispatchPreparationSnapshotSchema.parse({...base, jobIds: ["same", "same"]})).toThrow();
        expect(() => DispatchPreparationSnapshotSchema.parse({...base, state: "quarantined"})).toThrow();
        expect(DispatchPreparationSnapshotSchema.parse({
            ...base,
            state: "quarantined",
            quarantineCode: "TEXT_TO_IMAGE_PROJECT_UNAVAILABLE",
            quarantineMessage: "Project 暂不可达",
        }).state).toBe("quarantined");
    });

    it("enforces ready, leased, attempt-started and terminal lane invariants", () => {
        const ready = laneFixture();
        expect(ProviderLaneItemSnapshotSchema.parse(ready).state).toBe("ready");
        expect(() => ProviderLaneItemSnapshotSchema.parse({...ready, state: "leased"})).toThrow();

        const leased = ProviderLaneItemSnapshotSchema.parse({
            ...ready,
            state: "leased",
            claimId: "claim-1",
            claimLeaseUntil: "2026-07-21T12:00:10.000Z",
        });
        expect(leased.sendAttemptId).toBeNull();

        const started = ProviderLaneItemSnapshotSchema.parse({
            ...leased,
            state: "attempt_started",
            sendAttemptId: "send-1",
            sendLeaseUntil: "2026-07-21T12:01:00.000Z",
            sendFence: 4,
            attemptCount: 1,
        });
        expect(started.sendFence).toBe(4);
        expect(() => ProviderLaneItemSnapshotSchema.parse({...started, state: "ready"})).toThrow();
        const retryWait = ProviderLaneItemSnapshotSchema.parse({
            ...started,
            state: "retry_wait",
            claimId: null,
            claimLeaseUntil: null,
            errorCode: "NOVELAI_HTTP_503",
            errorMessage: "NovelAI 请求失败：503",
        });
        expect(retryWait.state).toBe("retry_wait");
        expect(() => ProviderLaneItemSnapshotSchema.parse({...retryWait, state: "retry_leased"})).toThrow();
        expect(ProviderLaneItemSnapshotSchema.parse({
            ...retryWait,
            state: "retry_leased",
            claimId: "retry-claim-1",
            claimLeaseUntil: "2026-07-21T12:02:00.000Z",
        }).state).toBe("retry_leased");
        expect(() => ProviderLaneItemSnapshotSchema.parse({...started, state: "outcome_unknown", errorCode: null})).toThrow();
        expect(ProviderLaneItemSnapshotSchema.parse({
            ...started,
            state: "outcome_unknown",
            claimId: null,
            claimLeaseUntil: null,
            errorCode: "TEXT_TO_IMAGE_OUTCOME_UNKNOWN",
            errorMessage: "远端结果无法确认",
        }).state).toBe("outcome_unknown");
    });

    it("requires one persistent throttle identity and active lease closure", () => {
        const idle = {
            schemaVersion: "nbook.text-to-image-provider-throttle/v1",
            ownerUserId: 7,
            providerId: 11,
            nextAllowedAt: "2026-07-21T12:00:15.000Z",
            activeAttemptId: null,
            leaseUntil: null,
            fencingVersion: 0,
            updatedAt: "2026-07-21T12:00:00.000Z",
        } as const;
        expect(ProviderThrottleSnapshotSchema.parse(idle).fencingVersion).toBe(0);
        expect(() => ProviderThrottleSnapshotSchema.parse({...idle, activeAttemptId: "send-1"})).toThrow();
        expect(ProviderThrottleSnapshotSchema.parse({
            ...idle,
            activeAttemptId: "send-1",
            leaseUntil: "2026-07-21T12:01:00.000Z",
            fencingVersion: 1,
        }).activeAttemptId).toBe("send-1");
    });
});

/** 构造两项 batch 的最小 preparation snapshot。 */
function preparationFixture() {
    return {
        schemaVersion: "nbook.text-to-image-dispatch-preparation/v1" as const,
        id: "dispatch-preparation-123",
        ownerUserId: 7,
        providerId: 11,
        providerCredentialRevision: 3,
        projectId: "project-1",
        projectPath: "workspace/demo",
        manifestHash: H("1"),
        prepareAttemptId: "prepare-attempt-1",
        prepareLeaseUntil: "2026-07-21T12:00:30.000Z",
        prepareVersion: 1,
        stateVersion: 1,
        state: "prepared" as const,
        jobIds: ["illustration-job-1", "illustration-job-2"],
        dispatchKeys: [H("2"), H("3")],
        quarantineCode: null,
        quarantineMessage: null,
        createdAt: "2026-07-21T12:00:00.000Z",
        updatedAt: "2026-07-21T12:00:00.000Z",
    };
}

/** 构造尚未领取的 ready lane item。 */
function laneFixture() {
    return {
        schemaVersion: "nbook.text-to-image-provider-lane-item/v1" as const,
        dispatchKey: H("2"),
        preparationId: "dispatch-preparation-123",
        jobId: "illustration-job-1",
        ownerUserId: 7,
        providerId: 11,
        providerCredentialRevision: 3,
        projectId: "project-1",
        projectPath: "workspace/demo",
        manifestHash: H("1"),
        prepareAttemptId: "prepare-attempt-1",
        prepareVersion: 1,
        state: "ready" as const,
        stateVersion: 2,
        claimId: null,
        claimLeaseUntil: null,
        sendAttemptId: null,
        sendLeaseUntil: null,
        sendFence: null,
        attemptCount: 0,
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-07-21T12:00:00.000Z",
        updatedAt: "2026-07-21T12:00:00.000Z",
    };
}
