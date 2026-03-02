import {describe, expect, it} from "vitest";
import {z} from "zod";
import {createAgent} from "nbook/server/agent-v3/neuro-agent/agent";
import {AIMessage, HumanMessage} from "nbook/server/agent-v3/neuro-agent/messages";
import {NeuroAgentTool} from "nbook/server/agent-v3/neuro-agent/tool";
import type {ChatModel, ChatModelRequest, ChatModelStreamEvent} from "nbook/server/agent-v3/neuro-agent/chat-model";
import type {AgentTool} from "nbook/server/agent-v3/tool/tool.types";

class ScriptedModel implements ChatModel {
    private index = 0;

    constructor(
        private readonly messages: AIMessage[],
    ) {}

    /**
     * 非流式返回下一条脚本消息。
     */
    async invoke(_request: ChatModelRequest): Promise<AIMessage> {
        return this.nextMessage();
    }

    /**
     * 流式返回下一条脚本消息。
     */
    async *stream(_request: ChatModelRequest): AsyncIterable<ChatModelStreamEvent> {
        const message = this.nextMessage();
        if (message.content) {
            yield {
                type: "assistant_delta",
                chunkText: message.content,
            };
        }
        for (const [callIndex, toolCall] of message.toolCalls.entries()) {
            yield {
                type: "tool_call_delta",
                callIndex,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                argsChunk: toolCall.argsText,
            };
        }
        yield {
            type: "done",
            message,
        };
    }

    /**
     * 读取下一条脚本消息。
     */
    private nextMessage(): AIMessage {
        const message = this.messages[this.index];
        if (!message) {
            throw new Error("脚本消息不足");
        }
        this.index += 1;
        return message;
    }
}

const demoTool: AgentTool = {
    key: "demo_tool",
    description: "测试工具",
    schema: z.object({
        text: z.string(),
    }),
    /**
     * 返回工具输入。
     */
    async execute(input) {
        return {
            content: `tool:${String((input as {text: string}).text)}`,
        };
    },
};

describe("createAgent", () => {
    it("无工具调用时直接完成", async () => {
        const agent = createAgent({
            model: new ScriptedModel([new AIMessage("完成")]),
        });

        const events = [];
        for await (const event of agent.stream({messages: [new HumanMessage("hello")]})) {
            events.push(event);
        }

        expect(events).toEqual([
            {
                type: "assistant_delta",
                chunkText: "完成",
            },
            {
                type: "done",
                messageText: "完成",
                message: expect.objectContaining({
                    content: "完成",
                }),
            },
        ]);
    });

    it("有工具调用时会执行工具并继续下一轮", async () => {
        const agent = createAgent({
            model: new ScriptedModel([
                new AIMessage({
                    content: "",
                    toolCalls: [{
                        id: "call-1",
                        name: "demo_tool",
                        argsText: "{\"text\":\"hello\"}",
                    }],
                }),
                new AIMessage("最终回答"),
            ]),
            tools: [new NeuroAgentTool(demoTool, {
                writeOutput() {},
            })],
        });

        const events = [];
        for await (const event of agent.stream({messages: [new HumanMessage("hello")]})) {
            events.push(event);
        }

        expect(events).toEqual([
            {
                type: "tool_call_delta",
                callIndex: 0,
                toolCallId: "call-1",
                toolName: "demo_tool",
                argsChunk: "{\"text\":\"hello\"}",
            },
            {
                type: "tool_started",
                runId: "call-1",
                toolName: "demo_tool",
                inputText: "{\"text\":\"hello\"}",
            },
            {
                type: "tool_finished",
                runId: "call-1",
                toolName: "demo_tool",
                outputText: "tool:hello",
            },
            {
                type: "assistant_delta",
                chunkText: "最终回答",
            },
            {
                type: "done",
                messageText: "最终回答",
                message: expect.objectContaining({
                    content: "最终回答",
                }),
            },
        ]);
    });

    it("超过 maxIterations 会返回 error 事件", async () => {
        const agent = createAgent({
            model: new ScriptedModel([
                new AIMessage({
                    content: "",
                    toolCalls: [{
                        id: "call-1",
                        name: "demo_tool",
                        argsText: "{\"text\":\"hello\"}",
                    }],
                }),
            ]),
            tools: [new NeuroAgentTool(demoTool, {
                writeOutput() {},
            })],
            maxIterations: 1,
        });

        const events = [];
        for await (const event of agent.stream({messages: []})) {
            events.push(event);
        }

        expect(events.at(-1)).toEqual({
            type: "error",
            message: "Agent loop 超过最大迭代次数：1",
        });
    });

    it("工具失败会返回 error 事件", async () => {
        const brokenTool: AgentTool = {
            ...demoTool,
            /**
             * 模拟工具失败。
             */
            async execute() {
                throw new Error("tool failed");
            },
        };
        const agent = createAgent({
            model: new ScriptedModel([
                new AIMessage({
                    content: "",
                    toolCalls: [{
                        id: "call-1",
                        name: "demo_tool",
                        argsText: "{\"text\":\"hello\"}",
                    }],
                }),
            ]),
            tools: [new NeuroAgentTool(brokenTool, {
                writeOutput() {},
            })],
        });

        const events = [];
        for await (const event of agent.stream({messages: []})) {
            events.push(event);
        }

        expect(events.at(-1)).toEqual({
            type: "error",
            message: "tool failed",
        });
    });
});
