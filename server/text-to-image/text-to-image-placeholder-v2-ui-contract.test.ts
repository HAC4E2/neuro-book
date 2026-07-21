import fs from "node:fs/promises";
import {describe, expect, it} from "vitest";

describe("V2 prompt placeholder UI/server contract", () => {
    it("keeps TipTap attrs reference-only and emits only placeholderId", async () => {
        const source = await fs.readFile("app/components/markdown-studio/tiptap/TextToImagePrompt.ts", "utf8");

        expect(source).toContain("shotIntentHash");
        expect(source).toContain("sourceChapterHash");
        expect(source).toContain("anchorId");
        expect(source).toContain("placeholderId: id");
        expect(source).not.toContain("promptGenerationStates");
        expect(source).not.toContain("negativePrompt");
        expect(source).not.toContain("characterIds");
        expect(source).not.toMatch(/attrs\.prompt|HTMLAttributes\.prompt|!prompt/u);
    });

    it("removes the paragraph-offset V1 placer from the chapter service", async () => {
        const source = await fs.readFile("server/text-to-image/chapter.service.ts", "utf8");

        expect(source).not.toContain("TextToImageChapterParagraph");
        expect(source).not.toContain("insertPrompts(");
        expect(source).not.toContain("afterParagraphId");
        expect(source).toContain("findTextToImagePromptMarkdown");
    });
});
