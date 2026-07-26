import {describe, expect, it} from "vitest";
import {
    inspectCharacterVisualDraftGroup,
    inspectLegacyCharacterVisualGroup,
    materializeCharacterVisualV2,
} from "nbook/server/text-to-image/character-visual-migration";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function characterMarkdown(profileTraits = "calm, ((blue eyes))") {
    return [
        "# image-tags",
        "",
        "## 角色中文名称",
        "主角|少年",
        "",
        "## 角色英文名称",
        "hero",
        "",
        "## 角色特征",
        profileTraits,
        "",
        "## 五官外貌",
        "sharp eyes",
        "",
        "## 负面提示词",
        "bad anatomy",
        "",
        "## 服装列表",
        "- [旅行装/travel outfit](outfits/travel.md)",
        "",
    ].join("\n");
}

function outfitMarkdown(owner = "hero") {
    return [
        "# 旅行装/travel outfit",
        "",
        "## 归属角色",
        owner,
        "",
        "## 上半身",
        "coat, scarf",
        "",
        "## 上半身背面",
        "coat back",
        "",
        "## 下半身",
        "trousers",
        "",
        "## 下半身背面",
        "trousers back",
        "",
    ].join("\n");
}

function terminal(sourceText: string, tagId: number) {
    return {
        schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
        kind: "canonical" as const,
        sourceText,
        indexVersion: "db3k-demo",
        policyVersion: "safe-demo",
        resolverVersion: "resolver-demo",
        resolverPolicyVersion: "resolver-policy-demo",
        capabilityVersion: "nai-cap-demo",
        providerKind: "novelai" as const,
        modelScope: {kind: "generic-novelai" as const},
        candidateSetHash: null,
        resolvedAt: "2026-07-17T00:00:00.000Z",
        matchedBy: "exact" as const,
        canonical: {tagId, canonicalName: sourceText.replaceAll(" ", "_")},
        decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
    };
}

