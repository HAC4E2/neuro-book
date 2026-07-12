import {describe, expect, it} from "vitest";
import {
    imageTagToPromptEngineCharacter,
    parseTextToImageCharacterImageTags,
    renderTextToImageCharacterImageTagsMarkdown,
    renderTextToImageCharacterTagsForLlm,
} from "nbook/app/utils/text-to-image-character-tags";

describe("text-to-image character image-tags markdown", () => {
    it("parses markdown body-part fields and outfit names", () => {
        const tag = parseTextToImageCharacterImageTags([
            "## 角色中文名称",
            "小明|明明",
            "## 角色英文名称",
            "Xiao Ming",
            "## 角色特征",
            "innocent, dependent",
            "## 五官外貌",
            "((blonde hair)), ((golden brown eyes))",
            "## 五官外貌背面",
            "((blonde hair)), nape",
            "## 上半身 SFW",
            "petite, collarbone",
            "## 上半身背面 SFW",
            "back, slim waist",
            "## 下半身 SFW",
            "slim legs",
            "## 下半身背面 SFW",
            "small round butt",
            "## 上半身 NSFW",
            "(pink areola), small nipples",
            "## 上半身背面 NSFW",
            "bare back",
            "## 下半身 NSFW",
            "small pussy",
            "## 下半身背面 NSFW",
            "tight anus",
            "## 负面提示词",
            "mature woman",
            "## 服装列表",
            "- [深色水手校服/dark navy sailor uniform](outfits/深色水手校服.md)",
            "- [白色睡裙/white nightgown](outfits/白色睡裙.md)",
        ].join("\n"), {
            id: "character-xiaoming",
            sourcePath: "lorebook/character/xiaoming/image-tags.md",
        });

        expect(tag.cnAliases).toEqual(["小明", "明明"]);
        expect(tag.enName).toBe("Xiao Ming");
        expect(tag.facialAppearance).toContain("golden brown eyes");
        expect(tag.upperBackNsfw).toBe("bare back");
        expect(tag.outfits).toEqual([
            {
                sourcePath: "lorebook/character/xiaoming/outfits/深色水手校服.md",
                owner: "",
                nameCn: "深色水手校服",
                nameEn: "dark navy sailor uniform",
                upper: "",
                upperBack: "",
                lower: "",
                lowerBack: "",
            },
            {
                sourcePath: "lorebook/character/xiaoming/outfits/白色睡裙.md",
                owner: "",
                nameCn: "白色睡裙",
                nameEn: "white nightgown",
                upper: "",
                upperBack: "",
                lower: "",
                lowerBack: "",
            },
        ]);

        const engineCharacter = imageTagToPromptEngineCharacter(tag);
        expect(engineCharacter.cnName).toBe("小明|明明");
        expect(engineCharacter.negativePrompt).toBe("mature woman");
    });

    it("renders compact LLM context with tags and outfit names", () => {
        const tag = parseTextToImageCharacterImageTags([
            "## 角色中文名称",
            "小明|明明",
            "## 角色英文名称",
            "Xiao Ming",
            "## 角色特征",
            "innocent",
            "## 五官外貌",
            "blonde hair",
            "## 服装列表",
            "[深色水手校服/dark navy sailor uniform](outfits/深色水手校服.md)",
        ].join("\n"), {id: "c-1", sourcePath: "lorebook/character/xiaoming/image-tags.md"});

        const context = renderTextToImageCharacterTagsForLlm([tag]);

        expect(context).toContain("小明|明明");
        expect(context).toContain("Xiao Ming");
        expect(context).toContain("blonde hair");
        expect(context).toContain("深色水手校服/dark navy sailor uniform");
    });

    it("ignores an outfit index that escapes the current character outfits directory", () => {
        const tag = parseTextToImageCharacterImageTags([
            "## 角色中文名称",
            "小明",
            "## 服装列表",
            "- [跨角色服装/another character outfit](../xiaohong/outfits/礼服.md)",
        ].join("\n"), {
            id: "xiaoming",
            sourcePath: "lorebook/character/xiaoming/image-tags.md",
        });

        expect(tag.outfits).toEqual([]);
    });

    it("renders image-tags.md markdown that can be parsed back", () => {
        const markdown = renderTextToImageCharacterImageTagsMarkdown({
            id: "xiaoming",
            sourcePath: "lorebook/character/xiaoming/image-tags.md",
            cnName: "小明|明明",
            cnAliases: ["小明", "明明"],
            enName: "Xiao Ming",
            profileTraits: "innocent, candid",
            facialAppearance: "((blonde hair)), ((golden brown eyes))",
            facialBack: "((blonde hair)), nape",
            upperSfw: "petite, slender body",
            upperBackSfw: "petite, slim waist",
            lowerSfw: "slim legs, soft thighs",
            lowerBackSfw: "slim legs, small round butt",
            upperNsfw: "",
            upperBackNsfw: "",
            lowerNsfw: "",
            lowerBackNsfw: "",
            negativePrompt: "mature woman",
            outfits: [{
                sourcePath: "lorebook/character/xiaoming/outfits/深色水手校服.md",
                owner: "Xiao Ming",
                nameCn: "深色水手校服",
                nameEn: "dark navy sailor uniform",
                upper: "white sailor shirt",
                upperBack: "white sailor shirt",
                lower: "navy pleated skirt",
                lowerBack: "navy pleated skirt",
            }],
        });
        const parsed = parseTextToImageCharacterImageTags(markdown, {
            id: "xiaoming",
            sourcePath: "lorebook/character/xiaoming/image-tags.md",
        });

        expect(markdown).toContain("# image-tags");
        expect(parsed.cnAliases).toEqual(["小明", "明明"]);
        expect(parsed.facialAppearance).toBe("((blonde hair)), ((golden brown eyes))");
        expect(markdown).toContain("[深色水手校服/dark navy sailor uniform](outfits/深色水手校服.md)");
        expect(parsed.outfits[0]).toMatchObject({
            nameCn: "深色水手校服",
            nameEn: "dark navy sailor uniform",
            sourcePath: "lorebook/character/xiaoming/outfits/深色水手校服.md",
        });
    });
});
