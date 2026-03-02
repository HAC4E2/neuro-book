import {describe, expect, it} from "vitest";
import {AgentRunMemory} from "nbook/server/agent-v3/runtime/agent-run-memory";
import {AgentRunner} from "nbook/server/agent-v3/runtime/agent-runner";
import {AgentToolRegistry} from "nbook/server/agent-v3/tool/tool-registry";
import {AIMessage} from "nbook/server/agent-v3/neuro-agent";
import type {ChatModel, ChatModelRequest, ChatModelStreamEvent} from "nbook/server/agent-v3/neuro-agent";

class TestChatModel implements ChatModel {
    /**
     * 非流式测试不使用。
     */
    async invoke(_request: ChatModelRequest): Promise<AIMessage> {
        return new AIMessage("你好");
    }

    /**
     * 返回固定事件流。
     */
    async *stream(_request: ChatModelRequest): AsyncIterable<ChatModelStreamEvent> {
        yield {
            type: "assistant_delta",
            chunkText: "你好",
        };
        yield {
            type: "done",
            message: new AIMessage("你好"),
        };
    }
}

describe("AgentRunner", () => {
    it("会把用户输入和 assistant 输出写入内存", async () => {
        const memory = new AgentRunMemory();
        const runner = new AgentRunner(new AgentToolRegistry(), memory, new TestChatModel());
        const events = [];

        for await (const event of runner.run({prompt: "hello"})) {
            events.push(event);
        }

        expect(events).toEqual([
            {
                type: "assistant_delta",
                chunkText: "你好",
            },
            {
                type: "done",
                messageText: "你好",
            },
        ]);
        expect(memory.snapshot.messages.map((message) => message.content)).toEqual([
            "hello",
            "你好",
        ]);
    });
});
