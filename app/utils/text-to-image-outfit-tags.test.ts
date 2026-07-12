import {describe, expect, it} from "vitest";
import {
    parseTextToImageOutfitTags,
    renderTextToImageOutfitTagsMarkdown,
} from "nbook/app/utils/text-to-image-outfit-tags";

describe("text-to-image outfit tags markdown", () => {
    it("parses the owner and four view-specific clothing sections", () => {
        const outfit = parseTextToImageOutfitTags([
            "# 深色水手校服/dark navy sailor uniform",
            "",
            "## 归属角色",
            "Xiao Ming",
            "",
            "## 上半身",
            "white sailor shirt, navy sailor collar, red neckerchief",
            "",
            "## 上半身背面",
            "white sailor shirt, navy sailor collar",
            "",
            "## 下半身",
            "navy pleated skirt, black loafers",
            "",
            "## 下半身背面",
            "navy pleated skirt, black loafers",
        ].join("\n"), {
            sourcePath: "lorebook/character/xiaoming/outfits/深色水手校服.md",
        });

        expect(outfit).toEqual({
            sourcePath: "lorebook/character/xiaoming/outfits/深色水手校服.md",
            owner: "Xiao Ming",
            nameCn: "深色水手校服",
            nameEn: "dark navy sailor uniform",
            upper: "white sailor shirt, navy sailor collar, red neckerchief",
            upperBack: "white sailor shirt, navy sailor collar",
            lower: "navy pleated skirt, black loafers",
            lowerBack: "navy pleated skirt, black loafers",
        });
    });

    it("renders an outfit markdown file that can be parsed back", () => {
        const markdown = renderTextToImageOutfitTagsMarkdown({
            sourcePath: "lorebook/character/xiaoming/outfits/白色睡裙.md",
            owner: "Xiao Ming",
            nameCn: "白色睡裙",
            nameEn: "white nightgown",
            upper: "white lace nightgown, ribbon straps",
            upperBack: "white lace nightgown, ribbon straps",
            lower: "white flowing skirt",
            lowerBack: "white flowing skirt",
        });
        const parsed = parseTextToImageOutfitTags(markdown, {
            sourcePath: "lorebook/character/xiaoming/outfits/白色睡裙.md",
        });

        expect(markdown).toContain("# 白色睡裙/white nightgown");
        expect(markdown).toContain("## 上半身背面");
        expect(parsed.nameCn).toBe("白色睡裙");
        expect(parsed.lowerBack).toBe("white flowing skirt");
    });
});
