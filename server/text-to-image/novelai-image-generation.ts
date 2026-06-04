import fs from "node:fs/promises";
import path from "node:path";
import {unzipSync} from "fflate";
import {z} from "zod";
import {withBrowserProxyForFetch} from "nbook/server/utils/browser-proxy";

export const TextToImageGenerateRequestSchema = z.object({
    novelAi: z.object({
        token: z.string(),
        imageBaseUrl: z.string().default("https://image.novelai.net"),
        model: z.string().default("nai-diffusion-4-5-full"),
        sampler: z.string().default("k_euler_ancestral"),
        noiseSchedule: z.string().default("karras"),
        promptGuidance: z.number().default(5),
        promptGuidanceRescale: z.number().default(0),
        aiDefaultCharacterPosition: z.boolean().default(true),
        variety: z.boolean().default(false),
        width: z.number().int().default(832),
        height: z.number().int().default(1216),
        steps: z.number().int().default(28),
        seed: z.number().int().default(-1),
    }),
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
            vibeEncoding: z.string().default(""),
            imageDataUrl: z.string().default(""),
            sourceType: z.enum(["png", "naiv4vibe", "naiv4vibebundle", "rawImage"]).default("rawImage"),
            strength: z.number().default(0.6),
            infoExtracted: z.number().default(0.7),
        })).default([]),
    }).nullable().default(null),
    character: z.object({
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
    }).nullable().default(null),
    prompt: z.string().default(""),
    negativePrompt: z.string().default(""),
    output: z.object({
        imageSavePath: z.string().default(""),
    }).default({imageSavePath: ""}),
});

export type TextToImageGenerateRequest = z.infer<typeof TextToImageGenerateRequestSchema>;

export type TextToImageGeneratedImage = {
    id: string;
    createdAt: string;
    fileName: string;
    savedPath: string;
    metadataPath: string;
    dataUrl: string;
    mimeType: string;
    byteLength: number;
    seed: number;
    width: number;
    height: number;
    model: string;
    prompt: string;
    negativePrompt: string;
};

export type TextToImageGenerateResponse = {
    images: TextToImageGeneratedImage[];
    request: {
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
    };
    warnings: string[];
};

type NegativeQualityPreset = NonNullable<TextToImageGenerateRequest["style"]>["negativeQualityPreset"];
type NovelAiRequestBuildResult = TextToImageGenerateResponse["request"] & {
    requestData: Record<string, unknown>;
};

const MAX_SEED = 4294967295;
const QUALITY_TAGS_BY_MODEL: Record<string, string> = {
    "nai-diffusion-4-5-full": "very aesthetic, masterpiece, no text",
    "nai-diffusion-4-5-curated": "very aesthetic, masterpiece, no text, -0.8::feet::, rating:general",
    "nai-diffusion-4-full": "no text, best quality, very aesthetic, absurdres",
    "nai-diffusion-4-curated-preview": "rating:general, best quality, very aesthetic, absurdres",
    "nai-diffusion-3": "best quality, amazing quality, very aesthetic, absurdres",
    "nai-diffusion-furry-3": "{best quality}, {amazing quality}",
};

