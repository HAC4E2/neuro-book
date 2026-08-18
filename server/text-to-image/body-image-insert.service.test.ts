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

    it("匹配不到 regex 时显式失败且不写入正文", () => {
        const chapterContent = "正文没有任何挂载点。";
        expect(() => insertBodyImagePlaceholders({
            chapterContent,
            blocks: [{...CLASSROOM_BLOCK, regex: "不存在的文本"}],
        })).toThrow(/未命中/);
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
