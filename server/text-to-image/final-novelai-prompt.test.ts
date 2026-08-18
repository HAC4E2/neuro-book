import {describe, expect, it} from "vitest";
import {buildFinalNovelAiPromptBundle} from "nbook/server/text-to-image/final-novelai-prompt";
import {DEFAULT_NOVEL_AI_PROMPT_REPLACE_TEXT} from "nbook/shared/dto/text-to-image.dto";

function input(overrides: Partial<Parameters<typeof buildFinalNovelAiPromptBundle>[0]> = {}): Parameters<typeof buildFinalNovelAiPromptBundle>[0] {
    return {
        model: "nai-diffusion-4-5-full",
        prompt: "1girl, forest",
        negativePrompt: "blurry",
        fixedPositivePrompt: "style-a",
        fixedPositivePromptEnd: "style-z",
        fixedNegativePrompt: "",
        rulesText: "",
        furryDataset: false,
        positiveQualityPreset: false,
        negativeQualityPreset: "none",
        ...overrides,
    };
}

describe("buildFinalNovelAiPromptBundle", () => {
    it("按前置前→固定前→前置后→正文→后置前→固定后→后置后→AQT→最后置拼接", () => {
        const bundle = buildFinalNovelAiPromptBundle(input({
            positiveQualityPreset: true,
            rulesText: [
                "forest=前置前|very front",
                "forest=前置后|after front",
                "forest=后置前|before back",
                "forest=后置后|after back",
                "forest=最后置|very last",
            ].join("\n"),
        }));

        expect(bundle.basePositive).toBe("very front, style-a, after front, 1girl, forest, before back, style-z, after back, very aesthetic, masterpiece, no text, very last");
        expect(bundle.actualInput).toBe(bundle.basePositive);
        expect(bundle.appliedRuleLines).toEqual([1, 2, 3, 4, 5]);
    });

    it("替换只改正文段，替换分角色逐槽生效，无角色槽是 no-op", () => {
        const rules = [
            "forest=替换|night forest",
            "1girl=替换分角色|hero girl",
        ].join("\n");
        const withoutCharacters = buildFinalNovelAiPromptBundle(input({rulesText: rules}));
        expect(withoutCharacters.basePositive).toBe("style-a, 1girl, night forest, style-z");

        const withCharacters = buildFinalNovelAiPromptBundle(input({
            rulesText: rules,
            characterPrompts: [
                {prompt: "1girl, blue eyes", negativePrompt: "blurry"},
                {prompt: "1boy, red eyes", negativePrompt: "blurry"},
            ],
        }));
        expect(withCharacters.characters[0]?.positive).toBe("hero girl, blue eyes");
        expect(withCharacters.characters[1]?.positive).toBe("1boy, red eyes");
    });

    it("内置八行规则默认不会修改普通提示词", () => {
        const bundle = buildFinalNovelAiPromptBundle(input({rulesText: DEFAULT_NOVEL_AI_PROMPT_REPLACE_TEXT}));
        expect(bundle.basePositive).toContain("1girl, forest");
        expect(bundle.appliedRuleLines).toEqual([]);
    });

    it("角色槽与基础正负向分别去重，坐标不丢失", () => {
        const bundle = buildFinalNovelAiPromptBundle(input({
            prompt: "1girl, blue eyes, 1girl",
            negativePrompt: "blurry, blurry",
            characterPrompts: [{prompt: "1girl, 1girl:1.2", negativePrompt: "bad, bad", centerX: 0.3, centerY: 0.5}],
        }));

        expect(bundle.actualInput).not.toMatch(/1girl,.*1girl/u);
        expect(bundle.actualNegativeInput).toBe("blurry");
        expect(bundle.characters[0]).toMatchObject({
            positive: "1girl:1.2",
            negative: "bad",
            centerX: 0.3,
            centerY: 0.5,
        });
    });
});
