import {describe, expect, it} from "vitest";
import {
    requestLlmCompletion,
    type RequestLlmCompletionInput,
} from "nbook/server/text-to-image/llm-chat";
import {
    generateBodyImageBlocks,
    parseBodyImageBlocks,
    parseBodyImageBlocksWithDiagnostics,
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

    it("兼容解析入口在混合回复中保留可用块", () => {
        const invalid = "<image><title_styled>缺少 regex</title_styled><prompts>bad</prompts></image>";
        const blocks = parseBodyImageBlocks(`${XML_BLOCK}\n${invalid}`);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.regex).toBe("她推开门走进教室");
    });

    it("generate 使用注入 complete 并固定 maxTokens/stream", async () => {
        let lastInput: RequestLlmCompletionInput | undefined;
        const complete: typeof requestLlmCompletion = async (input) => {
            lastInput = input;
            return `<content><images>${XML_BLOCK}</images></content>`;
        };

        const result = await generateBodyImageBlocks({
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

        expect(result.blocks).toHaveLength(1);
        expect(result.blocks[0]?.regex).toBe("她推开门走进教室");
        expect(result.diagnostics).toEqual([]);
        expect(lastInput?.baseUrl).toBe("https://api.example.com/v1");
        expect(lastInput?.model).toBe("gpt-4o");
        expect(lastInput?.maxTokens).toBe(12345);
        expect(lastInput?.stream).toBe(false);
        expect(lastInput?.messages[0]?.role).toBe("system");
        expect(lastInput?.messages[1]?.role).toBe("user");
        expect(String(lastInput?.messages[1]?.content)).toContain("第一章正文。");
    });

    it("部分图片块格式异常时保留有效块且不重试整次回复", async () => {
        let calls = 0;
        const invalidBlock = [
            "<image>",
            "<title_styled>缺少锚点</title_styled>",
            "<prompts>still has a prompt</prompts>",
            "</image>",
        ].join("\n");
        const complete: typeof requestLlmCompletion = async () => {
            calls += 1;
            return `<content><images>${XML_BLOCK}\n${invalidBlock}\n${XML_BLOCK_2}</images></content>`;
        };

        const result = await generateBodyImageBlocks({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {baseUrl: "https://api.example.com/v1", model: "gpt-4o"},
            },
            chapterContent: "正文",
            characterSummary: "",
            complete,
        });

        expect(calls).toBe(1);
        expect(result.blocks.map((block) => block.regex)).toEqual([
            "她推开门走进教室",
            "他转身关上门",
        ]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                blockIndex: 2,
                code: "block_invalid",
                action: "skipped",
            }),
        ]);
    });

    it("在 L1 返回时修复角色调用缺失的结尾 `$` 并保留 from side", async () => {
        const missingDollar = `${"$"}{"name":"Saki Terashima","angle":"from side","upperBody":"sfw","lowerBody":"sfw"},standing on deck`;
        const content = [
            "<image>",
            "<regex>她抓住栏杆</regex>",
            "<title_styled>甲板侧面</title_styled>",
            "<Tag_think>侧面、晕船</Tag_think>",
            "<size>832x1216</size>",
            `<prompts>${missingDollar},pale face,seasick</prompts>`,
            "</image>",
        ].join("\n");

        const result = await generateBodyImageBlocks({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {baseUrl: "https://api.example.com/v1", model: "gpt-4o"},
            },
            chapterContent: "正文",
            characterSummary: "Saki Terashima",
            complete: async () => content,
        });

        expect(result.blocks[0]?.prompt).toContain("from side");
        expect(result.blocks[0]?.prompt).toContain("}$");
        expect(result.blocks[0]?.prompt).toContain("pale face,seasick");
    });

    it("整次回复没有可用块时只报告堵塞且不重试", async () => {
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
        })).rejects.toMatchObject({
            code: "no_usable_blocks",
            message: "正文生图没有产出可用图片块，正文未修改",
        });
        expect(calls).toBe(1);
    });

    it("宽容解析会跳过截断块并保留前面的完整块", () => {
        const result = parseBodyImageBlocksWithDiagnostics(
            `<content><images>${XML_BLOCK}\n<image><regex>被截断</regex><prompts>unfinished`,
        );

        expect(result.blocks).toHaveLength(1);
        expect(result.blocks[0]?.regex).toBe("她推开门走进教室");
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                blockIndex: 2,
                code: "block_truncated",
                action: "skipped",
            }),
        ]);
    });

    it("宽容解析会为每个完整块保留 LLM 回复序号", () => {
        const result = parseBodyImageBlocksWithDiagnostics(
            `<image>${XML_BLOCK.replace(/^<image>|<\/image>$/gu, "")}</image>\n<image>${XML_BLOCK_2.replace(/^<image>|<\/image>$/gu, "")}</image>`,
        );

        expect(result.blocks.map((block) => block.sourceIndex)).toEqual([1, 2]);
        expect(result.diagnostics).toEqual([]);
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

    it("maps chatu-8 grid centers to normalized NovelAI coordinates", () => {
        const blocks = parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts>"
            + "<character_1><prompt>left character</prompt><centers>A1</centers></character_1>"
            + "<character_2><prompt>right character</prompt><centers>E5</centers></character_2>"
            + "</prompts></image>",
        );

        expect(blocks[0]?.characterPrompts).toEqual([
            {prompt: "left character", negativePrompt: "", centerX: 0.1, centerY: 0.1},
            {prompt: "right character", negativePrompt: "", centerX: 0.9, centerY: 0.9},
        ]);
    });

    it("keeps normalized numeric centers compatible with the legacy contract", () => {
        const blocks = parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts>"
            + "<character_1><prompt>character</prompt><center>0.25,0.75</center></character_1>"
            + "</prompts></image>",
        );

        expect(blocks[0]?.characterPrompts).toEqual([{
            prompt: "character",
            negativePrompt: "",
            centerX: 0.25,
            centerY: 0.75,
        }]);
    });

    it("maps new preset semantic centers to stable NovelAI coordinates", () => {
        const blocks = parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts>"
            + "<character_1><prompt>left character</prompt><centers>left, foreground</centers></character_1>"
            + "<character_2><prompt>middle character</prompt><centers>center, middleground</centers></character_2>"
            + "<character_3><prompt>right character</prompt><centers>right, background</centers></character_3>"
            + "</prompts></image>",
        );

        expect(blocks[0]?.characterPrompts).toEqual([
            {prompt: "left character", negativePrompt: "", centerX: 0.3, centerY: 0.7},
            {prompt: "middle character", negativePrompt: "", centerX: 0.5, centerY: 0.5},
            {prompt: "right character", negativePrompt: "", centerX: 0.7, centerY: 0.3},
        ]);
    });

    it("accepts Chinese semantic centers emitted by weaker models", () => {
        const blocks = parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts>"
            + "<character_1><prompt>character</prompt><centers>左侧，前景</centers></character_1>"
            + "</prompts></image>",
        );

        expect(blocks[0]?.characterPrompts?.[0]).toMatchObject({
            centerX: 0.3,
            centerY: 0.7,
        });
    });

    it("accepts vertical-only semantic centers emitted by weaker models", () => {
        const blocks = parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts>"
            + "<character_1><prompt>upper character</prompt><centers>top</centers></character_1>"
            + "<character_2><prompt>lower character</prompt><centers>bottom</centers></character_2>"
            + "</prompts></image>",
        );

        expect(blocks[0]?.characterPrompts).toEqual([
            {prompt: "upper character", negativePrompt: "", centerX: 0.5, centerY: 0.3},
            {prompt: "lower character", negativePrompt: "", centerX: 0.5, centerY: 0.7},
        ]);
    });

    it("removes safe certification prefixes from new preset prompt fields", () => {
        const blocks = parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts>"
            + "<scene_composition>sāfe&2girls, sāfe&indoors</scene_composition>"
            + "<character_1><prompt>sāfe&1girl, safe&smile</prompt>"
            + "<centers>sāfe&left, sāfe&foreground</centers>"
            + "<uc>sāfe&bad anatomy, safe&blurry</uc></character_1>"
            + "</prompts></image>",
        );

        expect(blocks[0]).toMatchObject({
            prompt: "2girls, indoors",
            characterPrompts: [{
                prompt: "1girl, smile",
                negativePrompt: "bad anatomy, blurry",
                centerX: 0.3,
                centerY: 0.7,
            }],
        });
        expect(blocks[0]?.prompts).not.toMatch(/s(?:a|ā)fe\s*[&＆]/iu);
    });

    it("rejects an invalid chatu-8 grid center", () => {
        expect(() => parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts><character_1><prompt>character</prompt><centers>Z9</centers></character_1></prompts></image>",
        )).toThrow(/center/);
    });

    it("extracts and removes chatu-8 inline center markers", () => {
        const blocks = parseBodyImageBlocks(
            "<image><regex>anchor</regex><prompts>"
            + "<character_1><prompt>character tags |centers:C3;</prompt></character_1>"
            + "</prompts></image>",
        );

        expect(blocks[0]?.characterPrompts).toEqual([{
            prompt: "character tags",
            negativePrompt: "",
            centerX: 0.5,
            centerY: 0.5,
        }]);
    });
});
