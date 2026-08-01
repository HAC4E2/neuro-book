import {describe, expect, it} from "vitest";
import {renderCharacterImageTagsMarkdown, renderOutfitTagsMarkdown} from "nbook/server/text-to-image/character-visual.codec";
import {
    CharacterVisualRegistryError,
    CharacterVisualRegistryService,
    type CharacterVisualRegistryFileStore,
} from "nbook/server/text-to-image/character-visual-registry.service";

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
        canonical: {tagId, canonicalName: sourceText},
        decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
    };
}

function character() {
    return {
        schema: "nbook.character-image-tags/v2" as const,
        characterId: "hero",
        names: {cn: "主角", aliasesCn: ["少年"], en: "hero"},
        resolutionScope: {providerKind: "novelai" as const, modelScope: {kind: "generic-novelai" as const}},
        fields: {
            profileTraits: ["tr-calm"], facialAppearance: [], facialBack: [], upperSfw: [], upperBackSfw: [],
            lowerSfw: [], lowerBackSfw: [], upperNsfw: [], upperBackNsfw: [], lowerNsfw: [], lowerBackNsfw: [], negativePrompt: [],
        },
        outfitRefs: ["outfits/travel.md"],
        fieldProviderSyntaxRefs: {}, providerSyntaxNodes: {}, tagResolutions: {"tr-calm": terminal("calm", 3001)}, policyApprovals: {},
    };
}

function outfit(ownerCharacterId = "hero", outfitId = "travel") {
    return {
        schema: "nbook.outfit-tags/v2" as const,
        outfitId,
        ownerCharacterId,
        names: {cn: "旅行装", en: "travel outfit"},
        resolutionScope: {providerKind: "novelai" as const, modelScope: {kind: "generic-novelai" as const}},
        fields: {upper: ["tr-coat"], upperBack: [], lower: [], lowerBack: []},
        fieldProviderSyntaxRefs: {}, providerSyntaxNodes: {}, tagResolutions: {"tr-coat": terminal("coat", 3002)}, policyApprovals: {},
    };
}

class MemoryStore implements CharacterVisualRegistryFileStore {
    readonly files = new Map<string, string>();

    async resolveProjectRoot(): Promise<string> {
        return "C:/project";
    }

    assertProjectOpen(): void {}

    async listPaths(): Promise<string[]> {
        return [...this.files.keys()].sort();
    }

    async read(_root: string, filePath: string): Promise<string | null> {
        return this.files.get(filePath) ?? null;
    }
}

describe("Character visual V2 registry", () => {
    it("只加载严格 V2 并汇总独立 planning/render hashes", async () => {
        const store = new MemoryStore();
        store.files.set("lorebook/character/hero/image-tags.md", renderCharacterImageTagsMarkdown(character()));
        store.files.set("lorebook/character/hero/outfits/travel.md", renderOutfitTagsMarkdown(outfit()));
        const result = await new CharacterVisualRegistryService({store}).read({projectPath: "workspace/demo"});
        expect(result.characters).toHaveLength(1);
        expect(result.characters[0]?.character.characterId).toBe("hero");
        expect(result.characters[0]?.outfits[0]?.outfit.outfitId).toBe("travel");
        expect(result.visualPlanningFactsHash).toMatch(/^sha256:/u);
        expect(result.renderTagFactsHash).toMatch(/^sha256:/u);
        expect(result.visualPlanningFactsHash).not.toBe(result.renderTagFactsHash);
    });

    it("旧格式 image-tags 视为缺少视觉资料，不要求 migration", async () => {
        const store = new MemoryStore();
        store.files.set("lorebook/character/hero/image-tags.md", "# image-tags\n\n## 角色特征\ncalm\n");
        const result = await new CharacterVisualRegistryService({store}).read({projectPath: "workspace/demo"});
        expect(result.characters).toEqual([]);
    });

    it("声明为 V2 但内容无效时保持显式错误", async () => {
        const store = new MemoryStore();
        store.files.set("lorebook/character/hero/image-tags.md", renderCharacterImageTagsMarkdown(character()).replace("outfitRefs:", "unknownField: true\noutfitRefs:"));
        await expect(new CharacterVisualRegistryService({store}).read({projectPath: "workspace/demo"}))
            .rejects.toMatchObject({code: "CHARACTER_VISUAL_INVALID"});
    });

    it("合法 YAML 引号 schema 键声明的无效 V2 也显式报错", async () => {
        const store = new MemoryStore();
        store.files.set(
            "lorebook/character/hero/image-tags.md",
            renderCharacterImageTagsMarkdown(character())
                .replace("schema: nbook.character-image-tags/v2", '"schema": nbook.character-image-tags/v2')
                .replace("outfitRefs:", "unknownField: true\noutfitRefs:"),
        );
        await expect(new CharacterVisualRegistryService({store}).read({projectPath: "workspace/demo"}))
            .rejects.toMatchObject({code: "CHARACTER_VISUAL_INVALID"});
    });

    it("缺失 outfit、owner mismatch 与 filename identity mismatch 均拒绝", async () => {
        for (const invalid of [null, outfit("villain"), outfit("hero", "other")]) {
            const store = new MemoryStore();
            store.files.set("lorebook/character/hero/image-tags.md", renderCharacterImageTagsMarkdown(character()));
            if (invalid) store.files.set("lorebook/character/hero/outfits/travel.md", renderOutfitTagsMarkdown(invalid));
            await expect(new CharacterVisualRegistryService({store}).read({projectPath: "workspace/demo"}))
                .rejects.toBeInstanceOf(CharacterVisualRegistryError);
        }
    });

    it("空 Project 返回稳定空 registry，不伪造角色", async () => {
        const result = await new CharacterVisualRegistryService({store: new MemoryStore()}).read({projectPath: "workspace/demo"});
        expect(result.characters).toEqual([]);
        expect(result.visualPlanningFactsHash).toMatch(/^sha256:/u);
    });
});
