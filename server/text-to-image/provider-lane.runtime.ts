import {z} from "zod";
import type {ProviderLaneItemSnapshot} from "nbook/shared/text-to-image-dispatch";
import type {ExpiredAttemptResolution, ProviderLaneRecoveryResult} from "nbook/server/text-to-image/provider-lane.repository";
import type {IllustrationDispatchWorkerResult} from "nbook/server/text-to-image/illustration-dispatch.worker";

type AsyncLogger = {
    debug(event: string, data?: object, message?: string): Promise<void> | void;
    warn(event: string, data?: object, message?: string): Promise<void> | void;
};

type RuntimeOptions = {
    preparation: {runOnce(limit: number): Promise<object>};
    revisions: {runOnce(limit: number): Promise<object>};
    lane: {
        recoverExpiredWith(
            limit: number,
            resolver: (item: ProviderLaneItemSnapshot) => Promise<ExpiredAttemptResolution>,
        ): Promise<ProviderLaneRecoveryResult>;
        cleanupIdle(limit: number): Promise<number>;
    };
    project: {inspectExpiredAttempt(item: ProviderLaneItemSnapshot): Promise<ExpiredAttemptResolution>};
    worker: {runOnce(): Promise<IllustrationDispatchWorkerResult>};
    logger: AsyncLogger;
    intervalMs?: number;
    batchSize?: number;
    maxDispatchesPerTick?: number;
    /** Nitro close 时先中止 adapter，再等待当前 tick 持久收口。 */
    abortActive?: () => void;
};

export type ProviderLaneRuntimeTickResult = {
    dispatches: number;
    idle: boolean;
    failedStages: Array<"preparation" | "revision" | "recovery" | "dispatch" | "cleanup">;
};

/**
 * Nitro 生命周期内的有界调度器。持久状态与互斥均在 repository；进程内 non-overlap 只避免无意义重复扫描。
 */
export class ProviderLaneRuntime {
    private readonly intervalMs: number;
    private readonly batchSize: number;
    private readonly maxDispatchesPerTick: number;
    private activeTick: Promise<ProviderLaneRuntimeTickResult> | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private stopping = false;

    constructor(private readonly options: RuntimeOptions) {
        this.intervalMs = z.number().int().min(250).max(60_000).parse(options.intervalMs ?? 1_000);
        this.batchSize = z.number().int().min(1).max(100).parse(options.batchSize ?? 20);
        this.maxDispatchesPerTick = z.number().int().min(1).max(100).parse(options.maxDispatchesPerTick ?? 4);
    }

    /** 启动一次即时 tick 与固定间隔轮询；重复 start 幂等。 */
    start(): void {
        if (this.timer || this.stopping) return;
        void this.tick();
        this.timer = setInterval(() => {
            void this.tick();
        }, this.intervalMs);
        this.timer.unref?.();
    }

    /** 停止新 tick，先中止在途远端请求，再等待当前批次持久收口。 */
    async stop(): Promise<void> {
        this.stopping = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.options.abortActive?.();
        await this.activeTick;
    }

    /** 重叠调用复用同一个 tick；数据库级 lease/fence 仍是唯一正确性边界。 */
    tick(): Promise<ProviderLaneRuntimeTickResult> {
        if (this.stopping) return Promise.resolve({dispatches: 0, idle: true, failedStages: []});
        if (this.activeTick) return this.activeTick;
        const active = this.runTick().finally(() => {
            if (this.activeTick === active) this.activeTick = null;
        });
        this.activeTick = active;
        return active;
    }

    private async runTick(): Promise<ProviderLaneRuntimeTickResult> {
        const failedStages: ProviderLaneRuntimeTickResult["failedStages"] = [];
        await this.runStage("preparation", failedStages, async () => await this.options.preparation.runOnce(this.batchSize));
        if (this.stopping) return {dispatches: 0, idle: true, failedStages};
        await this.runStage("revision", failedStages, async () => await this.options.revisions.runOnce(this.batchSize));
        if (this.stopping) return {dispatches: 0, idle: true, failedStages};
        await this.runStage("recovery", failedStages, async () => await this.options.lane.recoverExpiredWith(
            this.batchSize,
            async (item) => await this.options.project.inspectExpiredAttempt(item),
        ));
        if (this.stopping) return {dispatches: 0, idle: true, failedStages};

        let dispatches = 0;
        let idle = false;
        try {
            for (let index = 0; index < this.maxDispatchesPerTick; index += 1) {
                if (this.stopping) {
                    idle = true;
                    break;
                }
                const result = await this.options.worker.runOnce();
                if (result === "idle") {
                    idle = true;
                    break;
                }
                if (result === "deferred") break;
                dispatches += 1;
            }
        } catch (error) {
            failedStages.push("dispatch");
            await this.options.logger.warn(
                "text-to-image.provider-lane.stage-failed",
                {stage: "dispatch", error: error instanceof Error ? error.message : String(error)},
                "文生图 Provider lane dispatch 阶段失败",
            );
        }
        await this.runStage("cleanup", failedStages, async () => await this.options.lane.cleanupIdle(this.batchSize));
        await this.options.logger.debug("text-to-image.provider-lane.tick", {dispatches, idle, failedStages});
        return {dispatches, idle, failedStages};
    }

    private async runStage(
        stage: "preparation" | "revision" | "recovery" | "cleanup",
        failedStages: ProviderLaneRuntimeTickResult["failedStages"],
        operation: () => Promise<object | number>,
    ): Promise<void> {
        try {
            await operation();
        } catch (error) {
            failedStages.push(stage);
            await this.options.logger.warn(
                "text-to-image.provider-lane.stage-failed",
                {stage, error: error instanceof Error ? error.message : String(error)},
                `文生图 Provider lane ${stage} 阶段失败`,
            );
        }
    }
}
