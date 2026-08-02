import fs from "node:fs/promises";
import path from "node:path";
import {unzipSync} from "fflate";
import {z} from "zod";
import {resolveTextToImagePrompt, type TextToImageResolvedCharacterPrompt} from "nbook/app/utils/text-to-image-prompt-engine";
import {
    fetchTextToImageProvider,
    type TextToImageProviderFetch,
} from "nbook/server/text-to-image/provider-fetch";
import {TEXT_TO_IMAGE_NOVELAI_BASE_URL} from "nbook/server/text-to-image/schemas";
import {
    novelAiQualityTags,
    resolveNovelAiNegativePreset,
} from "nbook/shared/text-to-image-novelai-quality";
import type {TextToImageRecipeSource, TextToImageRecipeStyle} from "nbook/shared/text-to-image-recipe";
import type {FrozenReferenceAsset} from "nbook/shared/text-to-image-reference-asset";
import {
    isNovelAiV4Model,
    PROVIDER_GRAMMAR_REGISTRY,
    type NovelAiProviderModelId,
    type NovelAiVibeEncoderVersion,
} from "nbook/shared/text-to-image-provider-registry";
import {
    IllustrationCompiledRequestSchema,
    type IllustrationCompiledRequest,
} from "nbook/shared/text-to-image-execution";

const TextToImageGenerateCharacterSchema = z.object({
    id: z.string(),
    cnName: z.string().default(""),
    enName: z.string().default(""),
    profileTraits: z.string().default(""),
    facialAppearance: z.string().default(""),
    facialBack: z.string().default(""),
    upperSfw: z.string().default(""),
    upperBackSfw: z.string().default(""),
    lowerSfw: z.string().default(""),
    lowerBackSfw: z.string().default(""),
    upperNsfw: z.string().default(""),
    upperBackNsfw: z.string().default(""),
    lowerNsfw: z.string().default(""),
    lowerBackNsfw: z.string().default(""),
    sourceProjectPath: z.string().default(""),
    sourceNovelTitle: z.string().default(""),
    sourceCharacterPath: z.string().default(""),
}).strict();

const TextToImageGenerateOutfitSchema = z.object({
    id: z.string(),
    nameCn: z.string().default(""),
    nameEn: z.string().default(""),
    aliases: z.string().default(""),
    enabled: z.boolean().default(true),
    upperFront: z.string().default(""),
    upperBack: z.string().default(""),
    lowerFront: z.string().default(""),
    lowerBack: z.string().default(""),
    fullPrompt: z.string().default(""),
    negativePrompt: z.string().default(""),
}).strict();

const TextToImagePromptReplacementRuleSchema = z.object({
    id: z.string(),
    name: z.string().default(""),
    enabled: z.boolean().default(true),
    target: z.enum(["positive", "negative"]).default("positive"),
    matchMode: z.enum(["plain", "regex"]).default("plain"),
    mode: z.enum(["replace", "append", "prepend", "delete"]).default("replace"),
    trigger: z.string().default(""),
    replacement: z.string().default(""),
}).strict();

export const TextToImageGenerateRequestSchema = z.object({
    providerId: z.number().int().positive(),
    novelAi: z.object({
        model: z.string().default("nai-diffusion-4-5-full"),
        sampler: z.string().default("k_euler_ancestral"),
        noiseSchedule: z.string().default("karras"),
        promptGuidance: z.number().default(5),
        promptGuidanceRescale: z.number().default(0),
        aiDefaultCharacterPosition: z.boolean().default(true),
        variety: z.boolean().default(false),
        smeaMode: z.enum(["auto", "off", "on"]).default("auto"),
        smeaDyn: z.boolean().default(false),
        decrisper: z.boolean().default(false),
        width: z.number().int().default(832),
        height: z.number().int().default(1216),
        steps: z.number().int().default(28),
        seed: z.number().int().default(-1),
    }).strict(),
    style: z.object({
        id: z.string().optional(),
        name: z.string().default(""),
        positivePrefix: z.string().default(""),
        positiveSuffix: z.string().default(""),
        negativePrefix: z.string().default(""),
        negativeSuffix: z.string().default(""),
        useFurryDataset: z.boolean().default(false),
        positiveQualityPreset: z.boolean().default(true),
        negativeQualityPreset: z.enum(["none", "heavy", "light", "humanFocus", "furryFocus"]).default("none"),
        vibeReferences: z.array(z.object({
            id: z.string(),
            enabled: z.boolean().default(true),
            displayName: z.string().default("Vibe Reference"),
            strength: z.number().default(0.6),
            infoExtracted: z.number().default(0.7),
        }).strict()).default([]),
        characterReferences: z.array(z.object({
            id: z.string(),
            enabled: z.boolean().default(true),
            displayName: z.string().default("Character Reference"),
            strength: z.number().default(0.6),
            infoExtracted: z.number().default(0.7),
        }).strict()).default([]),
    }).strict().nullable().default(null),
    character: TextToImageGenerateCharacterSchema.nullable().default(null),
    characters: z.array(TextToImageGenerateCharacterSchema).default([]),
    outfits: z.array(TextToImageGenerateOutfitSchema).default([]),
    promptRules: z.array(TextToImagePromptReplacementRuleSchema).default([]),
    prompt: z.string().default(""),
    negativePrompt: z.string().default(""),
    count: z.number().int().min(1).max(4).default(1),
    output: z.object({
        imageSavePath: z.string().default(""),
    }).strict().default({imageSavePath: ""}),
}).strict();