const NEGATIVE_PRESETS: Record<string, Partial<Record<NegativeQualityPreset, {ucPreset: number; content: string}>>> = {
    "nai-diffusion-4-5-full": {
        heavy: {ucPreset: 0, content: "nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"},
        light: {ucPreset: 1, content: "nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page"},
        furryFocus: {ucPreset: 2, content: "nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic"},
        humanFocus: {ucPreset: 3, content: "nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"},
        none: {ucPreset: 4, content: ""},
    },
    "nai-diffusion-4-5-curated": {
        heavy: {ucPreset: 0, content: "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page"},
        light: {ucPreset: 1, content: "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page"},
        humanFocus: {ucPreset: 2, content: "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page"},
        none: {ucPreset: 3, content: ""},
    },
    "nai-diffusion-4-full": {
        heavy: {ucPreset: 0, content: "nsfw, blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page"},
        light: {ucPreset: 1, content: "nsfw, blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page"},
        humanFocus: {ucPreset: 2, content: "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, bad anatomy, bad hands"},
        furryFocus: {ucPreset: 2, content: "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, distorted text, repeated text, floating head, widescreen, sequence, compression artifacts, hard translated, cropped, unknown text, high contrast"},
        none: {ucPreset: 2, content: ""},
    },
    "nai-diffusion-4-curated-preview": {
        heavy: {ucPreset: 0, content: "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page"},
        light: {ucPreset: 1, content: "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page"},
        humanFocus: {ucPreset: 2, content: "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, bad anatomy, bad hands"},
        furryFocus: {ucPreset: 2, content: "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, distorted text, repeated text, floating head, widescreen, sequence, compression artifacts, hard translated, cropped, unknown text, high contrast"},
        none: {ucPreset: 2, content: ""},
    },
    "nai-diffusion-3": {
        heavy: {ucPreset: 0, content: "nsfw, lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]"},
        light: {ucPreset: 1, content: "nsfw, lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing"},
        humanFocus: {ucPreset: 2, content: "nsfw, lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes"},
        furryFocus: {ucPreset: 0, content: "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, distorted text, repeated text, floating head, widescreen, sequence, compression artifacts, hard translated, cropped, unknown text, high contrast"},
        none: {ucPreset: 3, content: "lowres"},
    },
    "nai-diffusion-furry-3": {
        heavy: {ucPreset: 0, content: "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, distorted text, repeated text, floating head, widescreen, sequence, compression artifacts, hard translated, cropped, unknown text, high contrast"},
        light: {ucPreset: 1, content: "{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text"},
        furryFocus: {ucPreset: 0, content: "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, distorted text, repeated text, floating head, widescreen, sequence, compression artifacts, hard translated, cropped, unknown text, high contrast"},
        humanFocus: {ucPreset: 0, content: "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, distorted text, repeated text, floating head, widescreen, sequence, compression artifacts, hard translated, cropped, unknown text, high contrast"},
        none: {ucPreset: 2, content: ""},
    },
};

export async function generateNovelAiImage(input: TextToImageGenerateRequest): Promise<TextToImageGenerateResponse> {
    const token = normalizeNovelAiToken(input.novelAi.token);
    if (!token) {
        throw new Error("NovelAI Persistent Token 不能为空");
    }

    const warnings: string[] = [];
    const outputDirectory = await resolveOutputDirectory(input.output.imageSavePath);
    const buildResult = await buildNovelAiRequest(input, token, warnings);
    buildResult.savedDirectory = outputDirectory;
    const response = await postNovelAiJson(input.novelAi.imageBaseUrl, "/ai/generate-image", token, buildResult.requestData, {
        Accept: "application/x-zip-compressed",
    });
    const images = extractNovelAiImages(Buffer.from(await response.arrayBuffer()));
    if (images.length === 0) {
        throw new Error("NovelAI 返回结果中没有找到图片");
    }

    const createdAt = new Date().toISOString();
    const savedImages: TextToImageGeneratedImage[] = [];
    for (const [index, image] of images.entries()) {
        const extension = extensionFromMimeType(image.mimeType);
        const fileName = buildImageFileName(createdAt, buildResult.seed, index, extension);
        const savedPath = path.join(outputDirectory, fileName);
        const metadataPath = savedPath.replace(/\.[^.]+$/u, ".json");
        await fs.writeFile(savedPath, image.data);
        await fs.writeFile(metadataPath, JSON.stringify({
            createdAt,
            fileName,
            request: {
                ...buildResult,
                requestData: buildResult.requestData,
            },
        }, null, 2), "utf-8");
        savedImages.push({
            id: `${Date.now().toString(36)}-${index}`,
            createdAt,
            fileName,
            savedPath,
            metadataPath,
            dataUrl: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
            mimeType: image.mimeType,
            byteLength: image.data.byteLength,
            seed: buildResult.seed,
            width: buildResult.width,
            height: buildResult.height,
            model: buildResult.model,
            prompt: buildResult.prompt,
            negativePrompt: buildResult.negativePrompt,
        });
    }

    return {
        images: savedImages,
        request: {
            model: buildResult.model,
            requestedModel: buildResult.requestedModel,
            action: buildResult.action,
            prompt: buildResult.prompt,
            negativePrompt: buildResult.negativePrompt,
            seed: buildResult.seed,
            width: buildResult.width,
            height: buildResult.height,
            steps: buildResult.steps,
            sampler: buildResult.sampler,
            savedDirectory: outputDirectory,
            parameters: buildResult.parameters,
        },
        warnings,
    };
}

