import {AIMessage, ToolMessage} from "@langchain/core/messages";
import {describe, expect, it} from "vitest";
import {toAgentMessageCreateInput, toLangChainMessage, toModelHistoryMessages, toStoredMessage} from "nbook/server/agent/messages/codec";
import {createAgentMessage} from "nbook/server/agent/test/fixtures";

describe("agent message codec", () => {
    it("使用 LangChain StoredMessage 保留 assistant 扩展字段", () => {
        const source = new AIMessage({
            id: "assistant-1",
            content: "完成",
            additional_kwargs: {
                reasoning_content: "需要读取文件",
                thinking: "需要读取文件",
            },
            tool_calls: [{
                id: "call-1",
                name: "read_file",
                args: {
                    filePath: "AGENTS.md",
                },
                type: "tool_call",
            }],
            usage_metadata: {
                input_tokens: 10,
                output_tokens: 5,
                total_tokens: 15,
            },
        });
        const input = toAgentMessageCreateInput(source, {
            id: "assistant-1",
            createdAt: "2026-04-05T00:00:00.000Z",
        });
        const storedMessage = toStoredMessage(input, {
            id: "assistant-1",
            status: "done",
            createdAt: "2026-04-05T00:00:00.000Z",
        });

        const restored = toLangChainMessage(createAgentMessage({
            id: "assistant-1",
            origin: "assistant_output",
            storedMessage,
        }));

        expect(AIMessage.isInstance(restored)).toBe(true);
        expect(restored.additional_kwargs.reasoning_content).toBe("需要读取文件");
        expect((restored as AIMessage).tool_calls).toMatchObject([{id: "call-1", name: "read_file"}]);
        expect((restored as AIMessage).usage_metadata?.total_tokens).toBe(15);
        expect(restored.additional_kwargs.messageId).toBe("assistant-1");
    });

    it("模型历史发送前会剥离 tool 内部 raw result", () => {
        const history = toModelHistoryMessages([
            createAgentMessage({
                id: "assistant-1",
                origin: "assistant_output",
                storedMessage: toStoredMessage(toAgentMessageCreateInput(new AIMessage({
                    id: "assistant-1",
                    content: "",
                    tool_calls: [{
                        id: "call-1",
                        name: "read_file",
                        args: {
                            filePath: "chapter.md",
                        },
                        type: "tool_call",
                    }],
                }), {
                    id: "assistant-1",
                }), {
                    id: "assistant-1",
                    status: "done",
                    createdAt: "2026-04-05T00:00:00.000Z",
                }),
            }),
            createAgentMessage({
                id: "tool-message-1",
                role: "tool",
                origin: "tool_result",
                content: "读取成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolArgs: "{\"filePath\":\"chapter.md\"}",
                rawAdditionalKwargs: {
                    assistantMessageId: "assistant-1",
                    toolResultRaw: {
                        ok: true,
                    },
                },
            }),
        ]);

        expect(ToolMessage.isInstance(history[1])).toBe(true);
        expect(history[1]?.additional_kwargs.assistantMessageId).toBe("assistant-1");
        expect("toolResultRaw" in (history[1]?.additional_kwargs ?? {})).toBe(false);
    });

    it("模型历史会为缺失的 tool_call_id 补失败 ToolMessage", () => {
        const history = toModelHistoryMessages([
            createAssistantToolCallMessage("assistant-1", [
                {id: "call-1", name: "read_file"},
                {id: "call-2", name: "execute_shell"},
                {id: "call-3", name: "write_file"},
            ]),
            createAgentMessage({
                id: "call-1",
                role: "tool",
                origin: "tool_result",
                content: "读取成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
            createAgentMessage({
                id: "call-2",
                role: "tool",
                origin: "tool_result",
                content: "命令成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-2",
                toolName: "execute_shell",
                toolStatus: "success",
            }),
        ]);

        expect(history).toHaveLength(4);
        expect(history.filter((message) => ToolMessage.isInstance(message)).map((message) => (message as ToolMessage).tool_call_id)).toEqual([
            "call-1",
            "call-2",
            "call-3",
        ]);
        expect((history[3] as ToolMessage).status).toBe("error");
        expect(history[3]?.text).toContain("Tool call canceled by user before it returned.");
    });

    it("模型历史允许 tool results 与 tool_calls 顺序不同", () => {
        const history = toModelHistoryMessages([
            createAssistantToolCallMessage("assistant-1", [
                {id: "call-1", name: "read_file"},
                {id: "call-2", name: "execute_shell"},
            ]),
            createAgentMessage({
                id: "call-2",
                role: "tool",
                origin: "tool_result",
                content: "命令成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-2",
                toolName: "execute_shell",
                toolStatus: "success",
            }),
            createAgentMessage({
                id: "call-1",
                role: "tool",
                origin: "tool_result",
                content: "读取成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
        ]);

        expect(history.filter((message) => ToolMessage.isInstance(message)).map((message) => (message as ToolMessage).tool_call_id)).toEqual([
            "call-2",
            "call-1",
        ]);
    });

    it("模型历史会丢弃孤立 ToolMessage", () => {
        const history = toModelHistoryMessages([
            createAgentMessage({
                id: "tool-message-1",
                role: "tool",
                origin: "tool_result",
                content: "读取成功",
                toolCallId: "call-1",
                toolName: "read_file",
            }),
        ]);

        expect(history).toEqual([]);
    });

    it("普通 LangChain 还原会保留产品历史 metadata", () => {
        const message = toLangChainMessage(createAgentMessage({
            role: "system",
            content: "你是 leader",
        }));

        expect(message.additional_kwargs.messageId).toBe("message-1");
        expect(message.additional_kwargs.messageStatus).toBe("done");
    });
});

function createAssistantToolCallMessage(id: string, toolCalls: Array<{id: string; name: string}>) {
    const input = toAgentMessageCreateInput(new AIMessage({
        id,
        content: "",
        tool_calls: toolCalls.map((toolCall) => ({
            ...toolCall,
            args: {},
            type: "tool_call",
        })),
    }), {
        id,
    });
    return createAgentMessage({
        id,
        storedMessage: toStoredMessage(input, {
            id,
            status: "done",
            createdAt: "2026-04-05T00:00:00.000Z",
        }),
    });
}
