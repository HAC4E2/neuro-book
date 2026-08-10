import {describe, expect, it} from "vitest";
import {
    extractLlmImagePrompts,
    extractLastLlmImagePrompt,
    stripLlmReasoningBlocks,
} from "nbook/server/text-to-image/llm-output";

describe("LLM image output compatibility", () => {
    it("extracts XML and legacy image blocks in source order", () => {
        const text = [
            "<images><image>first prompt</image></images>",
            "image###second prompt###",
            "<image>third prompt</image>",
        ].join("\n");

        expect(extractLlmImagePrompts(text)).toEqual([
            "first prompt",
            "second prompt",
            "third prompt",
        ]);
    });

    it("uses the last non-empty image block for single-output workflows", () => {
        expect(extractLastLlmImagePrompt(
            "<image> </image><image>final prompt</image>",
        )).toBe("final prompt");
    });

    it("removes recognized reasoning wrappers without deleting ordinary text", () => {
        const text = [
            "<thinking>internal reasoning</thinking>",
            "<tag_think>more reasoning</tag_think>",
            "<image>usable prompt</image>",
            "<disclaimer>extra explanation</disclaimer>",
            "tail",
        ].join("\n");

        expect(stripLlmReasoningBlocks(text)).toContain("<image>usable prompt</image>");
        expect(stripLlmReasoningBlocks(text)).not.toContain("internal reasoning");
        expect(stripLlmReasoningBlocks(text)).toContain("tail");
    });
});
