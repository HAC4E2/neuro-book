import type {AgentMessage} from "nbook/server/agent-v3/neuro-agent";
import type {AgentModelUsage} from "nbook/server/agent-v3/model-provider/model-provider.types";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
    [key: string]: JsonValue;
};

/**
 * Agent run 输入。
 */
export type AgentRunInput = {
    prompt: string;
    signal?: AbortSignal;
};

/**
 * 内存快照。
 */
export type AgentRunMemorySnapshot = {
    messages: AgentMessage[];
};

/**
 * v3 归一化运行事件。
 */
export type AgentRunEvent =
    | {type: "thinking_delta"; chunkText: string}
    | {type: "assistant_delta"; chunkText: string}
    | {type: "tool_call_delta"; callIndex: number; toolCallId?: string; toolName?: string; argsChunk?: string}
    | {type: "tool_started"; runId: string; toolName: string; inputText: string}
    | {type: "tool_finished"; runId: string; toolName: string; outputText: string}
    | {type: "usage"; usage: AgentModelUsage}
    | {type: "done"; messageText: string}
    | {type: "error"; message: string};
