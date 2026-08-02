import {describe, expect, it, vi} from "vitest";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {createCharacterImageTagHashes, createOutfitTagHashes} from "nbook/shared/text-to-image-character-visual";
import {createTagPatternRenderHash, TagPatternSchema} from "nbook/shared/text-to-image-tag-pattern";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";
import {resolveProviderCapability} from "nbook/shared/text-to-image-provider-registry";
import {createIllustrationRecipePlanningConstraints} from "nbook/shared/text-to-image-illustration-planning";
import type {TextToImageReferenceAssetDto} from "nbook/shared/text-to-image-reference-asset";
import {
    compileIllustration,
    type IllustrationCompileInput,
    type IllustrationResolutionValidator,
} from "nbook/server/text-to-image/illustration-compiler";
import {
    compileIllustration,
    IllustrationCompileError,
    type IllustrationResolutionValidator,
} from "nbook/server/text-to-image/illustration-compiler";

const H = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

/** 构造最小合法 source-image DTO；inpaint 双资产测试用它提供冻结证据。 */
function sourceDto(contentHash: string): TextToImageReferenceAssetDto {
    return {
        id: contentHash,
        kind: "source-image",
        contentHash,
        fileName: "asset.png",
        mimeType: "image/png",
        byteLength: 128,
        width: 3,
        height: 2,
        status: "available",
        createdAt: "2026-08-01T00:00:00.000Z",
    };
}

