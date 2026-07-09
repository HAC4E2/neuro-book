import {describe, expect, it} from "vitest";
import {
    buildCharacterImageTagFromDraft,
    resolveCharacterImageTagPaths,
} from "nbook/server/text-to-image/character-image-tags";

describe("character image-tags generation", () => {
    it("uses the existing character directory when current detail is index.md", () => {
        const paths = resolveCharacterImageTagPaths({
            characterPath: "lorebook/character/old-slug/index.md",
            characterTitle: "小明",
        });

        expect(paths.characterDirectoryPath).toBe("lorebook/character/old-slug");
        expect(paths.detailPath).toBe("lorebook/character/old-slug/index.md");
        expect(paths.imageTagsPath).toBe("lorebook/character/old-slug/image-tags.md");
        expect(paths.shouldCopyDetailFile).toBe(false);
    });

    it("creates a character-name directory for flat markdown detail files", () => {
        const paths = resolveCharacterImageTagPaths({
            characterPath: "lorebook/character/source.md",
            characterTitle: "小明 / 明明",
        });

        expect(paths.characterDirectoryPath).toBe("lorebook/character/小明-明明");
        expect(paths.detailPath).toBe("lorebook/character/小明-明明/index.md");
        expect(paths.imageTagsPath).toBe("lorebook/character/小明-明明/image-tags.md");
        expect(paths.shouldCopyDetailFile).toBe(true);
    });

    it("builds image-tags data from an LLM character draft", () => {
        const tag = buildCharacterImageTagFromDraft({
            id: "xiaoming",
            sourcePath: "lorebook/character/xiaoming/image-tags.md",
            fallbackCnName: "小明|明明",
            fallbackEnName: "Xiao Ming",
            draft: {
                facialAppearance: "blonde hair, golden brown eyes",
                profileTraits: "innocent, candid",
                upperSfw: "petite, slender body",
            },
        });

        expect(tag.cnAliases).toEqual(["小明", "明明"]);
        expect(tag.enName).toBe("Xiao Ming");
        expect(tag.facialAppearance).toBe("blonde hair, golden brown eyes");
        expect(tag.upperSfw).toBe("petite, slender body");
    });
});
