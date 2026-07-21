import {describe, expect, it} from "vitest";
import {
    createDefaultTextToImageRecipeSource,
    type TextToImageRecipeSource,
} from "nbook/shared/text-to-image-recipe";
import {
    createTextToImageRecipeSnapshot,
    parseTextToImageRecipeMarkdown,
    renderTextToImageRecipeMarkdown,
} from "nbook/server/text-to-image/recipe.codec";

describe("text-to-image Recipe codec", () => {
    it("规范渲染后可以严格往返默认 Recipe", () => {
        const source = createDefaultTextToImageRecipeSource();

        const markdown = renderTextToImageRecipeMarkdown(source);
        const parsed = parseTextToImageRecipeMarkdown(markdown);

        expect(parsed).toEqual(source);
        expect(markdown).toContain("type: instruction");
        expect(markdown).toContain("textToImageRecipe:");
        expect(markdown).toContain("schemaVersion: 2");
    });

    it("拒绝 Recipe 扩展中的未知字段", () => {
        const markdown = renderTextToImageRecipeMarkdown(createDefaultTextToImageRecipeSource())
            .replace("schemaVersion: 2", "schemaVersion: 2\n    providerId: 99");

        expect(() => parseTextToImageRecipeMarkdown(markdown)).toThrow(/providerId|unrecognized|未知/u);
    });

    it("拒绝重复 frontmatter key", () => {
        const markdown = renderTextToImageRecipeMarkdown(createDefaultTextToImageRecipeSource())
            .replace("schemaVersion: 2", "schemaVersion: 2\n    schemaVersion: 2");

        expect(() => parseTextToImageRecipeMarkdown(markdown)).toThrow(/duplicate|Map keys|重复/u);
    });

    it("规划约束 hash 与完整 Recipe source hash 分离", () => {
        const source = createDefaultTextToImageRecipeSource();
        const baseline = createTextToImageRecipeSnapshot(source);
        const styleChanged: TextToImageRecipeSource = {
            ...source,
            style: {...source.style, positivePrefix: "cinematic lighting"},
        };
        const dimensionChanged: TextToImageRecipeSource = {
            ...source,
            dimensions: {
                ...source.dimensions,
                portrait: {width: 896, height: 1344},
            },
        };

        const styleSnapshot = createTextToImageRecipeSnapshot(styleChanged);
        const dimensionSnapshot = createTextToImageRecipeSnapshot(dimensionChanged);

        expect(styleSnapshot.planningConstraintsHash).toBe(baseline.planningConstraintsHash);
        expect(styleSnapshot.recipeSourceHash).not.toBe(baseline.recipeSourceHash);
        expect(dimensionSnapshot.planningConstraintsHash).not.toBe(baseline.planningConstraintsHash);
        expect(dimensionSnapshot.recipeSourceHash).not.toBe(baseline.recipeSourceHash);
    });

    it("参考选择只保存内容 hash/强度并参与执行 hash，不接受 Data URL", () => {
        const source = createDefaultTextToImageRecipeSource();
        const withReference: TextToImageRecipeSource = {
            ...source,
            references: {
                normalizeVibeStrengths: true,
                vibeReferences: [{contentHash: "a".repeat(64), strength: 0.6, informationExtracted: 1}],
                characterReferences: [],
                inpaint: null,
            },
        };
        const snapshot = createTextToImageRecipeSnapshot(withReference);

        expect(parseTextToImageRecipeMarkdown(renderTextToImageRecipeMarkdown(withReference))).toEqual(withReference);
        expect(snapshot.recipeSourceHash).not.toBe(createTextToImageRecipeSnapshot(source).recipeSourceHash);
        expect(() => renderTextToImageRecipeMarkdown({
            ...withReference,
            references: {
                ...withReference.references,
                vibeReferences: [{
                    contentHash: "a".repeat(64),
                    strength: 0.6,
                    informationExtracted: 1,
                    imageDataUrl: "data:image/png;base64,secret",
                }],
            },
        } as TextToImageRecipeSource)).toThrow();
    });
});
