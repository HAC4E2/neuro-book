import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {NeuroToolResult, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {loadEffectiveConfigFromTarget} from "nbook/server/config/config-service";
import type {EffectiveConfig} from "nbook/server/config/types";
import {NovelDataClient, type NovelBookDetail, type NovelRankingSnapshot} from "nbook/server/novel-data/novel-data-client";

// novel-api 榜单选题工具（leader 只读面）：novel_rankings / novel_book_detail。
// 数据来自本地 novel-api 缓存（sibling 仓 ../novel-api），不触发采集刷新。

const NovelPlatformSchema = Type.Union([
    Type.Literal("qidian"),
    Type.Literal("fanqie"),
], {description: "Novel platform: 'qidian' (起点中文网) or 'fanqie' (番茄小说)."});

const NovelRankingsSchema = Type.Object({
    platform: NovelPlatformSchema,
    board: Type.String({
        minLength: 1,
        description: "Ranking board key. qidian boards: 'yuepiao' (月票榜), 'hotsales' (畅销榜), 'recom' (推荐榜), 'collect' (收藏榜). fanqie boards are machine keys like '0_1_1139' (女频-新书榜-古风世情).",
    }),
}, {additionalProperties: false});

const NovelBookDetailSchema = Type.Object({
    platform: NovelPlatformSchema,
    bookId: Type.String({
        minLength: 1,
        description: "The platform's numeric book id (the externalBookId field from novel_rankings items).",
    }),
}, {additionalProperties: false});

type NovelRankingsInput = Static<typeof NovelRankingsSchema>;
type NovelBookDetailInput = Static<typeof NovelBookDetailSchema>;

/** 工具的 config 注入 seam（照 web-tools）：默认从当前 invocation 捕获的 Project generation 读取。 */
type NovelDataConfigLoader = (context: ToolExecutionContext) => Promise<EffectiveConfig>;

async function defaultConfigLoader(context: ToolExecutionContext): Promise<EffectiveConfig> {
    if (!context.invocationId) {
        throw new Error("novel-data 工具缺少 invocationId，无法读取已捕获的 Project generation。");
    }
    return loadEffectiveConfigFromTarget(
        context.harness.configTargetForInvocation(context.invocationId),
    );
}

/**
 * 创建 novel-api 榜单选题工具。configLoader 可注入以便测试；
 * 内部按 config.novelData.baseUrl 构造 NovelDataClient。
 */
export function createNovelDataTools(configLoader: NovelDataConfigLoader = defaultConfigLoader) {
    /** 读取 baseUrl 并构造 client；未配置时给能直接指导用户的中文错误。 */
    async function clientFor(context: ToolExecutionContext): Promise<NovelDataClient> {
        const config = await configLoader(context);
        const baseUrl = config.novelData.baseUrl.trim();
        if (!baseUrl) {
            throw new Error("novel-api 服务地址未配置。请在设置页「小说数据」面板填写服务地址（默认 http://localhost:3000）；该服务在 sibling 仓 ../novel-api，按其 README 启动");
        }
        return new NovelDataClient(baseUrl);
    }

    const novelRankings = defineAgentTool({
        key: "novel_rankings",
        description: "Query the latest cached ranking snapshot from the local novel-api service (NovelScope). Read-only: data comes from the local cache and is NOT fetched live — the snapshot only updates when novel-api collects, so it may lag behind the real site; report the snapshot time to the user. qidian boards: yuepiao / hotsales / recom / collect. fanqie boards are machine keys like 0_1_1139. qidian items currently have empty metrics (numbers cannot be decoded reliably).",
        parameters: NovelRankingsSchema,
        executionMode: "parallel",
        async executeWithContext(context, _toolCallId, params): Promise<NeuroToolResult> {
            const input = params as NovelRankingsInput;
            const client = await clientFor(context);
            const snapshot = await client.rankings(input.platform, input.board);
            return {
                content: [{type: "text", text: renderRankingSnapshot(snapshot)}],
                details: normalizeToolResultDetails(snapshot as unknown as JsonValue),
            };
        },
    });

    const novelBookDetail = defineAgentTool({
        key: "novel_book_detail",
        description: "Query one book's cached detail from the local novel-api service by platform and the platform's numeric book id (externalBookId from novel_rankings). Read-only local cache with a 3h TTL; when the cache is expired and refresh failed, the result carries stale=true and the summary is marked accordingly — relay that the data may be outdated instead of presenting it as fresh.",
        parameters: NovelBookDetailSchema,
        executionMode: "parallel",
        async executeWithContext(context, _toolCallId, params): Promise<NeuroToolResult> {
            const input = params as NovelBookDetailInput;
            const client = await clientFor(context);
            const detail = await client.bookDetail(input.platform, input.bookId);
            return {
                content: [{type: "text", text: renderBookDetail(detail)}],
                details: normalizeToolResultDetails(detail as unknown as JsonValue),
            };
        },
    });

    return {novelRankings, novelBookDetail};
}

/** 榜单快照 → 中文行列表摘要（排名 + 书名 + 作者，metrics 有值时附在行尾）。 */
function renderRankingSnapshot(snapshot: NovelRankingSnapshot): string {
    const header = `榜单：${snapshot.rankType}（${snapshot.platform}/${snapshot.rankTypeKey}），快照时间 ${snapshot.fetchedAt}`;
    if (snapshot.items.length === 0) {
        return `${header}\n（快照没有条目）`;
    }
    const lines = snapshot.items.map((item) => {
        const metrics = [
            item.metrics.creationStatus,
            typeof item.metrics.wordCount === "number" ? `${formatCount(item.metrics.wordCount)}字` : "",
            typeof item.metrics.readCount === "number" ? `阅读 ${formatCount(item.metrics.readCount)}` : "",
            item.metrics.category ? `分类 ${item.metrics.category}` : "",
            item.metrics.lastChapterTitle ? `最新章 ${item.metrics.lastChapterTitle}` : "",
        ].filter(Boolean).join("｜");
        return `${item.rank}. ${item.title} — ${item.author}（书号 ${item.externalBookId}）${metrics ? `：${metrics}` : ""}`;
    });
    return [header, ...lines].join("\n");
}

/** 书籍详情 → 中文关键字段行摘要；stale 时首行标注数据可能过期。 */
function renderBookDetail(detail: NovelBookDetail): string {
    const lines: string[] = [];
    if (detail.stale) {
        lines.push("数据可能过期(stale)：缓存 TTL 已过且刷新失败，以下为最近一次成功抓取的数据。");
    }
    lines.push(`书名：${detail.title}`);
    lines.push(`作者：${detail.author}`);
    lines.push(`平台：${detail.platform}（书号 ${detail.externalBookId}）`);
    lines.push(`状态：${detail.bookStatus}${typeof detail.wordCount === "number" ? `｜${formatCount(detail.wordCount)}字` : ""}`);
    if (detail.genres.length > 0) {
        lines.push(`分类：${detail.genres.join("、")}`);
    }
    lines.push(`抓取时间：${detail.fetchedAt}（缓存有效期至 ${detail.expiresAt}）`);
    if (detail.description) {
        lines.push(`简介：${detail.description}`);
    }
    return lines.join("\n");
}

/** 大数展示：>=1 万转「x.x万」，其余原样。 */
function formatCount(value: number): string {
    return value >= 10_000 ? `${(value / 10_000).toFixed(1).replace(/\.0$/u, "")}万` : String(value);
}
