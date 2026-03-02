import type {AgentModelUsage} from "nbook/server/agent-v3/model-provider/model-provider.types";
import type {AIMessage, ChatModelStreamEvent} from "nbook/server/agent-v3/neuro-agent";

/**
 * 读取 DeepSeek thinking/reasoning 文本。
 */
export function readThinkingText(value: AIMessage | ChatModelStreamEvent): string {
    if ("type" in value) {
        return value.type === "thinking_delta" ? value.chunkText : "";
    }
    const thinkingText = value.metadata.thinkingText;
    return typeof thinkingText === "string" && thinkingText.trim() ? thinkingText : "";
}

/**
 * 从 NeuroAgent 消息或事件中读取 usage。
 */
export function readUsage(value: AIMessage | ChatModelStreamEvent): AgentModelUsage {
    if ("type" in value) {
        return value.type === "usage" ? value.usage : emptyUsage();
    }
    const rawUsage = value.metadata.usage;
    if (!rawUsage || typeof rawUsage !== "object" || Array.isArray(rawUsage)) {
        return emptyUsage();
    }
    const usage = rawUsage as Record<string, unknown>;
    return {
        inputTokens: readNumber(usage.inputTokens),
        outputTokens: readNumber(usage.outputTokens),
        totalTokens: readNumber(usage.totalTokens),
    };
}

/**
 * 判断 usage 是否包含有效 token 数。
 */
export function hasUsage(usage: AgentModelUsage): boolean {
    return [usage.inputTokens, usage.outputTokens, usage.totalTokens]
        .some((value) => typeof value === "number" && value > 0);
}

/**
 * 读取有限数字。
 */
function readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 空 usage。
 */
function emptyUsage(): AgentModelUsage {
    return {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
    };
}
