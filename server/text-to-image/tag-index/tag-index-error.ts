import {z} from "zod";

export const TagIndexErrorCodeSchema = z.enum([
    "TAG_INDEX_NOT_READY",
    "TAG_INDEX_SOURCE_UNAVAILABLE",
    "TAG_INDEX_SOURCE_RATE_LIMITED",
    "TAG_INDEX_SOURCE_SCHEMA_CHANGED",
    "TAG_INDEX_SYNC_INCOMPLETE",
    "TAG_INDEX_RECONCILIATION_FAILED",
    "TAG_INDEX_BUILD_FAILED",
    "TAG_INDEX_ACTIVATION_CONFLICT",
    "TAG_RESOLUTION_INVALID",
    "TAG_REPLACEMENT_CANDIDATE_STALE",
    "TAG_PASSTHROUGH_INVALID",
    "TAG_POLICY_BLOCKED",
    "TAG_POLICY_REVIEW_REQUIRED",
]);
export type TagIndexErrorCode = z.infer<typeof TagIndexErrorCodeSchema>;

/** Tag index / Resolver 边界的稳定领域错误。 */
export class TagIndexError extends Error {
    readonly code: TagIndexErrorCode;
    readonly statusCode: number | null;
    readonly retryAfterMs: number | null;

    constructor(input: {
        code: TagIndexErrorCode;
        message: string;
        statusCode?: number;
        retryAfterMs?: number;
        cause?: Error;
    }) {
        super(input.message, input.cause ? {cause: input.cause} : undefined);
        this.name = "TagIndexError";
        this.code = input.code;
        this.statusCode = input.statusCode ?? null;
        this.retryAfterMs = input.retryAfterMs ?? null;
    }
}

/** 判断异常是否已具有稳定 Tag index 领域语义。 */
export function isTagIndexError(error: unknown): error is TagIndexError {
    return error instanceof TagIndexError;
}
