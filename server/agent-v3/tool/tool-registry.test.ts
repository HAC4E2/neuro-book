import {describe, expect, it} from "vitest";
import {z} from "zod";
import {AgentToolRegistry} from "nbook/server/agent-v3/tool/tool-registry";
import type {AgentTool} from "nbook/server/agent-v3/tool/tool.types";

const demoTool: AgentTool = {
    key: "demo",
    description: "测试工具",
    schema: z.object({
        text: z.string(),
    }),
    /**
     * 返回输入文本。
     */
    async execute(input) {
        return {
            content: String((input as {text: string}).text),
        };
    },
};

describe("AgentToolRegistry", () => {
    it("会注册、读取并转换工具", async () => {
        const registry = new AgentToolRegistry();
        registry.register(demoTool);

        const agentTools = registry.toAgentTools({
            writeOutput() {},
        });

        expect(registry.listKeys()).toEqual(["demo"]);
        expect(registry.get("demo")).toBe(demoTool);
        expect(agentTools).toHaveLength(1);
        expect(agentTools[0]!.schema.key).toBe("demo");
        expect(await agentTools[0]!.execute("{\"text\":\"hello\"}")).toBe("hello");
    });

    it("会拒绝重复或未知工具", () => {
        const registry = new AgentToolRegistry();
        registry.register(demoTool);

        expect(() => registry.register(demoTool)).toThrow(/重复的 tool key/);
        expect(() => registry.get("missing")).toThrow(/未知的 tool key/);
    });
});
