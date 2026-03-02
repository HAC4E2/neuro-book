import type {JsonObject} from "nbook/server/agent-v3/runtime/runtime.types";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export type AgentToolCall = {
    id: string;
    name: string;
    argsText: string;
};

export type AgentMessageInput = {
    role: AgentMessageRole;
    content: string;
    toolCalls?: AgentToolCall[];
    toolCallId?: string;
    metadata?: JsonObject;
};

/**
 * NeuroAgent 的基础消息对象。
 */
export class AgentMessage {
    constructor(
        readonly role: AgentMessageRole,
        readonly content: string,
        readonly toolCalls: AgentToolCall[] = [],
        readonly toolCallId: string | null = null,
        readonly metadata: JsonObject = {},
    ) {}

    /**
     * 输出可序列化对象。
     */
    toJSON(): AgentMessageInput {
        return {
            role: this.role,
            content: this.content,
            ...(this.toolCalls.length > 0 ? {toolCalls: this.toolCalls} : {}),
            ...(this.toolCallId ? {toolCallId: this.toolCallId} : {}),
            ...(Object.keys(this.metadata).length > 0 ? {metadata: this.metadata} : {}),
        };
    }
}

/**
 * 系统消息。
 */
export class SystemMessage extends AgentMessage {
    constructor(content: string, metadata: JsonObject = {}) {
        super("system", content, [], null, metadata);
    }
}

/**
 * 用户消息。
 */
export class HumanMessage extends AgentMessage {
    constructor(content: string, metadata: JsonObject = {}) {
        super("user", content, [], null, metadata);
    }
}

/**
 * AI 消息。
 */
export class AIMessage extends AgentMessage {
    constructor(input: string | {content: string; toolCalls?: AgentToolCall[]; metadata?: JsonObject}) {
        if (typeof input === "string") {
            super("assistant", input);
            return;
        }
        super("assistant", input.content, input.toolCalls ?? [], null, input.metadata ?? {});
    }
}

/**
 * 工具结果消息。
 */
export class ToolResultMessage extends AgentMessage {
    constructor(input: {toolCallId: string; content: string; metadata?: JsonObject}) {
        super("tool", input.content, [], input.toolCallId, input.metadata ?? {});
    }
}
