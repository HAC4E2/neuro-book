import {describe, expect, it} from "vitest";
import {
    materializeCharacterVisualDirect,
    normalizeOutfitFileStem,
    type DirectVisualTagInput,
} from "nbook/server/text-to-image/character-visual-materializer";
import type {CharacterVisualDirectorOutput} from "nbook/shared/text-to-image-character-direct-write";
import type {OutfitTags} from "nbook/shared/text-to-image-character-visual";
import {createProviderPassthroughValidationHash} from "nbook/shared/text-to-image-tag-resolution";
import {createTagPolicyReviewRequestHash} from "nbook/shared/text-to-image-tag-resolver";

const HASH = `sha256:${"a".repeat(64)}`;

function output(overrides: Partial<CharacterVisualDirectorOutput> = {}): CharacterVisualDirectorOutput {
    return {
        schemaVersion: "nbook.character-visual-director-output/v2",
        operation: "generate-character-visual",
        state: "completed",
        sourceCharacterFileHash: HASH,
        summary: "生成角色视觉资料",
        character: {
            names: {cn: "小明", en: "xiao ming"},
            fields: {
                profileTraits: "calm,brave",
                facialAppearance: "",
                facialBack: "",
                upperSfw: "",
                upperBackSfw: "",
                lowerSfw: "",
                lowerBackSfw: "",
                upperNsfw: "",
                upperBackNsfw: "",
                lowerNsfw: "",
                lowerBackNsfw: "",
                negativePrompt: "",
            },
        },
        outfits: [{
            names: {cn: "旅行装", en: "travel outfit"},
            fields: {upper: "coat", upperBack: "", lower: "pants", lowerBack: ""},
        }],
        diagnostics: [],
        ...overrides,
    };
}

function terminal(sourceText: string, tagId: number) {
    return {
        state: "terminal" as const,
        run: {
            schemaVersion: "nbook.tag-resolution-run/v1" as const,
            state: "terminal_canonical" as const,
            runId: "run-1",
            resolutionId: `resolution-${tagId}`,
            contextId: "hero",
            sourceText,
            modelScope: {kind: "generic-novelai" as const},
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
            terminal: {
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
                resolvedAt: "2026-08-01T00:00:00.000Z",
                matchedBy: "exact" as const,
                canonical: {tagId, canonicalName: sourceText},
                decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
            },
        },
        reviewApproval: null,
    };
}

function passthrough(sourceText: string) {
    return {
        state: "terminal" as const,
        run: {
            schemaVersion: "nbook.tag-resolution-run/v1" as const,
            state: "terminal_passthrough" as const,
            runId: "run-1",
            resolutionId: "resolution-passthrough",
            contextId: "hero",
            sourceText,
            modelScope: {kind: "generic-novelai" as const},
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
            terminal: {
                schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
                kind: "provider_passthrough" as const,
                sourceText,
                indexVersion: "db3k-demo",
                policyVersion: "safe-demo",
                resolverVersion: "resolver-demo",
                resolverPolicyVersion: "resolver-policy-demo",
                capabilityVersion: "nai-cap-demo",
                providerKind: "novelai" as const,
                modelScope: {kind: "generic-novelai" as const},
                candidateSetHash: HASH,
                resolvedAt: "2026-08-01T00:00:00.000Z",
                wireText: sourceText,
                validationTextHash: createProviderPassthroughValidationHash(sourceText),
                reason: "no_reliable_candidate" as const,
                decisionProvenance: {selectedBy: "passthrough_fallback" as const, conceptQueriesHash: null},
            },
        },
        reviewApproval: null,
    };
}

function review(sourceText: string) {
    return {
        state: "review_required" as const,
        review: {
            schemaVersion: "nbook.tag-policy-review-request/v1" as const,
            resolutionId: "review-1",
            sourceText,
            policy: {policyVersion: "safe-demo", contentScope: "general" as const, matchedRuleIds: [], decision: "review_required" as const},
            subject: {kind: "canonical" as const, tagId: 3001, canonicalName: sourceText},
            reviewRequestHash: createTagPolicyReviewRequestHash({
                schemaVersion: "nbook.tag-policy-review-request/v1",
                resolutionId: "review-1",
                sourceText,
                policy: {policyVersion: "safe-demo", contentScope: "general", matchedRuleIds: [], decision: "review_required"},
                subject: {kind: "canonical", tagId: 3001, canonicalName: sourceText},
            }),
        },
    };
}

