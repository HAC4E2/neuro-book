import {describe, expect, it} from "vitest";
import {
    buildTextToImageCharacterTagPatch,
    parseTextToImageCharacterDraft,
} from "nbook/app/utils/text-to-image-character-design";

describe("text-to-image character design", () => {
    it("maps a returned character JSON object into NeuroBook character tag fields", () => {
        const reply = [
            "```json",
            JSON.stringify({
                character: {
                    "角色中文名称": "井上阳葵",
                    "角色英文名称": "Inoue Himari",
                    "角色特征": "energetic, sporty",
                    "五官外貌": "short brown hair, chestnut eyes, tan skin",
                    "五官外貌背面": "short brown hair, nape, tan skin",
                    "上半身SFW": "athletic build, medium breasts",
                    "上半身背面SFW": "athletic build, toned back",
                    "下半身SFW": "long legs, toned thighs",
                    "下半身背面SFW": "long legs, firm butt",
                    "上半身NSFW": "medium breasts, pink nipples",
                    "上半身NSFW背面": "bare back, shoulder blades",
                    "下半身NSFW": "pink pussy",
                    "下半身NSFW背面": "pink anus",
                },
            }, null, 2),
            "```",
        ].join("\n");

        const draft = parseTextToImageCharacterDraft(reply);

        expect(draft).toMatchObject({
            cnName: "井上阳葵",
            enName: "Inoue Himari",
            profileTraits: "energetic, sporty",
            facialAppearance: "short brown hair, chestnut eyes, tan skin",
            facialBack: "short brown hair, nape, tan skin",
            upperSfw: "athletic build, medium breasts",
            upperBackSfw: "athletic build, toned back",
            lowerSfw: "long legs, toned thighs",
            lowerBackSfw: "long legs, firm butt",
            upperNsfw: "medium breasts, pink nipples",
            upperBackNsfw: "bare back, shoulder blades",
            lowerNsfw: "pink pussy",
            lowerBackNsfw: "pink anus",
        });
    });

    it("keeps character tag patches limited to tag fields", () => {
        const patch = buildTextToImageCharacterTagPatch(parseTextToImageCharacterDraft(JSON.stringify({
            character: {
                cnName: "井上阳葵",
                enName: "Inoue Himari",
                profileTraits: "energetic",
                facialAppearance: "brown eyes",
            },
        })));

        expect(patch).toEqual({
            profileTraits: "energetic",
            facialAppearance: "brown eyes",
        });
    });
});
