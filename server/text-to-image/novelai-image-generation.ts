import {unzipSync} from "fflate";
import type {Dispatcher} from "undici";
import {
    fetchTextToImageProvider,
    TextToImageProviderConnectionError,
} from "nbook/server/text-to-image/provider-fetch";
import type {LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";
import {resolveNovelAiUcPreset} from "nbook/server/text-to-image/novelai-quality";
import {
    getNovelAiProxyResolver,
    type NovelAiProxyResolver,
} from "nbook/server/text-to-image/novelai-proxy";
import {
    getNovelAiRequestScheduler,
    type NovelAiRequestScheduler,
} from "nbook/server/text-to-image/novelai-request-scheduler";
import {
    buildNovelAiReferencePayload,
    resolveNovelAiModelFamily,
} from "nbook/server/text-to-image/novelai-payload";

export type NovelAiVibeReferenceInput = {
    enabled: boolean;
    imageId: string | null;
    informationExtracted: number;
    referenceStrength: number;
};

export type NovelAiVibeGroupInput = {
    enabled: boolean;
    random: boolean;
    normalizeStrength: boolean;
    groupId: string | null;
};

export type NovelAiCharacterReferenceInput = {
    enabled: boolean;
    groupId: string | null;
    imageIds: string[];
    referenceStrength: number;
    informationExtracted: number;
};

export type NovelAiInpaintInput = {
    imageId: string;
    maskId: string;
    strength: number;
};

export type NovelAiCharacterPromptInput = {
    prompt: string;
    negativePrompt: string;
    centerX?: number;
    centerY?: number;
};

/** 参考图字节解析器；Vibe/角色参考/局部重绘启用时必须注入。 */
export type TextToImageReferenceResolver = {
    readReference: (relativePath: string) => Promise<Uint8Array>;
};

export type NovelAiImageInput = {
    credential: string;
    baseUrl: string;
    model: string;
    prompt: string;
    negativePrompt: string;
    characterPrompts?: NovelAiCharacterPromptInput[];
    width: number;
    height: number;
    steps: number;
    seed: number;
    sampler: string;
    noiseSchedule: string;
    scale: number;
    cfgRescale: number;
    variety: boolean;
    decrisp: boolean;
    aiDefaultCharacterPosition: boolean;
    ucPreset?: number;
    positiveQualityPreset?: boolean;
    vibe?: NovelAiVibeReferenceInput;
    vibeGroup?: NovelAiVibeGroupInput;
    vibeGroups?: Record<string, string[]>;
    characterReference?: NovelAiCharacterReferenceInput;
    characterGroups?: Record<string, string[]>;
    inpaint?: NovelAiInpaintInput;
    requestIntervalMs?: number;
    signal?: AbortSignal;
    /** 测试或独立调用注入；生产默认使用全局 NovelAI 调度器。 */
    scheduler?: NovelAiRequestScheduler;
    /** 测试注入；生产由 provider-fetch 使用默认 fetch。 */
    fetchImpl?: LlmFetchImpl;
    /** NovelAI 专用代理解析器；未注入时生产使用进程级解析器。 */
    proxyResolver?: NovelAiProxyResolver;
};

export class NovelAiHttpError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "NovelAiHttpError";
    }
}

const MAX_SEED = 4294967295;
/**
 * NovelAI `/ai/generate-image` 直调。
 * 默认接收 zip 图片包，兼容 JSON `images[]` base64；安全出站复用 provider-fetch。
 */
