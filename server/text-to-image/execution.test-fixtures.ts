import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    createIllustrationCompiledRequestHash,
    createIllustrationExecutionManifestHash,
    type IllustrationCompiledRequest,
} from "nbook/shared/text-to-image-execution";
import {resolveProviderCapability} from "nbook/shared/text-to-image-provider-registry";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";

export const TEST_CONTRACT_HASH = (digit: string): string => `sha256:${digit.repeat(64)}`;

/** 构造共享同一 Recipe/Provider 的完整注册输入。 */
export function illustrationRegistrationFixture(outputCount: number) {
    const compiledRequests = Array.from({length: outputCount}, (_, outputIndex) => illustrationCompiledRequestFixture(outputIndex));
    const executionInputHashes = compiledRequests.map((request, outputIndex) => hashTextToImageContract({
        schemaVersion: "test.execution-input/v1",
        source: request.source,
        outputIndex,
        seed: request.parameters.seed,
    }));
    const recipeSnapshot = compiledRequests[0]?.recipeSnapshot;
    if (!recipeSnapshot) throw new Error("测试 fixture 缺少 Recipe snapshot");
    const executionManifestHash = createIllustrationExecutionManifestHash({
        executionInputHashes,
        recipeSnapshot,
        compiledRequests,
        outputCount,
        knownCost: null,
        tokenLowerBound: null,
    });
    return {
        projectPath: "workspace/demo",
        targetHash: TEST_CONTRACT_HASH("f"),
        executionNonce: "nonce-1",
        executionInputHashes,
        executionManifestHash,
        compiledRequests,
        outputCount,
        knownCost: null,
        tokenLowerBound: null,
        authorization: {authorizedOutputCount: outputCount, authorizedCostLimit: null, authorizedTokenLimit: null},
        actorUserId: 7,
        approvedAt: "2026-07-21T00:00:00.000Z",
    };
}

/** 最小合法、可自校验的 button CompiledRequest。 */
export function illustrationCompiledRequestFixture(outputIndex: number): IllustrationCompiledRequest {
    const recipeSnapshot = createTextToImageRecipeSnapshot(createDefaultTextToImageRecipeSource());
    const source = {
        projectId: "project-1",
        chapterPath: `manuscript/v1/c${String(outputIndex + 1)}/index.md`,
        placeholderId: `placeholder-${String(outputIndex + 1)}`,
        shotId: `shot-${String(outputIndex + 1)}`,
        shotOrigin: "chapter-plan" as const,
        anchorId: `p_000${String(outputIndex + 1)}_abcdef12`,
        shotIntentHash: TEST_CONTRACT_HASH("a"),
        sourceChapterHash: TEST_CONTRACT_HASH("b"),
    };
    const base = {
        schemaVersion: "nbook.illustration-compiled-request/v1" as const,
        compilerVersion: "route-b-compiler-v1",
        executionPolicyVersion: "route-b-execution-v1",
        providerKind: "novelai" as const,
        source,
        provider: {ownerUserId: 7, providerId: 11, credentialRevision: 3},
        capabilitySnapshot: resolveProviderCapability({kind: "novelai-model", modelId: "nai-diffusion-4-5-full"}),
        model: "nai-diffusion-4-5-full" as const,
        action: "generate" as const,
        prompt: "rain",
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
            seed: outputIndex + 100,
            count: 1 as const,
            aiDefaultCharacterPosition: true,
            variety: false,
            smeaMode: "auto" as const,
            smeaDyn: false,
            decrisper: false,
            qualityToggle: true,
            ucPreset: 4,
        },
        recipeSnapshot,
        references: {normalizeVibeStrengths: true, vibeReferences: [], characterReferences: [], inpaint: null},
        expansion: {
            patternSnapshots: [],
            characterSnapshots: [],
            resolutionValidationHash: TEST_CONTRACT_HASH("e"),
            positive: [],
            negative: [],
            characters: [],
        },
    };
    return {...base, compiledRequestHash: createIllustrationCompiledRequestHash(base)};
}
