import {describe, expect, it, vi} from "vitest";
import {
    DanbooruSourceClient,
    type DanbooruSourceFetch,
} from "nbook/server/text-to-image/tag-index/danbooru-source-client";

/** 构造带最终 URL 的 JSON Response，模拟 redirect:error 后的真实 fetch 结果。 */
function jsonResponse(url: string, body: object, init: ResponseInit = {}): Response {
    const response = new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: {"content-type": "application/json; charset=utf-8", ...init.headers},
    });
    Object.defineProperty(response, "url", {value: url});
    return response;
}

/** 官方 Tag row fixture；额外字段用于证明 unknown additions 不获得权限且不阻断。 */
function tagRow(id: number, overrides: Record<string, object | string | number | boolean> = {}): object {
    return {
        id,
        name: `tag_${id}?`,
        category: 0,
        post_count: 3000 + id,
        is_deprecated: false,
        created_at: "2026-07-20T00:00:00.000Z",
        updated_at: "2026-07-20T00:00:00.000Z",
        future_column: "ignored",
        ...overrides,
    };
}

/** 官方 relationship row fixture。 */
function relationRow(id: number, overrides: Record<string, object | string | number | boolean> = {}): object {
    return {
        id,
        antecedent_name: `old_${id}`,
        consequent_name: `tag_${id}`,
        status: "active",
        created_at: "2026-07-20T00:00:00.000Z",
        updated_at: "2026-07-20T00:00:00.000Z",
        ...overrides,
    };
}

