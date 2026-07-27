import type {FetchError} from "ofetch";
import type {JsonValue} from "nbook/server/agent/messages/types";

// novel-api（NovelScope 小说榜单采集服务，sibling 仓 ../novel-api）只读查询 client。
// 上游契约见 ../novel-api/docs/API.md：基础路径 /v1；本 client 只接查询端点，不接刷新/采集端点。

/**
 * 榜单条目 metrics。番茄可能包含以下字段（上游未提供的会省略）；
 * 起点榜单目前返回空 metrics（自定义字体编码导致榜单数值无法可靠还原，见 docs/API.md）。
 */
export type NovelRankingItemMetrics = {
    /** 阅读量（在读人数口径由上游决定） */
    readCount?: number;
    /** 字数 */
    wordCount?: number;
    /** 连载状态文案，如「连载中」 */
    creationStatus?: string;
    /** 最新章节标题 */
    lastChapterTitle?: string;
    /** 分类文案 */
    category?: string;
};

/** 榜单快照条目，按 rank 升序返回。 */
export type NovelRankingItem = {
    id: string;
    snapshotId: string;
    /** novel-api 内部书籍 UUID（不是平台书号） */
    bookId: string;
    rank: number;
    /** 平台侧纯数字书号；查询书籍详情时用它 */
    externalBookId: string;
    title: string;
    author: string;
    /** 上游可能缺失封面 */
    coverUrl?: string;
    sourceUrl?: string;
    metrics: NovelRankingItemMetrics;
};

/** 榜单最新快照（GET /v1/rankings/:platform/:rankTypeKey 响应体） */
export type NovelRankingSnapshot = {
    id: string;
    platform: string;
    /** 机器键，如起点 yuepiao、番茄 0_1_1139 */
    rankTypeKey: string;
    /** 中文展示名，如「女频-新书榜-古风世情」 */
    rankType: string;
    sourceUrl: string;
    /** 快照采集时间（ISO 8601）；快照不可变，只在 novel-api 侧刷新时更新 */
    fetchedAt: string;
    createdAt: string;
    items: NovelRankingItem[];
};

/** 书籍详情（GET /v1/books/:platform/:bookId 响应体，缓存 TTL 3h） */
export type NovelBookDetail = {
    /** novel-api 内部书籍 UUID */
    bookId: string;
    platform: string;
    /** 平台侧纯数字书号 */
    externalBookId: string;
    title: string;
    author: string;
    description: string;
    coverUrl?: string;
    genres: string[];
    /** 连载状态文案，如「连载中」 */
    bookStatus: string;
    wordCount?: number;
    /** 上游附加元数据，结构由 novel-api 决定，这里原样透传 */
    metadata: Record<string, JsonValue>;
    sourceUrl: string;
    fetchedAt: string;
    expiresAt: string;
    /** true = TTL 过期且刷新失败，返回的是最近一次成功数据（数据可能过期，需向用户转述） */
    stale: boolean;
};

/**
 * novel-api 只读查询 client。构造入参 baseUrl（不含 /v1 前缀，如 http://localhost:3000）。
 * 错误统一转成可直接指导用户的中文 Error：连接失败给启动引导，上游 4xx/5xx 转述上游信息。
 */
export class NovelDataClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        // 去掉尾部斜杠，拼路径时统一补 /v1
        this.baseUrl = baseUrl.replace(/\/+$/u, "");
    }

    /**
     * 查询最新榜单快照。只读取 novel-api 最近一次成功保存的不可变快照，不触发采集。
     */
    async rankings(platform: string, boardKey: string): Promise<NovelRankingSnapshot> {
        try {
            return await $fetch<NovelRankingSnapshot>(
                `${this.baseUrl}/v1/rankings/${encodeURIComponent(platform)}/${encodeURIComponent(boardKey)}`,
            );
        } catch (error) {
            throw this.describeError(error, {
                badRequest: `榜单键 ${platform}/${boardKey} 不受 novel-api 支持（起点：yuepiao / hotsales / recom / collect；番茄形如 0_1_1139）`,
                notFound: `榜单 ${platform}/${boardKey} 还没有已保存的快照。novel-api 只读缓存，需要先在 novel-api 侧完成一次采集刷新`,
            });
        }
    }

    /**
     * 查询书籍详情。bookId 是对应平台的纯数字书号（榜单条目里的 externalBookId）。
     * 缓存过期且刷新失败时上游仍返回 200 + stale=true，这里原样透传 stale 标记。
     */
    async bookDetail(platform: string, bookId: string): Promise<NovelBookDetail> {
        try {
            return await $fetch<NovelBookDetail>(
                `${this.baseUrl}/v1/books/${encodeURIComponent(platform)}/${encodeURIComponent(bookId)}`,
            );
        } catch (error) {
            throw this.describeError(error, {
                badRequest: `书号 ${bookId} 不受支持：bookId 必须是 ${platform} 平台的纯数字书籍 ID`,
                notFound: `书籍 ${platform}/${bookId} 不存在`,
            });
        }
    }

    /**
     * 把 $fetch 错误转成中文 Error。
     * 无 HTTP 状态码 = 请求没到达上游（连接被拒 / DNS / 超时）→ 给启动引导；
     * 有状态码 = 上游返回 4xx/5xx → 按语义转述（400/404 用调用方给的定制文案，其余带上游 message）。
     */
    private describeError(error: unknown, hints: {badRequest: string; notFound: string}): Error {
        const fetchError = error as FetchError<{message?: string}>;
        const statusCode = typeof fetchError?.statusCode === "number" ? fetchError.statusCode : undefined;
        if (statusCode === undefined) {
            return new Error(
                `novel-api 服务未启动或地址不对：${this.baseUrl}。该服务在 sibling 仓 ../novel-api，按其 README 启动（需要 PostgreSQL 与系统 Edge）`,
            );
        }
        if (statusCode === 400) {
            return new Error(hints.badRequest);
        }
        if (statusCode === 404) {
            return new Error(hints.notFound);
        }
        const upstreamMessage = typeof fetchError.data?.message === "string" ? fetchError.data.message : fetchError.message;
        if (statusCode === 502) {
            return new Error(`novel-api 上游采集失败（HTTP 502）：${upstreamMessage}。通常是外站抓取/解析失败，可稍后在 novel-api 侧重试刷新`);
        }
        return new Error(`novel-api 返回错误（HTTP ${statusCode}）：${upstreamMessage}`);
    }
}
