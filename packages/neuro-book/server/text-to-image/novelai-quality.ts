export type NovelAiQualityInput = {
    model: string;
    positiveEnabled: boolean;
    negativePreset: string;
};

export type NovelAiQualityResult = {
    aqt: string;
    ucp: string;
};

/** 解析 NAI V5/V4.5 Full/Curated 的 AQT/UCP；旧模型进入组装器前必须已规范化。 */
export function resolveNovelAiQualityPresets(input: NovelAiQualityInput): NovelAiQualityResult {
    const aqt = input.positiveEnabled ? resolveAqt(input.model) : "";
    const ucp = resolveUcp(input.model, input.negativePreset);
    return {aqt, ucp};
}

function resolveAqt(model: string): string {
    if (model === "nai-diffusion-5-full" || model === "nai-diffusion-5-curated") {
        return "";
    }
    if (model === "nai-diffusion-4-5-full") {
        return "very aesthetic, masterpiece, no text";
    }
    if (model === "nai-diffusion-4-5-curated") {
        return "very aesthetic, masterpiece, no text, -0.8::feet::, rating:general";
    }
    return "";
}

function resolveUcp(model: string, preset: string): string {
    const v5Heavy = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
    const v5Light = "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::";
    const v5HumanFocus = `${v5Heavy}, @_@, mismatched pupils, glowing eyes, bad anatomy`;
    const furryFocus = "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic";
    const table: Record<string, string> = {
        "nai-diffusion-5-full:Human Focus": v5HumanFocus,
        "nai-diffusion-5-full:Heavy": v5Heavy,
        "nai-diffusion-5-full:Light": v5Light,
        "nai-diffusion-5-full:Furry Focus": furryFocus,
        "nai-diffusion-5-curated:Human Focus": v5HumanFocus,
        "nai-diffusion-5-curated:Heavy": v5Heavy,
        "nai-diffusion-5-curated:Light": v5Light,
        "nai-diffusion-5-curated:Furry Focus": furryFocus,
        "nai-diffusion-4-5-curated:Human Focus": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page",
        "nai-diffusion-4-5-curated:Heavy": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
        "nai-diffusion-4-5-curated:Light": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
        "nai-diffusion-4-5-full:Human Focus": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
        "nai-diffusion-4-5-full:Heavy": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
        "nai-diffusion-4-5-full:Light": "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
        "nai-diffusion-4-5-full:Furry Focus": furryFocus,
    };
    return table[`${model}:${preset}`] ?? "";
}

/** 解析 NAI V5/V4.5 Full/Curated 的 ucPreset 数值；未知组合回退 Heavy。 */
export function resolveNovelAiUcPreset(model: string, preset: string): number {
    const table: Record<string, number> = {
        "nai-diffusion-5-full:Heavy": 0,
        "nai-diffusion-5-full:Light": 1,
        "nai-diffusion-5-full:Furry Focus": 2,
        "nai-diffusion-5-full:Human Focus": 3,
        "nai-diffusion-5-full:none": 4,
        "nai-diffusion-5-curated:Heavy": 0,
        "nai-diffusion-5-curated:Light": 1,
        "nai-diffusion-5-curated:Furry Focus": 2,
        "nai-diffusion-5-curated:Human Focus": 3,
        "nai-diffusion-5-curated:none": 4,
        "nai-diffusion-4-5-full:Heavy": 0,
        "nai-diffusion-4-5-full:Light": 1,
        "nai-diffusion-4-5-full:Furry Focus": 2,
        "nai-diffusion-4-5-full:Human Focus": 3,
        "nai-diffusion-4-5-full:none": 4,
        "nai-diffusion-4-5-curated:Heavy": 0,
        "nai-diffusion-4-5-curated:Light": 1,
        "nai-diffusion-4-5-curated:Human Focus": 2,
        "nai-diffusion-4-5-curated:none": 3,
    };
    return table[`${model}:${preset}`] ?? 0;
}