export type TextToImageGenerateRequest = z.infer<typeof TextToImageGenerateRequestSchema>;

/** 队列调用的已编译 NovelAI 输入：不携带角色、服装、输出路径或浏览器 data URL。 */
export type NovelAiRequestInput = {
    prompt: string;
    negativePrompt: string;
    novelAi: {
        model: string;
        sampler: string;
        noiseSchedule: string;
        promptGuidance: number;
        promptGuidanceRescale: number;
        width: number;
        height: number;
        steps: number;
        seed: number;
        count: number;
        aiDefaultCharacterPosition: boolean;
        variety: boolean;
        smeaMode: "auto" | "off" | "on";
        smeaDyn: boolean;
        decrisper: boolean;
    };
    style: TextToImageRecipeStyle;
};

export type NovelAiGeneratedImage = {
    bytes: Uint8Array;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    width: number;
    height: number;
    seed: number;
};

export class NovelAiHttpError extends Error {
    readonly code: string;
    readonly retryable: boolean;

    constructor(readonly status: number) {
        super(`NovelAI 请求失败：${String(status)}`);
        this.name = "NovelAiHttpError";
        this.code = `NOVELAI_HTTP_${String(status)}`;
        this.retryable = status === 429 || status >= 500;
    }
}

export type CompiledNovelAiResponse = {
    image: NovelAiGeneratedImage;
    request: {
        model: string;
        /** P5 preflight 冻结的远端 wire model；作为非敏感执行证据随响应返回。 */
        wireModel: string;
        seed: number;
        compiledRequestHash: string;
    };
};

/** buildNovelAiRequest 的受控构建产物；savedDirectory 仅队列路径置空。 */
type NovelAiRequestBuildResult = {
    model: string;
    requestedModel: string;
    action: "generate";
    prompt: string;
    negativePrompt: string;
    seed: number;
    width: number;
    height: number;
    steps: number;
    sampler: string;
    savedDirectory: string;
    parameters: Record<string, unknown>;
    requestData: Record<string, unknown>;
};

const MAX_SEED = 4294967295;

/**
 * 请求 NovelAI 并只返回受控的二进制图片；文件保存由 Project 资产服务负责。
 */
export async function requestNovelAiImages(
    input: NovelAiRequestInput,
    credential: string,
    signal: AbortSignal,
    fetchImpl: TextToImageProviderFetch = fetchTextToImageProvider,
): Promise<{images: NovelAiGeneratedImage[]; request: {model: string; seed: number}; warnings: string[]}> {
    const token = normalizeNovelAiToken(credential);
    if (!token) {
        throw new Error("NovelAI Provider 凭据不能为空");
    }
    const warnings: string[] = [];
    const buildResult = await buildNovelAiRequest({
        providerId: 0,
        novelAi: input.novelAi,
        style: {
            ...input.style,
            name: "Recipe snapshot",
            vibeReferences: [],
            characterReferences: [],
        },
        character: null,
        characters: [],
        outfits: [],
        promptRules: [],
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        count: input.novelAi.count,
        output: {imageSavePath: ""},
    }, token, warnings, fetchImpl);
    const response = await postNovelAiJson("/ai/generate-image", token, buildResult.requestData, {
        Accept: "application/x-zip-compressed",
    }, fetchImpl, signal);
    const images = extractNovelAiImages(Buffer.from(await response.arrayBuffer()));
    if (images.length === 0) {
        throw new Error("NovelAI 返回结果中没有找到图片");
    }
    return {
        images: images.map((image) => ({
            bytes: new Uint8Array(image.data),
            mimeType: image.mimeType as NovelAiGeneratedImage["mimeType"],
            width: buildResult.width,
            height: buildResult.height,
            seed: buildResult.seed,
        })),
        request: {model: buildResult.model, seed: buildResult.seed},
        warnings,
    };
}

