import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    TextToImageContractHashSchema,
    TextToImageModelScopeSchema,
    type TextToImageModelScope,
} from "nbook/shared/text-to-image-tag-resolution";

export const PROVIDER_GRAMMAR_REGISTRY_SCHEMA_VERSION = "nbook.provider-grammar-registry/v1" as const;
export const PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION = "nbook.provider-capability-snapshot/v2" as const;
export const PROVIDER_GRAMMAR_REGISTRY_VERSION = "nbook-novelai-provider-grammar-v2" as const;
export const PROVIDER_CAPABILITY_REGISTRY_VERSION = "nbook-generic-novelai-capability-v2" as const;

export const NOVELAI_PROVIDER_MODEL_IDS = [
    "nai-diffusion-4-5-full",
    "nai-diffusion-4-5-curated",
    "nai-diffusion-4-full",
    "nai-diffusion-4-curated-preview",
    "nai-diffusion-3",
    "nai-diffusion-furry-3",
] as const;

export const NovelAiProviderModelIdSchema = z.enum(NOVELAI_PROVIDER_MODEL_IDS);
export type NovelAiProviderModelId = z.infer<typeof NovelAiProviderModelIdSchema>;

const ProviderSyntaxRefSchema = z.string().trim().min(1).max(160)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u, "Provider syntax ref 必须是稳定 ID");

/**
 * P1 最小 NovelAI Provider Grammar 节点。
 *
 * 这里只允许表达同 owner field 内已解析 Tag 的数值权重；最终 wire encoding 由 Compiler 使用同一 registry 完成。
 */
export const ProviderSyntaxNodeSchema = z.object({
    kind: z.literal("novelai-tag-weight"),
    weight: z.number().finite().min(0.1).max(2),
    resolutionKeys: z.array(ProviderSyntaxRefSchema).min(1).max(128),
}).strict().superRefine((node, context) => {
    const seen = new Set<string>();
    node.resolutionKeys.forEach((resolutionKey, index) => {
        if (seen.has(resolutionKey)) {
            context.addIssue({
                code: "custom",
                path: ["resolutionKeys", index],
                message: `resolution key 重复：${resolutionKey}`,
            });
        }
        seen.add(resolutionKey);
    });
});

export type ProviderSyntaxNode = z.infer<typeof ProviderSyntaxNodeSchema>;

const SupportedModelIdsSchema = z.tuple([
    z.literal("nai-diffusion-4-5-full"),
    z.literal("nai-diffusion-4-5-curated"),
    z.literal("nai-diffusion-4-full"),
    z.literal("nai-diffusion-4-curated-preview"),
    z.literal("nai-diffusion-3"),
    z.literal("nai-diffusion-furry-3"),
]);

/** 应用内置、不可由 Project/浏览器改写的首版 Provider Grammar 真相源。 */
export const ProviderGrammarRegistrySchema = z.object({
    schemaVersion: z.literal(PROVIDER_GRAMMAR_REGISTRY_SCHEMA_VERSION),
    registryVersion: z.literal(PROVIDER_GRAMMAR_REGISTRY_VERSION),
    capabilityVersion: z.literal(PROVIDER_CAPABILITY_REGISTRY_VERSION),
    providerKind: z.literal("novelai"),
    supportedModelIds: SupportedModelIdsSchema,
    ordinaryTag: z.object({
        encoding: z.literal("single-token"),
        providerPassthrough: z.literal("sanitized-single-token"),
    }).strict(),
    syntaxNodes: z.object({
        "novelai-tag-weight": z.object({
            min: z.literal(0.1),
            max: z.literal(2),
            resolutionBinding: z.literal("same-owner-field"),
        }).strict(),
    }).strict(),
    advanced: z.object({
        vibeTransfer: z.object({maxReferences: z.literal(16), cacheByContentHash: z.literal(true)}).strict(),
        preciseReference: z.object({
            modelIds: z.tuple([
                z.literal("nai-diffusion-4-5-full"),
                z.literal("nai-diffusion-4-5-curated"),
            ]),
            maxReferences: z.literal(1),
            compatibleWithVibe: z.literal(false),
            additionalCostPerImage: z.literal(5),
        }).strict(),
        inpaint: z.object({maskMimeType: z.literal("image/png")}).strict(),
    }).strict(),
}).strict();