export async function requestNovelAiImages(
    input: NovelAiImageInput,
    resolver?: TextToImageReferenceResolver,
): Promise<Uint8Array[]> {
    const token = normalizeNovelAiToken(input.credential);
    if (token === "") {
        throw new Error("NovelAI Provider 凭据不能为空");
    }
    const width = clampInteger(input.width, 64, 4096, 832);
    const height = clampInteger(input.height, 64, 4096, 1216);
    const steps = clampInteger(input.steps, 1, 50, 28);
    const seed = clampInteger(input.seed, -1, MAX_SEED, 0);
    const family = resolveNovelAiModelFamily(input.model);
    const flatPrompt = input.prompt;
    const flatNegativePrompt = input.negativePrompt;
    const baseUrl = input.baseUrl.replace(/\/+$/u, "");
    const parameters: Record<string, unknown> = {
        params_version: 3,
        width,
        height,
        scale: clampNumber(input.scale, 1, 30, 5),
        sampler: input.sampler || "k_euler",
        steps,
        n_samples: 1,
        ucPreset: input.ucPreset ?? resolveNovelAiUcPreset(input.model, "Heavy"),
        qualityToggle: input.positiveQualityPreset ?? true,
        dynamic_thresholding: input.decrisp,
        controlnet_strength: 1,
        legacy: false,
        add_original_image: true,
        cfg_rescale: clampNumber(input.cfgRescale, 0, 1, 0),
        noise_schedule: input.noiseSchedule || "karras",
        normalize_reference_strength_multiple: true,
        inpaintImg2ImgStrength: 1,
        seed,
        negative_prompt: flatNegativePrompt,
        variety: input.variety,
        ai_default_character_position: input.aiDefaultCharacterPosition,
        deliberate_euler_ancestral_bug: false,
        prefer_brownian: true,
        skip_cfg_above_sigma: input.variety ? calculateVarietySigma(width, height) : null,
    };

    const characterPrompts = input.characterPrompts ?? [];
    const useCoords = !input.aiDefaultCharacterPosition
        && characterPrompts.every((item) => item.centerX !== undefined && item.centerY !== undefined);
    parameters.use_coords = useCoords;
    parameters.legacy_v3_extend = false;
    parameters.legacy_uc = false;
    parameters.v4_prompt = {
        caption: {
            base_caption: input.prompt,
            char_captions: buildNovelAiCharacterCaptions(characterPrompts),
        },
        use_coords: useCoords,
        use_order: true,
    };
    parameters.v4_negative_prompt = {
        caption: {
            base_caption: input.negativePrompt,
            char_captions: buildNovelAiCharacterCaptions(characterPrompts, true),
        },
        legacy_uc: false,
    };
    parameters.characterPrompts = [];

    const scheduler = input.scheduler ?? getNovelAiRequestScheduler();
    const proxyResolver = input.proxyResolver ?? (input.fetchImpl ? undefined : getNovelAiProxyResolver());
    return await scheduler.schedule({
        requestIntervalMs: input.requestIntervalMs ?? 15_000,
        signal: input.signal,
        run: async () => {
            const dispatcher = proxyResolver
                ? await proxyResolver.resolveDispatcher()
                : undefined;
            try {
                const vibe = await resolveVibeReferences(input, resolver, token, dispatcher);
                const character = await resolveCharacterReferences(input, resolver);
                Object.assign(parameters, buildNovelAiReferencePayload(
                    family,
                    {vibe, character},
                ));
                if (input.inpaint) {
                    if (!resolver) {
                        throw new Error("局部重绘需要 readReference resolver");
                    }
                    const [imageBytes, maskBytes] = await Promise.all([
                        resolver.readReference(input.inpaint.imageId),
                        resolver.readReference(input.inpaint.maskId),
                    ]);
                    parameters.image = Buffer.from(imageBytes).toString("base64");
                    parameters.mask = Buffer.from(maskBytes).toString("base64");
                    parameters.inpaintImg2ImgStrength = clampNumber(input.inpaint.strength, 0, 1, 0.54);
                    parameters.add_original_image = true;
                }

                const body = {
                    input: flatPrompt,
                    model: input.model,
                    action: "generate",
                    parameters,
                    use_new_shared_trial: true,
                };
                const response = await fetchTextToImageProvider(
                    `${baseUrl}/ai/generate-image`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${token}`,
                            "content-type": "application/json",
                            accept: "application/x-zip-compressed",
                        },
                        body: JSON.stringify(body),
                        signal: input.signal,
                    },
                    {allowPrivateNetwork: false},
                    {
                        ...(dispatcher ? {dispatcher} : {}),
                        ...(input.fetchImpl ? {fetchImpl: input.fetchImpl as never} : {}),
                    },
                );
                if (!response.ok) {
                    const detail = (await response.text().catch(() => "")).trim().slice(0, 1_000);
                    if (detail !== "") {
                        throw new NovelAiHttpError(`NovelAI 生成失败：HTTP ${response.status}：${detail}`, response.status);
                    }
                    throw new NovelAiHttpError(`NovelAI 生成失败：HTTP ${response.status}`, response.status);
                }

                const contentType = response.headers.get("content-type") ?? "";
                if (contentType.includes("application/json")) {
                    const data = await response.json() as {images?: Array<string>};
                    const images = data.images ?? [];
                    if (images.length === 0) {
                        throw new Error("NovelAI 未返回图片");
                    }
                    return images.map((base64) => Uint8Array.from(Buffer.from(base64, "base64")));
                }

                const extracted = extractNovelAiImages(Buffer.from(await response.arrayBuffer()));
                if (extracted.length === 0) {
                    throw new Error("NovelAI 返回结果中没有找到图片");
                }
                return extracted.map((image) => image.data);
            } catch (error) {
                if (proxyResolver && error instanceof TextToImageProviderConnectionError) {
                    await proxyResolver.invalidate();
                }
                throw error;
            }
        },
    });
}

type ResolvedVibeReference = {
    encodingBase64: string;
    strength: number;
    informationExtracted: number;
};

async function resolveVibeReferences(
    input: NovelAiImageInput,
    resolver: TextToImageReferenceResolver | undefined,
    token: string,
    dispatcher: Dispatcher | undefined,
): Promise<ResolvedVibeReference[]> {
    const imageIds: string[] = [];
    if (input.vibeGroup?.enabled) {
        const groups = input.vibeGroups ?? {};
        const groupId = input.vibeGroup.groupId
            ?? (input.vibeGroup.random ? randomGroupId(groups) : null);
        if (groupId !== null) {
            const group = groups[groupId] ?? [];
            imageIds.push(...group);
        }
    }
    if (input.vibe?.enabled && input.vibe.imageId) {
        imageIds.push(input.vibe.imageId);
    }
    if (imageIds.length === 0) {
        return [];
    }
    if (!resolver) {
        throw new Error("Vibe 参考图需要 readReference resolver");
    }

    const informationExtracted = input.vibe?.informationExtracted ?? 0.3;
    const strength = input.vibe?.referenceStrength ?? 0.6;
    const result: ResolvedVibeReference[] = [];
    for (const imageId of imageIds) {
        const bytes = await resolver.readReference(imageId);
        const encodingBytes = await encodeVibeFromBytes(
            token,
            bytes,
            input.model,
            informationExtracted,
            input,
            dispatcher,
        );
        result.push({
            encodingBase64: Buffer.from(encodingBytes).toString("base64"),
            strength,
            informationExtracted,
        });
    }
    return result;
}

type ResolvedCharacterReference = {
    imageBase64: string;
    strength: number;
    informationExtracted: number;
};

async function resolveCharacterReferences(
    input: NovelAiImageInput,
    resolver: TextToImageReferenceResolver | undefined,
): Promise<ResolvedCharacterReference[]> {
    const reference = input.characterReference;
    if (!reference?.enabled) {
        return [];
    }
    const group = reference.groupId
        ? (input.characterGroups?.[reference.groupId] ?? [])
        : [];
    const imageIds = group.length > 0 ? group : reference.imageIds;
    if (imageIds.length === 0) {
        return [];
    }
    if (!resolver) {
        throw new Error("角色参考图需要 readReference resolver");
    }
    const result: ResolvedCharacterReference[] = [];
    for (const imageId of imageIds) {
        const bytes = await resolver.readReference(imageId);
        result.push({
            imageBase64: Buffer.from(bytes).toString("base64"),
            strength: reference.referenceStrength,
            informationExtracted: reference.informationExtracted,
        });
    }
    return result;
}

/** 调用 NovelAI `/ai/encode-vibe` 把源图片字节派生为 encoding 二进制。 */
async function encodeVibeFromBytes(
    token: string,
    imageBytes: Uint8Array,
    model: string,
    informationExtracted: number,
    input: NovelAiImageInput,
    dispatcher: Dispatcher | undefined,
): Promise<Uint8Array> {
    const baseUrl = input.baseUrl.replace(/\/+$/u, "");
    const response = await fetchTextToImageProvider(
        `${baseUrl}/ai/encode-vibe`,
        {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                image: Buffer.from(imageBytes).toString("base64"),
                model,
                informationExtracted,
            }),
            signal: input.signal,
        },
        {allowPrivateNetwork: false},
        {
            ...(dispatcher ? {dispatcher} : {}),
            ...(input.fetchImpl ? {fetchImpl: input.fetchImpl as never} : {}),
        },
    );
    if (!response.ok) {
        throw new NovelAiHttpError(`NovelAI Vibe 编码失败：HTTP ${response.status}`, response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
}

type ExtractedNovelAiImage = {
    data: Uint8Array;
    mimeType: string;
};

function extractNovelAiImages(data: Buffer): ExtractedNovelAiImage[] {
    const directMimeType = detectMimeType(data);
    if (directMimeType !== null) {
        return [{data: new Uint8Array(data), mimeType: directMimeType}];
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
                data: new Uint8Array(buffer),
                mimeType: detectMimeType(buffer) ?? mimeTypeFromExtension(name),
            };
        });
}

function buildNovelAiCharacterCaptions(
    characterPrompts: NovelAiCharacterPromptInput[],
    useNegativePrompt = false,
): Array<Record<string, unknown>> {
    return characterPrompts.map((item) => ({
        char_caption: useNegativePrompt ? item.negativePrompt : item.prompt,
        centers: [{
            ...(item.centerX === undefined ? {} : {x: item.centerX}),
            ...(item.centerY === undefined ? {} : {y: item.centerY}),
        }],
    }));
}

function randomGroupId(groups: Record<string, string[]>): string | null {
    const keys = Object.keys(groups);
    if (keys.length === 0) {
        return null;
    }
    return keys[Math.floor(Math.random() * keys.length)] ?? null;
}

function calculateVarietySigma(width: number, height: number): number {
    return 58 * Math.sqrt((4 * (width / 8) * (height / 8)) / 63232);
}

function normalizeNovelAiToken(token: string): string {
    let normalized = token.trim();
    while (/^Bearer\s+/iu.test(normalized)) {
        normalized = normalized.replace(/^Bearer\s+/iu, "").trim();
    }
    return normalized;
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

function detectMimeType(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return "image/png";
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }
    if (buffer.length >= 12
        && buffer.subarray(0, 4).toString("ascii") === "RIFF"
        && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return "image/webp";
    }
    return null;
}

function mimeTypeFromExtension(name: string): string {
    const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") {
        return "image/jpeg";
    }
    if (extension === ".webp") {
        return "image/webp";
    }
    return "image/png";
}