function resolver(results: Record<string, ReturnType<typeof terminal> | ReturnType<typeof passthrough> | ReturnType<typeof review>>) {
    const calls: DirectVisualTagInput[] = [];
    return {
        calls,
        resolveTag: async (input: DirectVisualTagInput) => {
            calls.push(input);
            return results[input.sourceText] ?? terminal(input.sourceText, calls.length + 5000);
        },
    };
}

function existingOutfit(stem: string, ownerCharacterId = "hero"): {path: string; outfit: OutfitTags} {
    return {
        path: `lorebook/character/hero/outfits/${stem}.md`,
        outfit: {
            schema: "nbook.outfit-tags/v2",
            outfitId: stem,
            ownerCharacterId,
            names: {cn: stem, en: stem},
            resolutionScope: {providerKind: "novelai", modelScope: {kind: "generic-novelai"}},
            fields: {upper: [], upperBack: [], lower: [], lowerBack: []},
            fieldProviderSyntaxRefs: {},
            providerSyntaxNodes: {},
            tagResolutions: {},
            policyApprovals: {},
        },
    };
}

async function materialize(
    directorOutput = output(),
    existingOutfits: Array<{path: string; outfit: OutfitTags}> = [],
    tagResolver = resolver({}),
) {
    return materializeCharacterVisualDirect({
        runId: "run-1",
        characterId: "hero",
        existingCharacter: null,
        existingOutfits,
        output: directorOutput,
        resolveTag: tagResolver.resolveTag,
    });
}