export type ProviderGrammarRegistry = z.infer<typeof ProviderGrammarRegistrySchema>;

export const PROVIDER_GRAMMAR_REGISTRY: ProviderGrammarRegistry = ProviderGrammarRegistrySchema.parse({
    schemaVersion: PROVIDER_GRAMMAR_REGISTRY_SCHEMA_VERSION,
    registryVersion: PROVIDER_GRAMMAR_REGISTRY_VERSION,
    capabilityVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    providerKind: "novelai",
    supportedModelIds: NOVELAI_PROVIDER_MODEL_IDS,
    ordinaryTag: {
        encoding: "single-token",
        providerPassthrough: "sanitized-single-token",
    },
    syntaxNodes: {
        "novelai-tag-weight": {
            min: 0.1,
            max: 2,
            resolutionBinding: "same-owner-field",
        },
    },
    advanced: {
        vibeTransfer: {maxReferences: 16, cacheByContentHash: true},
        preciseReference: {
            modelIds: ["nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"],
            maxReferences: 1,
            compatibleWithVibe: false,
            additionalCostPerImage: 5,
        },
        inpaint: {maskMimeType: "image/png"},
    },
});

export const PROVIDER_GRAMMAR_REGISTRY_HASH = hashTextToImageContract({
    schemaVersion: PROVIDER_GRAMMAR_REGISTRY.schemaVersion,
    registryVersion: PROVIDER_GRAMMAR_REGISTRY.registryVersion,
    capabilityVersion: PROVIDER_GRAMMAR_REGISTRY.capabilityVersion,
    providerKind: PROVIDER_GRAMMAR_REGISTRY.providerKind,
    supportedModelIds: [...PROVIDER_GRAMMAR_REGISTRY.supportedModelIds],
    ordinaryTag: {
        encoding: PROVIDER_GRAMMAR_REGISTRY.ordinaryTag.encoding,
        providerPassthrough: PROVIDER_GRAMMAR_REGISTRY.ordinaryTag.providerPassthrough,
    },
    syntaxNodes: {
        "novelai-tag-weight": {
            min: PROVIDER_GRAMMAR_REGISTRY.syntaxNodes["novelai-tag-weight"].min,
            max: PROVIDER_GRAMMAR_REGISTRY.syntaxNodes["novelai-tag-weight"].max,
            resolutionBinding: PROVIDER_GRAMMAR_REGISTRY.syntaxNodes["novelai-tag-weight"].resolutionBinding,
        },
    },
    advanced: PROVIDER_GRAMMAR_REGISTRY.advanced,
});

/** Compiler/Resolver 可冻结的非敏感 capability snapshot。 */
export const ProviderCapabilitySnapshotSchema = z.object({
    schemaVersion: z.literal(PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION),
    capabilityVersion: z.literal(PROVIDER_CAPABILITY_REGISTRY_VERSION),
    grammarVersion: z.literal(PROVIDER_GRAMMAR_REGISTRY_VERSION),
    registryHash: TextToImageContractHashSchema,
    providerKind: z.literal("novelai"),
    modelScope: TextToImageModelScopeSchema,
    supportedModelIds: z.array(NovelAiProviderModelIdSchema).min(1).max(NOVELAI_PROVIDER_MODEL_IDS.length),
    ordinaryTags: z.literal(true),
    providerPassthrough: z.literal(true),
    tagWeight: z.object({
        kind: z.literal("novelai-tag-weight"),
        min: z.literal(0.1),
        max: z.literal(2),
    }).strict(),
    advanced: z.object({
        qualityTags: z.literal(true),
        undesiredContentPreset: z.literal(true),
        furryDataset: z.literal(true),
        smea: z.object({supported: z.literal(true), dynSupported: z.boolean()}).strict(),
        vibeTransfer: z.object({
            supported: z.literal(true),
            maxReferences: z.literal(16),
            cacheByContentHash: z.literal(true),
        }).strict(),
        preciseReference: z.object({
            supported: z.boolean(),
            maxReferences: z.literal(1),
            compatibleWithVibe: z.literal(false),
        }).strict(),
        inpaint: z.object({supported: z.literal(true), maskMimeType: z.literal("image/png")}).strict(),
    }).strict(),
}).strict();

