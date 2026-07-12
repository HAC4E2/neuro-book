import {describe, expect, it} from "vitest";
import {parseTextToImageOutfitDrafts} from "nbook/app/utils/text-to-image-outfit-design";

describe("text-to-image outfit LLM response parser", () => {
    it("parses multiple outfit blocks from the supplied role-design format", () => {
        const drafts = parseTextToImageOutfitDrafts([
            "<角色设计>",
            "<人物>",
            "中文名称:小明",
            "英文名称:Xiao Ming",
            "</人物>",
            "<服装>",
            "归属人:Xiao Ming",
            "中文名称:深色水手校服",
            "英文名称:dark navy sailor uniform",
            "上半身:white sailor shirt, navy sailor collar, red ribbon",
            "上半身背面:white sailor shirt, navy sailor collar",
            "下半身:navy pleated skirt, black loafers",
            "下半身背面:navy pleated skirt, black loafers",
            "</服装>",
            "<服装>",
            "归属人:Xiao Ming",
            "中文名称:白色睡裙",
            "英文名称:white nightgown",
            "上半身:white lace nightgown",
            "上半身背面:white lace nightgown",
            "下半身:white flowing skirt",
            "下半身背面:white flowing skirt",
            "</服装>",
            "</角色设计>",
        ].join("\n"));

        expect(drafts).toHaveLength(2);
        expect(drafts[0]).toEqual({
            owner: "Xiao Ming",
            nameCn: "深色水手校服",
            nameEn: "dark navy sailor uniform",
            upper: "white sailor shirt, navy sailor collar, red ribbon",
            upperBack: "white sailor shirt, navy sailor collar",
            lower: "navy pleated skirt, black loafers",
            lowerBack: "navy pleated skirt, black loafers",
        });
        expect(drafts[1]?.nameEn).toBe("white nightgown");
    });

    it("parses the default structured JSON outfits array", () => {
        const drafts = parseTextToImageOutfitDrafts(JSON.stringify({
            character: {"角色中文名称": "小明"},
            outfits: [{
                "归属人": "Xiao Ming",
                "中文名称": "旅行便装",
                "英文名称": "traveler casual outfit",
                "上半身": "linen shirt, leather vest",
                "上半身背面": "linen shirt, leather vest",
                "下半身": "brown trousers, leather boots",
                "下半身背面": "brown trousers, leather boots",
            }],
        }));

        expect(drafts).toEqual([{
            owner: "Xiao Ming",
            nameCn: "旅行便装",
            nameEn: "traveler casual outfit",
            upper: "linen shirt, leather vest",
            upperBack: "linen shirt, leather vest",
            lower: "brown trousers, leather boots",
            lowerBack: "brown trousers, leather boots",
        }]);
    });
});