describe("DanbooruSourceClient", () => {
    it("uses only the fixed official HTTPS endpoint and normalizes an ID cursor page", async () => {
        const fetch: DanbooruSourceFetch = vi.fn(async (url, init) => {
            expect(url).toBe("https://danbooru.donmai.us/tags.json?limit=1000&page=a0&search%5Bpost_count%5D=3000..");
            expect(init).toEqual(expect.objectContaining({method: "GET", redirect: "error"}));
            expect(new Headers(init.headers).get("accept")).toBe("application/json");
            return jsonResponse(url, [tagRow(5), tagRow(4)]);
        });
        const client = new DanbooruSourceClient({fetch, minRequestIntervalMs: 0});

        const page = await client.readPage({resource: "tags", pass: "source", cursor: 0, watermark: 5});

        expect(page.resource).toBe("tags");
        expect(page.records.map((record) => record.id)).toEqual([4, 5]);
        expect(page.records[0]).toEqual({
            id: 4,
            name: "tag_4?",
            categoryId: 0,
            postCount: 3004,
            isDeprecated: false,
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:00:00.000Z",
        });
        expect(page.nextCursor).toBe(5);
        expect(page.done).toBe(true);
        expect(page.provenance).toEqual(expect.objectContaining({
            resource: "tags",
            pass: "source",
            cursorStart: 0,
            cursorEnd: 5,
            watermark: 5,
            recordCount: 2,
            contentType: "application/json",
        }));
    });

    it("reads a fixed active relationship watermark", async () => {
        const fetch: DanbooruSourceFetch = vi.fn(async (url) => {
            expect(url).toBe("https://danbooru.donmai.us/tag_aliases.json?limit=1&page=b9007199254740991&search%5Bstatus%5D=active");
            return jsonResponse(url, [relationRow(77)]);
        });
        const client = new DanbooruSourceClient({fetch, minRequestIntervalMs: 0});

        await expect(client.readWatermark("aliases")).resolves.toBe(77);
    });

    it("keeps only active relationship facts and their official direction", async () => {
        const fetch: DanbooruSourceFetch = vi.fn(async (url) => jsonResponse(url, [relationRow(3)]));
        const client = new DanbooruSourceClient({fetch, minRequestIntervalMs: 0});
        const page = await client.readPage({resource: "implications", pass: "source", cursor: 0, watermark: 3});

        expect(page.records).toEqual([{
            id: 3,
            antecedentName: "old_3",
            consequentName: "tag_3",
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:00:00.000Z",
        }]);

        const inactiveFetch: DanbooruSourceFetch = vi.fn(async (url) => jsonResponse(url, [relationRow(3, {status: "deleted"})]));
        await expect(new DanbooruSourceClient({fetch: inactiveFetch, minRequestIntervalMs: 0})
            .readPage({resource: "implications", pass: "source", cursor: 0, watermark: 3}))
            .rejects.toMatchObject({code: "TAG_INDEX_SOURCE_SCHEMA_CHANGED"});
    });

    it("fails closed on missing fields, unknown category and duplicate or non-advancing IDs", async () => {
        const missingDeprecated = tagRow(2) as Record<string, object | string | number | boolean>;
        delete missingDeprecated.is_deprecated;
        const cases: object[][] = [
            [missingDeprecated],
            [tagRow(2, {category: 2})],
            [tagRow(2), tagRow(2)],
            [tagRow(1)],
        ];
        for (const body of cases) {
            const fetch: DanbooruSourceFetch = vi.fn(async (url) => jsonResponse(url, body));
            await expect(new DanbooruSourceClient({fetch, minRequestIntervalMs: 0})
                .readPage({resource: "tags", pass: "source", cursor: 1, watermark: 3}))
                .rejects.toMatchObject({
                    code: expect.stringMatching(/^TAG_INDEX_(?:SOURCE_SCHEMA_CHANGED|SYNC_INCOMPLETE)$/u),
                });
        }
    });

    it("honors Retry-After before retrying a 429", async () => {
        const sleep = vi.fn(async () => undefined);
        const onRetry = vi.fn(async () => undefined);
        let attempt = 0;
        const fetch: DanbooruSourceFetch = vi.fn(async (url) => {
            attempt += 1;
            if (attempt === 1) {
                return jsonResponse(url, {message: "rate limited"}, {status: 429, headers: {"retry-after": "2"}});
            }
            return jsonResponse(url, [relationRow(9)]);
        });
        const client = new DanbooruSourceClient({fetch, sleep, onRetry, minRequestIntervalMs: 0, maxRetries: 2});

        await expect(client.readWatermark("implications")).resolves.toBe(9);
        expect(sleep).toHaveBeenCalledWith(2000);
        expect(onRetry).toHaveBeenNthCalledWith(1, {reason: "rate_limited", attempt: 1, delayMs: 2000});
        expect(onRetry).toHaveBeenLastCalledWith(null);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("uses bounded exponential backoff for 5xx and exits with a stable error", async () => {
        const sleep = vi.fn(async () => undefined);
        const fetch: DanbooruSourceFetch = vi.fn(async (url) => jsonResponse(url, {message: "unavailable"}, {status: 503}));
        const client = new DanbooruSourceClient({
            fetch,
            sleep,
            minRequestIntervalMs: 0,
            maxRetries: 2,
            retryBaseDelayMs: 250,
        });

        await expect(client.readWatermark("tags")).rejects.toMatchObject({code: "TAG_INDEX_SOURCE_UNAVAILABLE"});
        expect(sleep.mock.calls).toEqual([[250], [500]]);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("rejects redirects, non-JSON and oversized responses", async () => {
        const redirected: DanbooruSourceFetch = vi.fn(async (url) => jsonResponse(
            url.replace("danbooru.donmai.us", "example.com"),
            [tagRow(1)],
        ));
        await expect(new DanbooruSourceClient({fetch: redirected, minRequestIntervalMs: 0})
            .readWatermark("tags"))
            .rejects.toMatchObject({code: "TAG_INDEX_SOURCE_UNAVAILABLE"});

        const html: DanbooruSourceFetch = vi.fn(async (url) => {
            const response = new Response("<html></html>", {headers: {"content-type": "text/html"}});
            Object.defineProperty(response, "url", {value: url});
            return response;
        });
        await expect(new DanbooruSourceClient({fetch: html, minRequestIntervalMs: 0})
            .readWatermark("tags"))
            .rejects.toMatchObject({code: "TAG_INDEX_SOURCE_SCHEMA_CHANGED"});

        const oversized: DanbooruSourceFetch = vi.fn(async (url) => jsonResponse(url, [tagRow(1)]));
        await expect(new DanbooruSourceClient({fetch: oversized, minRequestIntervalMs: 0, maxPageBytes: 8})
            .readWatermark("tags"))
            .rejects.toMatchObject({code: "TAG_INDEX_SOURCE_SCHEMA_CHANGED"});
    });

    it("maps cancellation to an incomplete sync without retrying", async () => {
        const fetch: DanbooruSourceFetch = vi.fn(async () => {
            throw new DOMException("aborted", "AbortError");
        });
        const client = new DanbooruSourceClient({fetch, minRequestIntervalMs: 0, maxRetries: 3});

        await expect(client.readWatermark("tags")).rejects.toMatchObject({code: "TAG_INDEX_SYNC_INCOMPLETE"});
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
