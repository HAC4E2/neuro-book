import {AIMessage, HumanMessage, ToolResultMessage} from "nbook/server/agent-v3/neuro-agent/messages";
import type {AgentMessage, AgentToolCall} from "nbook/server/agent-v3/neuro-agent/messages";
import type {ChatModel, ChatModelStreamEvent} from "nbook/server/agent-v3/neuro-agent/chat-model";
import {NeuroAgentTool} from "nbook/server/agent-v3/neuro-agent/tool";

export type NeuroAgentEvent =
    | {type: "thinking_delta"; chunkText: string}
    | {type: "assistant_delta"; chunkText: string}
    | {type: "tool_call_delta"; callIndex: number; toolCallId?: string; toolName?: string; argsChunk?: string}
    | {type: "tool_started"; runId: string; toolName: string; inputText: string}
    | {type: "tool_finished"; runId: string; toolName: string; outputText: string}
    | {type: "usage"; usage: {inputTokens: number | null; outputTokens: number | null; totalTokens: number | null}}
    | {type: "done"; messageText: string; message: AIMessage}
    | {type: "error"; message: string};

export type NeuroAgentRunInput = {
    messages: AgentMessage[];
    prompt?: string;
    signal?: AbortSignal;
};

export type NeuroAgentOptions = {
    model: ChatModel;
    tools?: NeuroAgentTool[];
    maxIterations?: number;
};

const DEFAULT_MAX_ITERATIONS = 20;

/**
 * 创建一个 NeuroAgent。
 */
export function createAgent(options: NeuroAgentOptions): NeuroAgent {
    return new NeuroAgent(options);
}

/**
 * 自研最小 Agent loop。
 */
export class NeuroAgent {
    private readonly maxIterations: number;

    constructor(
        private readonly options: NeuroAgentOptions,
    ) {
        this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    }

    /**
     * 非流式执行，返回最终 AI 消息。
     */
    async invoke(input: NeuroAgentRunInput): Promise<AIMessage> {
        let finalMessage = new AIMessage("");
        for await (const event of this.stream(input)) {
            if (event.type === "error") {
                throw new Error(event.message);
            }
            if (event.type === "done") {
                finalMessage = event.message;
            }
        }
        return finalMessage;
    }

    /**
     * 流式执行 Agent loop。
     */
    async *stream(input: NeuroAgentRunInput): AsyncIterable<NeuroAgentEvent> {
        const messages = this.buildInitialMessages(input);
        try {
            for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
                const modelMessage = yield* this.runModelTurn(messages, input.signal);
                messages.push(modelMessage);
                if (modelMessage.toolCalls.length === 0) {
                    yield {
                        type: "done",
                        messageText: modelMessage.content,
                        message: modelMessage,
                    };
                    return;
                }
                yield* this.runTools(messages, modelMessage.toolCalls);
            }
            yield {
                type: "error",
                message: `Agent loop 超过最大迭代次数：${String(this.maxIterations)}`,
            };
        } catch (error) {
            yield {
                type: "error",
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * 构造本轮初始消息。
     */
    private buildInitialMessages(input: NeuroAgentRunInput): AgentMessage[] {
        return [
            ...input.messages,
            ...(input.prompt ? [new HumanMessage(input.prompt)] : []),
        ];
    }

    /**
     * 执行一轮模型调用。
     */
    private async *runModelTurn(messages: AgentMessage[], signal?: AbortSignal): AsyncGenerator<NeuroAgentEvent, AIMessage> {
        let message = new AIMessage("");
        for await (const event of this.options.model.stream({
            messages,
            tools: this.options.tools?.map((tool) => tool.schema),
            signal,
        })) {
            const normalizedEvent = this.normalizeModelEvent(event);
            if (normalizedEvent) {
                yield normalizedEvent;
            }
            if (event.type === "done") {
                message = event.message;
            }
        }
        return message;
    }

    /**
     * 执行模型请求的工具。
     */
    private async *runTools(messages: AgentMessage[], toolCalls: AgentToolCall[]): AsyncGenerator<NeuroAgentEvent> {
        for (const toolCall of toolCalls) {
            const tool = this.options.tools?.find((item) => item.definition.key === toolCall.name);
            if (!tool) {
                throw new Error(`未知工具：${toolCall.name}`);
            }
            yield {
                type: "tool_started",
                runId: toolCall.id,
                toolName: toolCall.name,
                inputText: toolCall.argsText,
            };
            const outputText = await tool.execute(toolCall.argsText);
            messages.push(new ToolResultMessage({
                toolCallId: toolCall.id,
                content: outputText,
            }));
            yield {
                type: "tool_finished",
                runId: toolCall.id,
                toolName: toolCall.name,
                outputText,
            };
        }
    }

    /**
     * 转换模型事件为 Agent 事件。
     */
    private normalizeModelEvent(event: ChatModelStreamEvent): NeuroAgentEvent | null {
        if (event.type === "done") {
            return null;
        }
        return event;
    }
}