/**
 * Route B 唯一 paid adapter：只消费自校验 CompiledRequest，不调用手工 prompt builder，且不隐藏 retry。
 */
export async function requestCompiledNovelAiImage(
    requestInput: IllustrationCompiledRequest,
    credential: string,
    signal: AbortSignal,
    fetchImpl: TextToImageProviderFetch = fetchTextToImageProvider,
    resolver?: CompiledNovelAiReferenceResolver,
): Promise<CompiledNovelAiResponse> {
    const request = IllustrationCompiledRequestSchema.parse(requestInput);
    const token = normalizeNovelAiToken(credential);
    if (!token) throw new Error("NovelAI Provider 凭据不能为空");
    const hasReferences = request.references.vibeReferences.length > 0
        || request.references.characterReferences.length > 0
        || request.references.inpaint !== null;
    if (hasReferences && !resolver) {
        throw new Error("CompiledRequest 含参考资产但未注入 resolver");
    }
    const resolved = hasReferences && resolver
        ? await resolveCompiledReferences(request, resolver, token, fetchImpl, signal)
        : undefined;
    const parameters = buildCompiledNovelAiParameters(request, resolved);
    // P5：远端 action 与 wire model 只消费 preflight 冻结值，绝不在 adapter 重新推断。
    const response = await postNovelAiJson("/ai/generate-image", token, {
        input: request.prompt,
        model: request.wireModel,
        action: request.action,
        parameters,
        use_new_shared_trial: true,
    }, {Accept: "application/x-zip-compressed"}, fetchImpl, signal);
    const images = extractNovelAiImages(Buffer.from(await response.arrayBuffer()));
    if (images.length !== 1) {
        throw new Error(`NovelAI CompiledRequest 预期 1 张图片，实际返回 ${String(images.length)} 张`);
    }
    const image = images[0]!;
    return {
        image: {
            bytes: new Uint8Array(image.data),
            mimeType: image.mimeType as NovelAiGeneratedImage["mimeType"],
            width: request.parameters.width,
            height: request.parameters.height,
            seed: request.parameters.seed,
        },
        request: {
            model: request.model,
            wireModel: request.wireModel,
            seed: request.parameters.seed,
            compiledRequestHash: request.compiledRequestHash,
        },
    };
}

type CompiledCharacterCaption = {
    centers: Array<{x: number; y: number}>;
    char_caption: string;
};

type CompiledNovelAiParameters = {
    params_version: 3;
    width: number;
    height: number;
    scale: number;
    sampler: string;
    steps: number;
    n_samples: 1;
    ucPreset: number;
    qualityToggle: boolean;
    autoSmea: boolean;
    dynamic_thresholding: boolean;
    controlnet_strength: 1;
    legacy: false;
    add_original_image: true;
    cfg_rescale: number;
    noise_schedule: string;
    normalize_reference_strength_multiple: boolean;
    inpaintImg2ImgStrength: 1;
    seed: number;
    negative_prompt: string;
    deliberate_euler_ancestral_bug: false;
    prefer_brownian: true;
    skip_cfg_above_sigma: number | null;
    use_coords?: boolean;
    legacy_v3_extend?: false;
    legacy_uc?: false;
    v4_prompt?: {caption: {base_caption: string; char_captions: CompiledCharacterCaption[]}; use_coords: boolean; use_order: true};
    v4_negative_prompt?: {caption: {base_caption: string; char_captions: CompiledCharacterCaption[]}; legacy_uc: false};
    characterPrompts?: Array<{center: {x: number; y: number}; prompt: string; uc: string; enabled: true}>;
    sm?: boolean;
    sm_dyn?: boolean;
    uc?: string;
    /** P5 Vibe Transfer。 */
    reference_image_multiple?: string[];
    reference_strength_multiple?: number[];
    reference_information_extracted_multiple?: number[];
    /** P5 Character Reference。 */
    use_character_reference?: true;
    character_reference_image_multiple?: string[];
    character_reference_strength_multiple?: number[];
    character_reference_information_extracted_multiple?: number[];
    normalize_character_reference_strength_multiple?: true;
    /** P5 Inpaint base 图 base64（PNG/JPEG）。 */
    image?: string;
    /** P5 Inpaint 蒙版 base64 PNG（白=重绘）。 */
    mask?: string;
};

