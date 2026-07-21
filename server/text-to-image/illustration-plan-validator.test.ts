import {describe, expect, it} from "vitest";
import {validateIllustrationPlan} from "nbook/server/text-to-image/illustration-plan-validator";

function shot() {
    return {
        purpose: "建立港口规模",
        characterIds: ["hero"],
        outfitRefs: ["lorebook/character/hero/outfits/travel.md"],
        action: {hero: "standing-at-railing"},
        composition: {
            shotSize: "wide" as const,
            cameraAngle: "high" as const,
            viewpoint: "third-person" as const,
            canvasIntent: "landscape" as const,
            subjectPlacement: "lower-right",
        },
        continuity: {timeOfDay: "dawn", palette: "silver-blue"},
        tagPatternRefs: ["harbor-dawn"],
        tagDelta: {prefer: [], avoid: []},
    };
}

const closure = {
    characterIds: ["hero"],
    outfitRefs: ["lorebook/character/hero/outfits/travel.md"],
    patternIds: ["harbor-dawn"],
    anchorIds: ["p_0001_abcdef12", "p_0002_12345678"],
    terminalResolutions: [],
};

describe("illustration plan validator", () => {
    it("validates a chapter proposal against every closed candidate set", () => {
        const result = validateIllustrationPlan({
            operation: "plan-chapter",
            proposal: {
                operation: "plan-chapter",
                shots: [{anchorCandidateId: "p_0001_abcdef12", ...shot()}],
                continuityReview: {status: "passed", summary: "连续性已复核。"},
            },
            closure,
        });

        expect(result.shots[0]?.anchorId).toBe("p_0001_abcdef12");
        expect(result.shots[0]?.shotIntentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });

    it("injects the trusted selection anchor instead of accepting one from the model", () => {
        const result = validateIllustrationPlan({
            operation: "plan-selection",
            proposal: {operation: "plan-selection", shot: shot()},
            closure,
            selectionAnchor: {anchorId: "p_0001_abcdef12", insertAfterAnchorId: "p_0002_12345678"},
        });

        expect(result.shots).toHaveLength(1);
        expect(result.shots[0]).toMatchObject({
            anchorId: "p_0001_abcdef12",
            insertAfterAnchorId: "p_0002_12345678",
        });
    });

    it("rejects unknown anchor, entity, outfit, Pattern and terminal Tag refs as whole proposals", () => {
        const cases = [
            {anchorCandidateId: "p_9999_deadbeef"},
            {characterIds: ["intruder"], action: {intruder: "standing"}},
            {outfitRefs: ["lorebook/character/hero/outfits/unknown.md"]},
            {tagPatternRefs: ["hidden-pattern"]},
            {tagDelta: {prefer: [{resolutionId: "pending-resolution"}], avoid: []}},
        ];
        for (const changed of cases) {
            expect(() => validateIllustrationPlan({
                operation: "plan-chapter",
                proposal: {
                    operation: "plan-chapter",
                    shots: [{anchorCandidateId: "p_0001_abcdef12", ...shot(), ...changed}],
                    continuityReview: {status: "passed", summary: "连续性已复核。"},
                },
                closure,
            })).toThrow(/ILLUSTRATION_PLAN_INVALID/u);
        }
    });

    it("requires operation agreement and a trusted selection anchor", () => {
        expect(() => validateIllustrationPlan({
            operation: "plan-selection",
            proposal: {
                operation: "plan-chapter",
                shots: [{anchorCandidateId: "p_0001_abcdef12", ...shot()}],
                continuityReview: {status: "passed", summary: "连续性已复核。"},
            },
            closure,
        })).toThrow(/ILLUSTRATION_PLAN_INVALID/u);
    });
});
