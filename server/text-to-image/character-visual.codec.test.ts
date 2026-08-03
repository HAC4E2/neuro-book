import {describe, expect, it} from "vitest";
import {
    parseCharacterVisualJson,
    renderCharacterVisualJson,
    CharacterVisualFileSchema,
} from "nbook/server/text-to-image/character-visual.codec";

describe("character visual codec", () => {
    it("parse/render 保持 12 字段角色与服装数组", () => {
        const input = {
            schema: "nbook.character-visual/v1" as const,
            characterId: "char-1",
            character: {
                cnName: "小克",
                enName: "Xiao Ke",
                profileTraits: "innocent",
                facialAppearance: "long black hair, blue eyes",
                facialBack: "black hair back",
                upperSfw: "school uniform",
                upperBackSfw: "shoulders",
                lowerSfw: "skirt",
                lowerBackSfw: "legs",
                upperNsfw: "",
                upperBackNsfw: "",
                lowerNsfw: "",
                lowerBackNsfw: "",
                negativePrompt: "bad anatomy",
            },
            outfits: [{
                cnName: "校服",
                enName: "School Uniform",
                upper: "white shirt",
                upperBack: "plain back",
                lower: "navy skirt",
                lowerBack: "plain back",
            }],
            photos: ["assets/tti/avatar-1.png"],
        };

        const parsed = parseCharacterVisualJson(renderCharacterVisualJson(input));
        expect(parsed.character.cnName).toBe("小克");
        expect(parsed.outfits[0]?.enName).toBe("School Uniform");
        expect(parsed.photos).toEqual(["assets/tti/avatar-1.png"]);
    });

    it("缺失字段补默认值并允许空 photos", () => {
        const parsed = CharacterVisualFileSchema.parse({
            schema: "nbook.character-visual/v1",
            characterId: "char-2",
            character: {},
        });
        expect(parsed.character.facialAppearance).toBe("");
        expect(parsed.outfits).toEqual([]);
        expect(parsed.photos).toEqual([]);
    });

    it("拒绝非规范 schema 版本", () => {
        expect(CharacterVisualFileSchema.safeParse({
            schema: "nbook.character-visual/old",
            characterId: "char-3",
            character: {},
        }).success).toBe(false);
    });
});
