import {describe, expect, it} from "vitest";
import {
    buildCharacterOutfitArtifacts,
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

    it("updates returned outfits, preserves unmentioned indexes, and rejects another owner's outfit", () => {
        const artifacts = buildCharacterOutfitArtifacts({
            characterDirectoryPath: "lorebook/character/xiaoming",
            characterEnName: "Xiao Ming",
            existingOutfits: [{
                sourcePath: "lorebook/character/xiaoming/outfits/深色水手校服.md",
                owner: "Xiao Ming",
                nameCn: "深色水手校服",
                nameEn: "dark navy sailor uniform",
                upper: "old shirt",
                upperBack: "old shirt",
                lower: "old skirt",
                lowerBack: "old skirt",
            }, {
                sourcePath: "lorebook/character/xiaoming/outfits/白色睡裙.md",
                owner: "Xiao Ming",
                nameCn: "白色睡裙",
                nameEn: "white nightgown",
                upper: "",
                upperBack: "",
                lower: "",
                lowerBack: "",
            }],
            drafts: [{
                owner: "Xiao Ming",
                nameCn: "深色水手校服",
                nameEn: "dark navy sailor uniform",
                upper: "new sailor shirt",
                upperBack: "new sailor shirt",
                lower: "new pleated skirt",
                lowerBack: "new pleated skirt",
            }, {
                owner: "Other Person",
                nameCn: "不应绑定的礼服",
                nameEn: "unbound formalwear",
                upper: "formal jacket",
                upperBack: "formal jacket",
                lower: "formal trousers",
                lowerBack: "formal trousers",
            }],
        });

        expect(artifacts.outfits.map((outfit) => outfit.nameCn)).toEqual(["深色水手校服", "白色睡裙"]);
        expect(artifacts.files).toHaveLength(1);
        expect(artifacts.files[0]?.path).toBe("lorebook/character/xiaoming/outfits/深色水手校服.md");
        expect(artifacts.files[0]?.content).toContain("new sailor shirt");
        expect(artifacts.warnings[0]).toContain("Other Person");
    });

    it("never reuses an indexed outfit path outside the current character outfits directory", () => {
        const artifacts = buildCharacterOutfitArtifacts({
            characterDirectoryPath: "lorebook/character/xiaoming",
            characterEnName: "Xiao Ming",
            existingOutfits: [{
                sourcePath: "manuscript/chapter-1.md",
                owner: "Xiao Ming",
                nameCn: "旅行便装",
                nameEn: "traveler casual outfit",
                upper: "old shirt",
                upperBack: "old shirt",
                lower: "old trousers",
                lowerBack: "old trousers",
            }],
            drafts: [{
                owner: "Xiao Ming",
                nameCn: "旅行便装",
                nameEn: "traveler casual outfit",
                upper: "linen shirt",
                upperBack: "linen shirt",
                lower: "brown trousers",
                lowerBack: "brown trousers",
            }],
        });

        expect(artifacts.files[0]?.path).toBe("lorebook/character/xiaoming/outfits/旅行便装.md");
        expect(artifacts.outfits[0]?.sourcePath).toBe("lorebook/character/xiaoming/outfits/旅行便装.md");
    });
});
