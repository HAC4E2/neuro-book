import {describe, expect, it} from "vitest";
import {
    extractTagModifyPrompt,
    generateTagModifyPrompt,
} from "nbook/server/text-to-image/tag-modify-llm";
import type {RequestLlmCompletionInput} from "nbook/server/text-to-image/llm-chat";

const provider = {
    baseUrl: "https://llm.example.com/v1",
    credential: "sk-test",
    settings: {
        model: "tag-model",
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 512,
        stream: true,
        sendImages: false,
        mergeSystemUser: false,
        retryCount: 1,
    },
};

describe("tag modify llm", () => {
    it("accepts plain tags and the existing image wrappers", () => {
        expect(extractTagModifyPrompt("1girl, silver hair, blue eyes")).toBe(
            "1girl, silver hair, blue eyes",
        );
        expect(extractTagModifyPrompt("image###1girl, silver hair###")).toBe(
            "1girl, silver hair",
        );
        expect(extractTagModifyPrompt("<image><prompts>1girl, silver hair</prompts></image>")).toBe(
            "1girl, silver hair",
        );
    });

    it("removes reasoning blocks and rejects empty output", () => {
        expect(extractTagModifyPrompt("<thinking>draft</thinking>1girl, portrait")).toBe(
            "1girl, portrait",
        );
        expect(() => extractTagModifyPrompt("<image> </image>")).toThrow(/Tag/iu);
    });

    it("uses the tag_modify prompt contract, context entries and LLM reply token setting", async () => {
        let captured: RequestLlmCompletionInput | undefined;
        const complete = async (input: RequestLlmCompletionInput): Promise<string> => {
            captured = input;
            return "image###1girl, silver hair, blue eyes###";
        };

        const prompt = await generateTagModifyPrompt({
            provider,
            currentPrompt: "1girl, black hair, blue eyes",
            modificationRequest: "把头发改成银色，保留眼睛和构图",
            contextEntries: [{
                id: "always",
                name: "Tag rules",
                role: "system",
                content: "Use English NovelAI tags.",
                enabled: true,
                triggerMode: "always",
                triggerWords: "",
                andTriggerWords: "",
            }],
            runtime: {
                context: "current image context",
                userDemand: "把头发改成银色，保留眼睛和构图",
            },
            complete,
        });

        expect(prompt).toBe("1girl, silver hair, blue eyes");
        expect(captured?.model).toBe("tag-model");
        expect(captured?.maxTokens).toBe(512);
        expect(captured?.stream).toBe(false);
        expect(captured?.messages[0]?.content).toContain("Use English NovelAI tags.");
        expect(captured?.messages.at(-1)?.content).toContain("1girl, black hair, blue eyes");
        expect(captured?.messages.at(-1)?.content).toContain("把头发改成银色");
    });
});
