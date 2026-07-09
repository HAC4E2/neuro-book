import {describe, expect, it} from "vitest";
import {
    fallbackPlaceBodyImagePrompts,
    normalizeBodyImagePromptPlacements,
    type BodyImagePromptPlacementParagraph,
    type BodyImagePromptPlacementPrompt,
} from "nbook/server/text-to-image/body-image-prompt-placement";

const paragraphs: BodyImagePromptPlacementParagraph[] = [
    {id: "p-1", index: 0, text: "Alpha paragraph."},
    {id: "p-2", index: 1, text: "Beta paragraph."},
];

const prompts: BodyImagePromptPlacementPrompt[] = [
    {id: "prompt-1", order: 0, prompt: "Alpha scene", responseIndex: 0, nearbyText: "Alpha paragraph."},
    {id: "prompt-2", order: 1, prompt: "Beta scene", responseIndex: 20, nearbyText: ""},
];

describe("body image prompt placement", () => {
    it("normalizes agent placements by dropping unknown ids and duplicates", () => {
        const placements = normalizeBodyImagePromptPlacements({
            paragraphs,
            prompts,
            placements: [
                {promptId: "prompt-1", afterParagraphId: "p-1", reason: "first", confidence: 0.9},
                {promptId: "prompt-1", afterParagraphId: "p-2", reason: "duplicate", confidence: 0.9},
                {promptId: "missing", afterParagraphId: "p-1", reason: "unknown prompt", confidence: 0.9},
                {promptId: "prompt-2", afterParagraphId: "missing", reason: "unknown paragraph", confidence: 0.9},
            ],
        });

        expect(placements).toEqual([{
            promptId: "prompt-1",
            afterParagraphId: "p-1",
            reason: "first",
            confidence: 0.9,
        }]);
    });

    it("fallback only places prompts with clear nearby paragraph context", () => {
        const placements = fallbackPlaceBodyImagePrompts({paragraphs, prompts});

        expect(placements).toEqual([expect.objectContaining({promptId: "prompt-1", afterParagraphId: "p-1"})]);
    });
});