/**
 * P5 参考资产字节/encoding 解析器：adapter 只消费解析产物（base64），不接触 Project 路径与凭据。
 * 仅在 CompiledRequest.references 非空时由调用方注入生产实现。
 *
 * 所有读取都发生在 paid window（attempt_started 之后）；任何证据不符都抛稳定错误，
 * 由 dispatch 映射为不可重试的 reference 失败，绝不静默降级。
 */
export interface CompiledNovelAiReferenceResolver {
    /** 按 contentHash 完整复验 source-image，返回原始字节与复验证据；篡改/缺失 fail closed。 */
    readSource(contentHash: string): Promise<{bytes: Uint8Array; evidence: FrozenReferenceAsset}>;
    /** 按完整 typed cache key 读取已缓存 Vibe encoding；未命中返回 null，证据不符 fail closed。 */
    readVibeEncoding(input: {
        sourceContentHash: string;
        providerModel: NovelAiProviderModelId;
        informationExtracted: number;
        encoderVersion: NovelAiVibeEncoderVersion;
    }): Promise<Uint8Array | null>;
    /** 持久化远端派生 Vibe encoding（完整 typed cache key；source 为复验证据）。 */
    storeRemoteVibeEncoding(input: {
        source: FrozenReferenceAsset;
        providerModel: NovelAiProviderModelId;
        informationExtracted: number;
        encoderVersion: NovelAiVibeEncoderVersion;
        bytes: Uint8Array;
    }): Promise<void>;
}

/** 已解析为 base64 的参考资产产物，供 wire 投影使用；不携带 contentHash/原始字节。 */
type ResolvedCompiledReferences = {
    vibe: Array<{encodingBase64: string; strength: number; informationExtracted: number}>;
    character: Array<{imageBase64: string; strength: number; informationExtracted: number}>;
    inpaint: {imageBase64: string; maskBase64: string} | null;
};

/**
 * 把 CompiledRequest.references 解析为 base64 产物：Vibe encoding 走缓存或 /ai/encode-vibe，
 * Character Reference 与 Inpaint 蒙版直接读源字节。Resolver 仅做存储读写；encode-vibe 由本函数用凭据调用。
 */
async function resolveCompiledReferences(
    request: IllustrationCompiledRequest,
    resolver: CompiledNovelAiReferenceResolver,
    token: string,
    fetchImpl: TextToImageProviderFetch,
    signal: AbortSignal,
): Promise<ResolvedCompiledReferences> {
    const {vibeReferences, characterReferences, inpaint} = request.references;
    // P5：encoderVersion 只来自唯一 Provider registry 的 model → 容器映射，adapter 不持有映射表。
    const encoderVersion = resolveVibeEncoderVersion(request.model);
    const vibe: ResolvedCompiledReferences["vibe"] = [];
    for (const reference of vibeReferences) {
        const informationExtracted = reference.informationExtracted ?? 0;
        let encodingBytes = await resolver.readVibeEncoding({
            sourceContentHash: reference.contentHash,
            providerModel: request.model,
            informationExtracted,
            encoderVersion,
        });
        if (!encodingBytes) {
            // 缓存未命中才读取 source 字节并派生；派生结果按完整 typed key 持久化。
            const {bytes, evidence} = await resolver.readSource(reference.contentHash);
            encodingBytes = await encodeVibeFromBytes(token, bytes, request.model, informationExtracted, fetchImpl, signal);
            await resolver.storeRemoteVibeEncoding({
                source: evidence,
                providerModel: request.model,
                informationExtracted,
                encoderVersion,
                bytes: encodingBytes,
            });
        }
        vibe.push({
            encodingBase64: Buffer.from(encodingBytes).toString("base64"),
            strength: reference.strength,
            informationExtracted,
        });
    }
    const character: ResolvedCompiledReferences["character"] = [];
    for (const reference of characterReferences) {
        const {bytes} = await resolver.readSource(reference.contentHash);
        character.push({
            imageBase64: Buffer.from(bytes).toString("base64"),
            strength: reference.strength,
            informationExtracted: reference.informationExtracted ?? 0,
        });
    }
    let inpaintResolved: ResolvedCompiledReferences["inpaint"] = null;
    if (inpaint) {
        // P5 双资产：base 图与 PNG 蒙版都必须按 contentHash 完整复验后取原始字节。
        const [base, mask] = await Promise.all([
            resolver.readSource(inpaint.baseImageContentHash),
            resolver.readSource(inpaint.maskContentHash),
        ]);
        inpaintResolved = {
            imageBase64: Buffer.from(base.bytes).toString("base64"),
            maskBase64: Buffer.from(mask.bytes).toString("base64"),
        };
    }
    return {vibe, character, inpaint: inpaintResolved};
}

