import {describe, expect, it, vi} from "vitest";
import type {ProviderLaneItemSnapshot} from "nbook/shared/text-to-image-dispatch";
import {
    IllustrationDispatchWorker,
    type IllustrationDispatchLanePort,
} from "nbook/server/text-to-image/illustration-dispatch.worker";

describe("IllustrationDispatchWorker", () => {
    it("revalidates Project before and after attempt_started, then closes explicit success", async () => {
        const calls: string[] = [];
        const leased = item("leased");
        const started = item("attempt_started");
        const lane = laneFixture({
            async claimReady() { calls.push("leased"); return leased; },
            async startAttempt() { calls.push("attempt_started"); return {kind: "started", item: started, credential: "captured-token"}; },
            async complete() { calls.push("app_completed"); return true; },
        });
        const execute = vi.fn(async () => {
            calls.push("project_revalidate_send_result");
            return {kind: "completed" as const};
        });
        const worker = new IllustrationDispatchWorker({
            lane,
            project: {
                async preflight() { calls.push("project_preflight"); return {kind: "valid"}; },
                async configurationError() { throw new Error("不应传播配置错误"); },
                execute,
            },
        });

        await expect(worker.runOnce()).resolves.toBe("completed");
        expect(calls).toEqual(["leased", "project_preflight", "attempt_started", "project_revalidate_send_result", "app_completed"]);
        expect(execute).toHaveBeenCalledWith(started, "captured-token");
    });

    it("quarantines stale Project closure before paid attempt and never executes", async () => {
        const lane = laneFixture({async claimReady() { return item("leased"); }});
        const execute = vi.fn(async () => ({kind: "completed" as const}));
        const worker = new IllustrationDispatchWorker({
            lane,
            project: {
                async preflight() { return {kind: "invalid", code: "TEXT_TO_IMAGE_PROJECT_JOB_STALE", message: "Job 已漂移"}; },
                async configurationError() { throw new Error("不应传播配置错误"); },
                execute,
            },
        });

        await expect(worker.runOnce()).resolves.toBe("quarantined");
        expect(lane.quarantineLeased).toHaveBeenCalled();
        expect(lane.startAttempt).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it("keeps HTTP failures explicit and maps uncertain network errors to outcome_unknown", async () => {
        const failedLane = laneFixture({
            async claimReady() { return item("leased"); },
            async startAttempt() { return {kind: "started", item: item("attempt_started"), credential: "token"}; },
            async fail() { return true; },
        });
        await expect(new IllustrationDispatchWorker({
            lane: failedLane,
            project: {
                async preflight() { return {kind: "valid"}; },
                async configurationError() { throw new Error("不应传播配置错误"); },
                async execute() { return {kind: "failed", code: "NOVELAI_HTTP_503", message: "NovelAI 请求失败：503"}; },
            },
        }).runOnce()).resolves.toBe("failed");

        const unknown = vi.fn(async () => true);
        const unknownLane = laneFixture({
            async claimReady() { return item("leased"); },
            async startAttempt() { return {kind: "started", item: item("attempt_started"), credential: "token"}; },
            outcomeUnknown: unknown,
        });
        await expect(new IllustrationDispatchWorker({
            lane: unknownLane,
            project: {
                async preflight() { return {kind: "valid"}; },
                async configurationError() { throw new Error("不应传播配置错误"); },
                async execute() { throw new Error("socket reset"); },
            },
        }).runOnce()).resolves.toBe("outcome_unknown");
        expect(unknown).toHaveBeenCalledWith(expect.anything(), "socket reset");
    });

    it("routes explicit retryable HTTP responses back to the persistent lane", async () => {
        const retry = vi.fn(async () => "retry_wait" as const);
        const lane = laneFixture({
            async claimReady() { return item("leased"); },
            async startAttempt() { return {kind: "started", item: item("attempt_started"), credential: "token"}; },
            retry,
        });
        const execute = vi.fn(async () => ({kind: "retryable" as const, code: "NOVELAI_HTTP_503", message: "busy"}));

        await expect(new IllustrationDispatchWorker({
            lane,
            project: {
                async preflight() { return {kind: "valid"}; },
                async configurationError() { throw new Error("不应传播配置错误"); },
                execute,
            },
        }).runOnce()).resolves.toBe("retryable");
        expect(execute).toHaveBeenCalledOnce();
        expect(retry).toHaveBeenCalledWith(expect.anything(), "NOVELAI_HTTP_503", "busy");
    });

    it("propagates credential configuration errors to Project before quarantining the App claim", async () => {
        const leased = item("leased");
        const quarantine = vi.fn(async () => true);
        const configurationError = vi.fn(async () => undefined);
        const execute = vi.fn();
        const lane = laneFixture({
            async claimReady() { return leased; },
            async startAttempt() {
                return {kind: "configuration_error", item: leased, code: "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID", message: "凭据无法解密"};
            },
            quarantineLeased: quarantine,
        });

        await expect(new IllustrationDispatchWorker({
            lane,
            project: {async preflight() { return {kind: "valid"}; }, configurationError, execute},
        }).runOnce()).resolves.toBe("quarantined");
        expect(configurationError).toHaveBeenCalledWith(leased, "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID", "凭据无法解密");
        expect(configurationError.mock.invocationCallOrder[0]).toBeLessThan(quarantine.mock.invocationCallOrder[0]!);
        expect(execute).not.toHaveBeenCalled();
    });

    it("keeps the App claim leased when Project is unavailable during credential error propagation", async () => {
        const leased = item("leased");
        const quarantine = vi.fn(async () => true);
        const lane = laneFixture({
            async claimReady() { return leased; },
            async startAttempt() {
                return {kind: "configuration_error", item: leased, code: "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID", message: "凭据无法解密"};
            },
            quarantineLeased: quarantine,
        });
        const worker = new IllustrationDispatchWorker({
            lane,
            project: {
                async preflight() { return {kind: "valid"}; },
                async configurationError() { throw new Error("Project unavailable"); },
                async execute() { return {kind: "completed"}; },
            },
        });

        await expect(worker.runOnce()).rejects.toThrow("Project unavailable");
        expect(quarantine).not.toHaveBeenCalled();
    });
});

function laneFixture(overrides: Partial<IllustrationDispatchLanePort>): IllustrationDispatchLanePort & {
    startAttempt: ReturnType<typeof vi.fn>;
    quarantineLeased: ReturnType<typeof vi.fn>;
} {
    return {
        claimReady: vi.fn(async () => null),
        startAttempt: vi.fn(async () => null),
        quarantineLeased: vi.fn(async () => true),
        complete: vi.fn(async () => false),
        retry: vi.fn(async () => null),
        fail: vi.fn(async () => false),
        outcomeUnknown: vi.fn(async () => false),
        ...overrides,
    };
}

function item(state: "leased" | "attempt_started"): ProviderLaneItemSnapshot {
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
        stateVersion: started ? 4 : 3,
        claimId: "claim-1",
        claimLeaseUntil: "2026-07-21T00:00:30.000Z",
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
