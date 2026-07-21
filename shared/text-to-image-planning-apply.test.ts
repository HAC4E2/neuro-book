import {describe, expect, it} from "vitest";
import {
    assertPlanningApplyTransition,
    createPlanningApplyPayloadHash,
    IllustrationPlanningApplyPayloadSchema,
} from "nbook/shared/text-to-image-planning-apply";

const H = (digit: string) => `sha256:${digit.repeat(64)}`;

export function planningApplyPayloadFixture() {
    return {
        schemaVersion: "nbook.illustration-planning-apply/v1" as const,
        journalId: "apply-1",
        workflowId: "workflow-1",
        projectId: "project-1",
        chapterPath: "manuscript/v1/c1/index.md",
        sourceChapterHash: H("1"),
        planHash: H("2"),
        expectedChapterHash: H("3"),
        expectedStoryboardHash: null,
        storyboardBefore: null,
        stagedStoryboard: "---\nschema: staged\n---\n",
        stagedStoryboardHash: H("4"),
        appliedStoryboard: "---\nschema: applied\n---\n",
        appliedStoryboardHash: H("5"),
        chapterBefore: "正文。\n",
        chapterAfter: "正文。\n\n<text-to-image-prompt id=\"image_prompt_01\">...\n",
        chapterAfterHash: H("6"),
        newPlaceholderIds: ["image_prompt_01"],
        supersededPlaceholderIds: [],
        planningRequestHash: H("7"),
        planningInputHash: H("8"),
        planningEvidenceHash: H("9"),
    };
}

describe("Illustration Planning Apply contract", () => {
    it("accepts the only forward recoverable stage order", () => {
        const payload = IllustrationPlanningApplyPayloadSchema.parse(planningApplyPayloadFixture());
        expect(createPlanningApplyPayloadHash(payload)).toMatch(/^sha256:[a-f0-9]{64}$/u);

        expect(assertPlanningApplyTransition("prepared", "storyboard_written")).toBe("storyboard_written");
        expect(assertPlanningApplyTransition("storyboard_written", "chapter_written")).toBe("chapter_written");
        expect(assertPlanningApplyTransition("chapter_written", "storyboard_applied")).toBe("storyboard_applied");
        expect(assertPlanningApplyTransition("storyboard_applied", "completed")).toBe("completed");
    });

    it("rejects skipped/reversed transitions and terminal re-entry", () => {
        expect(() => assertPlanningApplyTransition("prepared", "chapter_written")).toThrow(/PLANNING_APPLY_STATE_CONFLICT/u);
        expect(() => assertPlanningApplyTransition("chapter_written", "storyboard_written")).toThrow(/PLANNING_APPLY_STATE_CONFLICT/u);
        expect(() => assertPlanningApplyTransition("completed", "prepared")).toThrow(/PLANNING_APPLY_STATE_CONFLICT/u);
        expect(() => assertPlanningApplyTransition("rolled_back", "prepared")).toThrow(/PLANNING_APPLY_STATE_CONFLICT/u);
    });

    it("allows explicit rollback/conflict exits only from applicable active stages", () => {
        expect(assertPlanningApplyTransition("prepared", "rolled_back")).toBe("rolled_back");
        expect(assertPlanningApplyTransition("storyboard_written", "rolled_back")).toBe("rolled_back");
        expect(assertPlanningApplyTransition("chapter_written", "apply_conflict")).toBe("apply_conflict");
        expect(() => assertPlanningApplyTransition("storyboard_applied", "rolled_back")).toThrow(/PLANNING_APPLY_STATE_CONFLICT/u);
    });

    it("rejects duplicate placeholder identities and unknown payload fields", () => {
        const payload = planningApplyPayloadFixture();
        expect(() => IllustrationPlanningApplyPayloadSchema.parse({
            ...payload,
            newPlaceholderIds: ["image_prompt_01", "image_prompt_01"],
        })).toThrow(/placeholder/u);
        expect(() => IllustrationPlanningApplyPayloadSchema.parse({...payload, providerId: 42})).toThrow();
    });
});
