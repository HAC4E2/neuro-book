import {describe, expect, it} from "vitest";
import {
    NovelAiVibeEncoderVersionSchema,
    NovelAiWireModelIdSchema,
    NOVELAI_PROVIDER_MODEL_IDS,
    PROVIDER_CAPABILITY_REGISTRY_VERSION,
    PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    PROVIDER_GRAMMAR_REGISTRY,
    PROVIDER_GRAMMAR_REGISTRY_HASH,
    PROVIDER_GRAMMAR_REGISTRY_SCHEMA_VERSION,
    PROVIDER_GRAMMAR_REGISTRY_VERSION,
    ProviderCapabilitySnapshotSchema,
    ProviderGrammarRegistrySchema,
    ProviderSyntaxNodeSchema,
    isNovelAiV4Model,
    isNovelAiVibeEncodingPair,
    preflightNovelAiCapabilities,
    resolveProviderCapability,
} from "nbook/shared/text-to-image-provider-registry";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

describe("text-to-image Provider Grammar / Capability registry", () => {
    it("提供唯一版本化 generic NovelAI 能力快照和稳定 registry hash", () => {
        const snapshot = resolveProviderCapability({kind: "generic-novelai"});

        expect(snapshot).toMatchObject({
            schemaVersion: "nbook.provider-capability-snapshot/v3",
            capabilityVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
            grammarVersion: PROVIDER_GRAMMAR_REGISTRY_VERSION,
            providerKind: "novelai",
            modelScope: {kind: "generic-novelai"},
            ordinaryTags: true,
            providerPassthrough: true,
            tagWeight: {kind: "novelai-tag-weight", min: 0.1, max: 2},
            advanced: {
                qualityTags: true,
                undesiredContentPreset: true,
                vibeTransfer: {supported: true, maxReferences: 16},
            },
        });
        expect(snapshot.registryHash).toBe(PROVIDER_GRAMMAR_REGISTRY_HASH);
        expect(PROVIDER_GRAMMAR_REGISTRY_HASH).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(TAG_INDEX_CAPABILITY_VERSION).toBe(PROVIDER_CAPABILITY_REGISTRY_VERSION);
    });

    it("冻结 P5 registry 与 capability snapshot 的四个版本字面量，并拒绝旧版本", () => {
        expect(PROVIDER_GRAMMAR_REGISTRY_SCHEMA_VERSION).toBe("nbook.provider-grammar-registry/v2");
        expect(PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION).toBe("nbook.provider-capability-snapshot/v3");
        expect(PROVIDER_GRAMMAR_REGISTRY_VERSION).toBe("nbook-novelai-provider-grammar-v3");
        expect(PROVIDER_CAPABILITY_REGISTRY_VERSION).toBe("nbook-generic-novelai-capability-v3");

        const versionRejections = [
            {
                name: "registry schema version",
                parse: () => ProviderGrammarRegistrySchema.safeParse({
                    ...PROVIDER_GRAMMAR_REGISTRY,
                    schemaVersion: "nbook.provider-grammar-registry/v1",
                }),
            },
            {
                name: "capability snapshot schema version",
                parse: () => ProviderCapabilitySnapshotSchema.safeParse({
                    ...resolveProviderCapability({kind: "generic-novelai"}),
                    schemaVersion: "nbook.provider-capability-snapshot/v2",
                }),
            },
            {
                name: "registry version",
                parse: () => ProviderGrammarRegistrySchema.safeParse({
                    ...PROVIDER_GRAMMAR_REGISTRY,
                    registryVersion: "nbook-novelai-provider-grammar-v2",
                }),
            },
            {
                name: "capability version",
                parse: () => ProviderCapabilitySnapshotSchema.safeParse({
                    ...resolveProviderCapability({kind: "generic-novelai"}),
                    capabilityVersion: "nbook-generic-novelai-capability-v2",
                }),
            },
        ];
        for (const candidate of versionRejections) {
            expect(candidate.parse().success, candidate.name).toBe(false);
        }
    });

    it("导出并收窄 NovelAI wire model 与 Vibe encoder 标识", () => {
        expect(NovelAiWireModelIdSchema.safeParse("nai-diffusion-4-5-full-inpainting").success).toBe(true);
        expect(NovelAiWireModelIdSchema.safeParse("vendor-wire-model").success).toBe(false);
        expect(NovelAiVibeEncoderVersionSchema.safeParse("novelai-vibe/v4-5full/v1").success).toBe(true);
        expect(NovelAiVibeEncoderVersionSchema.safeParse("novelai-vibe/v4/unknown").success).toBe(false);
    });

    it("从唯一 registry 导出 Vibe model/encoder 配对判定", () => {
        expect(isNovelAiVibeEncodingPair(
            "nai-diffusion-4-5-full",
            "novelai-vibe/v4-5full/v1",
        )).toBe(true);
        expect(isNovelAiVibeEncodingPair(
            "nai-diffusion-4-full",
            "novelai-vibe/v4-5full/v1",
        )).toBe(false);
    });

    it("把唯一的 inpaint 与 Vibe 容器映射冻结在唯一 registry，并使其影响 hash", () => {
        expect(PROVIDER_GRAMMAR_REGISTRY.advanced.inpaint).toMatchObject({
            modelWireMappings: [{
                model: "nai-diffusion-4-5-full",
                wireModel: "nai-diffusion-4-5-full-inpainting",
            }],
        });
        expect(PROVIDER_GRAMMAR_REGISTRY.advanced.vibeTransfer).toMatchObject({
            containers: [{
                bucket: "v4-5full",
                model: "nai-diffusion-4-5-full",
                encoderVersion: "novelai-vibe/v4-5full/v1",
            }],
        });
        expect(PROVIDER_GRAMMAR_REGISTRY_HASH).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(PROVIDER_GRAMMAR_REGISTRY_HASH).not.toBe(hashTextToImageContract({
            schemaVersion: PROVIDER_GRAMMAR_REGISTRY.schemaVersion,
            registryVersion: PROVIDER_GRAMMAR_REGISTRY.registryVersion,
            capabilityVersion: PROVIDER_GRAMMAR_REGISTRY.capabilityVersion,
            providerKind: PROVIDER_GRAMMAR_REGISTRY.providerKind,
            supportedModelIds: [...PROVIDER_GRAMMAR_REGISTRY.supportedModelIds],
            ordinaryTag: PROVIDER_GRAMMAR_REGISTRY.ordinaryTag,
            syntaxNodes: PROVIDER_GRAMMAR_REGISTRY.syntaxNodes,
            modelFamilies: PROVIDER_GRAMMAR_REGISTRY.modelFamilies,
            advanced: {
                ...PROVIDER_GRAMMAR_REGISTRY.advanced,
                vibeTransfer: {maxReferences: 16, cacheByContentHash: true},
                inpaint: {maskMimeType: "image/png"},
            },
        }));
    });

    it("通过 registry 判定 V4 模型，不接受字符串前缀猜测", () => {
        expect(isNovelAiV4Model("nai-diffusion-4-5-full")).toBe(true);
        expect(isNovelAiV4Model("nai-diffusion-3")).toBe(false);
    });

    it("在同一 registry 预检高级标量、参考组合与费用/Token 下限", () => {
        expect(preflightNovelAiCapabilities({
            model: "nai-diffusion-4-5-full",
            smeaMode: "auto",
            smeaDyn: false,
            useFurryDataset: false,
            vibeReferenceCount: 0,
            characterReferenceCount: 1,
            hasInpaint: true,
        })).toEqual({
            requestedModel: "nai-diffusion-4-5-full",
            effectiveModel: "nai-diffusion-4-5-full",
            wireModel: "nai-diffusion-4-5-full-inpainting",
            action: "infill",
            additionalCostLowerBound: 5,
            tokenLowerBound: 1,
            capabilityVersion: "nbook-generic-novelai-capability-v3",
            registryHash: PROVIDER_GRAMMAR_REGISTRY_HASH,
        });
        expect(() => preflightNovelAiCapabilities({
            model: "nai-diffusion-4-full",
            smeaMode: "auto",
            smeaDyn: false,
            useFurryDataset: false,
            vibeReferenceCount: 0,
            characterReferenceCount: 1,
            hasInpaint: false,
        })).toThrowError(expect.objectContaining({code: "TEXT_TO_IMAGE_REFERENCE_MODEL_UNSUPPORTED"}));
        expect(() => preflightNovelAiCapabilities({
            model: "nai-diffusion-4-5-full",
            smeaMode: "auto",
            smeaDyn: false,
            useFurryDataset: false,
            vibeReferenceCount: 1,
            characterReferenceCount: 1,
            hasInpaint: false,
        })).toThrowError(expect.objectContaining({code: "TEXT_TO_IMAGE_REFERENCE_COMBINATION_INVALID"}));
        expect(() => preflightNovelAiCapabilities({
            model: "nai-diffusion-4-5-full",
            smeaMode: "on",
            smeaDyn: true,
            useFurryDataset: false,
            vibeReferenceCount: 0,
            characterReferenceCount: 0,
            hasInpaint: false,
        })).toThrowError(expect.objectContaining({code: "TEXT_TO_IMAGE_ADVANCED_PARAMETER_UNSUPPORTED"}));
    });

    it("只有已登记的 inpaint wire mapping 才能进入 infill，其他模型一律 fail closed", () => {
        expect(() => preflightNovelAiCapabilities({
            model: "nai-diffusion-4-full",
            smeaMode: "auto",
            smeaDyn: false,
            useFurryDataset: false,
            vibeReferenceCount: 0,
            characterReferenceCount: 0,
            hasInpaint: true,
        })).toThrowError(expect.objectContaining({code: "TEXT_TO_IMAGE_REFERENCE_MODEL_UNSUPPORTED"}));
    });

    it("按唯一 registry mapping 派生 generic 与 model-specific Vibe/Inpaint 支持性", () => {
        const generic = resolveProviderCapability({kind: "generic-novelai"});
        const full = resolveProviderCapability({kind: "novelai-model", modelId: "nai-diffusion-4-5-full"});
        const diffusion3 = resolveProviderCapability({kind: "novelai-model", modelId: "nai-diffusion-3"});

        // generic 表示至少有一个已登记模型可用，而不是任一具体模型都可用。
        expect(generic.advanced.vibeTransfer.supported).toBe(true);
        expect(generic.advanced.inpaint.supported).toBe(true);
        expect(full.advanced.vibeTransfer.supported).toBe(true);
        expect(full.advanced.inpaint.supported).toBe(true);
        expect(diffusion3.advanced.vibeTransfer.supported).toBe(false);
        expect(diffusion3.advanced.inpaint.supported).toBe(false);

        expect(preflightNovelAiCapabilities({
            model: "nai-diffusion-4-5-full",
            smeaMode: "auto",
            smeaDyn: false,
            useFurryDataset: false,
            vibeReferenceCount: 1,
            characterReferenceCount: 0,
            hasInpaint: false,
        })).toMatchObject({action: "generate", wireModel: "nai-diffusion-4-5-full"});
        expect(() => preflightNovelAiCapabilities({
            model: "nai-diffusion-3",
            smeaMode: "auto",
            smeaDyn: false,
            useFurryDataset: false,
            vibeReferenceCount: 1,
            characterReferenceCount: 0,
            hasInpaint: false,
        })).toThrowError(expect.objectContaining({code: "TEXT_TO_IMAGE_REFERENCE_MODEL_UNSUPPORTED"}));
    });

    it("为当前支持的每个具体 image model 提供同源快照，并拒绝未知 model", () => {
        expect(NOVELAI_PROVIDER_MODEL_IDS).toHaveLength(6);
        for (const modelId of NOVELAI_PROVIDER_MODEL_IDS) {
            const snapshot = resolveProviderCapability({kind: "novelai-model", modelId});
            expect(snapshot.modelScope).toEqual({kind: "novelai-model", modelId});
            expect(snapshot.supportedModelIds).toEqual([modelId]);
            expect(snapshot.registryHash).toBe(PROVIDER_GRAMMAR_REGISTRY_HASH);
        }

        expect(() => resolveProviderCapability({
            kind: "novelai-model",
            modelId: "unknown-model",
        })).toThrowError(expect.objectContaining({code: "PROVIDER_MODEL_NOT_SUPPORTED"}));
    });

    it("只接受注册的 typed weight node，不接受自由模板、wire prompt 或越界权重", () => {
        expect(ProviderSyntaxNodeSchema.parse({
            kind: "novelai-tag-weight",
            weight: 1.25,
            resolutionKeys: ["tr-calm"],
        })).toEqual({kind: "novelai-tag-weight", weight: 1.25, resolutionKeys: ["tr-calm"]});
        expect(() => ProviderSyntaxNodeSchema.parse({
            kind: "novelai-tag-weight",
            weight: 2.1,
            resolutionKeys: ["tr-calm"],
        })).toThrow();
        expect(() => ProviderSyntaxNodeSchema.parse({
            kind: "novelai-template",
            template: "{{prompt}}",
            resolutionKeys: ["tr-calm"],
        })).toThrow();
        expect(() => ProviderSyntaxNodeSchema.parse({
            kind: "novelai-tag-weight",
            weight: 1.25,
            wirePrompt: "1.25::calm::",
            resolutionKeys: ["tr-calm"],
        })).toThrow();
        expect(() => ProviderSyntaxNodeSchema.parse({
            kind: "novelai-tag-weight",
            weight: 1.25,
            resolutionKeys: ["tr-calm", "tr-calm"],
        })).toThrow(/重复/u);
    });
});
