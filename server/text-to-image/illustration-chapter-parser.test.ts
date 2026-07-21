import {describe, expect, it} from "vitest";
import {
    IllustrationChapterParser,
    IllustrationSelectionError,
} from "nbook/server/text-to-image/illustration-chapter-parser";

const parser = new IllustrationChapterParser();

describe("IllustrationChapterParser", () => {
    it("removes managed placeholders from source identity without moving prose anchors", () => {
        const plain = "# 第一章\n\n港口醒来了。\n\n她看见舰队。\n";
        const withPrompt = "# 第一章\n\n港口醒来了。\n\n<text-to-image-prompt id=\"p1\">\n{\"schema\":\"nbook.text-to-image-prompt/v2\"}\n</text-to-image-prompt>\n\n她看见舰队。\n";
        const before = parser.parse({chapterPath: "manuscript/v1/c1/index.md", markdown: plain});
        const after = parser.parse({chapterPath: "manuscript/v1/c1/index.md", markdown: withPrompt});

        expect(after.sourceChapterHash).toBe(before.sourceChapterHash);
        expect(after.anchorCandidates.map((item) => item.anchorId)).toEqual(before.anchorCandidates.map((item) => item.anchorId));
        expect(after.chapterFileHash).not.toBe(before.chapterFileHash);
    });

    it("locks a cross-paragraph selection to the last intersecting top-level block", () => {
        const markdown = "第一段开始，海雾很重。\n\n第二段里，她看见舰队。\n\n第三段。\n";
        const snapshot = parser.parse({chapterPath: "manuscript/v1/c1/index.md", markdown});
        const selectedText = "海雾很重。\n\n第二段里，她看见舰队";
        const selection = parser.select(snapshot, {
            selectedText,
            lineRange: {startLine: 1, endLine: 3},
            chapterFileHash: snapshot.chapterFileHash,
        });

        expect(selection.startAnchorId).toBe(snapshot.anchorCandidates[0]?.anchorId);
        expect(selection.endAnchorId).toBe(snapshot.anchorCandidates[1]?.anchorId);
        expect(selection.insertAfterAnchorId).toBe(snapshot.anchorCandidates[1]?.anchorId);
    });

    it("uses line hints to disambiguate repeated text while excluding client offsets from selectionHash", () => {
        const markdown = "相同一句。\n\n中间。\n\n相同一句。\n";
        const snapshot = parser.parse({chapterPath: "manuscript/v1/c1/index.md", markdown});
        const first = parser.select(snapshot, {
            selectedText: "相同一句。",
            lineRange: {startLine: 5, endLine: 5},
            textRange: {startOffset: 0, endOffset: 5},
            chapterFileHash: snapshot.chapterFileHash,
        });
        const second = parser.select(snapshot, {
            selectedText: "相同一句。",
            lineRange: {startLine: 5, endLine: 5},
            textRange: {startOffset: markdown.lastIndexOf("相同一句。"), endOffset: markdown.length - 1},
            chapterFileHash: snapshot.chapterFileHash,
        });

        expect(first.startAnchorId).toBe(snapshot.anchorCandidates[2]?.anchorId);
        expect(first.selectionHash).toBe(second.selectionHash);
    });

    it("treats list and quote selections as their outer top-level blocks", () => {
        const markdown = "- 第一项\n- 第二项舰队\n\n> 她在栏杆旁。\n> 海风很冷。\n";
        const snapshot = parser.parse({chapterPath: "manuscript/v1/c1/index.md", markdown});
        const list = parser.select(snapshot, {
            selectedText: "第二项舰队",
            lineRange: {startLine: 2, endLine: 2},
            chapterFileHash: snapshot.chapterFileHash,
        });
        const quote = parser.select(snapshot, {
            selectedText: "海风很冷",
            lineRange: {startLine: 5, endLine: 5},
            chapterFileHash: snapshot.chapterFileHash,
        });

        expect(snapshot.blocks.map((block) => block.kind)).toEqual(["list", "blockquote"]);
        expect(list.insertAfterAnchorId).toBe(snapshot.anchorCandidates[0]?.anchorId);
        expect(quote.insertAfterAnchorId).toBe(snapshot.anchorCandidates[1]?.anchorId);
    });

    it("rejects ambiguous and forbidden selections", () => {
        const repeated = parser.parse({chapterPath: "manuscript/v1/c1/index.md", markdown: "相同 相同\n"});
        expect(() => parser.select(repeated, {
            selectedText: "相同",
            lineRange: {startLine: 1, endLine: 1},
            chapterFileHash: repeated.chapterFileHash,
        })).toThrowError(IllustrationSelectionError);

        const forbidden = parser.parse({chapterPath: "manuscript/v1/c1/index.md", markdown: "```ts\nconst fleet = true;\n```\n"});
        expect(() => parser.select(forbidden, {
            selectedText: "const fleet = true;",
            lineRange: {startLine: 2, endLine: 2},
            chapterFileHash: forbidden.chapterFileHash,
        })).toThrowError(/ILLUSTRATION_SELECTION_FORBIDDEN/u);
    });
});
