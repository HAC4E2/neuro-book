import {
    ProviderLaneItemSnapshotSchema,
    type ProviderLaneItemSnapshot,
} from "nbook/shared/text-to-image-dispatch";
import type {
    ProviderLaneDispatchPort,
    ProviderLaneDispatchResult,
    ProviderLaneWorkerResult,
} from "nbook/server/text-to-image/provider-lane.worker";
import type {
    ProviderLaneAttemptStart,
    ProviderLaneRetryOutcome,
} from "nbook/server/text-to-image/provider-lane.repository";

export interface IllustrationDispatchLanePort {
    claimReady(): Promise<ProviderLaneItemSnapshot | null>;
    startAttempt(leased: ProviderLaneItemSnapshot): Promise<ProviderLaneAttemptStart | null>;
    quarantineLeased(leased: ProviderLaneItemSnapshot, code: string, message: string): Promise<boolean>;
    complete(started: ProviderLaneItemSnapshot): Promise<boolean>;
    retry(started: ProviderLaneItemSnapshot, code: string, message: string): Promise<ProviderLaneRetryOutcome>;
    fail(started: ProviderLaneItemSnapshot, code: string, message: string): Promise<boolean>;
    outcomeUnknown(started: ProviderLaneItemSnapshot, message?: string): Promise<boolean>;
}

export type IllustrationDispatchPreflight =
    | {kind: "valid"}
    | {kind: "invalid"; code: string; message: string};

export interface IllustrationDispatchProjectPort extends ProviderLaneDispatchPort {
    /** paid attempt 前复验 Project immutable closure。 */
    preflight(leased: ProviderLaneItemSnapshot): Promise<IllustrationDispatchPreflight>;
    /** paid boundary 前的 Provider 配置错误必须先持久传播到 Project。 */
    configurationError(leased: ProviderLaneItemSnapshot, code: string, message: string): Promise<void>;
    execute(started: ProviderLaneItemSnapshot, credential: string): Promise<ProviderLaneDispatchResult>;
}

export type IllustrationDispatchWorkerResult = ProviderLaneWorkerResult | "quarantined";

type WorkerOptions = {
    lane: IllustrationDispatchLanePort;
    project: IllustrationDispatchProjectPort;
};

/** Route B one-item worker：Project preflight 在 App attempt_started 之前，执行端再做一次复验。 */
export class IllustrationDispatchWorker {
    constructor(private readonly options: WorkerOptions) {}

    async runOnce(): Promise<IllustrationDispatchWorkerResult> {
        const leased = await this.options.lane.claimReady();
        if (!leased) return "idle";
        const strictLeased = ProviderLaneItemSnapshotSchema.parse(leased);
        const preflight = await this.options.project.preflight(strictLeased);
        if (preflight.kind === "invalid") {
            return await this.options.lane.quarantineLeased(strictLeased, preflight.code, preflight.message)
                ? "quarantined"
                : "deferred";
        }
        const start = await this.options.lane.startAttempt(strictLeased);
        if (!start) return "deferred";
        if (start.kind === "configuration_error") {
            await this.options.project.configurationError(start.item, start.code, start.message);
            return await this.options.lane.quarantineLeased(start.item, start.code, start.message)
                ? "quarantined"
                : "deferred";
        }
        const strictStarted = ProviderLaneItemSnapshotSchema.parse(start.item);
        let result: ProviderLaneDispatchResult;
        try {
            result = await this.options.project.execute(strictStarted, start.credential);
        } catch (error) {
            const message = error instanceof Error ? error.message : "远端请求结果无法确认";
            return await this.options.lane.outcomeUnknown(strictStarted, message) ? "outcome_unknown" : "deferred";
        }
        if (result.kind === "completed") {
            return await this.options.lane.complete(strictStarted) ? "completed" : "deferred";
        }
        if (result.kind === "retryable") {
            const retry = await this.options.lane.retry(strictStarted, result.code, result.message);
            return retry === "retry_wait" ? "retryable" : retry === "configuration_stale" ? "configuration_stale" : "deferred";
        }
        if (result.kind === "failed") {
            return await this.options.lane.fail(strictStarted, result.code, result.message) ? "failed" : "deferred";
        }
        return await this.options.lane.outcomeUnknown(strictStarted, result.message) ? "outcome_unknown" : "deferred";
    }
}