/** CompiledRequest 字段到 NovelAI wire 的纯确定性投影；不做 sampler/model/prompt 纠正。 */
function buildCompiledNovelAiParameters(request: IllustrationCompiledRequest, resolved?: ResolvedCompiledReferences): CompiledNovelAiParameters {
    const input = request.parameters;
    const parameters: CompiledNovelAiParameters = {
        params_version: 3,
        width: input.width,
        height: input.height,
        scale: input.promptGuidance,
        sampler: input.sampler,
        steps: input.steps,
        n_samples: 1,
        ucPreset: input.ucPreset,
        qualityToggle: input.qualityToggle,
        autoSmea: input.smeaMode === "auto",
        dynamic_thresholding: input.decrisper,
        controlnet_strength: 1,
        legacy: false,
        add_original_image: true,
        cfg_rescale: input.promptGuidanceRescale,
        noise_schedule: input.noiseSchedule,
        normalize_reference_strength_multiple: true,
        inpaintImg2ImgStrength: 1,
        seed: input.seed,
        negative_prompt: request.negativePrompt,
        deliberate_euler_ancestral_bug: false,
        prefer_brownian: true,
        skip_cfg_above_sigma: input.variety ? calculateVarietySigma(input.width, input.height) : null,
    };
    if (isNovelAiV4Model(request.model)) {
        const useCoords = !input.aiDefaultCharacterPosition;
        const positiveCaptions = request.characterPrompts.map((character): CompiledCharacterCaption => ({
            centers: [character.center],
            char_caption: character.prompt,
        }));
        const negativeCaptions = request.characterPrompts.map((character): CompiledCharacterCaption => ({
            centers: [character.center],
            char_caption: character.negativePrompt,
        }));
        parameters.use_coords = useCoords;
        parameters.legacy_v3_extend = false;
        parameters.legacy_uc = false;
        parameters.v4_prompt = {
            caption: {base_caption: request.prompt, char_captions: positiveCaptions},
            use_coords: useCoords,
            use_order: true,
        };
        parameters.v4_negative_prompt = {
            caption: {base_caption: request.negativePrompt, char_captions: negativeCaptions},
            legacy_uc: false,
        };
        parameters.characterPrompts = request.characterPrompts.map((character) => ({
            center: character.center,
            prompt: character.prompt,
            uc: character.negativePrompt,
            enabled: true,
        }));
    } else {
        parameters.sm = input.smeaMode === "on";
        parameters.sm_dyn = input.smeaDyn;
        parameters.uc = request.negativePrompt;
    }
    if (resolved?.vibe.length) {
        parameters.normalize_reference_strength_multiple = request.references.normalizeVibeStrengths;
        parameters.reference_image_multiple = resolved.vibe.map((item) => item.encodingBase64);
        parameters.reference_strength_multiple = resolved.vibe.map((item) => item.strength);
        parameters.reference_information_extracted_multiple = resolved.vibe.map((item) => item.informationExtracted);
    }
    if (resolved?.character.length) {
        parameters.use_character_reference = true;
        parameters.character_reference_image_multiple = resolved.character.map((item) => item.imageBase64);
        parameters.character_reference_strength_multiple = resolved.character.map((item) => item.strength);
        parameters.character_reference_information_extracted_multiple = resolved.character.map((item) => item.informationExtracted);
        parameters.normalize_character_reference_strength_multiple = true;
    }
    if (resolved?.inpaint) {
        // P5 Inpaint：base 图原样传输 + PNG 蒙版（白=重绘）；action/wire model 由 preflight 冻结。
        parameters.image = resolved.inpaint.imageBase64;
        parameters.mask = resolved.inpaint.maskBase64;
    }
    return parameters;
}

