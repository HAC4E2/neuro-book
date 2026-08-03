export type NovelAiQualityInput = {
    model: string;
    positiveEnabled: boolean;
    negativePreset: string;
};

export type NovelAiQualityResult = {
    aqt: string;
    ucp: string;
};

/** 按模型解析 NovelAI AQT/UCP 质量预设，与 chatu8 内置映射对齐。 */
export function resolveNovelAiQualityPresets(input: NovelAiQualityInput): NovelAiQualityResult {
    const model = input.model;
    const aqt = input.positiveEnabled
        ? resolveAqt(model)
        : "";
    const ucp = resolveUcp(model, input.negativePreset);
    return {aqt, ucp};
}

function resolveAqt(model: string): string {
    if (model === "nai-diffusion-4-curated-preview") {
        return "rating:general, best quality, very aesthetic, absurdres";
    }
    if (model === "nai-diffusion-4-full") {
        return "no text, best quality, very aesthetic, absurdres";
    }
    if (model === "nai-diffusion-4-5-full") {
        return "very aesthetic, masterpiece, no text";
    }
    if (model === "nai-diffusion-4-5-curated") {
        return "very aesthetic, masterpiece, no text, -0.8::feet::, rating:general";
    }
    return "best quality, amazing quality, very aesthetic, absurdres";
}

function resolveUcp(model: string, preset: string): string {
    const key = `${model}:${preset}`;
    const table: Record<string, string> = {
        "nai-diffusion-3:Heavy": "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
        "nai-diffusion-3:Light": "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing",
        "nai-diffusion-3:Human Focus": "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes",
        "nai-diffusion-4-full:Heavy": "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page",
        "nai-diffusion-4-full:Light": "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page",
        "nai-diffusion-4-curated-preview:Heavy": "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page",
        "nai-diffusion-4-curated-preview:Light": "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page",
        "nai-diffusion-4-5-curated:Human Focus": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page",
        "nai-diffusion-4-5-curated:Heavy": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
        "nai-diffusion-4-5-curated:Light": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
        "nai-diffusion-4-5-full:Human Focus": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
        "nai-diffusion-4-5-full:Heavy": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
        "nai-diffusion-4-5-full:Light": "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
        "nai-diffusion-4-5-full:Furry Focus": "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic",
    };
    return table[key] ?? "";
}
