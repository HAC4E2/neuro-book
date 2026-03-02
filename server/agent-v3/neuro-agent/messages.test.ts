import {describe, expect, it} from "vitest";
import {AIMessage, HumanMessage, SystemMessage, ToolResultMessage} from "nbook/server/agent-v3/neuro-agent/messages";

describe("NeuroAgent messages", () => {
    it("会创建并序列化常见消息", () => {
        const system = new SystemMessage("规则");
        const human = new HumanMessage("你好");
        const ai = new AIMessage({
            content: "",
            toolCalls: [{
                id: "call-1",
                name: "demo",
                argsText: "{\"text\":\"hi\"}",
            }],
        });
        const tool = new ToolResultMessage({
            toolCallId: "call-1",
            content: "ok",
        });

        expect(system.toJSON()).toEqual({
            role: "system",
            content: "规则",
        });
        expect(human.toJSON()).toEqual({
            role: "user",
            content: "你好",
        });
        expect(ai.toJSON()).toEqual({
            role: "assistant",
            content: "",
            toolCalls: [{
                id: "call-1",
                name: "demo",
                argsText: "{\"text\":\"hi\"}",
            }],
        });
        expect(tool.toJSON()).toEqual({
            role: "tool",
            content: "ok",
            toolCallId: "call-1",
        });
    });
});
