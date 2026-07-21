import {describe, expect, it} from "vitest";
import {
    ChapterIllustrationProposalSchema,
    IllustrationSelectionInputSchema,
    SelectionIllustrationProposalSchema,
} from "nbook/shared/text-to-image-illustration-planning";

const HASH = `sha256:${"a".repeat(64)}`;

function shot() {
    return {
        purpose: "建立港口规模",
        characterIds: ["hero"],
        outfitRefs: ["lorebook/character/hero/outfits/travel.md"],
        action: {hero: "standing-at-railing"},
        composition: {
            shotSize: "wide",
            cameraAngle: "high",
            viewpoint: "third-person",
            canvasIntent: "landscape",
            subjectPlacement: "lower-right",
        },
        continuity: {timeOfDay: "dawn", palette: "silver-blue"},
        tagPatternRefs: ["harbor-dawn"],
        tagDelta: {prefer: [{resolutionId: "resolution-1"}], avoid: []},
    } as const;
}

describe("illustration planning contracts", () => {
    it("keeps client selection coordinates as bounded location hints", () => {
        const parsed = IllustrationSelectionInputSchema.parse({
            selectedText: "她看见舰队。",
            lineRange: {startLine: 5, endLine: 7},
            textRange: {startOffset: 40, endOffset: 47},
            chapterFileHash: HASH,
        });
        expect(parsed.lineRange).toEqual({startLine: 5, endLine: 7});
        expect(() => IllustrationSelectionInputSchema.parse({...parsed, anchorId: "forged"})).toThrow();
    });

    it("accepts chapter anchors but forbids model-owned identities and final prompts", () => {
        const parsed = ChapterIllustrationProposalSchema.parse({
            operation: "plan-chapter",
            shots: [{anchorCandidateId: "p_0001_abcdef12", ...shot()}],
            continuityReview: {status: "passed", summary: "镜头时间与色板连续。"},
        });
        expect(parsed.shots).toHaveLength(1);
        expect(() => ChapterIllustrationProposalSchema.parse({
            ...parsed,
            shots: [{...parsed.shots[0], shotId: "forged"}],
        })).toThrow();
        expect(() => ChapterIllustrationProposalSchema.parse({
            ...parsed,
            shots: [{...parsed.shots[0], finalPrompt: "masterpiece"}],
        })).toThrow();
    });

    it("selection output has exactly one shot and no anchor field", () => {
        expect(SelectionIllustrationProposalSchema.parse({operation: "plan-selection", shot: shot()}).shot.purpose)
            .toBe("建立港口规模");
        expect(() => SelectionIllustrationProposalSchema.parse({
            operation: "plan-selection",
            shot: {...shot(), anchorCandidateId: "p_0001_abcdef12"},
        })).toThrow();
        expect(() => SelectionIllustrationProposalSchema.parse({operation: "plan-selection", shots: [shot(), shot()]})).toThrow();
    });
});
