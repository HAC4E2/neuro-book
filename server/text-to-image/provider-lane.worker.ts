import {z} from "zod";
import {
    ProviderLaneItemSnapshotSchema,
    type ProviderLaneItemSnapshot,
} from "nbook/shared/text-to-image-dispatch";
import type {
    ProviderLaneAttemptStart,
    ProviderLaneRetryOutcome,
} from "nbook/server/text-to-image/provider-lane.repository";

const DispatchResultSchema = z.discriminatedUnion("kind", [
    z.object({kind: z.literal("completed")}).strict(),
    z.object({
        kind: z.literal("retryable"),
        code: z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/u),
        message: z.string().trim().min(1).max(1_000),
    }).strict(),
    z.object({
        kind: z.literal("failed"),
        code: z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/u),
        message: z.string().trim().min(1).max(1_000),
    }).strict(),
    z.object({
        kind: z.literal("outcome_unknown"),
        message: z.string().trim().min(1).max(1_000),
    }).strict(),
]);

export type ProviderLaneDispatchResult = z.infer<typeof DispatchResultSchema>;

export interface ProviderLaneWorkerRepository {
    claimReady(): Promise<ProviderLaneItemSnapshot | null>;
    startAttempt(leased: ProviderLaneItemSnapshot): Promise<ProviderLaneAttemptStart | null>;
    complete(started: ProviderLaneItemSnapshot): Promise<boolean>;
    retry(started: ProviderLaneItemSnapshot, code: string, message: string): Promise<ProviderLaneRetryOutcome>;
    fail(started: ProviderLaneItemSnapshot, code: string, message: string): Promise<boolean>;
    outcomeUnknown(started: ProviderLaneItemSnapshot, message?: string): Promise<boolean>;
}

export interface ProviderLaneDispatchPort {
    /** 调用方保证此入口只会收到已持久化 attempt_started/fence 的 item。 */
    execute(started: ProviderLaneItemSnapshot, credential: string): Promise<ProviderLaneDispatchResult>;
}

export type ProviderLaneWorkerResult = "idle" | "deferred" | "completed" | "retryable" | "configuration_stale" | "failed" | "outcome_unknown";

type WorkerOptions = {
    repository: ProviderLaneWorkerRepository;
    dispatch: ProviderLaneDispatchPort;
};

/** 每次只处理一个 lane item；并发、节流与 fence 全由持久 repository 决定。 */
export class ProviderLaneWorker {
    constructor(private readonly options: WorkerOptions) {}

    /** attempt_started 成功前绝不进入 paid dispatch；其后的异常一律按结果不明收口。 */
    async runOnce(): Promise<ProviderLaneWorkerResult> {
        const leased = await this.options.repository.claimReady();
        if (!leased) return "idle";
        const start = await this.options.repository.startAttempt(ProviderLaneItemSnapshotSchema.parse(leased));
        if (!start) return "deferred";
        if (start.kind === "configuration_error") return "deferred";
        const strictStarted = ProviderLaneItemSnapshotSchema.parse(start.item);
        let result: ProviderLaneDispatchResult;
        try {
            result = DispatchResultSchema.parse(await this.options.dispatch.execute(strictStarted, start.credential));
        } catch (error) {
            const message = error instanceof Error ? error.message : "远端请求结果无法确认";
            return await this.options.repository.outcomeUnknown(strictStarted, message) ? "outcome_unknown" : "deferred";
        }
        if (result.kind === "completed") {
            return await this.options.repository.complete(strictStarted) ? "completed" : "deferred";
        }
        if (result.kind === "retryable") {
            const retry = await this.options.repository.retry(strictStarted, result.code, result.message);
            return retry === "retry_wait" ? "retryable" : retry === "configuration_stale" ? "configuration_stale" : "deferred";
        }
        if (result.kind === "failed") {
            return await this.options.repository.fail(strictStarted, result.code, result.message) ? "failed" : "deferred";
        }
        return await this.options.repository.outcomeUnknown(strictStarted, result.message) ? "outcome_unknown" : "deferred";
    }
}
