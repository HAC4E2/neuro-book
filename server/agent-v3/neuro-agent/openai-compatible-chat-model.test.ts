import {describe, expect, it} from "vitest";
import {HumanMessage} from "nbook/server/agent-v3/neuro-agent/messages";
import {OpenAICompatibleChatModel} from "nbook/server/agent-v3/neuro-agent/openai-compatible-chat-model";

/**
 * 创建 mock fetch。
 */
function createFetch(response: Response): typeof fetch {
    return (async () => response) as typeof fetch;
}

/**
 * 创建 SSE 响应。
 */
function createSseResponse(lines: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoder.encode(lines.join("\n")));
            controller.close();
        },
    }), {
        status: 200,
    });
}

describe("OpenAICompatibleChatModel", () => {
    it("会解析非流式正文、tool calls 和 usage", async () => {
        const model = new OpenAICompatibleChatModel({
            modelId: "demo",
            apiKey: "key",
            baseURL: "https://example.com/v1",
            fetch: createFetch(Response.json({
                choices: [{
                    message: {
                        content: "正文",
                        tool_calls: [{
                            id: "call-1",
                            type: "function",
                            function: {
                                name: "demo_tool",
                                arguments: "{\"a\":1}",
                            },
                        }],
                    },
                }],
                usage: {
                    prompt_tokens: 1,
                    completion_tokens: 2,
                    total_tokens: 3,
                },
            })),
        });

        const message = await model.invoke({
            messages: [new HumanMessage("hello")],
        });

        expect(message.content).toBe("正文");
        expect(message.toolCalls).toEqual([{
            id: "call-1",
            name: "demo_tool",
            argsText: "{\"a\":1}",
        }]);
        expect(message.metadata.usage).toEqual({
            inputTokens: 1,
            outputTokens: 2,
            totalTokens: 3,
        });
    });

    it("会解析 SSE 正文、thinking、tool call、usage 和 done", async () => {
        const model = new OpenAICompatibleChatModel({
            modelId: "demo",
            apiKey: "key",
            baseURL: "https://example.com/v1",
            fetch: createFetch(createSseResponse([
                "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"思考\"}}]}",
                "data: {\"choices\":[{\"delta\":{\"content\":\"回答\"}}]}",
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"demo_tool\",\"arguments\":\"{\\\"a\\\":\"}}]}}]}",
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"1}\"}}]}}]}",
                "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}",
                "data: [DONE]",
            ])),
        });

        const events = [];
        for await (const event of model.stream({messages: [new HumanMessage("hello")]})) {
            events.push(event);
        }

        expect(events).toEqual([
            {
                type: "thinking_delta",
                chunkText: "思考",
            },
            {
                type: "assistant_delta",
                chunkText: "回答",
            },
            {
                type: "tool_call_delta",
                callIndex: 0,
                toolCallId: "call-1",
                toolName: "demo_tool",
                argsChunk: "{\"a\":",
            },
            {
                type: "tool_call_delta",
                callIndex: 0,
                toolCallId: undefined,
                toolName: undefined,
                argsChunk: "1}",
            },
            {
                type: "usage",
                usage: {
                    inputTokens: 1,
                    outputTokens: 2,
                    totalTokens: 3,
                },
            },
            {
                type: "done",
                message: expect.objectContaining({
                    content: "回答",
                    toolCalls: [{
                        id: "call-1",
                        name: "demo_tool",
                        argsText: "{\"a\":1}",
                    }],
                }),
            },
        ]);
    });
});
