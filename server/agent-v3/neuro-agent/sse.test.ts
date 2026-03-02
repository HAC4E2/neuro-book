import {describe, expect, it} from "vitest";
import {AIMessage} from "nbook/server/agent-v3/neuro-agent/messages";
import {toSseStream} from "nbook/server/agent-v3/neuro-agent/sse";
import type {NeuroAgentEvent} from "nbook/server/agent-v3/neuro-agent/agent";

/**
 * 创建事件流。
 */
async function* createEvents(): AsyncGenerator<NeuroAgentEvent> {
    yield {
        type: "assistant_delta",
        chunkText: "你好",
    };
    yield {
        type: "done",
        messageText: "你好",
        message: new AIMessage("你好"),
    };
}

describe("toSseStream", () => {
    it("会输出合法 SSE 帧", async () => {
        const stream = toSseStream(createEvents());
        const text = await new Response(stream).text();

        expect(text).toContain("event: assistant_delta\n");
        expect(text).toContain("data: {\"type\":\"assistant_delta\",\"chunkText\":\"你好\"}\n\n");
        expect(text).toContain("event: done\n");
    });
});
