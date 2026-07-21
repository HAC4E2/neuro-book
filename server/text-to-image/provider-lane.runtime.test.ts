import {afterEach, describe, expect, it, vi} from "vitest";
import {ProviderLaneRuntime} from "nbook/server/text-to-image/provider-lane.runtime";

describe("ProviderLaneRuntime", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("合并重叠 tick，并在一次有界轮询中完成恢复、发送和清理", async () => {
        let releasePreparation: (() => void) | undefined;
        const preparation = vi.fn(async () => {
            await new Promise<void>((resolve) => {
                releasePreparation = resolve;
            });
            return {claimed: 0, ready: 0, abandoned: 0, quarantined: 0, failed: 0};
        });
        const workerResults = ["completed", "failed", "idle"] as const;
        const worker = vi.fn(async () => workerResults.shift() ?? "idle");
        const runtime = new ProviderLaneRuntime({
            preparation: {runOnce: preparation},
            revisions: {runOnce: vi.fn(async () => ({claimed: 0, completed: 0, failed: 0}))},
            lane: {
                recoverExpiredWith: vi.fn(async () => ({leasedRecovered: 0, attemptsRetried: 0, attemptsUnknown: 0})),
                cleanupIdle: vi.fn(async () => 1),
            },
            project: {inspectExpiredAttempt: vi.fn()},
            worker: {runOnce: worker},
            logger: {debug: vi.fn(), warn: vi.fn()},
            maxDispatchesPerTick: 5,
        });

        const first = runtime.tick();
        const overlapping = runtime.tick();
        expect(preparation).toHaveBeenCalledTimes(1);
        releasePreparation?.();

        await expect(first).resolves.toMatchObject({dispatches: 2, idle: true});
        await expect(overlapping).resolves.toMatchObject({dispatches: 2, idle: true});
        expect(worker).toHaveBeenCalledTimes(3);
    });

    it("单个恢复阶段失败会记录错误，但不阻止 lane worker 继续处理", async () => {
        const warnings: string[] = [];
        const worker = vi.fn(async () => "idle" as const);
        const runtime = new ProviderLaneRuntime({
            preparation: {runOnce: vi.fn(async () => { throw new Error("prepare db busy"); })},
            revisions: {runOnce: vi.fn(async () => ({claimed: 0, completed: 0, failed: 0}))},
            lane: {
                recoverExpiredWith: vi.fn(async () => ({leasedRecovered: 0, attemptsRetried: 0, attemptsUnknown: 0})),
                cleanupIdle: vi.fn(async () => 0),
            },
            project: {inspectExpiredAttempt: vi.fn()},
            worker: {runOnce: worker},
            logger: {
                debug: vi.fn(),
                warn: vi.fn(async (event) => { warnings.push(event); }),
            },
        });

        await expect(runtime.tick()).resolves.toMatchObject({failedStages: ["preparation"], idle: true});
        expect(worker).toHaveBeenCalledOnce();
        expect(warnings).toEqual(["text-to-image.provider-lane.stage-failed"]);
    });

    it("start 非阻塞启动即时/周期 tick，stop 清理 timer 并等待当前批次", async () => {
        vi.useFakeTimers();
        const preparation = vi.fn(async () => ({}));
        const runtime = new ProviderLaneRuntime({
            preparation: {runOnce: preparation},
            revisions: {runOnce: vi.fn(async () => ({}))},
            lane: {
                recoverExpiredWith: vi.fn(async () => ({leasedRecovered: 0, attemptsRetried: 0, attemptsUnknown: 0})),
                cleanupIdle: vi.fn(async () => 0),
            },
            project: {inspectExpiredAttempt: vi.fn()},
            worker: {runOnce: vi.fn(async () => "idle" as const)},
            logger: {debug: vi.fn(), warn: vi.fn()},
            intervalMs: 500,
        });

        runtime.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(preparation).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(500);
        expect(preparation).toHaveBeenCalledTimes(2);

        await runtime.stop();
        await vi.advanceTimersByTimeAsync(1_500);
        expect(preparation).toHaveBeenCalledTimes(2);
    });

    it("stop aborts an active remote request before waiting for the tick to settle", async () => {
        let releaseWorker: (() => void) | undefined;
        const events: string[] = [];
        const runtime = new ProviderLaneRuntime({
            preparation: {runOnce: vi.fn(async () => ({}))},
            revisions: {runOnce: vi.fn(async () => ({}))},
            lane: {
                recoverExpiredWith: vi.fn(async () => ({leasedRecovered: 0, attemptsRetried: 0, attemptsUnknown: 0})),
                cleanupIdle: vi.fn(async () => 0),
            },
            project: {inspectExpiredAttempt: vi.fn()},
            worker: {
                runOnce: vi.fn(async () => {
                    events.push("worker-started");
                    await new Promise<void>((resolve) => { releaseWorker = resolve; });
                    events.push("worker-settled");
                    return "outcome_unknown" as const;
                }),
            },
            logger: {debug: vi.fn(), warn: vi.fn()},
            maxDispatchesPerTick: 3,
            abortActive: () => {
                events.push("aborted");
                releaseWorker?.();
            },
        });

        const tick = runtime.tick();
        await vi.waitFor(() => expect(events).toContain("worker-started"));
        await runtime.stop();
        await tick;
        expect(events).toEqual(["worker-started", "aborted", "worker-settled"]);
        expect(events.filter((event) => event === "worker-started")).toHaveLength(1);
    });

    it("stop during preparation prevents the tick from claiming its first paid attempt", async () => {
        let releasePreparation: (() => void) | undefined;
        const preparation = vi.fn(async () => {
            await new Promise<void>((resolve) => { releasePreparation = resolve; });
            return {};
        });
        const worker = vi.fn(async () => "completed" as const);
        const runtime = new ProviderLaneRuntime({
            preparation: {runOnce: preparation},
            revisions: {runOnce: vi.fn(async () => ({}))},
            lane: {
                recoverExpiredWith: vi.fn(async () => ({leasedRecovered: 0, attemptsRetried: 0, attemptsUnknown: 0})),
                cleanupIdle: vi.fn(async () => 0),
            },
            project: {inspectExpiredAttempt: vi.fn()},
            worker: {runOnce: worker},
            logger: {debug: vi.fn(), warn: vi.fn()},
            maxDispatchesPerTick: 4,
            abortActive: () => releasePreparation?.(),
        });

        const tick = runtime.tick();
        await vi.waitFor(() => expect(preparation).toHaveBeenCalledOnce());
        await runtime.stop();
        await expect(tick).resolves.toEqual({dispatches: 0, idle: true, failedStages: []});
        expect(worker).not.toHaveBeenCalled();
        await expect(runtime.tick()).resolves.toEqual({dispatches: 0, idle: true, failedStages: []});
        runtime.start();
        expect(preparation).toHaveBeenCalledOnce();
    });
});