export type ProviderCapabilitySnapshot = z.infer<typeof ProviderCapabilitySnapshotSchema>;

/** 未注册的 Recipe model 不能进入 Resolver/Compiler model-specific scope。 */
export class ProviderModelNotSupportedError extends Error {
    readonly code = "PROVIDER_MODEL_NOT_SUPPORTED";

    constructor(readonly modelId: string) {
        super(`NovelAI image model 未注册：${modelId}`);
        this.name = "ProviderModelNotSupportedError";
    }
}

/**
 * 从唯一内置 registry 解析 generic 或具体 model capability。
 *
 * P5 只能扩展本 registry；调用方不得自建 capability map。
 */
export function resolveProviderCapability(modelScope: TextToImageModelScope): ProviderCapabilitySnapshot {
    const scope = TextToImageModelScopeSchema.parse(modelScope);
    let supportedModelIds: NovelAiProviderModelId[];
    if (scope.kind === "generic-novelai") {
        supportedModelIds = [...NOVELAI_PROVIDER_MODEL_IDS];
    } else {
        const parsedModel = NovelAiProviderModelIdSchema.safeParse(scope.modelId);
        if (!parsedModel.success) {
            throw new ProviderModelNotSupportedError(scope.modelId);
        }
        supportedModelIds = [parsedModel.data];
    }

    return ProviderCapabilitySnapshotSchema.parse({
        schemaVersion: PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
        capabilityVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
        grammarVersion: PROVIDER_GRAMMAR_REGISTRY_VERSION,
        registryHash: PROVIDER_GRAMMAR_REGISTRY_HASH,
        providerKind: "novelai",
        modelScope: scope,
        supportedModelIds,
        ordinaryTags: true,
        providerPassthrough: true,
        tagWeight: {kind: "novelai-tag-weight", min: 0.1, max: 2},
        advanced: {
            qualityTags: true,
            undesiredContentPreset: true,
            furryDataset: true,
            smea: {
                supported: true,
                // novelai-model 分支下 scope.modelId 已由 line 205 safeParse 保证为合法枚举值，这里 cast 与 line 239 同模式。
                dynSupported: scope.kind === "generic-novelai" || !isNovelAiV4Model(scope.modelId as NovelAiProviderModelId),
            },
            vibeTransfer: {
                supported: true,
                maxReferences: PROVIDER_GRAMMAR_REGISTRY.advanced.vibeTransfer.maxReferences,
                cacheByContentHash: true,
            },
            preciseReference: {
                supported: scope.kind === "novelai-model"
                    && PROVIDER_GRAMMAR_REGISTRY.advanced.preciseReference.modelIds.includes(
                        scope.modelId as "nai-diffusion-4-5-full" | "nai-diffusion-4-5-curated",
                    ),
                maxReferences: PROVIDER_GRAMMAR_REGISTRY.advanced.preciseReference.maxReferences,
                compatibleWithVibe: false,
            },
            inpaint: {supported: true, maskMimeType: "image/png"},
        },
    });
}

export type NovelAiCapabilityPreflightInput = {
    model: NovelAiProviderModelId;
    smeaMode: "auto" | "off" | "on";
    smeaDyn: boolean;
    useFurryDataset: boolean;
    vibeReferenceCount: number;
    characterReferenceCount: number;
    hasInpaint: boolean;
};