async function buildNovelAiRequest(input: TextToImageGenerateRequest, token: string, warnings: string[]): Promise<NovelAiRequestBuildResult> {
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
    const sampler = mapSamplerForModel(input.novelAi.sampler.trim() || "k_euler_ancestral", model);
    if (sampler !== input.novelAi.sampler) {
        warnings.push(`采样方法已按模型兼容性映射为 ${sampler}。`);
    }

    const basePrompt = mergePromptParts(
        input.style?.positivePrefix,
        shouldInlineCharacterPrompt(input) ? buildCharacterPrompt(input.character) : "",
        input.prompt,
        input.style?.positiveSuffix,
    );
    if (!basePrompt) {
        throw new Error("正面 prompt 不能为空");
    }
    const prompt = input.style?.positiveQualityPreset === false
        ? basePrompt
        : applyQualityTags(basePrompt, model);
    const baseNegativePrompt = mergePromptParts(input.style?.negativePrefix, input.negativePrompt, input.style?.negativeSuffix);
    const preset = resolveNegativePreset(model, input.style?.negativeQualityPreset ?? "none");
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
        n_samples: 1,
        ucPreset: preset.ucPreset,
        qualityToggle: input.style?.positiveQualityPreset ?? true,
        autoSmea: false,
        dynamic_thresholding: false,
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

    if (isV4Model(model)) {
        applyV4PromptParameters(parameters, input, prompt, negativePrompt);
    } else {
        const isDdim = sampler.includes("ddim");
        const autoSmea = width * height > 1024 * 1024;
        parameters.sm = isDdim ? false : autoSmea;
        parameters.sm_dyn = false;
        parameters.uc = negativePrompt;
    }

    await applyVibeTransferParameters(parameters, input, model, token, warnings);

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

function applyV4PromptParameters(parameters: Record<string, unknown>, input: TextToImageGenerateRequest, prompt: string, negativePrompt: string): void {
    const characterPrompt = input.character ? buildCharacterPrompt(input.character) : "";
    const includeCharacter = Boolean(input.character && characterPrompt);
    const center = {x: 0.5, y: 0.5};
    const useCoords = !input.novelAi.aiDefaultCharacterPosition;
    const charCaptions = includeCharacter
        ? [{centers: [center], char_caption: characterPrompt}]
        : [];
    const negativeCharCaptions = includeCharacter
        ? [{centers: [center], char_caption: ""}]
        : [];

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
    parameters.characterPrompts = includeCharacter
        ? [{
            center,
            prompt: characterPrompt,
            uc: "",
            enabled: true,
        }]
        : [];
}

async function applyVibeTransferParameters(parameters: Record<string, unknown>, input: TextToImageGenerateRequest, model: string, token: string, warnings: string[]): Promise<void> {
    const references = (input.style?.vibeReferences ?? []).filter((reference) => reference.enabled);
    if (references.length === 0) {
        return;
    }

    const encodings: string[] = [];
    const strengths: number[] = [];
    const infoExtracted: number[] = [];
    for (const reference of references) {
        let encoding = reference.vibeEncoding.trim();
        if (!encoding && reference.imageDataUrl.trim()) {
            try {
                encoding = await encodeVibeReference(input.novelAi.imageBaseUrl, token, reference.imageDataUrl, model, reference.infoExtracted);
            } catch (error) {
                warnings.push(`${reference.displayName || "Vibe"} 编码失败，已跳过：${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (!encoding) {
            continue;
        }
        encodings.push(encoding);
        strengths.push(clampNumber(reference.strength, 0, 1, 0.6));
        infoExtracted.push(clampNumber(reference.infoExtracted, 0, 1, 0.7));
    }

    if (encodings.length === 0) {
        return;
    }

    parameters.normalize_reference_strength_multiple = true;
    parameters.reference_image_multiple = encodings;
    parameters.reference_strength_multiple = strengths;
    parameters.reference_information_extracted_multiple = infoExtracted;
}

async function encodeVibeReference(imageBaseUrl: string, token: string, imageDataUrl: string, model: string, informationExtracted: number): Promise<string> {
    const imageBase64 = readImageDataUrlBase64(imageDataUrl);
    const response = await postNovelAiJson(imageBaseUrl, "/ai/encode-vibe", token, {
        image: imageBase64,
        model,
        informationExtracted,
    }, {});
    return Buffer.from(await response.arrayBuffer()).toString("base64");
}

async function postNovelAiJson(baseUrl: string, endpoint: string, token: string, data: unknown, extraHeaders: Record<string, string>): Promise<Response> {
    const url = `${baseUrl.trim().replace(/\/+$/u, "")}${endpoint}`;
    const response = await fetch(url, await withBrowserProxyForFetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...extraHeaders,
        },
        body: JSON.stringify(data),
    }));

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`NovelAI 请求失败：${response.status}${text ? ` ${text.slice(0, 500)}` : ""}`);
    }

    return response;
}

async function resolveOutputDirectory(inputPath: string): Promise<string> {
    const trimmedPath = inputPath.trim();
    const outputDirectory = trimmedPath
        ? path.resolve(trimmedPath)
        : path.join(resolveUserHomeDirectory(), "Pictures", "NeuroBook", "NovelAI");
    if (trimmedPath && !path.isAbsolute(trimmedPath)) {
        throw new Error("图片保存路径必须是本地绝对路径");
    }

    await fs.mkdir(outputDirectory, {recursive: true});
    const stat = await fs.stat(outputDirectory);
    if (!stat.isDirectory()) {
        throw new Error("图片保存路径不是文件夹");
    }
    return outputDirectory;
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

function resolveNegativePreset(model: string, preset: NegativeQualityPreset): {ucPreset: number; content: string} {
    const modelPresets = NEGATIVE_PRESETS[model] ?? NEGATIVE_PRESETS["nai-diffusion-3"];
    return modelPresets?.[preset] ?? modelPresets?.none ?? {ucPreset: 3, content: ""};
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
    return !isV4Model(requestedModel);
}

function mergePromptParts(...parts: Array<string | null | undefined>): string {
    return parts
        .map((part) => (part ?? "").trim().replace(/^,+|,+$/gu, ""))
        .filter((part) => part.length > 0)
        .join(", ");
}

function applyQualityTags(prompt: string, model: string): string {
    const tags = QUALITY_TAGS_BY_MODEL[model];
    if (!tags) {
        return prompt;
    }
    return mergePromptParts(prompt, tags);
}

function mapSamplerForModel(sampler: string, model: string): string {
    if (sampler === "ddim" || sampler === "ddim_v3") {
        if (model.includes("diffusion-3")) {
            return "ddim_v3";
        }
        if (isV4Model(model)) {
            return "k_euler_ancestral";
        }
    }
    return sampler;
}

function normalizeNoiseSchedule(noiseSchedule: string, model: string): string {
    if (isV4Model(model) && noiseSchedule === "native") {
        return "karras";
    }
    return noiseSchedule || "karras";
}

function isV4Model(model: string): boolean {
    return model.includes("diffusion-4") || model.includes("diffusion-4-5");
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

function readImageDataUrlBase64(dataUrl: string): string {
    const match = dataUrl.trim().match(/^data:[^;]+;base64,(.+)$/u);
    if (match?.[1]) {
        return match[1].trim();
    }
    return dataUrl.trim();
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

function buildImageFileName(createdAt: string, seed: number, index: number, extension: string): string {
    const timestamp = createdAt.replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
    return `neurobook-nai-${timestamp}-seed-${seed}-${String(index + 1).padStart(2, "0")}.${extension}`;
}

function resolveUserHomeDirectory(): string {
    return process.env.USERPROFILE || process.env.HOME || process.cwd();
}
