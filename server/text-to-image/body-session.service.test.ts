import {describe, expect, it, vi} from "vitest";
import {generateBodyPrompts} from "nbook/server/text-to-image/body-session.service";
import {
    BodyImagePlanningBlockedError,
    type BodyImageBlock,
} from "nbook/server/text-to-image/body-image-llm";
import type {BodyCharacterMatch} from "nbook/server/text-to-image/body-character-scanner";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const CLASSROOM_BLOCK: BodyImageBlock = {
    regex: "她推开门走进教室",
    title: "晨光教室",
    tagThink: "教室、清晨",
    size: "832x1216",
    prompts: "1girl, classroom",
};

const xiaoKe: CharacterVisualFile = {
    schema: "nbook.character-visual/v1",
    characterId: "xiao-ke",
    character: {
        cnName: "小克",
        enName: "Xiao Ke",
        triggerWords: "小克",
        profileTraits: "innocent",
        facialAppearance: "long black hair",
        facialBack: "",
        upperSfw: "school uniform",
        upperBackSfw: "",
        lowerSfw: "skirt",
        lowerBackSfw: "",
        upperNsfw: "",
        upperBackNsfw: "",
        lowerNsfw: "",
        lowerBackNsfw: "",
        negativePrompt: "bad anatomy",
    },
    outfits: [],
    photos: [],
};

const match: BodyCharacterMatch = {
    characterId: "xiao-ke",
    groupId: null,
    visual: xiaoKe,
    matchedTrigger: "小克",
    matchedTriggers: ["小克"],
    source: "trigger",
};

const provider = {
    baseUrl: "https://llm.example.com",
    credential: "secret",
    settings: {model: "gpt-4o-mini", temperature: 1},
};

describe("body session service", () => {
    it("机械扫描结果组装为<人物>摘要后调用 LLM 并插入占位符", async () => {
        const generate = vi.fn().mockResolvedValue({blocks: [CLASSROOM_BLOCK], diagnostics: []});

        const result = await generateBodyPrompts({
            provider,
            chapterContent: "她推开门走进教室，小克站在窗边。",
            characterMatches: [match],
            generate,
        });

        expect(generate).toHaveBeenCalledOnce();
        expect(generate.mock.calls[0]?.[0]).toMatchObject({
            chapterContent: "她推开门走进教室，小克站在窗边。",
            characterSummary: expect.stringContaining("<人物>"),
        });
        expect(result.characterSummary).toContain("中文名：小克");
        expect(result.content).toContain("<text-to-image-prompt id=\"");
        expect(result.placeholders).toHaveLength(1);
        expect(result.diagnostics).toEqual([]);
    });

    it("LLM 返回相同锚点的多个图片块时按回复顺序完成插入", async () => {
        const generate = vi.fn().mockResolvedValue({
            blocks: [
                {...CLASSROOM_BLOCK, title: "第一张"},
                {...CLASSROOM_BLOCK, title: "第二张"},
            ],
            diagnostics: [],
        });

        const result = await generateBodyPrompts({
            provider,
            chapterContent: "她推开门走进教室。",
            characterMatches: [match],
            generate,
        });

        expect(result.placeholders.map((placeholder) => placeholder.title))
            .toEqual(["第一张", "第二张"]);
        expect(result.content.indexOf('"title":"第一张"'))
            .toBeLessThan(result.content.indexOf('"title":"第二张"'));
        expect(result.diagnostics).toEqual([]);
    });

    it("客户端 characterSummary 不能覆盖后端扫描摘要", async () => {
        const generate = vi.fn().mockResolvedValue({blocks: [CLASSROOM_BLOCK], diagnostics: []});

        const result = await generateBodyPrompts({
            provider,
            chapterContent: "她推开门走进教室，正文。",
            characterMatches: [match],
            characterSummary: "显式摘要",
            generate,
        });

        expect(generate.mock.calls[0]?.[0]?.characterSummary).toContain("<人物>");
        expect(generate.mock.calls[0]?.[0]?.characterSummary).toContain("中文名：小克");
        expect(generate.mock.calls[0]?.[0]?.characterSummary).not.toContain("显式摘要");
        expect(result.characterSummary).toContain("中文名：小克");
    });

    it("合并 LLM 坏块诊断与锚点降级诊断后返回部分成功结果", async () => {
        const generate = vi.fn().mockResolvedValue({
            blocks: [{...CLASSROOM_BLOCK, regex: "正文不存在的挂载点"}],
            diagnostics: [{
                blockIndex: 2,
                code: "block_invalid",
                action: "skipped",
                message: "第 2 个图片块格式不完整，已跳过",
            }],
        });

        const result = await generateBodyPrompts({
            provider,
            chapterContent: "她推开门走进教室。",
            characterMatches: [match],
            generate,
        });

        expect(result.placeholders).toHaveLength(1);
        expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "block_invalid",
            "anchor_appended",
        ]);
    });

    it("整次没有可用块时在插入前直接报告堵塞", async () => {
        const blocked = new BodyImagePlanningBlockedError([]);
        const generate = vi.fn().mockRejectedValue(blocked);

        await expect(generateBodyPrompts({
            provider,
            chapterContent: "正文",
            characterMatches: [match],
            generate,
        })).rejects.toBe(blocked);
        expect(generate).toHaveBeenCalledOnce();
    });
});