async function buildNovelAiRequest(
    input: TextToImageGenerateRequest,
    token: string,
    warnings: string[],
    fetchImpl: TextToImageProviderFetch,
): Promise<NovelAiRequestBuildResult> {
    const requestedModel = input.novelAi.model.trim() || "nai-diffusion-4-5-full";
    const model = input.style?.useFurryDataset === true && !requestedModel.includes("furry")
        ? "nai-diffusion-furry-3"
        : requestedModel;
    if (model !== requestedModel) {
        warnings.push("已启用 Furry 数据集，本次请求使用 nai-diffusion-furry-3。");
    }

    const width = clampInteger(input.novelAi.width, 64, 4096, 832);
    const height = clampInteger(input.novelAi.height, 64, 4096, 1216);
    const steps = clampInteger(input.novelAi.steps, 1, 50, 28);
    const seed = input.novelAi.seed === -1 ? randomSeed() : clampInteger(input.novelAi.seed, 0, MAX_SEED, randomSeed());
    const count = clampInteger(input.count, 1, 4, 1);
    const sampler = mapSamplerForModel(input.novelAi.sampler.trim() || "k_euler_ancestral", model);
    if (sampler !== input.novelAi.sampler) {
        warnings.push(`采样方法已按模型兼容性映射为 ${sampler}。`);
    }

    const resolvedPrompt = resolveTextToImagePrompt({
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        characters: collectPromptCharacters(input),
        outfits: input.outfits,
        promptRules: input.promptRules,
        activeCharacter: shouldInlineCharacterPrompt(input) ? input.character : null,
    });
    if (resolvedPrompt.unresolvedTriggers.length > 0) {
        warnings.push(`本次有 ${resolvedPrompt.unresolvedTriggers.length} 个 prompt 触发符未匹配：${resolvedPrompt.unresolvedTriggers.join(", ")}`);
    }
    if (resolvedPrompt.appliedRules.length > 0) {
        warnings.push(`已应用 ${resolvedPrompt.appliedRules.length} 条 prompt 替换规则。`);
    }

    const basePrompt = mergePromptParts(
        input.style?.positivePrefix,
        resolvedPrompt.prompt,
        input.style?.positiveSuffix,
    );
    if (!basePrompt) {
        throw new Error("正面 prompt 不能为空");
    }
    const prompt = input.style?.positiveQualityPreset === false
        ? basePrompt
        : applyQualityTags(basePrompt, model);
    const baseNegativePrompt = mergePromptParts(input.style?.negativePrefix, resolvedPrompt.negativePrompt, input.style?.negativeSuffix);
    const preset = resolveNovelAiNegativePreset(model, input.style?.negativeQualityPreset ?? "none");
    let negativePrompt = mergePromptParts(preset.content, baseNegativePrompt);
    if (containsNsfwTag(prompt)) {
        negativePrompt = removeNsfwTag(negativePrompt);
    }

    const parameters: Record<string, unknown> = {
        params_version: 3,
        width,
        height,
        scale: toFiniteNumber(input.novelAi.promptGuidance, 5),
        sampler,
        steps,
        n_samples: count,
        ucPreset: preset.ucPreset,
        qualityToggle: input.style?.positiveQualityPreset ?? true,
        autoSmea: input.novelAi.smeaMode === "auto",
        dynamic_thresholding: input.novelAi.decrisper,
        controlnet_strength: 1,
        legacy: false,
        add_original_image: true,
        cfg_rescale: toFiniteNumber(input.novelAi.promptGuidanceRescale, 0),
        noise_schedule: normalizeNoiseSchedule(input.novelAi.noiseSchedule, model),
        normalize_reference_strength_multiple: true,
        inpaintImg2ImgStrength: 1,
        seed,
        negative_prompt: negativePrompt,
        deliberate_euler_ancestral_bug: false,
        prefer_brownian: true,
        skip_cfg_above_sigma: input.novelAi.variety ? calculateVarietySigma(width, height) : null,
    };

    if (isNovelAiV4Model(model as NovelAiProviderModelId)) {
        applyV4PromptParameters(parameters, input, prompt, negativePrompt, resolvedPrompt.characterPrompts);
    } else {
        const isDdim = sampler.includes("ddim");
        const autoSmea = input.novelAi.smeaMode === "auto" && width * height > 1024 * 1024;
        parameters.sm = isDdim ? false : input.novelAi.smeaMode === "on" || autoSmea;
        parameters.sm_dyn = !isDdim && input.novelAi.smeaDyn;
        parameters.uc = negativePrompt;
    }

    return {
        model,
        requestedModel,
        action: "generate",
        prompt,
        negativePrompt,
        seed,
        width,
        height,
        steps,
        sampler,
        savedDirectory: "",
        parameters,
        requestData: {
            input: prompt,
            model,
            action: "generate",
            parameters,
            use_new_shared_trial: true,
        },
    };
}

