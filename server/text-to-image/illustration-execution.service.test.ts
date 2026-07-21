import {describe, expect, it, vi} from "vitest";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    createIllustrationCompiledRequestHash,
    createIllustrationExecutionManifestHash,
    createIllustrationExecutionSourceIdentityHash,
} from "nbook/shared/text-to-image-execution";
import {resolveProviderCapability} from "nbook/shared/text-to-image-provider-registry";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";
import {ExecutionPreviewTokenService} from "nbook/server/text-to-image/execution-preview-token";
import {
    IllustrationExecutionService,
    type IllustrationExecutionCompilePort,
    type IllustrationExecutionRegistrationPort,
} from "nbook/server/text-to-image/illustration-execution.service";

const H = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

describe("IllustrationExecutionService preview", () => {
    it("builds a signed one-shot preview without mutating Project/App/files", async () => {
        const state = {projectRows: 0, appRows: 0, files: ["chapter-before"]};
        const before = structuredClone(state);
        const compiler = fakeCompiler();
        const tokens = tokenService();
        const service = new IllustrationExecutionService({
            compiler,
            tokens,
            nonceFactory: () => "nonce-one",
        });

        const preview = await service.previewOne({projectPath: "C:/novel", ownerUserId: 7, placeholderId: "placeholder-a"});

        expect(preview).toMatchObject({
            schemaVersion: "nbook.illustration-execution-preview/v1",
            kind: "single",
            outputCount: 1,
            requests: [{source: {placeholderId: "placeholder-a"}, model: "nai-diffusion-4-5-full", width: 832, height: 1216}],
        });
        expect(tokens.verify(preview.previewToken)).toMatchObject({
            executionNonce: "nonce-one",
            targetHash: preview.targetHash,
            manifestHash: preview.manifestHash,
        });
        expect(state).toEqual(before);
        expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({
            executionNonce: "nonce-one",
            outputCount: 1,
            outputIndex: 0,
        }));
    });

    it("uses one nonce for an all-or-nothing batch and separates output seeds", async () => {
        const compiler = fakeCompiler();
        const service = new IllustrationExecutionService({
            compiler,
            tokens: tokenService(),
            nonceFactory: () => "nonce-batch",
        });

        const preview = await service.previewBatch({
            projectPath: "C:/novel",
            ownerUserId: 7,
            placeholderIds: ["placeholder-a", "placeholder-b"],
        });

        expect(preview.kind).toBe("batch");
        expect(preview.outputCount).toBe(2);
        expect(preview.requests.map((request) => request.seed)).toHaveLength(2);
        expect(new Set(preview.requests.map((request) => request.seed)).size).toBe(2);
        expect(compiler.compile).toHaveBeenNthCalledWith(1, expect.objectContaining({executionNonce: "nonce-batch", outputIndex: 0, outputCount: 2}));
        expect(compiler.compile).toHaveBeenNthCalledWith(2, expect.objectContaining({executionNonce: "nonce-batch", outputIndex: 1, outputCount: 2}));

        const blockedCompiler = fakeCompiler({blockedPlaceholderId: "placeholder-b"});
        const blockedService = new IllustrationExecutionService({compiler: blockedCompiler, tokens: tokenService(), nonceFactory: () => "nonce-blocked"});
        await expect(blockedService.previewBatch({
            projectPath: "C:/novel",
            ownerUserId: 7,
            placeholderIds: ["placeholder-a", "placeholder-b"],
        })).rejects.toThrow("blocking compile issue");
        expect(blockedCompiler.compile).toHaveBeenCalledTimes(2);
    });

    it("recompiles from verified claims with the same nonce and rejects target or manifest drift", async () => {
        const compiler = fakeCompiler();
        const tokens = tokenService();
        const service = new IllustrationExecutionService({compiler, tokens, nonceFactory: () => "nonce-recompile"});
        const preview = await service.previewOne({projectPath: "C:/novel", ownerUserId: 7, placeholderId: "placeholder-a"});
        const claims = tokens.verify(preview.previewToken);

        const rebuilt = await service.recompileOne({
            projectPath: "C:/novel",
            ownerUserId: 7,
            placeholderId: "placeholder-a",
            claims,
        });
        expect(rebuilt.manifestHash).toBe(preview.manifestHash);
        expect(rebuilt.requests[0]?.seed).toBe(preview.requests[0]?.seed);

        await expect(service.recompileOne({
            projectPath: "C:/novel",
            ownerUserId: 7,
            placeholderId: "placeholder-b",
            claims,
        })).rejects.toMatchObject({code: "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED"});
    });

    it("verifies the shown manifest and atomically delegates the exact recompiled draft", async () => {
        const repository = fakeRegistrationRepository();
        const service = new IllustrationExecutionService({
            compiler: fakeCompiler(),
            tokens: tokenService(),
            repository,
            nonceFactory: () => "nonce-authorize",
            clock: () => new Date("2026-07-21T01:00:00.000Z"),
        });
        const preview = await service.previewOne({projectPath: "workspace/demo", ownerUserId: 7, placeholderId: "placeholder-a"});

        const receipt = await service.authorizeOne({
            projectPath: "workspace/demo",
            ownerUserId: 7,
            placeholderId: "placeholder-a",
            previewToken: preview.previewToken,
            manifestHash: preview.manifestHash,
            authorization: {authorizedOutputCount: 1, authorizedCostLimit: null, authorizedTokenLimit: null},
        });

        expect(receipt.executionManifestHash).toBe(preview.manifestHash);
        expect(repository.register).toHaveBeenCalledWith(expect.objectContaining({
            projectPath: "workspace/demo",
            targetHash: preview.targetHash,
            executionInputHashes: preview.executionInputHashes,
            executionManifestHash: preview.manifestHash,
            outputCount: 1,
            actorUserId: 7,
            approvedAt: "2026-07-21T01:00:00.000Z",
            compiledRequests: [expect.objectContaining({compiledRequestHash: preview.requests[0]?.compiledRequestHash})],
        }));
    });

    it("does not register when the client manifest or batch target set differs from signed claims", async () => {
        const repository = fakeRegistrationRepository();
        const service = new IllustrationExecutionService({
            compiler: fakeCompiler(),
            tokens: tokenService(),
            repository,
            nonceFactory: () => "nonce-authorize-batch",
        });
        const preview = await service.previewBatch({
            projectPath: "workspace/demo",
            ownerUserId: 7,
            placeholderIds: ["placeholder-a", "placeholder-b"],
        });
        await expect(service.authorizeBatch({
            projectPath: "workspace/demo",
            ownerUserId: 7,
            placeholderIds: ["placeholder-a", "placeholder-b"],
            previewToken: preview.previewToken,
            manifestHash: H("f"),
            authorization: {authorizedOutputCount: 2, authorizedCostLimit: null, authorizedTokenLimit: null},
        })).rejects.toMatchObject({code: "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED"});
        expect(repository.register).not.toHaveBeenCalled();
    });
});

