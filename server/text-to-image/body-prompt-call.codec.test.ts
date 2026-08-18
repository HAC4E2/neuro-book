import {describe, expect, it} from "vitest";
import {
    assertCanonicalBodyPromptCalls,
    getBodyPromptFacing,
    normalizeBodyPromptCalls,
    parseBodyPromptCode,
    scanBodyPromptCalls,
} from "nbook/server/text-to-image/body-prompt-call.codec";

describe("body prompt call codec", () => {
    it("repairs a complete JSON call with a missing closing dollar", () => {
        const raw = `${"$"}{"name":"Saki Terashima","angle":"from side","upperBody":"sfw","lowerBody":"sfw"},standing on deck`;

        const result = normalizeBodyPromptCalls(raw);

        expect(result.prompt).toBe(`${"$"}{"name":"Saki Terashima","angle":"from side","upperBody":"sfw","lowerBody":"sfw"}$,standing on deck`);
        expect(result.repairs).toEqual([{type: "missing-closing-dollar", offset: 82}]);
        expect(normalizeBodyPromptCalls(result.prompt)).toEqual({prompt: result.prompt, repairs: []});
    });

    it("balances nested objects and escaped strings before parsing", () => {
        const prompt = `${"$"}{"name":"Hero","character":{"enName":"A \\\"Hero\\\"","profileTraits":"silver hair","facialAppearance":"blue eyes"}}$`;

        expect(scanBodyPromptCalls(prompt)).toHaveLength(1);
        expect(() => assertCanonicalBodyPromptCalls(prompt)).not.toThrow();
    });

    it("does not repair a truncated JSON object", () => {
        expect(() => normalizeBodyPromptCalls(`${"$"}{"name":"Hero","angle":"from side"`))
            .toThrow(/不是合法 JSON/);
    });

    it("uses front DNA for every non-back angle and back DNA for registered back phrases", () => {
        expect(getBodyPromptFacing("from side")).toBe("front");
        expect(getBodyPromptFacing("three-quarter view")).toBe("front");
        expect(getBodyPromptFacing("from behind")).toBe("back");
        expect(getBodyPromptFacing("from back")).toBe("back");
        expect(getBodyPromptFacing("back")).toBe("back");
        expect(getBodyPromptFacing("behind")).toBe("back");
    });

    it("keeps the original angle text while accepting free-form angles", () => {
        const code = parseBodyPromptCode('"name":"Hero","angle":" From Side ","upperBody":"sfw","lowerBody":"sfw"');

        expect(code.angleText).toBe("From Side");
        expect(code.facing).toBe("front");
    });

    it("preserves an explicit character or outfit kind for semantic resolution", () => {
        const character = parseBodyPromptCode('"kind":"character","name":"Hero","angle":"from side"');
        const outfit = parseBodyPromptCode('"kind":"outfit","name":"Office Outfit","upperBody":"visible","lowerBody":"hidden"');

        expect(character.kind).toBe("character");
        expect(outfit.kind).toBe("outfit");
        expect(outfit.angleText).toBe("");
        expect(outfit.upperBody).toBe("visible");
    });

    it("rejects an unknown explicit kind", () => {
        expect(() => parseBodyPromptCode('"kind":"scene","name":"Hero"')).toThrow(/kind/);
    });

    it("rejects character states on an explicit outfit call at the canonical gate", () => {
        expect(() => assertCanonicalBodyPromptCalls(
            `${"$"}{"kind":"outfit","name":"Office Outfit","upperBody":"sfw","lowerBody":"visible"}$`,
        )).toThrow(/kind=outfit/);
    });
});
