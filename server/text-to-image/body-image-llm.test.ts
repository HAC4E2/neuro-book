import {describe, expect, it} from "vitest";
import {
    requestLlmCompletion,
    type RequestLlmCompletionInput,
} from "nbook/server/text-to-image/llm-chat";
import {
    generateBodyImageBlocks,
    parseBodyImageBlocks,
} from "nbook/server/text-to-image/body-image-llm";

const XML_BLOCK = [
    "<image>",
    "<regex>她推开门走进教室</regex>",
    "<title_styled>晨光教室</title_styled>",
    "<Tag_think>教室、清晨、小克站在窗边</Tag_think>",
    "<size>832x1216</size>",
    "<prompts>",
    "<scene_composition>classroom,morning light</scene_composition>",
    "<character_1>",
    "<prompt>1girl,long black hair,blue eyes,standing by window</prompt>",
    "</character_1>",
    "</prompts>",
    "</image>",
].join("\n");

const XML_BLOCK_2 = [
    "<image>",
    "<regex>他转身关上门</regex>",
    "<title_styled>黄昏走廊</title_styled>",
    "<Tag_think>走廊、黄昏、背影</Tag_think>",
    "<size>1216x832</size>",
    "<prompts>1boy,corridor,sunset light,walking away</prompts>",
    "</image>",
].join("\n");

describe("body image llm", () => {
    it("extracts scene prompt and up to four structured character slots", () => {
        const block = parseBodyImageBlocks(`<content><images>${XML_BLOCK}</images></content>`)[0]!;

        expect(block.prompt).toBe("classroom,morning light");
        expect(block.characterPrompts).toEqual([{
            prompt: "1girl,long black hair,blue eyes,standing by window",
            negativePrompt: "",
        }]);
    });

    it("includes same-volume history as prompt context without changing the current chapter prompt", async () => {
        let lastInput: RequestLlmCompletionInput | undefined;
        const complete: typeof requestLlmCompletion = async (input) => {
            lastInput = input;
            return `<content><images>${XML_BLOCK}</images></content>`;
        };

        await generateBodyImageBlocks({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {baseUrl: "https://api.example.com/v1", model: "gpt-4o"},
            },
            chapterContent: "current chapter",
            characterSummary: "",
            historyPrefill: [{
                path: "manuscript/001-volume/001-chapter/index.md",
                content: "previous chapter",
            }],
            complete,
        });

        expect(lastInput?.messages.some((message) => String(message.content).includes("previous chapter"))).toBe(true);
        expect(lastInput?.messages.at(-1)?.role).toBe("user");
        expect(String(lastInput?.messages.at(-1)?.content)).toContain("current chapter");
    });

    it("解析 <content>/<images>/<image> 五要素块", () => {
        const blocks = parseBodyImageBlocks(`<content><images>${XML_BLOCK}</images></content>`);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({
            regex: "她推开门走进教室",
            title: "晨光教室",
            tagThink: "教室、清晨、小克站在窗边",
            size: "832x1216",
        });
        expect(blocks[0]?.prompts).toContain("classroom,morning light");
        expect(blocks[0]?.prompts).toContain("<prompt>");
    });

    it("解析多个 image 块并按顺序返回", () => {
        const blocks = parseBodyImageBlocks(`<content><images>${XML_BLOCK}\n${XML_BLOCK_2}</images></content>`);

        expect(blocks).toHaveLength(2);
        expect(blocks[0]?.title).toBe("晨光教室");
        expect(blocks[1]?.title).toBe("黄昏走廊");
        expect(blocks[1]?.prompts).toBe("1boy,corridor,sunset light,walking away");
    });

    it("没有 image 块时抛错", () => {
        expect(() => parseBodyImageBlocks("<content>没有图片</content>")).toThrow(/未找到 <image> 块/);
    });

    it("image 块缺少 regex 或 prompts 时抛错", () => {
        const invalid = [
            "<image>",
            "<title_styled>标题</title_styled>",
            "<Tag_think>思考</Tag_think>",
            "<size>832x1216</size>",
            "</image>",
        ].join("\n");

        expect(() => parseBodyImageBlocks(invalid)).toThrow(/regex|prompts/);
    });

    it("generate 使用注入 complete 并固定 maxTokens/stream", async () => {
        let lastInput: RequestLlmCompletionInput | undefined;
        const complete: typeof requestLlmCompletion = async (input) => {
            lastInput = input;
            return `<content><images>${XML_BLOCK}</images></content>`;
        };

        const blocks = await generateBodyImageBlocks({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {
                    baseUrl: "https://api.example.com/v1",
                    model: "gpt-4o",
                    temperature: 0.8,
                    topP: 0.9,
                    maxTokens: 12345,
                    stream: false,
                    sendImages: false,
                    mergeSystemUser: false,
                    retryCount: 0,
                },
            },
            chapterContent: "第一章正文。",
            characterSummary: "小克：long black hair",
            complete,
        });

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.regex).toBe("她推开门走进教室");
        expect(lastInput?.baseUrl).toBe("https://api.example.com/v1");
        expect(lastInput?.model).toBe("gpt-4o");
        expect(lastInput?.maxTokens).toBe(12345);
        expect(lastInput?.stream).toBe(false);
        expect(lastInput?.messages[0]?.role).toBe("system");
        expect(lastInput?.messages[1]?.role).toBe("user");
        expect(String(lastInput?.messages[1]?.content)).toContain("第一章正文。");
    });

    it("解析失败最多重试 2 次后成功", async () => {
        let calls = 0;
        const complete: typeof requestLlmCompletion = async () => {
            calls += 1;
            return calls === 1
                ? "坏输出"
                : `<content><images>${XML_BLOCK}</images></content>`;
        };

        const blocks = await generateBodyImageBlocks({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {baseUrl: "https://api.example.com/v1", model: "gpt-4o"},
            },
            chapterContent: "正文",
            characterSummary: "",
            complete,
        });

        expect(calls).toBe(2);
        expect(blocks[0]?.regex).toBe("她推开门走进教室");
    });

    it("连续解析失败抛错", async () => {
        let calls = 0;
        const complete: typeof requestLlmCompletion = async () => {
            calls += 1;
            return "坏输出";
        };

        await expect(generateBodyImageBlocks({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {baseUrl: "https://api.example.com/v1", model: "gpt-4o"},
            },
            chapterContent: "正文",
            characterSummary: "",
            complete,
        })).rejects.toThrow(/解析失败/);
        expect(calls).toBe(3);
    });

    it("rejects more than four character slots instead of silently truncating", () => {
        const slots = Array.from({length: 5}, (_, index) => (
            `<character_${index + 1}><prompt>character ${index + 1}</prompt></character_${index + 1}>`
        )).join("");
        expect(() => parseBodyImageBlocks(`<image><regex>anchor</regex><prompts>${slots}</prompts></image>`))
            .toThrow(/4/);
    });

    it("rejects an explicitly invalid character center", () => {
        expect(() => parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts><character_1><prompt>character</prompt><center>2,0.5</center></character_1></prompts></image>",
        )).toThrow(/center/);
    });
});
