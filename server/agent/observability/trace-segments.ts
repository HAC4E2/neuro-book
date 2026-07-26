/**
 * Prompt 分区归因（Task 126）。
 *
 * 把一次 provider 请求的 `{systemPrompt, messages, tools}` 切成可解释的分区，
 * 并按 compaction 同口径给出**纯估算** token。
 *
 * 刻意不在这里做「按 provider 真实用量校准」：校准需要响应侧 usage，而本函数在
 * 请求侧调用；两处各留一半会让口径漂移。校准由消费方（面板）用同一份估算值按比例分摊。
 *
 * 纯函数、无 IO、不读 config，可随 recorder 一起抽成独立库。
 */
import {createHash} from "node:crypto";
import type {PiTraceSegment, PiTraceSegmentKind} from "nbook/server/agent/observability/pi-request-recorder";
import {estimateStoredMessageTokens, type StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";

/**
 * prepareRun 计算出的 messages 前缀归因。
 *
 * 只覆盖 prepareRun 当时的 messages 数组；同一 invocation 后续 turn 追加的
 * assistant / toolResult / steer 消息一律落在 `conversation`，因为它们本来就是对话流量。
 */
export type PromptPrefixAttribution = {
    /** 与前缀等长：每条消息属于哪个分区。 */
    kinds: PiTraceSegmentKind[];
    /** 与 kinds 等长：每条消息的 Profile DSL 来源名；无来源为 null。 */
    labels: (readonly string[] | null)[];
};

/** 单条消息的估算 token；非 message 分区（system/tools）用 charTokens。 */
function charTokens(text: string): number {
    // 与 pi `estimateTokens` 的 chars/4 保持同口径，避免面板内出现两套估算。
    return Math.ceil(text.length / 4);
}

/**
 * 计算工具集指纹。
 *
 * 用途是「检测工具集是否变化导致缓存断点前移」，因此只需要稳定且够短，不需要抗碰撞。
 * 覆盖完整 tool 定义（含 schema）：只比名字会漏掉 description / schema 变更，
 * 而那同样会击穿 Anthropic 的 tools 断点。
 */
export function computeToolsHash(tools: readonly unknown[]): string | undefined {
    if (tools.length === 0) {
        return undefined;
    }
    return createHash("sha256").update(JSON.stringify(tools)).digest("hex").slice(0, 8);
}

/**
 * 把一次请求切成分区。
 *
 * `system` / `tools` 不在 messages 数组里，`range` 为 null；两者为空时整段省略。
 * messages 按 `prefix` 的 kind 压成连续区间——同一 kind 可能出现多段（例如历史里
 * 散落的旧 AppendingSet 提醒与本轮 AppendingSet 之间隔着对话），消费方按 kind 求和即可。
 */
export function buildTraceSegments(input: {
    systemPrompt: string;
    tools: readonly unknown[];
    messages: readonly StoredMessageLike[];
    /** 缺省时全部消息计入 conversation（无 profile prepare 的调用，如 compaction / health-check）。 */
    prefix?: PromptPrefixAttribution;
}): PiTraceSegment[] {
    const segments: PiTraceSegment[] = [];

    if (input.systemPrompt.length > 0) {
        segments.push({kind: "system", range: null, estimatedTokens: charTokens(input.systemPrompt)});
    }
    if (input.tools.length > 0) {
        segments.push({kind: "tools", range: null, estimatedTokens: charTokens(JSON.stringify(input.tools))});
    }

    let current: PiTraceSegment | undefined;
    let currentLabels: (readonly string[] | null)[] = [];
    for (const [index, message] of input.messages.entries()) {
        const kind = input.prefix?.kinds[index] ?? "conversation";
        const label = input.prefix?.labels[index] ?? null;
        if (!current || current.kind !== kind) {
            if (current) {
                finishMessageSegment(segments, current, currentLabels);
            }
            current = {kind, range: {start: index, end: index + 1}, estimatedTokens: 0};
            currentLabels = [];
        } else {
            current.range!.end = index + 1;
        }
        current.estimatedTokens += estimateStoredMessageTokens(message);
        currentLabels.push(label);
    }
    if (current) {
        finishMessageSegment(segments, current, currentLabels);
    }
    return segments;
}

/** 收尾一个 message 分区：labels 全为 null 时整个字段省略，避免 trace 里堆无信息量的 null 数组。 */
function finishMessageSegment(
    segments: PiTraceSegment[],
    segment: PiTraceSegment,
    labels: (readonly string[] | null)[],
): void {
    if (labels.some((label) => label !== null)) {
        segment.labels = labels.map((label) => label === null ? null : [...label]);
    }
    segments.push(segment);
}
