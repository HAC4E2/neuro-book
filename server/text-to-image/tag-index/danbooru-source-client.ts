import {createHash} from "node:crypto";
import {z} from "zod";
import {
    DANBOORU_MIN_POST_COUNT,
    TagIndexPageProvenanceSchema,
    TagIndexSourcePassSchema,
    TagIndexSourceResourceSchema,
    type TagIndexPageProvenance,
} from "nbook/shared/text-to-image-tag-index";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";

export const DANBOORU_SOURCE_ENDPOINT = "https://danbooru.donmai.us" as const;
export const DANBOORU_SOURCE_CLIENT_VERSION = "nbook-danbooru-source-v1" as const;

const DANBOORU_PAGE_LIMIT = 1000;
const MAX_WATERMARK_CURSOR = Number.MAX_SAFE_INTEGER;
const DEFAULT_PAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_REQUEST_INTERVAL_MS = 1000;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

const OfficialTagNameSchema = z.string().regex(/^[\x21-\x2b\x2d-\x7e]{1,170}$/u);
const OfficialTimestampSchema = z.string().trim().min(1).max(80);
const OfficialCategoryIdSchema = z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(4), z.literal(5)]);

const OfficialTagRowSchema = z.object({
    id: z.number().int().positive().safe(),
    name: OfficialTagNameSchema,
    category: OfficialCategoryIdSchema,
    post_count: z.number().int().min(DANBOORU_MIN_POST_COUNT).safe(),
    is_deprecated: z.boolean(),
    created_at: OfficialTimestampSchema,
    updated_at: OfficialTimestampSchema,
}).passthrough();

const OfficialRelationshipRowSchema = z.object({
    id: z.number().int().positive().safe(),
    antecedent_name: OfficialTagNameSchema,
    consequent_name: OfficialTagNameSchema,
    status: z.literal("active"),
    created_at: OfficialTimestampSchema,
    updated_at: OfficialTimestampSchema,
}).passthrough();

export type DanbooruSourceFetch = (url: string, init: RequestInit) => Promise<Response>;

export type DanbooruTagSourceRecord = {
    id: number;
    name: string;
    categoryId: 0 | 1 | 3 | 4 | 5;
    postCount: number;
    isDeprecated: boolean;
    createdAt: string;
    updatedAt: string;
};

export type DanbooruRelationshipSourceRecord = {
    id: number;
    antecedentName: string;
    consequentName: string;
    createdAt: string;
    updatedAt: string;
};

export type DanbooruSourceResource = z.infer<typeof TagIndexSourceResourceSchema>;
export type DanbooruSourcePass = z.infer<typeof TagIndexSourcePassSchema>;

export type DanbooruTagSourcePage = {
    resource: "tags";
    records: DanbooruTagSourceRecord[];
    nextCursor: number;
    done: boolean;
    /** 过滤 watermark 后无记录的结束页不生成可缓存 page。 */
    provenance: TagIndexPageProvenance | null;
};

export type DanbooruRelationshipSourcePage = {
    resource: "aliases" | "implications";
    records: DanbooruRelationshipSourceRecord[];
    nextCursor: number;
    done: boolean;
    /** 过滤 watermark 后无记录的结束页不生成可缓存 page。 */
    provenance: TagIndexPageProvenance | null;
};

export type DanbooruSourcePage = DanbooruTagSourcePage | DanbooruRelationshipSourcePage;

type DanbooruSourceClientOptions = {
    fetch?: DanbooruSourceFetch;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    minRequestIntervalMs?: number;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    maxPageBytes?: number;
    onRetry?: (retry: DanbooruSourceRetry | null) => Promise<void>;
};

export type DanbooruSourceRetry = {
    reason: "network_error" | "rate_limited" | "server_error";
    attempt: number;
    delayMs: number;
};

export type DanbooruSourcePageInput = {
    resource: DanbooruSourceResource;
    pass: DanbooruSourcePass;
    cursor: number;
    watermark: number;
    signal?: AbortSignal;
};

/** 可由生产 client 或 deterministic fixture 实现的最小同步读取面。 */
export type DanbooruSourceReader = {
    readWatermark(resource: DanbooruSourceResource, signal?: AbortSignal): Promise<number>;
    readPage(input: DanbooruSourcePageInput): Promise<DanbooruSourcePage>;
};

type JsonResponsePayload = {
    value: object[];
    byteLength: number;
    hash: string;
    contentType: "application/json";
};

/**
 * Danbooru 官方 JSON API 的唯一网络边界。
 *
 * 调用方只能选择登记的 resource/cursor；host、path、threshold 与关系状态均由本类固定。
 */
