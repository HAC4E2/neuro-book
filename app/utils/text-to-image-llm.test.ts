import {describe, expect, it} from "vitest";
import {buildTextToImageLlmMessages, formatTextToImageLlmMessages} from "nbook/app/utils/text-to-image-llm";

describe("text-to-image LLM messages", () => {
    it("renders request variables into a matching context placeholder without duplicate user input", () => {
        const messages = buildTextToImageLlmMessages({
            task: "characterDesign",
            userRequest: "角色设定",
            taskPrompt: "返回 JSON",
            requestVariables: {character: "小明"},
            contextPreset: {
                id: "preset-1",
                name: "角色设计",
                updatedAt: null,
                entries: [{
                    id: "entry-1",
                    name: "固定上下文",
                    role: "system",
                    triggerMode: "always",
                    enabled: true,
                    content: "角色：{{ character }}，请求：{{ request }}",
                }],
            },
        });

        expect(messages).toEqual([
            {role: "system", content: "角色：小明，请求：角色设定"},
            {role: "system", content: "返回 JSON"},
        ]);
        expect(formatTextToImageLlmMessages(messages)).toContain("#1 SYSTEM");
    });

    it("keeps trigger-only entries out of unrelated requests", () => {
        const messages = buildTextToImageLlmMessages({
            task: "bodyImage",
            userRequest: "雨夜街道",
            contextPreset: {
                id: "preset-1",
                name: "正文",
                updatedAt: null,
                entries: [{
                    id: "entry-1",
                    name: "战斗",
                    role: "system",
                    triggerMode: "trigger",
                    enabled: true,
                    content: "战斗构图规则",
                }],
            },
        });

        expect(messages).toEqual([{role: "user", content: "雨夜街道"}]);
    });
});
