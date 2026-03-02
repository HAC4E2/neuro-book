import {describe, expect, it} from "vitest";
import {createChatModel, resolveDeepSeekFlashConfig} from "nbook/server/agent-v3/model-provider/model-provider";
import {hasUsage, readThinkingText, readUsage} from "nbook/server/agent-v3/model-provider/model-inspector";
import type {AgentModelUsage} from "nbook/server/agent-v3/model-provider/model-provider.types";
import {HumanMessage} from "nbook/server/agent-v3/neuro-agent";

describe("model-provider", () => {
    it("会从 config.yaml 读取 deepseek-v4-flash 配置", () => {
        const config = resolveDeepSeekFlashConfig();

        expect(config.modelKey).toBe("deepseek/deepseek-v4-flash");
        expect(config.modelId).toBe("deepseek-v4-flash");
        expect(config.baseURL).toContain("deepseek");
        expect(config.apiKey.length).toBeGreaterThan(0);
    });

    it("会真实调用 DeepSeek 并返回正文、思维链和 usage", async () => {
        const model = createChatModel();
        const stream = model.stream({
            messages: [
                new HumanMessage("天空为什么是蓝色。"),
            ],
        });
        let text = "";
        let thinkingText = "";
        let usage: AgentModelUsage = {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
        };

        for await (const chunk of stream) {
            if (chunk.type === "assistant_delta") {
                text += chunk.chunkText;
            }
            thinkingText += readThinkingText(chunk);
            const chunkUsage = readUsage(chunk);
            usage = {
                inputTokens: chunkUsage.inputTokens ?? usage.inputTokens,
                outputTokens: chunkUsage.outputTokens ?? usage.outputTokens,
                totalTokens: chunkUsage.totalTokens ?? usage.totalTokens,
            };
        }

        expect(text.trim().length).toBeGreaterThan(0);
        expect(thinkingText.trim().length).toBeGreaterThan(0);
        expect(hasUsage(usage)).toBe(true);
    }, 120_000);
});