export class DanbooruSourceClient implements DanbooruSourceReader {
    private readonly sourceFetch: DanbooruSourceFetch;
    private readonly sleep: (milliseconds: number) => Promise<void>;
    private readonly now: () => number;
    private readonly minRequestIntervalMs: number;
    private readonly maxRetries: number;
    private readonly retryBaseDelayMs: number;
    private readonly maxPageBytes: number;
    private readonly onRetry: (retry: DanbooruSourceRetry | null) => Promise<void>;
    private lastRequestStartedAt: number | null = null;

    constructor(options: DanbooruSourceClientOptions = {}) {
        this.sourceFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
        this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
        this.now = options.now ?? Date.now;
        this.minRequestIntervalMs = parseBoundedInteger(options.minRequestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS, 0, 60_000, "minRequestIntervalMs");
        this.maxRetries = parseBoundedInteger(options.maxRetries ?? DEFAULT_MAX_RETRIES, 0, 10, "maxRetries");
        this.retryBaseDelayMs = parseBoundedInteger(options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS, 1, 60_000, "retryBaseDelayMs");
        this.maxPageBytes = parseBoundedInteger(options.maxPageBytes ?? DEFAULT_PAGE_BYTES, 1, 16 * 1024 * 1024, "maxPageBytes");
        this.onRetry = options.onRetry ?? (async () => undefined);
    }

    /** 读取一个资源在同步开始时的最大可见 ID。 */
    async readWatermark(resource: DanbooruSourceResource, signal?: AbortSignal): Promise<number> {
        const parsedResource = TagIndexSourceResourceSchema.parse(resource);
        const url = buildDanbooruUrl(parsedResource, 1, `b${MAX_WATERMARK_CURSOR}`);
        const payload = await this.requestJsonArray(url, signal);
        if (payload.value.length === 0) return 0;
        if (payload.value.length !== 1) {
            throw sourceSchemaError("watermark 响应必须包含至多一条记录");
        }
        if (parsedResource === "tags") {
            return parseTagRows(payload.value)[0]!.id;
        }
        return parseRelationshipRows(payload.value)[0]!.id;
    }

    /** 读取一个固定 watermark 下的 sequential page，并规范化为 ID ASC。 */
    async readPage(input: DanbooruSourcePageInput): Promise<DanbooruSourcePage> {
        const resource = TagIndexSourceResourceSchema.parse(input.resource);
        const pass = TagIndexSourcePassSchema.parse(input.pass);
        if (!Number.isSafeInteger(input.cursor) || input.cursor < 0) {
            throw syncIncompleteError("source cursor 必须是非负安全整数");
        }
        if (!Number.isSafeInteger(input.watermark) || input.watermark <= 0 || input.cursor >= input.watermark) {
            throw syncIncompleteError("source watermark 必须大于当前 cursor");
        }
        const url = buildDanbooruUrl(resource, DANBOORU_PAGE_LIMIT, `a${input.cursor}`);
        const payload = await this.requestJsonArray(url, input.signal);
        if (resource === "tags") {
            const records = parseTagRows(payload.value);
            const page = normalizeSourcePage({resource, pass, records, payload, cursor: input.cursor, watermark: input.watermark});
            return {...page, resource, records: page.records};
        }
        const records = parseRelationshipRows(payload.value);
        const page = normalizeSourcePage({resource, pass, records, payload, cursor: input.cursor, watermark: input.watermark});
        return {...page, resource, records: page.records};
    }

