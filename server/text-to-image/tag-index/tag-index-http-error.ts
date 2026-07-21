import {createError} from "h3";
import {isTagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";

/** 把 Tag index/Resolver 领域错误映射为有限 HTTP 出口，不泄露本地路径。 */
export function throwTagIndexHttpError(error: unknown): never {
    if (!isTagIndexError(error)) throw error;
    const statusCode = error.statusCode
        ?? (error.code === "TAG_INDEX_NOT_READY" ? 409
            : error.code === "TAG_INDEX_SOURCE_RATE_LIMITED" ? 429
                : error.code === "TAG_INDEX_SOURCE_UNAVAILABLE" || error.code === "TAG_INDEX_SOURCE_SCHEMA_CHANGED" ? 502
                    : error.code === "TAG_RESOLUTION_INVALID" || error.code === "TAG_PASSTHROUGH_INVALID" ? 400
                        : error.code === "TAG_REPLACEMENT_CANDIDATE_STALE"
                            || error.code === "TAG_INDEX_ACTIVATION_CONFLICT"
                            || error.code === "TAG_POLICY_BLOCKED"
                            || error.code === "TAG_POLICY_REVIEW_REQUIRED" ? 409
                            : 500);
    throw createError({
        statusCode,
        message: error.message,
        data: {
            code: error.code,
            ...(error.retryAfterMs !== null ? {retryAfterMs: error.retryAfterMs} : {}),
        },
    });
}