function applyV4PromptParameters(parameters: Record<string, unknown>, input: TextToImageGenerateRequest, prompt: string, negativePrompt: string, resolvedCharacterPrompts: TextToImageResolvedCharacterPrompt[]): void {
    const fallbackCharacterPrompt = input.character ? buildCharacterPrompt(input.character) : "";
    const fallbackPrompts: TextToImageResolvedCharacterPrompt[] = fallbackCharacterPrompt
        ? [{
            characterId: input.character?.id ?? "active",
            name: input.character?.cnName || input.character?.enName || "active",
            prompt: fallbackCharacterPrompt,
            negativePrompt: "",
            center: {x: 0.5, y: 0.5},
        }]
        : [];
    const characterPrompts = resolvedCharacterPrompts.length > 0 ? resolvedCharacterPrompts : fallbackPrompts;
    const useCoords = !input.novelAi.aiDefaultCharacterPosition;
    const charCaptions = characterPrompts.map((item) => ({
        centers: [item.center],
        char_caption: item.prompt,
    }));
    const negativeCharCaptions = characterPrompts.map((item) => ({
        centers: [item.center],
        char_caption: item.negativePrompt,
    }));

    parameters.params_version = 3;
    parameters.use_coords = useCoords;
    parameters.legacy_v3_extend = false;
    parameters.legacy_uc = false;
    parameters.v4_prompt = {
        caption: {
            base_caption: prompt,
            char_captions: charCaptions,
        },
        use_coords: useCoords,
        use_order: true,
    };
    parameters.v4_negative_prompt = {
        caption: {
            base_caption: negativePrompt,
            char_captions: negativeCharCaptions,
        },
        legacy_uc: false,
    };
    parameters.characterPrompts = characterPrompts.map((item) => ({
        center: item.center,
        prompt: item.prompt,
        uc: item.negativePrompt,
        enabled: true,
    }));
}

function collectPromptCharacters(input: TextToImageGenerateRequest): TextToImageGenerateRequest["characters"] {
    const characters = [...input.characters];
    if (input.character && !characters.some((character) => character.id === input.character?.id)) {
        characters.unshift(input.character);
    }
    return characters;
}

/** 调用 NovelAI /ai/encode-vibe 把源图片字节派生为 encoding 二进制；缓存与 wire 共用。 */
async function encodeVibeFromBytes(
    token: string,
    imageBytes: Uint8Array,
    model: string,
    informationExtracted: number,
    fetchImpl: TextToImageProviderFetch,
    signal: AbortSignal,
): Promise<Uint8Array> {
    const imageBase64 = Buffer.from(imageBytes).toString("base64");
    const response = await postNovelAiJson("/ai/encode-vibe", token, {
        image: imageBase64,
        model,
        informationExtracted,
    }, {}, fetchImpl, signal);
    return new Uint8Array(await response.arrayBuffer());
}

async function postNovelAiJson(
    endpoint: string,
    token: string,
    data: unknown,
    extraHeaders: Record<string, string>,
    fetchImpl: TextToImageProviderFetch,
    signal?: AbortSignal,
): Promise<Response> {
    const url = `${TEXT_TO_IMAGE_NOVELAI_BASE_URL}${endpoint}`;
    const response = await fetchImpl(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...extraHeaders,
        },
        body: JSON.stringify(data),
        signal,
    }, {allowPrivateNetwork: false});

    if (!response.ok) throw new NovelAiHttpError(response.status);

    return response;
}

