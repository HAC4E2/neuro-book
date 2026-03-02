import {
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    mapChatMessagesToStoredMessages,
    mapStoredMessageToChatMessage,
    type BaseMessage,
    type StoredMessage,
} from "@langchain/core/messages";
import {INTERRUPTED_TOOL_RESULT_TEXT, TOOL_RESULT_RAW_KEY} from "nbook/server/agent/tools/shared/tool-message";
import type {
    AgentMessage,
    AgentMessageCreateInput,
    AgentMessageRole,
    AgentMessageStatus,
    JsonObject,
} from "nbook/server/agent/types";

/**
 * 将持久化 AgentMessage 转为 LangChain 消息。
 */
export function toLangChainMessage(message: AgentMessage): BaseMessage {
    return attachProductMetadata(
        mapStoredMessageToChatMessage(message.storedMessage),
        {
            id: message.id,
            status: message.status,
            createdAt: message.createdAt,
        },
    );
}

/**
 * 批量转换为 LangChain 消息。
 */
export function toLangChainMessages(messages: AgentMessage[]): BaseMessage[] {
    return messages.map(toLangChainMessage);
}

/**
 * 将持久化消息投影为可重新发送给模型的合法历史序列。
 */
export function toModelHistoryMessages(messages: AgentMessage[]): BaseMessage[] {
    return normalizeToolResultSequence(toLangChainMessages(messages).map(sanitizeMessageForModel));
}

/**
 * 将 LangChain 消息转为 AgentMessage 创建输入。
 */
export function toAgentMessageCreateInput(
    message: BaseMessage,
    overrides: Partial<Omit<AgentMessageCreateInput, "message">> = {},
): AgentMessageCreateInput {
    return {
        message,
        ...overrides,
    };
}

/**
 * 批量转换 LangChain 消息。
 */
export function toAgentMessageCreateInputs(messages: BaseMessage[]): AgentMessageCreateInput[] {
    return messages.map((message) => toAgentMessageCreateInput(message));
}

/**
 * 构造一条 assistant 文本消息。
 */
export function createAssistantMessageInput(input: {
    content: string;
    status?: AgentMessageStatus;
    id?: string;
    thinking?: string;
    model?: string;
    tokens?: number;
    usageMetadata?: JsonObject;
    toolCalls?: AIMessage["tool_calls"];
}): AgentMessageCreateInput {
    const additionalKwargs: JsonObject = {
        ...(input.thinking ? {thinking: input.thinking} : {}),
        ...(input.thinking ? {reasoning_content: input.thinking} : {}),
        ...(input.model ? {model: input.model} : {}),
        ...(typeof input.tokens === "number" ? {tokens: input.tokens} : {}),
        ...(input.usageMetadata ? {usageMetadata: input.usageMetadata} : {}),
    };

    return {
        id: input.id,
        status: input.status ?? "done",
        message: new AIMessage({
            id: input.id,
            content: input.content,
            additional_kwargs: additionalKwargs,
            tool_calls: input.toolCalls ?? [],
            usage_metadata: input.usageMetadata
                ? {
                    input_tokens: readNumber(input.usageMetadata.inputTokens),
                    output_tokens: readNumber(input.usageMetadata.outputTokens),
                    total_tokens: readNumber(input.usageMetadata.totalTokens),
                    input_token_details: {
                        cache_read: readNumber(input.usageMetadata.cacheReadTokens),
                        cache_creation: readNumber(input.usageMetadata.cacheCreationTokens),
                    },
                }
                : undefined,
        }),
    };
}

/**
 * 生成可持久化的 LangChain StoredMessage。
 */
export function toStoredMessage(input: AgentMessageCreateInput, resolved: {
    id: string;
    status: AgentMessageStatus;
    createdAt: string;
}): StoredMessage {
    return mapChatMessagesToStoredMessages([
        attachProductMetadata(input.message, resolved),
    ])[0]!;
}

