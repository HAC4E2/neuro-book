import {describe, expect, it} from "vitest";
import {
    createIllustrationCompiledRequestHash,
    createIllustrationExecutionInputHash,
    createIllustrationExecutionManifestHash,
    IllustrationCompiledRequestSchema,
} from "nbook/shared/text-to-image-execution";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";
import {resolveProviderCapability} from "nbook/shared/text-to-image-provider-registry";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";

const H = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

describe("illustration execution contracts", () => {
    it("strict-parses an immutable compiled request and verifies its self hash", () => {
        const request = compiledRequest();
        expect(IllustrationCompiledRequestSchema.parse(request)).toEqual(request);
        expect(() => IllustrationCompiledRequestSchema.parse({...request, compiledRequestHash: H("b")})).toThrow(/compiledRequestHash/u);
        expect(() => IllustrationCompiledRequestSchema.parse({...request, apiKey: "secret"})).toThrow();
        expect(() => IllustrationCompiledRequestSchema.parse({
            ...request,
            references: {
                ...request.references,
                vibeReferences: [{
                    contentHash: H("f"),
                    strength: 0.5,
                    informationExtracted: 1,
                    imageBase64: "secret",
                }],
            },
        })).toThrow();
    });

    it("separates execution input, compiled request and manifest hash domains", () => {
        const request = compiledRequest();
        const inputHash = createIllustrationExecutionInputHash({
            source: request.source,
            publicationJournalId: "journal-1",
            patternSnapshots: request.expansion.patternSnapshots,
            characterSnapshots: request.expansion.characterSnapshots,
            recipeSnapshot: request.recipeSnapshot,
            provider: request.provider,
            capabilitySnapshot: request.capabilitySnapshot,
            resolutionValidationHash: request.expansion.resolutionValidationHash,
            referenceSnapshotHash: request.referenceSnapshotHash,
            executionNonce: "nonce-1",
            variantIndex: 0,
            outputIndex: 0,
            outputCount: 1,
            seed: request.parameters.seed,
            compilerVersion: request.compilerVersion,
            executionPolicyVersion: request.executionPolicyVersion,
        });
        const manifestHash = createIllustrationExecutionManifestHash({
            executionInputHashes: [inputHash],
            recipeSnapshot: request.recipeSnapshot,
            compiledRequests: [request],
            outputCount: 1,
            additionalCostLowerBound: null,
            tokenLowerBound: null,
        });

        expect(inputHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(request.compiledRequestHash).not.toBe(inputHash);
        expect(manifestHash).not.toBe(inputHash);
    });
});

/** 最小合法 CompiledRequest fixture。 */
function compiledRequest() {
    const recipeSnapshot = createTextToImageRecipeSnapshot(createDefaultTextToImageRecipeSource());
    const base = {
        schemaVersion: "nbook.illustration-compiled-request/v1" as const,
        compilerVersion: "route-b-compiler-v1",
        executionPolicyVersion: "route-b-execution-v1",
        providerKind: "novelai" as const,
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
        provider: {ownerUserId: 7, providerId: 11, credentialRevision: 3},
        capabilitySnapshot: resolveProviderCapability({kind: "novelai-model", modelId: "nai-diffusion-4-5-full"}),
        model: "nai-diffusion-4-5-full" as const,
        action: "generate" as const,
        wireModel: "nai-diffusion-4-5-full" as const,
        referenceSnapshotHash: H("c"),
        prompt: "rain, cinematic lighting",
        negativePrompt: "lowres",
        characterPrompts: [],
        parameters: {
            sampler: "k_euler_ancestral",
            noiseSchedule: "karras",
            steps: 28,
            promptGuidance: 5,
            promptGuidanceRescale: 0,
            width: 832,
            height: 1216,
            seed: 123,
            count: 1 as const,
            aiDefaultCharacterPosition: true,
            variety: false,
            smeaMode: "auto" as const,
            smeaDyn: false,
            decrisper: false,
            qualityToggle: true,
            ucPreset: 4,
        },
        references: {
            normalizeVibeStrengths: true,
            vibeReferences: [],
            characterReferences: [],
            inpaint: null,
        },
        recipeSnapshot,
        expansion: {
            patternSnapshots: [{patternId: "pattern-rain", renderHash: H("d")}],
            characterSnapshots: [],
            resolutionValidationHash: H("e"),
            positive: [],
            negative: [],
            characters: [],
        },
    };
    return {...base, compiledRequestHash: createIllustrationCompiledRequestHash(base)};
}
