import type {AgentModelUsage} from "nbook/server/agent-v3/model-provider/model-provider.types";
import type {AgentMessage, AgentToolCall, AIMessage} from "nbook/server/agent-v3/neuro-agent/messages";
import type {AgentToolDefinition} from "nbook/server/agent-v3/neuro-agent/tool";

export type ChatModelRequest = {
    messages: AgentMessage[];
    tools?: AgentToolDefinition[];
    signal?: AbortSignal;
};

export type ChatModelStreamEvent =
    | {type: "thinking_delta"; chunkText: string}
    | {type: "assistant_delta"; chunkText: string}
    | {type: "tool_call_delta"; callIndex: number; toolCallId?: string; toolName?: string; argsChunk?: string}
    | {type: "usage"; usage: AgentModelUsage}
    | {type: "done"; message: AIMessage}
    | {type: "error"; message: string};

export type ChatModelToolCallDraft = {
    index: number;
    id: string;
    name: string;
    argsText: string;
};

/**
 * NeuroAgent 使用的聊天模型接口。
 */
export interface ChatModel {
    /**
     * 非流式调用模型。
     */
    invoke(request: ChatModelRequest): Promise<AIMessage>;

    /**
     * 流式调用模型。
     */
    stream(request: ChatModelRequest): AsyncIterable<ChatModelStreamEvent>;
}

/**
 * 将 tool call 草稿转为稳定 tool call。
 */
export function toToolCalls(drafts: ChatModelToolCallDraft[]): AgentToolCall[] {
    return drafts
        .filter((draft) => draft.id && draft.name)
        .sort((left, right) => left.index - right.index)
        .map((draft) => ({
            id: draft.id,
            name: draft.name,
            argsText: draft.argsText,
        }));
}
