import {describe, expect, it} from "vitest";
import {
    requestLlmCompletion,
    type RequestLlmCompletionInput,
} from "nbook/server/text-to-image/llm-chat";
import {
    extractCharacterPhotoPrompt,
    generateCharacterPhotoPrompt,
} from "nbook/server/text-to-image/character-photo-llm";

const COMPLETE_REPLY = [
    "<image>",
    "<imgthink>角色展示</imgthink>",
    "image###1girl,long black hair,blue eyes,portrait,soft lighting,smile###",
    "</image>",
].join("\n");

describe("character photo llm", () => {
    it("提取 image###...### 中的完整 tag", () => {
        const prompt = extractCharacterPhotoPrompt(COMPLETE_REPLY);

        expect(prompt).toBe("1girl,long black hair,blue eyes,portrait,soft lighting,smile");
    });

    it("没有 image### 标记时抛错", () => {
        expect(() => extractCharacterPhotoPrompt("1girl,portrait")).toThrow(/image###/);
    });

    it("takes the last valid image block and accepts the XML wrapper", () => {
        expect(extractCharacterPhotoPrompt([
            "image###first###",
            "<images><image>second</image></images>",
            "image###last###",
        ].join("\n"))).toBe("last");
        expect(extractCharacterPhotoPrompt("<image>xml prompt</image>")).toBe("xml prompt");
    });

    it("generate 使用注入 complete 并固定 maxTokens/stream", async () => {
        let lastInput: RequestLlmCompletionInput | undefined;
        const complete: typeof requestLlmCompletion = async (input) => {
            lastInput = input;
            return COMPLETE_REPLY;
        };

        const prompt = await generateCharacterPhotoPrompt({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {
                    model: "gpt-4o",
                    temperature: 0.8,
                    topP: 0.9,
                    maxTokens: 4096,
                    stream: false,
                    sendImages: false,
                    mergeSystemUser: false,
                    retryCount: 0,
                },
            },
            characterText: "小克：long black hair, blue eyes",
            outfitText: "校服：white shirt, navy skirt",
            userRequirement: "正面半身像",
            complete,
        });

        expect(prompt).toBe("1girl,long black hair,blue eyes,portrait,soft lighting,smile");
        expect(lastInput?.baseUrl).toBe("https://api.example.com/v1");
        expect(lastInput?.model).toBe("gpt-4o");
        expect(lastInput?.maxTokens).toBe(2048);
        expect(lastInput?.stream).toBe(false);
        expect(lastInput?.messages[0]?.role).toBe("system");
        expect(String(lastInput?.messages[0]?.content)).toContain("image###");
        expect(lastInput?.messages[1]?.role).toBe("user");
        expect(String(lastInput?.messages[1]?.content)).toContain("小克");
        expect(String(lastInput?.messages[1]?.content)).toContain("校服");
        expect(String(lastInput?.messages[1]?.content)).toContain("正面半身像");
    });

    it("LLM 返回空 tag 时抛错", async () => {
        const complete: typeof requestLlmCompletion = async () => "image######";

        await expect(generateCharacterPhotoPrompt({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {model: "gpt-4o"},
            },
            characterText: "小克",
            outfitText: "",
            userRequirement: "",
            complete,
        })).rejects.toThrow(/空/);
    });
});
