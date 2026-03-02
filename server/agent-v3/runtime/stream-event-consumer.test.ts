import {describe, expect, it} from "vitest";
import {StreamEventConsumer} from "nbook/server/agent-v3/runtime/stream-event-consumer";
import type {AgentRunEvent} from "nbook/server/agent-v3/runtime/runtime.types";

/**
 * 创建测试用异步事件流。
 */
async function* createEvents(events: AgentRunEvent[]): AsyncGenerator<AgentRunEvent> {
    for (const event of events) {
        yield event;
    }
}

describe("StreamEventConsumer", () => {
    it("会透传 NeuroAgent 事件", async () => {
        const consumer = new StreamEventConsumer();
        const events = consumer.consume(createEvents([
            {
                type: "thinking_delta",
                chunkText: "思考",
            },
            {
                type: "assistant_delta",
                chunkText: "回答",
            },
            {
                type: "done",
                messageText: "回答",
            },
        ]));

        const result = [];
        for await (const event of events) {
            result.push(event);
        }

        expect(result).toEqual([
            {
                type: "thinking_delta",
                chunkText: "思考",
            },
            {
                type: "assistant_delta",
                chunkText: "回答",
            },
            {
                type: "done",
                messageText: "回答",
            },
        ]);
    });

    it("会把异常转换为 error 事件", async () => {
        const consumer = new StreamEventConsumer();
        async function* brokenEvents(): AsyncGenerator<AgentRunEvent> {
            throw new Error("boom");
        }
        const result = [];
        for await (const event of consumer.consume(brokenEvents())) {
            result.push(event);
        }

        expect(result).toEqual([
            {
                type: "error",
                message: "boom",
            },
        ]);
    });
});
