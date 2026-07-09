import {describe, expect, it} from "vitest";
import type {TextToImageCharacterImageTag} from "nbook/app/utils/text-to-image-character-tags";
import {
    buildBodyImageCharacterTagContext,
    fallbackDetectBodyImageCharacterTags,
} from "nbook/server/text-to-image/body-image-character-tags";

function characterTag(patch: Partial<TextToImageCharacterImageTag>): TextToImageCharacterImageTag {
    return {
        id: patch.id ?? "character",
        sourcePath: patch.sourcePath ?? "lorebook/character/character/image-tags.md",
        cnName: patch.cnName ?? "角色",
        cnAliases: patch.cnAliases ?? ["角色"],
        enName: patch.enName ?? "Character",
        profileTraits: patch.profileTraits ?? "",
        facialAppearance: patch.facialAppearance ?? "",
        facialBack: patch.facialBack ?? "",
        upperSfw: patch.upperSfw ?? "",
        upperBackSfw: patch.upperBackSfw ?? "",
        lowerSfw: patch.lowerSfw ?? "",
        lowerBackSfw: patch.lowerBackSfw ?? "",
        upperNsfw: patch.upperNsfw ?? "",
        upperBackNsfw: patch.upperBackNsfw ?? "",
        lowerNsfw: patch.lowerNsfw ?? "",
        lowerBackNsfw: patch.lowerBackNsfw ?? "",
        negativePrompt: patch.negativePrompt ?? "",
        outfits: patch.outfits ?? [],
    };
}

describe("body image character tag context", () => {
    it("fallback detector matches any Chinese alias without injecting unrelated characters", () => {
        const candidates = [
            characterTag({id: "xiaoming", cnName: "小明|明明", cnAliases: ["小明", "明明"], enName: "Xiao Ming"}),
            characterTag({id: "xiaohong", cnName: "小红", cnAliases: ["小红"], enName: "Xiao Hong"}),
        ];

        const matches = fallbackDetectBodyImageCharacterTags("明明推开教室的门。", candidates);

        expect(matches.map((item) => item.id)).toEqual(["xiaoming"]);
    });

    it("builds request variables from detector matches and keeps prompt replacement visible", async () => {
        const candidates = [
            characterTag({
                id: "xiaoming",
                cnName: "小明|明明",
                cnAliases: ["小明", "明明"],
                enName: "Xiao Ming",
                facialAppearance: "blonde hair",
                upperSfw: "petite",
            }),
            characterTag({
                id: "xiaohong",
                cnName: "小红",
                cnAliases: ["小红"],
                enName: "Xiao Hong",
                facialAppearance: "red hair",
            }),
        ];

        const context = await buildBodyImageCharacterTagContext({
            chapterMarkdown: "小明站在窗边。",
            candidates,
            promptRules: [{
                name: "去掉旧画风",
                enabled: true,
                target: "positive",
                matchMode: "plain",
                mode: "replace",
                trigger: "old style",
                replacement: "new style",
            }],
            detect: async () => [{id: "xiaoming", sourcePath: candidates[0]!.sourcePath, reason: "正文点名", confidence: 0.98}],
        });

        expect(context.matchedCharacters.map((item) => item.id)).toEqual(["xiaoming"]);
        expect(context.requestVariables.characterImageTags).toContain("Xiao Ming");
        expect(context.requestVariables.characterImageTags).toContain("blonde hair");
        expect(context.requestVariables.characterImageTags).not.toContain("Xiao Hong");
        expect(context.requestVariables.promptRules).toContain("new style");
    });
});
