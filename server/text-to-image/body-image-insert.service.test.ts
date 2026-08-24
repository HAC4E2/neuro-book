import {describe, expect, it} from "vitest";
import {
    findAllTextToImagePromptMarkdown,
} from "nbook/shared/text-to-image-markdown";
import type {BodyImageBlock} from "nbook/server/text-to-image/body-image-llm";
import {insertBodyImagePlaceholders} from "nbook/server/text-to-image/body-image-insert.service";

const CLASSROOM_BLOCK: BodyImageBlock = {
    regex: "她推开门走进教室",
    title: "晨光教室",
    tagThink: "教室、清晨、小克站在窗边",
    size: "832x1216",
    prompts: "1girl,long black hair,blue eyes,classroom,morning light",
};

const CORRIDOR_BLOCK: BodyImageBlock = {
    regex: "他转身关上门",
    title: "黄昏走廊",
    tagThink: "走廊、黄昏、背影",
    size: "1216x832",
    prompts: "1boy,corridor,sunset light,walking away",
};

describe("body image insert service", () => {
    it("在匹配 regex 的行之后插入占位符并返回结构化占位符", () => {
        const chapterContent = [
            "第一段。",
            "她推开门走进教室，阳光落在课桌上。",
            "第二段。",
        ].join("\n");

        const result = insertBodyImagePlaceholders({
            chapterContent,
            blocks: [CLASSROOM_BLOCK],
        });

        expect(result.placeholders).toHaveLength(1);
        expect(result.content).toContain("她推开门走进教室，阳光落在课桌上。\n<text-to-image-prompt id=\"");
        expect(result.placeholders[0]).toMatchObject({
            id: expect.stringMatching(/^tti-[0-9a-f-]{36}$/u),
            schema: "nbook.text-to-image-prompt/v1",
            anchor: "她推开门走进教室",
            prompt: "1girl,long black hair,blue eyes,classroom,morning light",
            title: "晨光教室",
            size: "832x1216",
            tagThink: "教室、清晨、小克站在窗边",
        });
    });

    it("渲染出的占位符可被 L2 解析器还原", () => {
        const result = insertBodyImagePlaceholders({
            chapterContent: "她推开门走进教室。",
            blocks: [CLASSROOM_BLOCK],
        });

        const found = findAllTextToImagePromptMarkdown(result.content);
        expect(found).toHaveLength(1);
        expect(found[0]?.payload).toMatchObject({
            anchor: "她推开门走进教室",
            prompt: "1girl,long black hair,blue eyes,classroom,morning light",
            title: "晨光教室",
            tagThink: "教室、清晨、小克站在窗边",
            size: "832x1216",
        });
    });

    it("多个块各自插入到匹配行之后且 id 不重复", () => {
        const chapterContent = [
            "第一句。",
            "她推开门走进教室。",
            "第二句。",
            "他转身关上门。",
            "结尾。",
        ].join("\n");

        const result = insertBodyImagePlaceholders({
            chapterContent,
            blocks: [CLASSROOM_BLOCK, CORRIDOR_BLOCK],
        });

        expect(result.placeholders).toHaveLength(2);
        expect(result.content).toContain("她推开门走进教室。\n<text-to-image-prompt");
        expect(result.content).toContain("他转身关上门。\n<text-to-image-prompt");
        expect(result.placeholders[0]?.id).not.toBe(result.placeholders[1]?.id);
    });

    it("相同锚点按 LLM 回复顺序插入且每个占位符保持独立 ID", () => {
        const first = {...CLASSROOM_BLOCK, title: "第一张", prompts: "first prompt"};
        const second = {...CLASSROOM_BLOCK, title: "第二张", prompts: "second prompt"};

        const result = insertBodyImagePlaceholders({
            chapterContent: "正文。\n她推开门走进教室。\n结尾。",
            blocks: [first, second],
        });
        const found = findAllTextToImagePromptMarkdown(result.content);

        expect(result.placeholders.map((placeholder) => placeholder.title))
            .toEqual(["第一张", "第二张"]);
        expect(found.map((item) => item.payload.title)).toEqual(["第一张", "第二张"]);
        expect(result.placeholders[0]?.id).not.toBe(result.placeholders[1]?.id);
        expect(result.content.indexOf('"title":"第一张"'))
            .toBeLessThan(result.content.indexOf('"title":"第二张"'));
    });

    it("不同锚点落在同一正文行时仍按 LLM 回复顺序插入", () => {
        const result = insertBodyImagePlaceholders({
            chapterContent: "她推开门走进教室，然后他转身关上门。",
            blocks: [CLASSROOM_BLOCK, CORRIDOR_BLOCK],
        });
        const found = findAllTextToImagePromptMarkdown(result.content);

        expect(found.map((item) => item.payload.title)).toEqual(["晨光教室", "黄昏走廊"]);
    });

    it("同一锚点命中正文多行时使用第一行并记录降级诊断", () => {
        const result = insertBodyImagePlaceholders({
            chapterContent: "她推开门走进教室。\n另一段：她推开门走进教室。",
            blocks: [CLASSROOM_BLOCK],
        });

        const placeholderIndex = result.content.indexOf("<text-to-image-prompt id=\"");
        expect(placeholderIndex).toBeGreaterThan(result.content.indexOf("她推开门走进教室。"));
        expect(placeholderIndex).toBeLessThan(result.content.indexOf("另一段：她推开门走进教室。"));
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                blockIndex: 1,
                code: "anchor_first_match",
                action: "inserted",
            }),
        ]);
    });

    it("匹配不到 regex 时追加到正文末尾并记录降级诊断", () => {
        const chapterContent = "正文没有任何挂载点。";
        const result = insertBodyImagePlaceholders({
            chapterContent,
            blocks: [{...CLASSROOM_BLOCK, regex: "不存在的文本"}],
        });

        expect(result.content).toContain(`${chapterContent}\n<text-to-image-prompt id="`);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                blockIndex: 1,
                code: "anchor_appended",
                action: "inserted",
            }),
        ]);
    });

    it("写入前拒绝未闭合的角色调用", () => {
        const chapterContent = "她推开门走进教室。";
        const block = {
            ...CLASSROOM_BLOCK,
            prompts: `${"$"}{"name":"Saki Terashima","angle":"from side","upperBody":"sfw","lowerBody":"sfw"},standing`,
        };

        expect(() => insertBodyImagePlaceholders({chapterContent, blocks: [block]}))
            .toThrow(/门禁|不是合法 JSON/);
    });
});