export type NovelAiCapabilityPreflight = {
    effectiveModel: NovelAiProviderModelId;
    action: "generate" | "infill";
    additionalCostLowerBound: number;
    tokenLowerBound: number;
};

export type NovelAiCapabilityErrorCode =
    | "TEXT_TO_IMAGE_ADVANCED_PARAMETER_UNSUPPORTED"
    | "TEXT_TO_IMAGE_REFERENCE_MODEL_UNSUPPORTED"
    | "TEXT_TO_IMAGE_REFERENCE_COMBINATION_INVALID"
    | "TEXT_TO_IMAGE_REFERENCE_LIMIT_EXCEEDED";

/** 高级参数/参考组合不满足唯一 Provider capability registry。 */
export class NovelAiCapabilityError extends Error {
    constructor(readonly code: NovelAiCapabilityErrorCode, message: string) {
        super(message);
        this.name = "NovelAiCapabilityError";
    }
}

/**
 * 对 Recipe 高级能力做无副作用预检。
 *
 * AQT/UCP 分别由 CompiledRequest 的 qualityToggle/ucPreset 承载，所有已登记模型均支持；
 * 此函数只处理会改变模型、远端 action、额外费用或组合合法性的字段。
 */
export function preflightNovelAiCapabilities(input: NovelAiCapabilityPreflightInput): NovelAiCapabilityPreflight {
    const model = NovelAiProviderModelIdSchema.parse(input.model);
    const effectiveModel: NovelAiProviderModelId = input.useFurryDataset && model !== "nai-diffusion-furry-3"
        ? "nai-diffusion-furry-3"
        : model;
    const capability = resolveProviderCapability({kind: "novelai-model", modelId: effectiveModel});
    if (!Number.isInteger(input.vibeReferenceCount) || input.vibeReferenceCount < 0
        || input.vibeReferenceCount > capability.advanced.vibeTransfer.maxReferences
        || !Number.isInteger(input.characterReferenceCount) || input.characterReferenceCount < 0
        || input.characterReferenceCount > capability.advanced.preciseReference.maxReferences) {
        throw new NovelAiCapabilityError("TEXT_TO_IMAGE_REFERENCE_LIMIT_EXCEEDED", "参考图片数量超过当前 Provider capability 上限。");
    }
    if (isNovelAiV4Model(effectiveModel) && (input.smeaMode === "on" || input.smeaDyn)) {
        throw new NovelAiCapabilityError(
            "TEXT_TO_IMAGE_ADVANCED_PARAMETER_UNSUPPORTED",
            "NovelAI V4/V4.5 只支持自动或关闭 SMEA，不支持手动 SMEA/SMEA DYN。",
        );
    }
    if (input.characterReferenceCount > 0 && !capability.advanced.preciseReference.supported) {
        throw new NovelAiCapabilityError(
            "TEXT_TO_IMAGE_REFERENCE_MODEL_UNSUPPORTED",
            "Precise Character Reference 只支持已登记的 NovelAI V4.5 模型。",
        );
    }
    if (input.vibeReferenceCount > 0 && input.characterReferenceCount > 0) {
        throw new NovelAiCapabilityError(
            "TEXT_TO_IMAGE_REFERENCE_COMBINATION_INVALID",
            "Vibe Transfer 与 Precise Character Reference 不能在同一请求中组合。",
        );
    }
    return {
        effectiveModel,
        action: input.hasInpaint ? "infill" : "generate",
        additionalCostLowerBound: input.characterReferenceCount
            * PROVIDER_GRAMMAR_REGISTRY.advanced.preciseReference.additionalCostPerImage
            + Math.max(0, input.vibeReferenceCount - 4) * 2,
        tokenLowerBound: 1,
    };
}

/** 判断模型是否属于只接受 auto SMEA 的 V4/V4.5 家族。 */
function isNovelAiV4Model(model: NovelAiProviderModelId): boolean {
    return model.startsWith("nai-diffusion-4-");
}