describe("Illustration Compiler", () => {
    it("canonically combines referenced Pattern, shot delta, character/outfit and Recipe style", async () => {
        const input = compileInput();
        const validator = modelValidator();
        const result = await compileIllustration(input, {resolutionValidator: validator});

        expect(validator.revalidate).toHaveBeenCalledWith(expect.objectContaining({
            contextId: "project-1",
            targetScope: {kind: "novelai-model", modelId: "nai-diffusion-4-5-full"},
        }));
        expect(result.request.prompt).toBe("cinematic_lighting, 1.25::rain::, silver-blue atmospheric haze");
        expect(result.request.negativePrompt).toBe("lowres, text");
        expect(result.request.characterPrompts).toEqual([{
            characterId: "hero",
            center: {x: 0.5, y: 0.5},
            prompt: "1girl, blue_eyes, red_coat",
            negativePrompt: "bad_anatomy, bad_hands",
        }]);
        expect(result.request.parameters).toMatchObject({width: 1216, height: 832, seed: 123, count: 1});
        expect(result.executionInputHash).toMatch(/^sha256:/u);
        expect(result.executionManifestHash).toMatch(/^sha256:/u);
    });

    it("compiles a no-registered-character shot from terminal transient visual tags", async () => {
        const base = compileInput();
        const transientFigure = canonical("young traveler, dark cloak", 4001);
        const result = await compileIllustration({
            ...base,
            shot: {
                ...base.shot,
                characterIds: [],
                outfitRefs: [],
                action: {},
                tagResolutions: {transientFigure},
                tagDelta: {prefer: ["transientFigure"], avoid: []},
            },
            characters: {
                ...base.characters,
                characters: [],
                renderTagFactsHash: hashTextToImageContract({characters: []}),
            },
        }, {resolutionValidator: modelValidator()});

        expect(result.request.characterPrompts).toEqual([]);
        expect(result.request.prompt).toContain("young traveler, dark cloak");
    });

    it("dedupes deterministically, lets shot avoid remove a non-mandatory Pattern suggestion, and blocks mandatory conflicts", async () => {
        const base = compileInput();
        const duplicateRain = resolvedStyle("rain", 1001);
        const deduped = await compileIllustration({
            ...base,
            recipeStyle: {...base.recipeStyle, positivePrefix: [duplicateRain]},
            recipeSnapshot: recipeSnapshot({positivePrefix: "rain"}),
        }, {resolutionValidator: modelValidator()});
        expect(deduped.request.prompt.match(/rain/gu)).toHaveLength(1);

        const preferMist = base.shot.tagResolutions.preferMist;
        if (!preferMist) throw new Error("测试 fixture 缺少 preferMist resolution");
        const avoided = await compileIllustration({
            ...base,
            shot: {
                ...base.shot,
                tagResolutions: {preferMist, avoidRain: canonical("rain", 1001)},
                tagDelta: {...base.shot.tagDelta, avoid: ["avoidRain"]},
            },
        }, {resolutionValidator: modelValidator()});
        expect(avoided.request.prompt).not.toContain("rain");
        expect(avoided.request.negativePrompt).toContain("rain");

        const mandatoryConflict = {
            ...base,
            recipeStyle: {...base.recipeStyle, negativePrefix: [resolvedStyle("1girl", 2001)]},
            recipeSnapshot: recipeSnapshot({positivePrefix: "cinematic_lighting", negativePrefix: "1girl"}),
        };
        await expect(compileIllustration(mandatoryConflict, {resolutionValidator: modelValidator()}))
            .rejects.toMatchObject<Partial<IllustrationCompileError>>({code: "ILLUSTRATION_COMPILE_CONFLICT"});
    });

    it("applies deterministic visibility and rejects missing referenced owner facts", async () => {
        const base = compileInput();
        const closeUp = await compileIllustration({
            ...base,
            shot: {...base.shot, composition: {...base.shot.composition, shotSize: "close-up" as const}},
        }, {resolutionValidator: modelValidator()});
        expect(closeUp.request.characterPrompts[0]?.prompt).toBe("1girl, blue_eyes");

        await expect(compileIllustration({
            ...base,
            shot: {...base.shot, outfitRefs: ["lorebook/character/hero/outfits/missing.md"]},
        }, {resolutionValidator: modelValidator()})).rejects.toMatchObject<Partial<IllustrationCompileError>>({
            code: "CHARACTER_VISUAL_TAGS_UNRESOLVED",
        });
    });

    it("hashes only referenced Pattern render snapshots and rejects planning/model scope drift", async () => {
        const base = compileInput();
        const unreferenced = pattern("pattern-unused", "fog", 7001);
        const first = await compileIllustration({
            ...base,
            effectivePatterns: {...base.effectivePatterns, patterns: [...base.effectivePatterns.patterns, unreferenced]},
        }, {resolutionValidator: modelValidator()});
        const changedUnused = pattern("pattern-unused", "snow", 7002);
        const second = await compileIllustration({
            ...base,
            effectivePatterns: {...base.effectivePatterns, patterns: [...base.effectivePatterns.patterns, changedUnused]},
        }, {resolutionValidator: modelValidator()});
        expect(second.executionInputHash).toBe(first.executionInputHash);

        const changedReferenced = pattern("pattern-rain", "storm", 7003);
        const third = await compileIllustration({
            ...base,
            effectivePatterns: {...base.effectivePatterns, patterns: [changedReferenced]},
        }, {resolutionValidator: modelValidator()});
        expect(third.executionInputHash).not.toBe(first.executionInputHash);

        await expect(compileIllustration({
            ...base,
            effectivePatterns: {...base.effectivePatterns, planningHash: H("e")},
        }, {resolutionValidator: modelValidator()})).rejects.toMatchObject<Partial<IllustrationCompileError>>({code: "ILLUSTRATION_SHOT_STALE"});

        await expect(compileIllustration({
            ...base,
            effectivePatterns: {...base.effectivePatterns, presetSemanticHash: H("f")},
        }, {resolutionValidator: modelValidator()})).rejects.toMatchObject<Partial<IllustrationCompileError>>({code: "ILLUSTRATION_SHOT_STALE"});

        const badValidator = modelValidator({keepGeneric: true});
        await expect(compileIllustration(base, {resolutionValidator: badValidator}))
            .rejects.toMatchObject<Partial<IllustrationCompileError>>({code: "TAG_RESOLUTION_INVALID"});
    });

    it("uses the shared NovelAI quality and negative-preset grammar", async () => {
        const base = compileInput();
        const recipe = recipeSnapshot({
            positivePrefix: "cinematic_lighting",
            positiveQualityPreset: true,
            negativeQualityPreset: "light",
        });
        const result = await compileIllustration({
            ...base,
            planningFacts: {...base.planningFacts, recipePlanningConstraintsHash: createIllustrationRecipePlanningConstraints(recipe).constraintsHash},
            recipeSnapshot: recipe,
        }, {resolutionValidator: modelValidator()});

        expect(result.request.prompt).toBe("cinematic_lighting, 1.25::rain::, silver-blue atmospheric haze, very aesthetic, masterpiece, no text");
        expect(result.request.negativePrompt).toBe("nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page, lowres, text");
        expect(result.request.parameters).toMatchObject({qualityToggle: true, ucPreset: 1});
    });

    it("P5 参考资产：空引用不需校验器；非空引用冻结证据并构造 preflight action/wireModel", async () => {
        const base = compileInput();
        const empty = await compileIllustration(base, {resolutionValidator: modelValidator()});
        expect(empty.request.references).toEqual({normalizeVibeStrengths: true, vibeReferences: [], characterReferences: [], inpaint: null});
        expect(empty.request.action).toBe("generate");
        expect(empty.request.wireModel).toBe("nai-diffusion-4-5-full");

        const hash64 = "a".repeat(64);
        const vibeSelection = {contentHash: hash64, strength: 0.6, informationExtracted: 0.5};
        const recipeWithRefs = recipeSnapshot({positivePrefix: "cinematic_lighting"});
        const resolved = await compileIllustration({
            ...base,
            recipeSnapshot: {
                ...recipeWithRefs,
                references: {...recipeWithRefs.references, vibeReferences: [vibeSelection]},
            },
            referenceAssetVerifier: async (contentHashes) => {
                const map = new Map<string, TextToImageReferenceAssetDto>();
                for (const hash of contentHashes) map.set(hash, sourceDto(hash));
                return map;
            },
        }, {resolutionValidator: modelValidator()});
        expect(resolved.request.references.vibeReferences).toEqual([vibeSelection]);
        expect(resolved.request.references.characterReferences).toEqual([]);
        expect(resolved.request.references.normalizeVibeStrengths).toBe(true);
        expect(resolved.request.referenceSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        // Vibe 引用命中已登记容器，preflight 仍为 generate。
        expect(resolved.request.action).toBe("generate");

        await expect(compileIllustration({
            ...base,
            recipeSnapshot: {
                ...recipeSnapshot({positivePrefix: "cinematic_lighting"}),
                references: {
                    ...recipeSnapshot({positivePrefix: "cinematic_lighting"}).references,
                    inpaint: {baseImageContentHash: hash64, maskContentHash: hash64},
                },
            },
            referenceAssetVerifier: async (contentHashes) => {
                const map = new Map<string, TextToImageReferenceAssetDto>();
                for (const hash of contentHashes) map.set(hash, {...sourceDto(hash), mimeType: "image/jpeg"});
                return map;
            },
        }, {resolutionValidator: modelValidator()})).rejects.toThrow(/Inpaint/u);

        // base/mask 尺寸不一致拒绝。
        await expect(compileIllustration({
            ...base,
            recipeSnapshot: {
                ...recipeSnapshot({positivePrefix: "cinematic_lighting"}),
                references: {
                    ...recipeSnapshot({positivePrefix: "cinematic_lighting"}).references,
                    inpaint: {baseImageContentHash: hash64, maskContentHash: "b".repeat(64)},
                },
            },
            referenceAssetVerifier: async (contentHashes) => {
                const map = new Map<string, TextToImageReferenceAssetDto>();
                for (const [index, hash] of contentHashes.entries()) {
                    map.set(hash, {...sourceDto(hash), height: index === 0 ? 2 : 3});
                }
                return map;
            },
        }, {resolutionValidator: modelValidator()})).rejects.toThrow(/尺寸不一致/u);

        await expect(compileIllustration({
            ...base,
            recipeSnapshot: {
                ...recipeSnapshot({positivePrefix: "cinematic_lighting"}),
                references: {...recipeSnapshot({positivePrefix: "cinematic_lighting"}).references, vibeReferences: [vibeSelection]},
            },
        }, {resolutionValidator: modelValidator()})).rejects.toThrow(/参考资产非空但未提供校验器/u);
    });
});

/** 完整 canonical compile fixture。 */
function compileInput() {
    const rain = pattern("pattern-rain", "rain", 1001, {weight: 1.25});
    const character = characterFixture();
    const outfit = outfitFixture();
    const characterHashes = createCharacterImageTagHashes(character);
    const outfitHashes = createOutfitTagHashes(outfit);
    const recipeSnapshotValue = recipeSnapshot({positivePrefix: "cinematic_lighting"});
    return {
        source: {
            projectId: "project-1",
            chapterPath: "manuscript/v1/c1/index.md",
            placeholderId: "placeholder-1",
            shotId: "shot-1",
            shotOrigin: "chapter-plan" as const,
            anchorId: "p_0001_abcdef12",
            shotIntentHash: H("a"),
            sourceChapterHash: H("b"),
        },
        publicationJournalId: "journal-1",
        planningFacts: {
            effectivePresetSemanticHash: H("2"),
            effectivePatternPlanningHash: H("c"),
            visualPlanningFactsHash: H("d"),
            recipePlanningConstraintsHash: createIllustrationRecipePlanningConstraints(recipeSnapshotValue).constraintsHash,
        },
        shot: {
            shotId: "shot-1",
            state: "active" as const,
            shotIntentHash: H("a"),
            placeholderId: "placeholder-1",
            publication: {journalId: "journal-1", status: "applied" as const, appliedAt: "2026-07-21T00:00:00.000Z"},
            origin: {kind: "chapter-plan" as const, planningRunId: "workflow-1"},
            anchorId: "p_0001_abcdef12",
            insertAfterAnchorId: "p_0001_abcdef12",
            purpose: "雨夜相遇",
            characterIds: ["hero"],
            outfitRefs: ["lorebook/character/hero/outfits/travel.md"],
            action: {},
            composition: {shotSize: "medium" as const, cameraAngle: "eye-level" as const, viewpoint: "third-person" as const, canvasIntent: "landscape" as const, subjectPlacement: "center"},
            continuity: {timeOfDay: "night", palette: "blue"},
            tagPatternRefs: ["pattern-rain"],
            tagResolutions: {
                preferMist: passthrough("silver-blue atmospheric haze"),
                avoidText: canonical("text", 1003),
            },
            tagDelta: {prefer: ["preferMist"], avoid: ["avoidText"]},
        },
        effectivePatterns: {presetSemanticHash: H("2"), planningHash: H("c"), patterns: [rain]},
        characters: {
            visualPlanningFactsHash: H("d"),
            renderTagFactsHash: hashTextToImageContract({characters: [characterHashes.renderTagFactsHash, outfitHashes.renderTagFactsHash]}),
            characters: [{
                path: "lorebook/character/hero/image-tags.md",
                fileHash: H("f"),
                character,
                hashes: characterHashes,
                outfits: [{path: "lorebook/character/hero/outfits/travel.md", fileHash: H("1"), outfit, hashes: outfitHashes}],
            }],
        },
        recipeSnapshot: recipeSnapshotValue,
        recipeStyle: {
            positivePrefix: [resolvedStyle("cinematic_lighting", 5001)],
            positiveSuffix: [],
            negativePrefix: [],
            negativeSuffix: [],
        },
        provider: {ownerUserId: 7, providerId: 11, credentialRevision: 3},
        capabilitySnapshot: resolveProviderCapability({kind: "novelai-model", modelId: "nai-diffusion-4-5-full"}),
        executionNonce: "nonce-1",
        variantIndex: 0,
        outputIndex: 0,
        outputCount: 1,
        seed: 123,
    };
}

function recipeSnapshot(style: {
    positivePrefix?: string;
    negativePrefix?: string;
    positiveQualityPreset?: boolean;
    negativeQualityPreset?: "none" | "heavy" | "light" | "humanFocus" | "furryFocus";
}) {
    const source = {
        schemaVersion: 3 as const,
        recipeId: "default" as const,
        title: "Route B",
        model: "nai-diffusion-4-5-full",
        sampler: "k_euler_ancestral",
        noiseSchedule: "karras",
        steps: 28,
        promptGuidance: 5,
        promptGuidanceRescale: 0,
        dimensions: {mode: "byIntent" as const, fixed: {width: 832, height: 1216}, portrait: {width: 832, height: 1216}, landscape: {width: 1216, height: 832}, square: {width: 1024, height: 1024}},
        seed: {policy: "random" as const, fixed: 0},
        advanced: {aiDefaultCharacterPosition: true, variety: false, smeaMode: "auto" as const, smeaDyn: false, decrisper: false},
        styles: [{
            id: "compiler-test",
            name: "编译测试画风",
            positivePrefix: style.positivePrefix ?? "",
            positiveSuffix: "",
            negativePrefix: style.negativePrefix ?? "",
            negativeSuffix: "",
            useFurryDataset: false,
            positiveQualityPreset: style.positiveQualityPreset ?? false,
            negativeQualityPreset: style.negativeQualityPreset ?? "none",
        }],
        activeStyleId: "compiler-test",
        references: {
            normalizeVibeStrengths: true,
            vibeReferences: [],
            characterReferences: [],
            inpaint: null,
        },
    };
    return createTextToImageRecipeSnapshot(source);
}

function pattern(patternId: string, sourceText: string, tagId: number, syntax?: {weight: number}) {
    const resolution = canonical(sourceText, tagId);
    return TagPatternSchema.parse({
        patternId,
        order: 1,
        enabled: true,
        retrieval: {mode: "always", any: [], andAny: [], characterCount: {min: 0, max: 8}, canvasIntents: [], ratingScopes: ["general"], providerKinds: ["novelai"], modelScopes: [{kind: "generic-novelai"}]},
        intent: {scene: "scene", composition: "composition", lighting: "lighting", action: "action"},
        tagResolutions: {tag: resolution, lowres: canonical("lowres", 1002), badHands: canonical("bad_hands", 1004)},
        policyApprovals: {},
        positive: {scene: ["tag"], composition: [], lighting: [], action: []},
        negative: {global: ["lowres"], characters: ["badHands"]},
        providerSyntaxRefs: syntax ? ["weight"] : [],
        providerSyntaxNodes: syntax ? {weight: {kind: "novelai-tag-weight", weight: syntax.weight, resolutionKeys: ["tag"]}} : {},
        confidence: 1,
    });
}

function characterFixture() {
    return {
        schema: "nbook.character-image-tags/v2" as const,
        characterId: "hero",
        names: {cn: "主角", aliasesCn: [], en: "hero"},
        resolutionScope: {providerKind: "novelai" as const, modelScope: {kind: "generic-novelai" as const}},
        fields: {profileTraits: ["profile"], facialAppearance: ["eyes"], facialBack: [], upperSfw: [], upperBackSfw: [], lowerSfw: [], lowerBackSfw: [], upperNsfw: [], upperBackNsfw: [], lowerNsfw: [], lowerBackNsfw: [], negativePrompt: ["bad"]},
        outfitRefs: ["outfits/travel.md"],
        fieldProviderSyntaxRefs: {}, providerSyntaxNodes: {},
        tagResolutions: {profile: canonical("1girl", 2001), eyes: canonical("blue_eyes", 2002), bad: canonical("bad_anatomy", 2003)},
        policyApprovals: {},
    };
}

function outfitFixture() {
    return {
        schema: "nbook.outfit-tags/v2" as const,
        outfitId: "travel",
        ownerCharacterId: "hero",
        names: {cn: "旅行装", en: "travel"},
        resolutionScope: {providerKind: "novelai" as const, modelScope: {kind: "generic-novelai" as const}},
        fields: {upper: ["coat"], upperBack: [], lower: [], lowerBack: []},
        fieldProviderSyntaxRefs: {}, providerSyntaxNodes: {},
        tagResolutions: {coat: canonical("red_coat", 3001)},
        policyApprovals: {},
    };
}

function resolvedStyle(sourceText: string, tagId: number) {
    return {resolution: canonical(sourceText, tagId), policyApproval: null};
}

function canonical(sourceText: string, tagId: number) {
    return {
        schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
        kind: "canonical" as const,
        sourceText,
        indexVersion: "index-v1",
        policyVersion: "policy-v1",
        resolverVersion: "resolver-v1",
        resolverPolicyVersion: "resolver-policy-v1",
        capabilityVersion: "nbook-generic-novelai-capability-v1",
        providerKind: "novelai" as const,
        modelScope: {kind: "generic-novelai" as const},
        candidateSetHash: null,
        resolvedAt: "2026-07-21T00:00:00.000Z",
        matchedBy: "exact" as const,
        canonical: {tagId, canonicalName: sourceText},
        decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
    };
}

function passthrough(sourceText: string) {
    return {
        schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
        kind: "provider_passthrough" as const,
        sourceText,
        indexVersion: "index-v1",
        policyVersion: "policy-v1",
        resolverVersion: "resolver-v1",
        resolverPolicyVersion: "resolver-policy-v1",
        capabilityVersion: "nbook-generic-novelai-capability-v1",
        providerKind: "novelai" as const,
        modelScope: {kind: "generic-novelai" as const},
        candidateSetHash: H("9"),
        resolvedAt: "2026-07-21T00:00:00.000Z",
        wireText: sourceText,
        validationTextHash: hashTextToImageContract({validationText: sourceText.normalize("NFKC")}),
        reason: "no_reliable_candidate" as const,
        decisionProvenance: {selectedBy: "passthrough_fallback" as const, conceptQueriesHash: null},
    };
}

function modelValidator(options: {keepGeneric?: boolean} = {}): IllustrationResolutionValidator {
    return {
        revalidate: vi.fn(async (input) => ({
            validationHash: H("8"),
            resolutions: input.resolutions.map((resolution) => options.keepGeneric ? resolution : {...resolution, modelScope: input.targetScope}),
        })),
    };
}
