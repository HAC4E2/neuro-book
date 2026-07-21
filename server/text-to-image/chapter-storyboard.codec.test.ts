import {describe, expect, it} from "vitest";
import {createChapterIllustrationPlanHash} from "nbook/shared/text-to-image-chapter-storyboard";
import {
    parseChapterStoryboardMarkdown,
    renderChapterStoryboardMarkdown,
} from "nbook/server/text-to-image/chapter-storyboard.codec";

function hash(character: string): string {
    return `sha256:${character.repeat(64)}`;
}

function storyboardFixture() {
    const storyboard = {
        schema: "nbook.chapter-illustrations/v2" as const,
        chapterPath: "manuscript/001-volume/003-chapter/index.md",
        revisionId: "sb_codec_01",
        sourceChapterHash: hash("1"),
        planHash: hash("0"),
        planningSources: [],
        shots: [],
    };
    storyboard.planHash = createChapterIllustrationPlanHash(storyboard);
    return storyboard;
}

describe("chapter storyboard Markdown codec", () => {
    it("round-trips strict frontmatter and keeps body outside planHash", () => {
        const storyboard = storyboardFixture();
        const markdown = renderChapterStoryboardMarkdown(storyboard, "# 本章插图计划\n\n作者说明。\n");
        const parsed = parseChapterStoryboardMarkdown(markdown);
        const otherBody = parseChapterStoryboardMarkdown(renderChapterStoryboardMarkdown(storyboard, "另一段说明。\n"));

        expect(parsed.storyboard).toEqual(storyboard);
        expect(parsed.body).toBe("# 本章插图计划\n\n作者说明。\n");
        expect(parsed.fileHash).not.toBe(otherBody.fileHash);
        expect(parsed.storyboard.planHash).toBe(otherBody.storyboard.planHash);
    });

    it("rejects duplicate YAML keys and tampered planHash", () => {
        const markdown = renderChapterStoryboardMarkdown(storyboardFixture());
        const duplicateKey = markdown.replace(
            "schema: nbook.chapter-illustrations/v2",
            "schema: nbook.chapter-illustrations/v2\nschema: nbook.chapter-illustrations/v2",
        );
        expect(() => parseChapterStoryboardMarkdown(duplicateKey)).toThrow(/frontmatter/u);

        const tampered = markdown.replace(/^planHash: sha256:[a-f0-9]{64}$/mu, `planHash: ${hash("f")}`);
        expect(() => parseChapterStoryboardMarkdown(tampered)).toThrow(/planHash/u);
    });
});