/**
 * 从持久化节点读取角色。
 */
export function readAgentMessageRole(message: AgentMessage): AgentMessageRole {
    return resolveRole(toLangChainMessage(message));
}

/**
 * 从持久化节点读取文本内容。
 */
export function readAgentMessageContent(message: AgentMessage): string {
    return toLangChainMessage(message).text;
}

/**
 * 从持久化节点读取可展示/调试的 additional_kwargs。
 */
export function readAgentMessageAdditionalKwargs(message: AgentMessage): JsonObject {
    return normalizeJsonObject(toLangChainMessage(message).additional_kwargs);
}

/**
 * 从持久化节点读取 tool 关联的 assistant message id。
 */
export function readAgentMessageAssistantId(message: AgentMessage): string | null {
    const additionalKwargs = readAgentMessageAdditionalKwargs(message);
    return typeof additionalKwargs.assistantMessageId === "string"
        ? additionalKwargs.assistantMessageId
        : null;
}

/**
 * 从持久化节点读取 tool_call_id。
 */
export function readAgentMessageToolCallId(message: AgentMessage): string | null {
    const langChainMessage = toLangChainMessage(message);
    return ToolMessage.isInstance(langChainMessage)
        ? langChainMessage.tool_call_id || null
        : null;
}

/**
 * 从持久化节点读取 tool 名称。
 */
export function readAgentMessageToolName(message: AgentMessage): string | null {
    const langChainMessage = toLangChainMessage(message);
    return ToolMessage.isInstance(langChainMessage)
        ? langChainMessage.name ?? null
        : null;
}

/**
 * 从持久化节点读取 tool args 文本。
 */
export function readAgentMessageToolArgs(message: AgentMessage): string | null {
    const langChainMessage = toLangChainMessage(message);
    if (!ToolMessage.isInstance(langChainMessage)) {
        return null;
    }
    const toolArgs = langChainMessage.metadata?.toolArgs;
    return typeof toolArgs === "string" ? toolArgs : null;
}

/**
 * 从持久化节点读取 tool 状态。
 */
export function readAgentMessageToolStatus(message: AgentMessage): "success" | "error" | null {
    const langChainMessage = toLangChainMessage(message);
    return ToolMessage.isInstance(langChainMessage)
        ? langChainMessage.status ?? null
        : null;
}

/**
 * 原地改写 StoredMessage 的正文。
 */
export function replaceStoredMessageContent(storedMessage: StoredMessage, content: string): StoredMessage {
    return {
        ...storedMessage,
        data: {
            ...storedMessage.data,
            content,
        },
    };
}

/**
 * 给 LangChain 消息附加产品历史 metadata。
 */
function attachProductMetadata(message: BaseMessage, metadata: {
    id: string;
    status: AgentMessageStatus;
    createdAt: string;
}): BaseMessage {
    const additional_kwargs = {
        ...message.additional_kwargs,
        messageCreatedAt: metadata.createdAt,
        messageStatus: metadata.status,
        messageId: metadata.id,
    };

    if (AIMessage.isInstance(message)) {
        return new AIMessage({
            id: metadata.id,
            name: message.name,
            content: message.content,
            additional_kwargs,
            response_metadata: message.response_metadata,
            tool_calls: message.tool_calls,
            invalid_tool_calls: message.invalid_tool_calls,
            usage_metadata: message.usage_metadata,
        });
    }
    if (ToolMessage.isInstance(message)) {
        return new ToolMessage({
            id: metadata.id,
            name: message.name,
            content: message.content,
            status: message.status,
            tool_call_id: message.tool_call_id,
            metadata: message.metadata,
            additional_kwargs,
        });
    }
    if (HumanMessage.isInstance(message)) {
        return new HumanMessage({
            id: metadata.id,
            name: message.name,
            content: message.content,
            additional_kwargs,
            response_metadata: message.response_metadata,
        });
    }
    return new SystemMessage({
        id: metadata.id,
        name: message.name,
        content: message.content,
        additional_kwargs,
        response_metadata: message.response_metadata,
    });
}

