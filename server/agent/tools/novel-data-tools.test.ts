import {beforeEach, describe, expect, it, vi} from "vitest";
import {Value} from "typebox/value";
import {createFetch} from "ofetch";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";
import {createNovelDataTools} from "nbook/server/agent/tools/novel-data-tools";
import type {EffectiveConfig} from "nbook/server/config/types";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";

// 测试环境没有 Nitro 的全局 $fetch：用 ofetch.createFetch 装一个，底层 fetch 走可编程 mock，
// 这样错误分类（FetchError 有无 statusCode）走的是真实 ofetch 语义。
const fetchMock = vi.fn(async (_input: unknown): Promise<Response> => {
    throw new Error("fetchMock 未编程");
});
// 测试专用全局注入：生产环境该全局由 Nitro 提供。绕开 Nitro 的 $Fetch 路由类型（unknown 双转）只发生在测试装配处。
(globalThis as unknown as {$fetch: unknown}).$fetch = createFetch({
    // fetch mock 的窄签名与 DOM fetch 重载不完全一致，测试内收窄安全
    fetch: ((input: unknown) => fetchMock(input)) as unknown as typeof fetch,
    Headers: globalThis.Headers,
    AbortController: globalThis.AbortController,
});

/** 注入的 configLoader 不读 context 字段，空对象即可（仅测试用） */
const fakeContext = {} as ToolExecutionContext;

/** 基于默认 effective config 改 novelData.baseUrl。 */
function configWith(baseUrl: string): EffectiveConfig {
    const config = createDefaultEffectiveConfig();
    config.novelData.baseUrl = baseUrl;
    return config;
}

const rankingSnapshot = {
    id: "snapshot-1",
    platform: "fanqie",
    rankTypeKey: "0_1_1139",
    rankType: "女频-新书榜-古风世情",
    sourceUrl: "https://fanqienovel.com/rank/0_1_1139",
    fetchedAt: "2026-07-24T00:30:00.000Z",
    createdAt: "2026-07-24T00:30:01.000Z",
    items: [
        {
            id: "item-1",
            snapshotId: "snapshot-1",
            bookId: "book-uuid-1",
            rank: 1,
            externalBookId: "7420000000000000001",
            title: "作品标题一",
            author: "作者甲",
            coverUrl: "https://example.com/cover.jpg",
            sourceUrl: "https://fanqienovel.com/page/7420000000000000001",
            metrics: {
                readCount: 123_456,
                wordCount: 789_000,
                creationStatus: "连载中",
                category: "古风世情",
            },
        },
        {
            id: "item-2",
            snapshotId: "snapshot-1",
            bookId: "book-uuid-2",
            rank: 2,
            externalBookId: "7420000000000000002",
            title: "作品标题二",
            author: "作者乙",
            metrics: {},
        },
    ],
};

describe("novel data tools", () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    it("novel_rankings schema 校验平台枚举与必填 board", () => {
        const tools = createNovelDataTools(async () => configWith("http://localhost:3000"));
        expect(Value.Check(tools.novelRankings.parameters, {platform: "fanqie", board: "0_1_1139"})).toBe(true);
        expect(Value.Check(tools.novelRankings.parameters, {platform: "qidian", board: "yuepiao"})).toBe(true);
        expect(Value.Check(tools.novelRankings.parameters, {platform: "unknown", board: "yuepiao"})).toBe(false);
        expect(Value.Check(tools.novelRankings.parameters, {platform: "qidian"})).toBe(false);
        expect(Value.Check(tools.novelBookDetail.parameters, {platform: "fanqie", bookId: "742"})).toBe(true);
        expect(Value.Check(tools.novelBookDetail.parameters, {platform: "fanqie"})).toBe(false);
    });

    it("正常返回榜单中文行列表摘要", async () => {
        fetchMock.mockResolvedValueOnce(Response.json(rankingSnapshot));
        const tools = createNovelDataTools(async () => configWith("http://localhost:3000"));

        const result = await tools.novelRankings.runtime().executeWithContext!(
            fakeContext,
            "call-1",
            {platform: "fanqie", board: "0_1_1139"},
        );

        const text = result.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text).toContain("女频-新书榜-古风世情");
        expect(text).toContain("2026-07-24T00:30:00.000Z");
        expect(text).toContain("1. 作品标题一 — 作者甲（书号 7420000000000000001）");
        expect(text).toContain("连载中");
        expect(text).toContain("78.9万字");
        expect(text).toContain("2. 作品标题二 — 作者乙（书号 7420000000000000002）");
        expect(result.details).toBeDefined();
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/rankings/fanqie/0_1_1139");
    });

    it("书籍详情 stale 时摘要首行标注数据可能过期", async () => {
        fetchMock.mockResolvedValueOnce(Response.json({
            bookId: "book-uuid-1",
            platform: "fanqie",
            externalBookId: "7420000000000000001",
            title: "作品标题一",
            author: "作者甲",
            description: "规范化后的作品简介",
            genres: ["古风世情"],
            bookStatus: "连载中",
            wordCount: 789_000,
            metadata: {},
            sourceUrl: "https://fanqienovel.com/page/7420000000000000001",
            fetchedAt: "2026-07-24T00:31:00.000Z",
            expiresAt: "2026-07-24T03:31:00.000Z",
            stale: true,
        }));
        const tools = createNovelDataTools(async () => configWith("http://localhost:3000"));

        const result = await tools.novelBookDetail.runtime().executeWithContext!(
            fakeContext,
            "call-2",
            {platform: "fanqie", bookId: "7420000000000000001"},
        );

        const text = result.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text.split("\n")[0]).toContain("数据可能过期(stale)");
        expect(text).toContain("书名：作品标题一");
        expect(text).toContain("古风世情");
    });

    it("baseUrl 为空时报设置页配置引导", async () => {
        const tools = createNovelDataTools(async () => configWith(""));

        await expect(tools.novelRankings.runtime().executeWithContext!(
            fakeContext,
            "call-3",
            {platform: "qidian", board: "yuepiao"},
        )).rejects.toThrow("小说数据");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("连接失败时报 novel-api 启动引导", async () => {
        // ofetch GET 默认会重试一次，所以用 mockRejectedValue 而不是 Once
        fetchMock.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), {code: "ECONNREFUSED"}));
        const tools = createNovelDataTools(async () => configWith("http://localhost:3000"));

        await expect(tools.novelRankings.runtime().executeWithContext!(
            fakeContext,
            "call-4",
            {platform: "fanqie", board: "0_1_1139"},
        )).rejects.toThrow("novel-api 服务未启动或地址不对");
    });
});