function extractNovelAiImages(data: Buffer): Array<{name: string; mimeType: string; data: Buffer}> {
    const directMimeType = detectMimeType(data);
    if (directMimeType) {
        return [{name: `image.${extensionFromMimeType(directMimeType)}`, mimeType: directMimeType, data}];
    }

    let unzipped: Record<string, Uint8Array>;
    try {
        unzipped = unzipSync(new Uint8Array(data));
    } catch (error) {
        throw new Error(`无法解压 NovelAI 返回的图片包：${error instanceof Error ? error.message : String(error)}`);
    }

    return Object.entries(unzipped)
        .filter(([name]) => /\.(png|jpe?g|webp)$/iu.test(name))
        .map(([name, bytes]) => {
            const buffer = Buffer.from(bytes);
            return {
                name,
                mimeType: detectMimeType(buffer) ?? mimeTypeFromExtension(name),
                data: buffer,
            };
        });
}

function buildCharacterPrompt(character: TextToImageGenerateRequest["character"]): string {
    if (!character) {
        return "";
    }
    return mergePromptParts(
        character.enName,
        character.profileTraits,
        character.facialAppearance,
        character.upperSfw,
        character.lowerSfw,
    );
}

function shouldInlineCharacterPrompt(input: TextToImageGenerateRequest): boolean {
    const requestedModel = input.style?.useFurryDataset === true && !input.novelAi.model.includes("furry")
        ? "nai-diffusion-furry-3"
        : input.novelAi.model;
    return !isNovelAiV4Model(requestedModel as NovelAiProviderModelId);
}

function mergePromptParts(...parts: Array<string | null | undefined>): string {
    return parts
        .map((part) => (part ?? "").trim().replace(/^,+|,+$/gu, ""))
        .filter((part) => part.length > 0)
        .join(", ");
}

function applyQualityTags(prompt: string, model: string): string {
    return mergePromptParts(prompt, novelAiQualityTags(model));
}

function mapSamplerForModel(sampler: string, model: string): string {
    if (sampler === "ddim" || sampler === "ddim_v3") {
        if (model.includes("diffusion-3")) {
            return "ddim_v3";
        }
        if (isNovelAiV4Model(model as NovelAiProviderModelId)) {
            return "k_euler_ancestral";
        }
    }
    return sampler;
}

function normalizeNoiseSchedule(noiseSchedule: string, model: string): string {
    if (isNovelAiV4Model(model as NovelAiProviderModelId) && noiseSchedule === "native") {
        return "karras";
    }
    return noiseSchedule || "karras";
}

/** 从唯一 Provider registry 解析 model 的已登记 Vibe encoder 版本；未登记 fail closed。 */
function resolveVibeEncoderVersion(model: NovelAiProviderModelId): NovelAiVibeEncoderVersion {
    const container = PROVIDER_GRAMMAR_REGISTRY.advanced.vibeTransfer.containers.find(
        (entry) => entry.model === model,
    );
    if (!container) {
        throw new Error(`model=${model} 没有登记 Vibe 容器映射`);
    }
    return container.encoderVersion;
}

function calculateVarietySigma(width: number, height: number): number {
    return 58 * Math.sqrt((4 * (width / 8) * (height / 8)) / 63232);
}

function containsNsfwTag(prompt: string): boolean {
    return /[\{\[]*nsfw[\}\]]*/iu.test(prompt);
}

function removeNsfwTag(prompt: string): string {
    return prompt
        .replace(/[\{\[]*nsfw[\}\]]*\s*,?\s*/giu, "")
        .replace(/,\s*,/gu, ",")
        .replace(/^\s*,\s*/u, "")
        .replace(/\s*,\s*$/u, "")
        .trim();
}

function normalizeNovelAiToken(token: string): string {
    let normalized = token.trim();
    while (/^Bearer\s+/iu.test(normalized)) {
        normalized = normalized.replace(/^Bearer\s+/iu, "").trim();
    }
    return normalized;
}

function randomSeed(): number {
    return Math.floor(Math.random() * MAX_SEED);
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.round(Math.min(max, Math.max(min, value)));
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function detectMimeType(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return "image/png";
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return "image/webp";
    }
    return null;
}

function mimeTypeFromExtension(name: string): string {
    const extension = path.extname(name).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") {
        return "image/jpeg";
    }
    if (extension === ".webp") {
        return "image/webp";
    }
    return "image/png";
}

function extensionFromMimeType(mimeType: string): string {
    if (mimeType === "image/jpeg") {
        return "jpg";
    }
    if (mimeType === "image/webp") {
        return "webp";
    }
    return "png";
}
