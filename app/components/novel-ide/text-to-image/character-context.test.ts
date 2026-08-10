import {describe, expect, it} from "vitest";
import {resolveCharacterGenerationContext} from "nbook/app/components/novel-ide/text-to-image/character-context";

describe("character generation context", () => {
    it("derives a character id from a project character markdown path", () => {
        expect(resolveCharacterGenerationContext(
            "lorebook/character/alice/index.md",
            "# Alice\n\nA careful scout.",
        )).toEqual({
            characterId: "alice",
            groupId: null,
            characterPage: "# Alice\n\nA careful scout.",
        });
    });

    it("preserves a grouped character id when the markdown path is grouped", () => {
        expect(resolveCharacterGenerationContext(
            "lorebook/character/fantasy/alice/index.md",
            "character details",
        )).toEqual({
            characterId: "alice",
            groupId: "fantasy",
            characterPage: "character details",
        });
    });

    it("rejects non-character markdown files and blank content", () => {
        expect(resolveCharacterGenerationContext("manuscript/chapter-1.md", "text")).toBeNull();
        expect(resolveCharacterGenerationContext("lorebook/character/alice/index.md", "  ")).toBeNull();
    });
});
