import {describe, expect, it} from "vitest";
import {
    NOVELAI_PROVIDER_MODEL_IDS,
    PROVIDER_CAPABILITY_REGISTRY_VERSION,
    PROVIDER_GRAMMAR_REGISTRY_HASH,
    PROVIDER_GRAMMAR_REGISTRY_VERSION,
    ProviderSyntaxNodeSchema,
    preflightNovelAiCapabilities,
    resolveProviderCapability,
} from "nbook/shared/text-to-image-provider-registry";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";

describe("text-to-image Provider Grammar / Capability registry", () => {
    it("提供唯一版本化 generic NovelAI 能力快照和稳定 registry hash", () => {
        const snapshot = resolveProviderCapability({kind: "generic-novelai"});

        expect(snapshot).toMatchObject({
            schemaVersion: "nbook.provider-capability-snapshot/v2",
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
            effectiveModel: "nai-diffusion-4-5-full",
            action: "infill",
            additionalCostLowerBound: 5,
            tokenLowerBound: 1,
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
