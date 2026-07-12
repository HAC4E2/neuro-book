import {describe, expect, it} from "vitest";
import {compileTextToImagePrompt, type BodyImagePromptResolution} from "nbook/server/text-to-image/prompt-compiler";

describe("compileTextToImagePrompt", () => {
    it("只编译解析结果中命中的角色，并按前视全身 SFW 与声明服装合成 tag", () => {
        const result = compileTextToImagePrompt({
            basePrompt: "cinematic lighting, 1girl",
            baseNegativePrompt: "lowres",
            resolution: resolution(),
            characters: [character()],
            promptRules: [{
                id: "append-quality",
                name: "quality",
                enabled: true,
                target: "positive",
                matchMode: "plain",
                mode: "append",
                trigger: "",
                replacement: "masterpiece",
            }],
        });

        expect(result.prompt).toBe("cinematic lighting, 1girl, Alice, innocent, blonde hair, petite, slim legs, white sailor shirt, navy pleated skirt, black loafers, masterpiece");
        expect(result.negativePrompt).toBe("lowres, child");
        expect(result.characterPrompts).toEqual([{
            characterId: "alice",
            prompt: "Alice, innocent, blonde hair, petite, slim legs, white sailor shirt, navy pleated skirt, black loafers",
            negativePrompt: "child",
        }]);
        expect(result.appliedRuleIds).toEqual(["append-quality"]);
    });

    it("遇到未声明服装或缺失角色时只给出警告，不凭空补 tag", () => {
        const result = compileTextToImagePrompt({
            basePrompt: "1girl",
            baseNegativePrompt: "",
            resolution: {...resolution(), characterIds: ["missing", "alice"], outfitName: "不存在的服装"},
            characters: [character()],
            promptRules: [],
        });

        expect(result.prompt).toContain("Alice");
        expect(result.prompt).not.toContain("不存在的服装");
        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.stringContaining("missing"),
            expect.stringContaining("不存在的服装"),
        ]));
    });

    it.each([
        ["front", "face", "white sailor shirt"],
        ["back", "upper", "sailor shirt back, back bow"],
        ["front", "lower", "navy pleated skirt, black loafers"],
        ["back", "lower", "skirt back pleats, black loafers"],
        ["back", "full", "sailor shirt back, back bow, skirt back pleats, black loafers"],
    ] as const)("injects the %s %s outfit section", (view, framing, expectedOutfitTags) => {
        const result = compileTextToImagePrompt({
            basePrompt: "1girl",
            baseNegativePrompt: "",
            resolution: {...resolution(), view, framing},
            characters: [character()],
            promptRules: [],
        });

        expect(result.prompt).toContain(expectedOutfitTags);
        expect(result.prompt).not.toContain("dark navy sailor uniform");
    });
});

function resolution(): BodyImagePromptResolution {
    return {
        promptId: "prompt-1",
        afterParagraphId: "paragraph-1",
        characterIds: ["alice"],
        view: "front",
        framing: "full",
        rating: "sfw",
        outfitName: "深色水手校服",
        reason: "角色出场",
        confidence: 0.9,
    };
}

function character() {
    return {
        id: "alice",
        sourcePath: "lorebook/character/alice/image-tags.md",
        cnName: "爱丽丝|小爱",
        cnAliases: ["爱丽丝", "小爱"],
        enName: "Alice",
        profileTraits: "innocent",
        facialAppearance: "blonde hair",
        facialBack: "blonde hair, nape",
        upperSfw: "petite",
        upperBackSfw: "petite, back",
        lowerSfw: "slim legs",
        lowerBackSfw: "small round butt",
        upperNsfw: "bare breasts",
        upperBackNsfw: "bare back",
        lowerNsfw: "pussy",
        lowerBackNsfw: "tight anus",
        negativePrompt: "child",
        outfits: [{
            sourcePath: "lorebook/character/alice/outfits/深色水手校服.md",
            owner: "Alice",
            nameCn: "深色水手校服",
            nameEn: "dark navy sailor uniform",
            upper: "white sailor shirt",
            upperBack: "sailor shirt back, back bow",
            lower: "navy pleated skirt, black loafers",
            lowerBack: "skirt back pleats, black loafers",
        }],
    };
}
