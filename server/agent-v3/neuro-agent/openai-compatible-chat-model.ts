import {AIMessage} from "nbook/server/agent-v3/neuro-agent/messages";
import type {AgentMessage, AgentToolCall} from "nbook/server/agent-v3/neuro-agent/messages";
import type {ChatModel, ChatModelRequest, ChatModelStreamEvent, ChatModelToolCallDraft} from "nbook/server/agent-v3/neuro-agent/chat-model";
import {toToolCalls} from "nbook/server/agent-v3/neuro-agent/chat-model";
import type {AgentToolDefinition} from "nbook/server/agent-v3/neuro-agent/tool";
import type {AgentModelUsage} from "nbook/server/agent-v3/model-provider/model-provider.types";

export type OpenAICompatibleChatModelOptions = {
    modelId: string;
    apiKey: string;
    baseURL: string;
    fetch?: typeof fetch;
    headers?: Record<string, string>;
    enableThinking?: boolean;
};

type OpenAIChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string | null;
            tool_calls?: OpenAIToolCall[];
            reasoning_content?: string;
            thinking_content?: string;
        };
    }>;
    usage?: OpenAIUsage;
};

type OpenAIToolCall = {
    id?: string;
    type?: "function";
    function?: {
        name?: string;
        arguments?: string;
    };
};

type OpenAIUsage = {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
};

/**
 * OpenAI-compatible Chat Completions 模型。
 */
export class OpenAICompatibleChatModel implements ChatModel {
    private readonly fetchImpl: typeof fetch;

    constructor(
        readonly options: OpenAICompatibleChatModelOptions,
    ) {
        this.fetchImpl = options.fetch ?? fetch;
    }

    /**
     * 非流式调用模型。
     */
    async invoke(request: ChatModelRequest): Promise<AIMessage> {
        const response = await this.fetchJson({
            request,
            stream: false,
        }) as OpenAIChatCompletionResponse;
        const message = response.choices?.[0]?.message;
        const content = message?.content ?? "";
        return new AIMessage({
            content,
            toolCalls: this.readToolCalls(message?.tool_calls ?? []),
            metadata: {
                ...(message?.reasoning_content ? {thinkingText: message.reasoning_content} : {}),
                ...(message?.thinking_content ? {thinkingText: message.thinking_content} : {}),
                usage: this.readUsage(response.usage),
            },
        });
    }

    /**
     * 流式调用模型。
     */
    async *stream(request: ChatModelRequest): AsyncIterable<ChatModelStreamEvent> {
        const response = await this.fetchResponse({
            request,
            stream: true,
        });
        if (!response.body) {
            throw new Error("模型流式响应缺少 body");
        }

        let content = "";
        const drafts = new Map<number, ChatModelToolCallDraft>();
        const decoder = new TextDecoder();
        let buffer = "";

        for await (const chunk of this.readResponseBody(response.body)) {
            buffer += decoder.decode(chunk, {stream: true});
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const event = this.parseSseLine(line, drafts);
                if (!event) {
                    continue;
                }
                if (event.type === "assistant_delta") {
                    content += event.chunkText;
                }
                yield event;
            }
        }

        const rest = decoder.decode();
        if (rest) {
            buffer += rest;
        }
        for (const line of buffer.split(/\r?\n/)) {
            const event = this.parseSseLine(line, drafts);
            if (!event) {
                continue;
            }
            if (event.type === "assistant_delta") {
                content += event.chunkText;
            }
            yield event;
        }