/**
 * 移除不能重新发给模型的后端内部字段。
 */
function sanitizeMessageForModel(message: BaseMessage): BaseMessage {
    if (!ToolMessage.isInstance(message)) {
        return message;
    }

    const {[TOOL_RESULT_RAW_KEY]: _toolResultRaw, ...safeAdditionalKwargs} = message.additional_kwargs;
    return new ToolMessage({
        id: message.id,
        name: message.name,
        content: message.content,
        status: message.status,
        tool_call_id: message.tool_call_id,
        metadata: message.metadata,
        additional_kwargs: safeAdditionalKwargs,
    });
}

/**
 * 修复发送给模型前的 tool_call / tool_result 序列。
 * OpenAI 兼容协议要求带 tool_calls 的 assistant 后面必须紧跟每个 tool_call_id 的 ToolMessage。
 */
function normalizeToolResultSequence(messages: BaseMessage[]): BaseMessage[] {
    const normalizedMessages: BaseMessage[] = [];
    let index = 0;

    while (index < messages.length) {
        const message = messages[index]!;
        if (AIMessage.isInstance(message) && message.tool_calls?.length) {
            const toolCalls = message.tool_calls;
            const pendingToolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id).filter((id): id is string => Boolean(id)));
            normalizedMessages.push(message);
            index += 1;

            while (index < messages.length && ToolMessage.isInstance(messages[index]!)) {
                const toolMessage = messages[index]! as ToolMessage;
                if (pendingToolCallIds.has(toolMessage.tool_call_id)) {
                    normalizedMessages.push(toolMessage);
                    pendingToolCallIds.delete(toolMessage.tool_call_id);
                }
                index += 1;
            }

            for (const toolCall of toolCalls) {
                if (toolCall.id && pendingToolCallIds.has(toolCall.id)) {
                    normalizedMessages.push(createInterruptedToolMessage(message, toolCall));
                }
            }
            continue;
        }

        if (!ToolMessage.isInstance(message)) {
            normalizedMessages.push(message);
        }
        index += 1;
    }

    return normalizedMessages;
}

/**
 * 为已开始但没有落盘结果的工具调用补一条失败结果，避免后续请求携带非法历史。
 */
function createInterruptedToolMessage(assistantMessage: AIMessage, toolCall: NonNullable<AIMessage["tool_calls"]>[number]): ToolMessage {
    const assistantMessageId = typeof assistantMessage.additional_kwargs.messageId === "string"
        ? assistantMessage.additional_kwargs.messageId
        : assistantMessage.id;
    return new ToolMessage({
        id: toolCall.id,
        name: toolCall.name,
        content: INTERRUPTED_TOOL_RESULT_TEXT,
        status: "error",
        tool_call_id: toolCall.id ?? "interrupted-tool-call",
        metadata: {
            toolArgs: JSON.stringify(toolCall.args ?? {}),
        },
        additional_kwargs: {
            ...(assistantMessageId ? {assistantMessageId} : {}),
            interrupted: true,
        },
    });
}

/**
 * 根据 LangChain message 判定持久化角色。
 */
function resolveRole(message: BaseMessage): AgentMessageRole {
    const messageType = message._getType();
    if (messageType === "human") {
        return "user";
    }
    if (messageType === "ai") {
        return "assistant";
    }
    if (messageType === "tool") {
        return "tool";
    }
    return "system";
}

/**
 * 将附加参数收敛为 JSON 对象。
 */
function normalizeJsonObject(value: unknown): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    try {
        return JSON.parse(JSON.stringify(value)) as JsonObject;
    } catch {
        return {};
    }
}

/**
 * 从 JSON 对象里读取数字字段。
 */
function readNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