/** 固定 HMAC 时钟，便于断言 token claims。 */
function tokenService(): ExecutionPreviewTokenService {
    return new ExecutionPreviewTokenService({
        secret: "route-b-preview-token-test-secret-32-bytes",
        now: () => Date.parse("2026-07-21T00:00:00.000Z"),
    });
}

/** 只读 fake compiler；根据服务传入的 nonce/output index 构造严格执行快照。 */
function fakeCompiler(options: {blockedPlaceholderId?: string} = {}): IllustrationExecutionCompilePort & {compile: ReturnType<typeof vi.fn>} {
    return {
        readTarget: vi.fn(async (input) => ({
            sourceIdentityHash: sourceIdentityHash(input.placeholderId),
            seedPolicy: {kind: "random" as const},
        })),
        compile: vi.fn(async (input) => {
            if (input.placeholderId === options.blockedPlaceholderId) throw new Error("blocking compile issue");
            return compileResult(input);
        }),
    };
}

/** 只记录原子注册输入并返回稳定 receipt。 */
function fakeRegistrationRepository(): IllustrationExecutionRegistrationPort & {register: ReturnType<typeof vi.fn>} {
    return {
        register: vi.fn(async (input) => ({
            schemaVersion: "nbook.illustration-execution-registration-receipt/v1" as const,
            manifestId: "manifest-1",
            executionManifestHash: input.executionManifestHash,
            approvalId: "approval-1",
            approvalHash: H("d"),
            registrationState: "jobs_registered" as const,
            dispatchState: "ready" as const,
            jobIds: input.compiledRequests.map((_, index) => `job-${String(index + 1)}`),
            dispatchKeys: input.compiledRequests.map((_, index) => H(String(index + 1))),
            registeredAt: input.approvedAt,
        })),
    };
}

/** 与 compile fixture 相同的 button source identity。 */
function sourceIdentityHash(placeholderId: string): string {
    return createIllustrationExecutionSourceIdentityHash({
        projectId: "project-1",
        chapterPath: "manuscript/v1/c1/index.md",
        placeholderId,
        shotId: `shot-${placeholderId}`,
        shotOrigin: "chapter-plan",
        anchorId: "p_0001_abcdef12",
        shotIntentHash: H("a"),
        sourceChapterHash: H("b"),
    });
}

/** 最小合法 CompileResult fixture。 */
function compileResult(input: Parameters<IllustrationExecutionCompilePort["compile"]>[0]) {
    const recipeSnapshot = createTextToImageRecipeSnapshot(createDefaultTextToImageRecipeSource());
    const source = {
        projectId: "project-1",
        chapterPath: "manuscript/v1/c1/index.md",
        placeholderId: input.placeholderId,
        shotId: `shot-${input.placeholderId}`,
        shotOrigin: "chapter-plan" as const,
        anchorId: "p_0001_abcdef12",
        shotIntentHash: H("a"),
        sourceChapterHash: H("b"),
    };
    const seed = input.seed;
    const base = {
        schemaVersion: "nbook.illustration-compiled-request/v1" as const,
        compilerVersion: "route-b-compiler-v1",
        executionPolicyVersion: "route-b-execution-v1",
        providerKind: "novelai" as const,
        source,
        provider: {ownerUserId: input.ownerUserId, providerId: 11, credentialRevision: 1},
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
            seed,
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
        expansion: {patternSnapshots: [], characterSnapshots: [], resolutionValidationHash: H("e"), positive: [], negative: [], characters: []},
    };
    const request = {...base, compiledRequestHash: createIllustrationCompiledRequestHash(base)};
    const executionInputHash = hashTextToImageContract({
        schemaVersion: "test.execution-input/v1",
        source,
        executionNonce: input.executionNonce,
        outputIndex: input.outputIndex,
        outputCount: input.outputCount,
        seed,
    });
    return {
        request,
        executionInputHash,
        compiledRequestHash: request.compiledRequestHash,
        executionManifestHash: createIllustrationExecutionManifestHash({
            executionInputHashes: [executionInputHash],
            recipeSnapshot,
            compiledRequests: [request],
            outputCount: 1,
            knownCost: null,
            tokenLowerBound: null,
        }),
    };
}
