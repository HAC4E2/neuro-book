import {describe, expect, it} from "vitest";
import {
    captureIllustrationSelection,
    IllustrationSelectionCaptureError,
} from "nbook/app/utils/illustration-planning-selection";
import type {InlineEditReference} from "nbook/app/utils/inline-editor-selection";

describe("captureIllustrationSelection", () => {
    it("binds the selection to exact saved Markdown bytes and raw offsets", async () => {
        const markdown = "第一段。\n\n相同一句。\n\n相同一句。\n";
        const result = await captureIllustrationSelection(markdown, reference({startLine: 5, endLine: 5}));

        expect(result).toEqual({
            selectedText: "相同一句。",
            lineRange: {startLine: 5, endLine: 5},
            textRange: {
                startOffset: markdown.lastIndexOf("相同一句。"),
                endOffset: markdown.lastIndexOf("相同一句。") + "相同一句。".length,
            },
            chapterFileHash: "sha256:dac7b0b45281e2c37e21cae08e97450abfc20cfb9eb2284e48680bd48d8e2fd1",
        });
    });

    it("fails closed when the same text remains ambiguous inside the hinted lines", async () => {
        const markdown = "相同一句。相同一句。\n";
        await expect(captureIllustrationSelection(markdown, reference({startLine: 1, endLine: 1})))
            .rejects.toMatchObject({
                code: "ILLUSTRATION_SELECTION_AMBIGUOUS",
            } satisfies Partial<IllustrationSelectionCaptureError>);
    });
});

function reference(range: {startLine: number; endLine: number}): InlineEditReference {
    return {
        ref: "[[manuscript/chapter.md]]",
        path: "manuscript/chapter.md",
        range,
        match: "unique",
        text: "相同一句。",
    };
}
