import {describe, expect, it, vi} from "vitest";
import type {ProviderLaneItemSnapshot} from "nbook/shared/text-to-image-dispatch";
import {
    ProviderLaneWorker,
    type ProviderLaneWorkerRepository,
} from "nbook/server/text-to-image/provider-lane.worker";

describe("ProviderLaneWorker", () => {
    it("persists leased and attempt_started before invoking the paid dispatch port", async () => {
        const calls: string[] = [];
        const ready = item("ready");
        const leased = {...ready, state: "leased" as const, stateVersion: 3, claimId: "claim-1", claimLeaseUntil: "2026-07-21T00:00:30.000Z"};
        const started = {
            ...leased,
            state: "attempt_started" as const,
            stateVersion: 4,
            sendAttemptId: "attempt-1",
            sendLeaseUntil: "2026-07-21T00:02:00.000Z",
            sendFence: 1,
            attemptCount: 1,
        };
        const repository = repositoryFixture({
            async claimReady() { calls.push("leased"); return leased; },
            async startAttempt() { calls.push("attempt_started"); return {kind: "started", item: started, credential: "captured-token"}; },
            async complete() { calls.push("completed"); return true; },
        });
        const dispatch = vi.fn(async () => {
            calls.push("adapter");
            return {kind: "completed" as const};
        });

        await expect(new ProviderLaneWorker({repository, dispatch: {execute: dispatch}}).runOnce()).resolves.toBe("completed");
        expect(calls).toEqual(["leased", "attempt_started", "adapter", "completed"]);
        expect(dispatch).toHaveBeenCalledWith(started, "captured-token");
    });

    it("never calls the dispatch port when no ready item or start fence is available", async () => {
        const dispatch = vi.fn(async () => ({kind: "completed" as const}));
        const idle = new ProviderLaneWorker({repository: repositoryFixture({async claimReady() { return null; }}), dispatch: {execute: dispatch}});
        await expect(idle.runOnce()).resolves.toBe("idle");

        const deferred = new ProviderLaneWorker({
            repository: repositoryFixture({
                async claimReady() { return item("leased"); },
                async startAttempt() { return null; },
            }),
            dispatch: {execute: dispatch},
        });
        await expect(deferred.runOnce()).resolves.toBe("deferred");
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("maps explicit failure and thrown uncertain windows to different persistent exits", async () => {
        const started = item("attempt_started");
        const failedRepository = repositoryFixture({
            async claimReady() { return item("leased"); },
            async startAttempt() { return {kind: "started", item: started, credential: "token"}; },
            async fail() { return true; },
        });
        await expect(new ProviderLaneWorker({
            repository: failedRepository,
            dispatch: {async execute() { return {kind: "failed", code: "NOVELAI_HTTP_400", message: "bad request"}; }},
        }).runOnce()).resolves.toBe("failed");

        const unknown = vi.fn(async () => true);
        const unknownRepository = repositoryFixture({
            async claimReady() { return item("leased"); },
            async startAttempt() { return {kind: "started", item: started, credential: "token"}; },
            outcomeUnknown: unknown,
        });
        await expect(new ProviderLaneWorker({
            repository: unknownRepository,
            dispatch: {async execute() { throw new Error("network timeout"); }},
        }).runOnce()).resolves.toBe("outcome_unknown");
        expect(unknown).toHaveBeenCalledWith(started, "network timeout");
    });

    it("persists an explicit retryable response instead of hiding a second adapter call", async () => {
        const started = item("attempt_started");
        const retry = vi.fn(async () => "retry_wait" as const);
        const dispatch = vi.fn(async () => ({kind: "retryable" as const, code: "NOVELAI_HTTP_429", message: "rate limited"}));
        const repository = repositoryFixture({
            async claimReady() { return item("leased"); },
            async startAttempt() { return {kind: "started", item: started, credential: "token"}; },
            retry,
        });

        await expect(new ProviderLaneWorker({repository, dispatch: {execute: dispatch}}).runOnce()).resolves.toBe("retryable");
        expect(dispatch).toHaveBeenCalledOnce();
        expect(retry).toHaveBeenCalledWith(started, "NOVELAI_HTTP_429", "rate limited");
    });

    it("leaves attempt_started recoverable when persistent retry settlement itself fails", async () => {
        const started = item("attempt_started");
        const outcomeUnknown = vi.fn(async () => true);
        const repository = repositoryFixture({
            async claimReady() { return item("leased"); },
            async startAttempt() { return {kind: "started", item: started, credential: "token"}; },
            async retry() { throw new Error("app sqlite busy"); },
            outcomeUnknown,
        });
        const worker = new ProviderLaneWorker({
            repository,
            dispatch: {async execute() { return {kind: "retryable", code: "NOVELAI_HTTP_503", message: "busy"}; }},
        });

        await expect(worker.runOnce()).rejects.toThrow("app sqlite busy");
        expect(outcomeUnknown).not.toHaveBeenCalled();
    });
});

function repositoryFixture(overrides: Partial<ProviderLaneWorkerRepository>): ProviderLaneWorkerRepository {
    return {
        async claimReady() { return null; },
        async startAttempt() { return null; },
        async complete() { return false; },
        async retry() { return null; },
        async fail() { return false; },
        async outcomeUnknown() { return false; },
        ...overrides,
    };
}

function item(state: "ready" | "leased" | "attempt_started"): ProviderLaneItemSnapshot {
    const leased = state !== "ready";
    const started = state === "attempt_started";
    return {
        schemaVersion: "nbook.text-to-image-provider-lane-item/v1",
        dispatchKey: `sha256:${"a".repeat(64)}`,
        preparationId: "preparation-1",
        jobId: "job-1",
        ownerUserId: 7,
        providerId: 11,
        providerCredentialRevision: 3,
        projectId: "project-1",
        projectPath: "workspace/demo",
        manifestHash: `sha256:${"b".repeat(64)}`,
        prepareAttemptId: "prepare-1",
        prepareVersion: 1,
        state,
        stateVersion: started ? 4 : leased ? 3 : 2,
        claimId: leased ? "claim-1" : null,
        claimLeaseUntil: leased ? "2026-07-21T00:00:30.000Z" : null,
        sendAttemptId: started ? "attempt-1" : null,
        sendLeaseUntil: started ? "2026-07-21T00:02:00.000Z" : null,
        sendFence: started ? 1 : null,
        attemptCount: started ? 1 : 0,
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
    };
}