    /** 获取并限制一个官方 JSON array 响应，含串行节流与有界重试。 */
    private async requestJsonArray(url: string, signal?: AbortSignal): Promise<JsonResponsePayload> {
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            await this.waitForRequestSlot();
            let response: Response;
            try {
                response = await this.sourceFetch(url, {
                    method: "GET",
                    headers: {accept: "application/json"},
                    redirect: "error",
                    ...(signal ? {signal} : {}),
                });
            } catch (error) {
                if (isAbortError(error) || signal?.aborted) {
                    throw syncIncompleteError("Danbooru 同步已取消", error);
                }
                if (attempt < this.maxRetries) {
                    const delayMs = this.retryDelay(attempt);
                    await this.onRetry({reason: "network_error", attempt: attempt + 1, delayMs});
                    await this.sleep(delayMs);
                    continue;
                }
                throw sourceUnavailableError("Danbooru 官方 API 请求失败", null, error);
            }

            assertOfficialResponseUrl(response.url, url);
            if (response.status === 429) {
                const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), this.now());
                if (retryAfterMs !== null && retryAfterMs <= MAX_RETRY_AFTER_MS && attempt < this.maxRetries) {
                    await this.onRetry({reason: "rate_limited", attempt: attempt + 1, delayMs: retryAfterMs});
                    await this.sleep(retryAfterMs);
                    continue;
                }
                throw new TagIndexError({
                    code: "TAG_INDEX_SOURCE_RATE_LIMITED",
                    message: "Danbooru 官方 API 持续限流",
                    statusCode: 429,
                    ...(retryAfterMs !== null ? {retryAfterMs} : {}),
                });
            }
            if (response.status >= 500 && response.status <= 599) {
                if (attempt < this.maxRetries) {
                    const delayMs = this.retryDelay(attempt);
                    await this.onRetry({reason: "server_error", attempt: attempt + 1, delayMs});
                    await this.sleep(delayMs);
                    continue;
                }
                throw sourceUnavailableError("Danbooru 官方 API 持续不可用", response.status);
            }
            if (!response.ok) {
                throw sourceUnavailableError(`Danbooru 官方 API 返回 HTTP ${response.status}`, response.status);
            }
            const payload = await readJsonPayload(response, this.maxPageBytes);
            await this.onRetry(null);
            return payload;
        }
        throw sourceUnavailableError("Danbooru 官方 API 重试状态异常");
    }

    /** 确保本 client 实例的请求起始时间至少间隔固定时长。 */
    private async waitForRequestSlot(): Promise<void> {
        const current = this.now();
        if (this.lastRequestStartedAt !== null) {
            const remaining = this.minRequestIntervalMs - (current - this.lastRequestStartedAt);
            if (remaining > 0) await this.sleep(remaining);
        }
        this.lastRequestStartedAt = this.now();
    }

    /** 计算有上限的指数退避。 */
    private retryDelay(attempt: number): number {
        return Math.min(this.retryBaseDelayMs * (2 ** attempt), 60_000);
    }
}

/** 构造固定 official host/path/query，调用方无法插入 URL。 */
function buildDanbooruUrl(resource: DanbooruSourceResource, limit: number, page: string): string {
    const path = resource === "tags"
        ? "/tags.json"
        : resource === "aliases" ? "/tag_aliases.json" : "/tag_implications.json";
    const url = new URL(path, DANBOORU_SOURCE_ENDPOINT);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page", page);
    if (resource === "tags") {
        url.searchParams.set("search[post_count]", `${DANBOORU_MIN_POST_COUNT}..`);
    } else {
        url.searchParams.set("search[status]", "active");
    }
    return url.toString();
}

/** 解析并只投影 SourceClient 所需的官方 Tag 字段。 */
function parseTagRows(rows: object[]): DanbooruTagSourceRecord[] {
    try {
        return rows.map((row) => {
            const parsed = OfficialTagRowSchema.parse(row);
            return {
                id: parsed.id,
                name: parsed.name,
                categoryId: parsed.category,
                postCount: parsed.post_count,
                isDeprecated: parsed.is_deprecated,
                createdAt: normalizeTimestamp(parsed.created_at),
                updatedAt: normalizeTimestamp(parsed.updated_at),
            };
        });
    } catch (error) {
        throw sourceSchemaError("Danbooru Tag 响应 schema 已变化", error);
    }
}

/** 解析并只投影 active Alias/Implication 的官方字段。 */
function parseRelationshipRows(rows: object[]): DanbooruRelationshipSourceRecord[] {
    try {
        return rows.map((row) => {
            const parsed = OfficialRelationshipRowSchema.parse(row);
            return {
                id: parsed.id,
                antecedentName: parsed.antecedent_name,
                consequentName: parsed.consequent_name,
                createdAt: normalizeTimestamp(parsed.created_at),
                updatedAt: normalizeTimestamp(parsed.updated_at),
            };
        });
    } catch (error) {
        throw sourceSchemaError("Danbooru relationship 响应 schema 已变化", error);
    }
}

/** 验证 page 内 ID 单调边界并生成可缓存 provenance。 */
function normalizeSourcePage<TRecord extends {id: number}>(input: {
    resource: DanbooruSourceResource;
    pass: DanbooruSourcePass;
    records: TRecord[];
    payload: JsonResponsePayload;
    cursor: number;
    watermark: number;
}): {
    records: TRecord[];
    nextCursor: number;
    done: boolean;
    provenance: TagIndexPageProvenance | null;
} {
    const ids = input.records.map((record) => record.id);
    if (new Set(ids).size !== ids.length) {
        throw syncIncompleteError("Danbooru page 含重复 ID");
    }
    if (ids.some((id) => id <= input.cursor)) {
        throw syncIncompleteError("Danbooru page cursor 未推进");
    }
    const records = [...input.records]
        .filter((record) => record.id <= input.watermark)
        .sort((left, right) => left.id - right.id);
    const reachedWatermark = ids.some((id) => id >= input.watermark);
    const done = input.records.length < DANBOORU_PAGE_LIMIT || reachedWatermark;
    if (records.length === 0) {
        return {records, nextCursor: input.cursor, done: true, provenance: null};
    }
    const nextCursor = records[records.length - 1]!.id;
    const provenance = TagIndexPageProvenanceSchema.parse({
        resource: input.resource,
        pass: input.pass,
        pageIdentity: `${input.resource}.${input.pass}.${input.cursor}.${nextCursor}.${input.payload.hash.slice(7, 23)}`,
        cursorStart: input.cursor,
        cursorEnd: nextCursor,
        watermark: input.watermark,
        recordCount: records.length,
        byteLength: input.payload.byteLength,
        contentType: input.payload.contentType,
        hash: input.payload.hash,
    });
    return {records, nextCursor, done, provenance};
}

