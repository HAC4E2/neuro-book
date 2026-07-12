import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {parseTextToImageCharacterImageTags} from "nbook/app/utils/text-to-image-character-tags";
import type {TextToImageCharacterImageTag} from "nbook/app/utils/text-to-image-character-tags";
import {
    buildBodyImageCharacterTagContext,
    fallbackDetectBodyImageCharacterTags,
    hydrateCharacterOutfits,
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
    it("loads linked outfit markdown files into the character package", async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-outfit-tags-"));
        try {
            const outfitPath = path.join(projectRoot, "lorebook", "character", "xiaoming", "outfits", "深色水手校服.md");
            await fs.mkdir(path.dirname(outfitPath), {recursive: true});
            await fs.writeFile(outfitPath, [
                "# 深色水手校服/dark navy sailor uniform",
                "## 归属角色",
                "Xiao Ming",
                "## 上半身",
                "white sailor shirt",
                "## 上半身背面",
                "white sailor shirt, back bow",
                "## 下半身",
                "navy pleated skirt",
                "## 下半身背面",
                "navy pleated skirt, back pleats",
            ].join("\n"), "utf-8");
            const character = parseTextToImageCharacterImageTags([
                "## 角色中文名称",
                "小明",
                "## 角色英文名称",
                "Xiao Ming",
                "## 服装列表",
                "- [深色水手校服/dark navy sailor uniform](outfits/深色水手校服.md)",
            ].join("\n"), {
                id: "xiaoming",
                sourcePath: "lorebook/character/xiaoming/image-tags.md",
            });

            const hydrated = await hydrateCharacterOutfits(projectRoot, character);

            expect(hydrated.outfits[0]).toMatchObject({
                sourcePath: "lorebook/character/xiaoming/outfits/深色水手校服.md",
                owner: "Xiao Ming",
                upper: "white sailor shirt",
                upperBack: "white sailor shirt, back bow",
                lower: "navy pleated skirt",
                lowerBack: "navy pleated skirt, back pleats",
            });
        } finally {
            await fs.rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("fallback detector matches any Chinese alias without injecting unrelated characters", () => {
        const candidates = [
            characterTag({id: "xiaoming", cnName: "小明|明明", cnAliases: ["小明", "明明"], enName: "Xiao Ming"}),
            characterTag({id: "xiaohong", cnName: "小红", cnAliases: ["小红"], enName: "Xiao Hong"}),
        ];

        const matches = fallbackDetectBodyImageCharacterTags("明明，推开教室的门。", candidates);

        expect(matches.map((item) => item.id)).toEqual(["xiaoming"]);
    });

    it("fallback ignores single-character aliases and Han substring matches", () => {
        const candidates = [
            characterTag({id: "single", cnAliases: ["明"], enName: "Ming"}),
            characterTag({id: "xiaoming", cnAliases: ["小明"], enName: "Xiao Ming"}),
            characterTag({id: "alice", cnAliases: [], enName: "Alice"}),
        ];

        expect(fallbackDetectBodyImageCharacterTags("小明明站在门口，malice 不是角色。", candidates).map((item) => item.id))
            .toEqual([]);
        expect(fallbackDetectBodyImageCharacterTags("Alice 站在门口。", candidates).map((item) => item.id))
            .toEqual(["alice"]);
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