describe("character visual direct materializer", () => {
    it("优先使用中文服装名，并在中文为空时将英文空白规范为连字符", () => {
        expect(normalizeOutfitFileStem({cn: "深蓝水手服", en: "dark navy sailor uniform"})).toBe("深蓝水手服");
        expect(normalizeOutfitFileStem({cn: "", en: "dark navy sailor uniform"})).toBe("dark-navy-sailor-uniform");
    });

    it("以 NFKC 规范服装文件名", () => {
        expect(normalizeOutfitFileStem({cn: "", en: "ＡＢＣ　制服"})).toBe("ABC-制服");
    });

    it("拒绝 Windows 路径、控制字符、尾随点或空格及保留设备名", () => {
        for (const name of ["a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "a\u0000b", "name.", "name ", "CON", "con.txt", "PRN", "AUX.md", "NUL", "COM1", "com9.txt", "LPT1", "lpt9.md"]) {
            expect(() => normalizeOutfitFileStem({cn: name, en: "fallback"})).toThrow(/CHARACTER_VISUAL_OUTFIT_NAME_INVALID/u);
        }
    });

    it("空、过长或无法通过 VisualStableId 的服装名会让整体 materialization 失败", async () => {
        await expect(materialize(output({outfits: [{names: {cn: "", en: ""}, fields: {upper: "", upperBack: "", lower: "", lowerBack: ""}}]}))).rejects.toThrow();
        await expect(materialize(output({outfits: [{names: {cn: "a".repeat(161), en: "fallback"}, fields: {upper: "", upperBack: "", lower: "", lowerBack: ""}}]}))).rejects.toThrow();
        await expect(materialize(output({outfits: [{names: {cn: "-leading", en: "fallback"}, fields: {upper: "", upperBack: "", lower: "", lowerBack: ""}}]}))).rejects.toThrow(/CHARACTER_VISUAL_OUTFIT_NAME_INVALID/u);
    });

    it("拒绝重复或规范化后碰撞的服装名，不生成后缀", async () => {
        const duplicate = output({outfits: [
            {names: {cn: "ＡＢＣ", en: "travel outfit"}, fields: {upper: "", upperBack: "", lower: "", lowerBack: ""}},
            {names: {cn: "ABC", en: "travel outfit"}, fields: {upper: "", upperBack: "", lower: "", lowerBack: ""}},
        ]});
        await expect(materialize(duplicate)).rejects.toThrow(/CHARACTER_VISUAL_OUTFIT_CONFLICT/u);
    });

    it("同 stem 且同 owner 更新既有文件，owner 不同则失败", async () => {
        const sameOwner = await materialize(output(), [existingOutfit("旅行装")]);
        expect(sameOwner.outfits.map((item) => item.path)).toContain("lorebook/character/hero/outfits/旅行装.md");
        await expect(materialize(output(), [existingOutfit("旅行装", "other")])).rejects.toThrow(/CHARACTER_VISUAL_OUTFIT_CONFLICT/u);
    });

    it("保留新输出未提及的既有有效服装引用和文档", async () => {
        const result = await materialize(output(), [existingOutfit("旅行装"), existingOutfit("旧装")]);
        expect(result.character.outfitRefs).toEqual(["outfits/旅行装.md", "outfits/旧装.md"]);
        expect(result.outfits.map((item) => item.path)).toEqual([
            "lorebook/character/hero/outfits/旅行装.md",
            "lorebook/character/hero/outfits/旧装.md",
        ]);
        expect(result.outfits.find((item) => item.outfit.outfitId === "旧装")?.outfit).toEqual(existingOutfit("旧装").outfit);
    });

    it("只保留 allow 与已清洗的 provider passthrough 终态 resolution", async () => {
        const tagResolver = resolver({calm: terminal("calm", 3001), brave: passthrough("brave")});
        const result = await materialize(output({outfits: []}), [], tagResolver);
        expect(Object.values(result.character.tagResolutions).map((item) => item.kind).sort()).toEqual(["canonical", "provider_passthrough"]);
        expect(result.character.policyApprovals).toEqual({});
        expect(tagResolver.calls).toEqual(expect.arrayContaining([
            expect.objectContaining({runId: "run-1", contextId: expect.stringMatching(/^character-/u), modelScope: {kind: "generic-novelai"}, approval: null}),
        ]));
    });

    it("无批准的 review_required 从文档排除并返回诊断", async () => {
        const result = await materialize(output({outfits: []}), [], resolver({calm: review("calm")}));
        expect(result.character.fields.profileTraits).toHaveLength(1);
        expect(Object.values(result.character.tagResolutions).map((item) => item.sourceText)).not.toContain("calm");
        expect(result.diagnostics).toEqual([expect.objectContaining({code: "TAG_REVIEW_EXCLUDED", owner: "character:hero", field: "profileTraits", sourceText: "calm"})]);
    });

    it("block、宏、权重、XML/Markdown 或 Provider 参数中的任一项都会中止全部文档", async () => {
        await expect(materialize(output({outfits: []}), [], resolver({calm: {
            state: "blocked",
            code: "TAG_POLICY_BLOCKED",
            resolutionId: "blocked-1",
            sourceText: "calm",
            policy: {policyVersion: "safe-demo", contentScope: "general", matchedRuleIds: [], decision: "block"},
            subject: {kind: "canonical", tagId: 3001, canonicalName: "calm"},
        }}))).rejects.toThrow(/CHARACTER_VISUAL_POLICY_BLOCKED/u);
        for (const value of ["${macro}", "(calm:1.2)", "<tag>", "**calm**", "quality=high"]) {
            await expect(materialize(output({outfits: [], character: {...output().character!, fields: {...output().character!.fields, profileTraits: value}}}))).rejects.toThrow(/CHARACTER_VISUAL_POLICY_BLOCKED/u);
        }
    });

    it("每个字段超过 20 个 terminal tag 时失败而不是截断", async () => {
        const tags = Array.from({length: 21}, (_, index) => `tag-${index}`).join(",");
        await expect(materialize(output({outfits: [], character: {...output().character!, fields: {...output().character!.fields, profileTraits: tags}}}))).rejects.toThrow();
    });
});
