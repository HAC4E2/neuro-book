import {describe, expect, it, vi} from "vitest";
import {generateBodyPrompts} from "nbook/server/text-to-image/body-session.service";
import type {BodyImageBlock} from "nbook/server/text-to-image/body-image-llm";
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
        const generate = vi.fn().mockResolvedValue([CLASSROOM_BLOCK]);

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
    });

    it("客户端 characterSummary 不能覆盖后端扫描摘要", async () => {
        const generate = vi.fn().mockResolvedValue([CLASSROOM_BLOCK]);

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
});