        yield {
            type: "done",
            message: new AIMessage({
                content,
                toolCalls: toToolCalls([...drafts.values()]),
            }),
        };
    }

    /**
     * 读取 Web ReadableStream。
     */
    private async *readResponseBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
        const reader = body.getReader();
        try {
            while (true) {
                const result = await reader.read();
                if (result.done) {
                    return;
                }
                yield result.value;
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * 发起 JSON 请求。
     */
    private async fetchJson(input: {request: ChatModelRequest; stream: boolean}): Promise<unknown> {
        const response = await this.fetchResponse(input);
        return response.json();
    }

    /**
     * 发起底层 HTTP 请求。
     */
    private async fetchResponse(input: {request: ChatModelRequest; stream: boolean}): Promise<Response> {
        const response = await this.fetchImpl(this.buildUrl(), {
            method: "POST",
            signal: input.request.signal,
            headers: {
                Authorization: `Bearer ${this.options.apiKey}`,
                "Content-Type": "application/json",
                ...(this.options.headers ?? {}),
            },
            body: JSON.stringify(this.buildRequestBody(input.request, input.stream)),
        });
        if (!response.ok) {
            throw new Error(`模型请求失败：${String(response.status)} ${await response.text()}`);
        }
        return response;
    }

    /**
     * 构造 Chat Completions URL。
     */
    private buildUrl(): string {
        return `${this.options.baseURL.replace(/\/$/, "")}/chat/completions`;
    }

    /**
     * 构造 Chat Completions 请求体。
     */
    private buildRequestBody(request: ChatModelRequest, stream: boolean): Record<string, unknown> {
        return {
            model: this.options.modelId,
            messages: request.messages.map((message) => this.toOpenAIMessage(message)),
            stream,
            ...(stream ? {stream_options: {include_usage: true}} : {}),
            ...(request.tools && request.tools.length > 0 ? {tools: request.tools.map((tool) => this.toOpenAITool(tool))} : {}),
            ...(this.options.enableThinking ? {thinking: {type: "enabled"}} : {}),
        };
    }

    /**
     * 转换消息格式。
     */
    private toOpenAIMessage(message: AgentMessage): Record<string, unknown> {
        if (message.role === "tool") {
            return {
                role: "tool",
                tool_call_id: message.toolCallId,
                content: message.content,
            };
        }
        return {
            role: message.role,
            content: message.content,
            ...(message.toolCalls.length > 0 ? {
                tool_calls: message.toolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    type: "function",
                    function: {
                        name: toolCall.name,
                        arguments: toolCall.argsText,
                    },
                })),
            } : {}),
        };
    }

    /**
     * 转换工具定义。
     */
    private toOpenAITool(tool: AgentToolDefinition): Record<string, unknown> {
        return {
            type: "function",
            function: {
                name: tool.key,
                description: tool.description,
                parameters: tool.parameters,
            },
        };
    }

    /**
     * 解析单行 SSE data。
     */
    private parseSseLine(line: string, drafts: Map<number, ChatModelToolCallDraft>): ChatModelStreamEvent | null {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
            return null;
        }
        const data = trimmed.slice("data:".length).trim();
        if (!data || data === "[DONE]") {
            return null;
        }
        const parsed = JSON.parse(data) as {
            choices?: Array<{
                delta?: {
                    content?: string;
                    reasoning_content?: string;
                    thinking_content?: string;
                    tool_calls?: Array<{
                        index?: number;
                        id?: string;
                        function?: {
                            name?: string;
                            arguments?: string;
                        };
                    }>;
                };
            }>;
            usage?: OpenAIUsage | null;
        };
        const usage = this.readUsage(parsed.usage ?? undefined);
        if (this.hasUsage(usage)) {
            return {
                type: "usage",
                usage,
            };
        }

        const delta = parsed.choices?.[0]?.delta;
        const thinkingText = delta?.reasoning_content ?? delta?.thinking_content ?? "";
        if (thinkingText) {
            return {
                type: "thinking_delta",
                chunkText: thinkingText,
            };
        }
        if (delta?.content) {
            return {
                type: "assistant_delta",
                chunkText: delta.content,
            };
        }
        const toolCallDelta = delta?.tool_calls?.find((toolCall) => typeof toolCall.index === "number");
        if (!toolCallDelta || typeof toolCallDelta.index !== "number") {
            return null;
        }
        const draft = drafts.get(toolCallDelta.index) ?? {
            index: toolCallDelta.index,
            id: "",
            name: "",
            argsText: "",
        };
        draft.id = toolCallDelta.id ?? draft.id;
        draft.name = toolCallDelta.function?.name ?? draft.name;
        draft.argsText += toolCallDelta.function?.arguments ?? "";
        drafts.set(toolCallDelta.index, draft);
        return {
            type: "tool_call_delta",
            callIndex: toolCallDelta.index,
            toolCallId: toolCallDelta.id,
            toolName: toolCallDelta.function?.name,
            argsChunk: toolCallDelta.function?.arguments,
        };
    }

    /**
     * 读取完整 tool call。
     */
    private readToolCalls(toolCalls: OpenAIToolCall[]): AgentToolCall[] {
        return toolCalls.map((toolCall) => ({
            id: toolCall.id ?? "",
            name: toolCall.function?.name ?? "",
            argsText: toolCall.function?.arguments ?? "",
        })).filter((toolCall) => toolCall.id && toolCall.name);
    }

    /**
     * 读取 token usage。
     */
    private readUsage(usage: OpenAIUsage | undefined): AgentModelUsage {
        return {
            inputTokens: this.readNumber(usage?.prompt_tokens),
            outputTokens: this.readNumber(usage?.completion_tokens),
            totalTokens: this.readNumber(usage?.total_tokens),
        };
    }

    /**
     * 判断 usage 是否有效。
     */
    private hasUsage(usage: AgentModelUsage): boolean {
        return [usage.inputTokens, usage.outputTokens, usage.totalTokens].some((value) => typeof value === "number" && value > 0);
    }

    /**
     * 读取有限数字。
     */
    private readNumber(value: unknown): number | null {
        return typeof value === "number" && Number.isFinite(value) ? value : null;
    }
}

/**
 * OpenAI 官方兼容模型。
 */
export class OpenAIChatModel extends OpenAICompatibleChatModel {}

/**
 * DeepSeek 官方兼容模型。
 */
export class DeepSeekChatModel extends OpenAICompatibleChatModel {
    constructor(options: Omit<OpenAICompatibleChatModelOptions, "enableThinking"> & {enableThinking?: boolean}) {
        super({
            ...options,
            enableThinking: options.enableThinking ?? true,
        });
    }
}
