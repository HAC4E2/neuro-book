import {describe, expect, it} from "vitest";
import {IllustrationDirector} from "nbook/server/text-to-image/illustration-director";

const MISSING_DOLLAR_CALL = `${"$"}{"name":"Saki Terashima","angle":"from side","upperBody":"sfw","lowerBody":"sfw"},standing on deck`;

describe("IllustrationDirector", () => {
    it("repairs calls in the main, character and negative prompt slots", () => {
        const result = new IllustrationDirector().normalize([{
            prompts: `<scene_composition>deck</scene_composition><character_1><prompt>${MISSING_DOLLAR_CALL}</prompt><uc>${MISSING_DOLLAR_CALL}</uc></character_1>`,
            prompt: MISSING_DOLLAR_CALL,
            characterPrompts: [{prompt: MISSING_DOLLAR_CALL, negativePrompt: MISSING_DOLLAR_CALL}],
        }]);

        expect(result.repairs).toHaveLength(4);
        expect(result.repairs.find((repair) => repair.slot === "prompts")?.count).toBe(2);
        expect(result.repairs.every((repair) => repair.type === "missing-closing-dollar")).toBe(true);
        expect(result.blocks[0]?.prompts).toContain("from side\",\"upperBody\":\"sfw\",\"lowerBody\":\"sfw\"}$");
        expect(result.blocks[0]?.characterPrompts?.[0]?.negativePrompt).toContain("}$");
        expect(() => new IllustrationDirector().assertCanonical(result.blocks)).not.toThrow();
    });

    it("rejects an invalid angle/body value instead of guessing", () => {
        expect(() => new IllustrationDirector().normalize([{
            prompts: `${"$"}{"name":"Hero","angle":"from side","upperBody":"unknown","lowerBody":"sfw"}$`,
        }])).toThrow(/upperBody/);
    });

    it("rejects a missing closing dollar after an unsafe identifier boundary", () => {
        expect(() => new IllustrationDirector().normalize([{
            prompts: `${"$"}{"name":"Hero","angle":"from side"}standing`,
        }])).toThrow(/格式无效/);
    });

    it("repairs a standalone outfit call without changing its semantic fields", () => {
        const missingDollar = `${"$"}{"name":"office lady smart casual outfit","upperBody":"visible","lowerBody":"visible"},standing on deck`;
        const result = new IllustrationDirector().normalize([{prompts: missingDollar}]);

        expect(result.repairs).toEqual([{
            imageIndex: 1,
            slot: "prompts",
            type: "missing-closing-dollar",
            count: 1,
        }]);
        expect(result.blocks[0]?.prompts).toContain('"upperBody":"visible","lowerBody":"visible"}$');
    });
});