/** 读取 response bytes、限制大小并解析 JSON array。 */
async function readJsonPayload(response: Response, maxPageBytes: number): Promise<JsonResponsePayload> {
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
        throw sourceSchemaError("Danbooru 响应 content-type 不是 application/json");
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxPageBytes)) {
        throw sourceSchemaError("Danbooru 响应超过 page bytes 上限");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxPageBytes) {
        throw sourceSchemaError("Danbooru 响应超过 page bytes 上限");
    }
    let parsed: unknown;
    try {
        const text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
        parsed = JSON.parse(text) as unknown;
    } catch (error) {
        throw sourceSchemaError("Danbooru 响应不是有效 UTF-8 JSON", error);
    }
    if (!Array.isArray(parsed) || parsed.length > DANBOORU_PAGE_LIMIT) {
        throw sourceSchemaError("Danbooru 响应根必须是有界 JSON array");
    }
    const rows: object[] = [];
    for (const row of parsed) {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
            throw sourceSchemaError("Danbooru 响应 row 必须是 JSON object");
        }
        rows.push(row);
    }
    return {
        value: rows,
        byteLength: bytes.byteLength,
        hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        contentType: "application/json",
    };
}

/** 只允许固定 official origin/path 的最终响应。 */
function assertOfficialResponseUrl(responseUrl: string, requestedUrl: string): void {
    try {
        const response = new URL(responseUrl);
        const requested = new URL(requestedUrl);
        if (response.protocol !== "https:" || response.origin !== DANBOORU_SOURCE_ENDPOINT
            || response.pathname !== requested.pathname || response.username || response.password) {
            throw new Error("response URL 不属于固定 official endpoint");
        }
    } catch (error) {
        throw sourceUnavailableError("Danbooru 官方 API redirect/origin 校验失败", null, toError(error));
    }
}

/** 把任意有效 ISO timestamp 规范为 UTC 毫秒格式。 */
function normalizeTimestamp(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new Error("timestamp 非法");
    return new Date(timestamp).toISOString();
}

/** 解析标准 Retry-After 秒数或 HTTP-date。 */
function parseRetryAfter(value: string | null, now: number): number | null {
    if (!value) return null;
    if (/^\d+$/u.test(value.trim())) return Number(value.trim()) * 1000;
    const target = Date.parse(value);
    if (!Number.isFinite(target)) return null;
    return Math.max(0, target - now);
}

/** 解析构造参数的安全整数。 */
function parseBoundedInteger(value: number, minimum: number, maximum: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} 必须是 ${minimum}..${maximum} 的安全整数`);
    }
    return value;
}

/** 判断 fetch 是否因 AbortSignal 终止。 */
function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError"
        || error instanceof Error && error.name === "AbortError";
}

/** 将真正 Error 作为 cause 保留。 */
function toError(error: unknown): Error | undefined {
    return error instanceof Error ? error : undefined;
}

/** 构造 schema drift 错误。 */
function sourceSchemaError(message: string, cause?: unknown): TagIndexError {
    return new TagIndexError({
        code: "TAG_INDEX_SOURCE_SCHEMA_CHANGED",
        message,
        ...(toError(cause) ? {cause: toError(cause)} : {}),
    });
}

/** 构造 source unavailable 错误。 */
function sourceUnavailableError(message: string, statusCode: number | null = null, cause?: unknown): TagIndexError {
    const resolvedCause = toError(cause);
    return new TagIndexError({
        code: "TAG_INDEX_SOURCE_UNAVAILABLE",
        message,
        ...(statusCode !== null ? {statusCode} : {}),
        ...(resolvedCause ? {cause: resolvedCause} : {}),
    });
}

/** 构造不可安全继续的同步错误。 */
function syncIncompleteError(message: string, cause?: unknown): TagIndexError {
    return new TagIndexError({
        code: "TAG_INDEX_SYNC_INCOMPLETE",
        message,
        ...(toError(cause) ? {cause: toError(cause)} : {}),
    });
}