describe("Character visual legacy migration", () => {
    it("外部结构化 source 使用同一 candidate，允许 create-only target base", () => {
        const inspected = inspectCharacterVisualDraftGroup({
            source: {
                kind: "ttp_character_export",
                sourcePath: "upload/characters.json",
                rawSourceHash: HASH_A,
                sanitizedSourceHash: HASH_B,
                visualSourceHash: HASH_A,
                sourceCharacterId: "ttp-character-1234567890abcdef12345678",
                mergePreviewHash: HASH_B,
            },
            character: {
                path: "lorebook/character/hero/image-tags.md",
                targetBaseFileHash: null,
                characterId: "hero",
                names: {cn: "主角", aliasesCn: [], en: "hero"},
                fields: {
                    profileTraits: "calm", facialAppearance: "short hair", facialBack: "",
                    upperSfw: "", upperBackSfw: "", lowerSfw: "", lowerBackSfw: "",
                    upperNsfw: "", upperBackNsfw: "", lowerNsfw: "", lowerBackNsfw: "",
                    negativePrompt: "",
                },
                outfitRefs: ["outfits/ttp-outfit-1234567890abcdef12345678.md"],
            },
            outfits: [{
                path: "lorebook/character/hero/outfits/ttp-outfit-1234567890abcdef12345678.md",
                targetBaseFileHash: null,
                outfitId: "ttp-outfit-1234567890abcdef12345678",
                ownerCharacterId: "hero",
                names: {cn: "旅行装", en: "travel outfit"},
                fields: {upper: "coat", upperBack: "", lower: "trousers", lowerBack: ""},
            }],
            issues: [],
        });

        expect(inspected.source.kind).toBe("ttp_character_export");
        expect(inspected.character.targetBaseFileHash).toBeNull();
        expect(inspected.outfits[0]?.targetBaseFileHash).toBeNull();
        expect(inspected.pendingAtoms.map((item) => item.atom.sourceText)).toEqual([
            "calm", "short hair", "coat", "trousers",
        ]);
    });

    it("把旧自由字符串拆为稳定 pending atoms，并补齐全部固定字段", () => {
        const inspected = inspectLegacyCharacterVisualGroup({
            characterPath: "lorebook/character/hero/image-tags.md",
            characterMarkdown: characterMarkdown(),
            outfits: [{path: "lorebook/character/hero/outfits/travel.md", markdown: outfitMarkdown()}],
        });
        expect(inspected.state).toBe("pending_unresolved");
        expect(inspected.character.characterId).toBe("hero");
        expect(inspected.character.names).toEqual({cn: "主角", aliasesCn: ["少年"], en: "hero"});
        expect(inspected.character.outfitRefs).toEqual(["outfits/travel.md"]);
        expect(Object.keys(inspected.character.fields)).toEqual([
            "profileTraits", "facialAppearance", "facialBack", "upperSfw", "upperBackSfw", "lowerSfw",
            "lowerBackSfw", "upperNsfw", "upperBackNsfw", "lowerNsfw", "lowerBackNsfw", "negativePrompt",
        ]);
        expect(inspected.pendingAtoms.map((item) => item.atom.sourceText)).toEqual([
            "calm", "blue eyes", "sharp eyes", "bad anatomy", "coat", "scarf", "coat back", "trousers", "trousers back",
        ]);
        const weighted = inspected.pendingAtoms.find((item) => item.atom.sourceText === "blue eyes");
        expect(weighted?.syntax).toEqual({kind: "novelai-tag-weight", weight: 1.1});
        expect(new Set(inspected.pendingAtoms.map((item) => item.resolutionKey)).size).toBe(inspected.pendingAtoms.length);
        expect(inspected.issues).toEqual([]);
    });

    it("未知宏与 owner/path 不一致进入 blocking report，不猜测兼容", () => {
        const macro = inspectLegacyCharacterVisualGroup({
            characterPath: "lorebook/character/hero/image-tags.md",
            characterMarkdown: characterMarkdown("calm, {{random::blue::red}}"),
            outfits: [{path: "lorebook/character/other/outfits/travel.md", markdown: outfitMarkdown("villain")}],
        });
        expect(macro.state).toBe("blocked");
        expect(macro.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
            "UNKNOWN_PROVIDER_SYNTAX",
            "OUTFIT_PATH_MISMATCH",
            "OUTFIT_OWNER_MISMATCH",
        ]));
        expect(macro.pendingAtoms.some((item) => item.atom.sourceText.includes("random"))).toBe(false);
    });

    it("同一来源重复扫描产生相同 migration identity 与 resolution keys", () => {
        const input = {
            characterPath: "lorebook/character/hero/image-tags.md",
            characterMarkdown: characterMarkdown(),
            outfits: [{path: "lorebook/character/hero/outfits/travel.md", markdown: outfitMarkdown()}],
        };
        expect(inspectLegacyCharacterVisualGroup(input)).toEqual(inspectLegacyCharacterVisualGroup(input));
    });

    it("全部 terminal 就绪后生成 V2，同文件 key/syntax 所有权完整且不携带旧自由字符串", () => {
        const inspected = inspectLegacyCharacterVisualGroup({
            characterPath: "lorebook/character/hero/image-tags.md",
            characterMarkdown: characterMarkdown(),
            outfits: [{path: "lorebook/character/hero/outfits/travel.md", markdown: outfitMarkdown()}],
        });
        const resolutions = Object.fromEntries(inspected.pendingAtoms.map((item, index) => [
            item.resolutionKey,
            {terminal: terminal(item.atom.sourceText, index + 3001), reviewApproval: null},
        ]));
        const materialized = materializeCharacterVisualV2({candidate: inspected, resolutions});
        expect(materialized.character.fields.profileTraits).toHaveLength(2);
        expect(materialized.character.providerSyntaxNodes).toEqual(expect.objectContaining({
            [inspected.pendingAtoms.find((item) => item.atom.sourceText === "blue eyes")!.syntaxKey!]: expect.objectContaining({
                kind: "novelai-tag-weight",
                resolutionKeys: [inspected.pendingAtoms.find((item) => item.atom.sourceText === "blue eyes")!.resolutionKey],
            }),
        }));
        expect(materialized.outfits).toHaveLength(1);
        expect(materialized.outfits[0]?.outfit.ownerCharacterId).toBe("hero");
        expect(() => materializeCharacterVisualV2({candidate: inspected, resolutions: {}})).toThrow(/缺少 terminal/u);
    });
});
