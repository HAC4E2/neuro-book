import {NovelAiProviderModelIdSchema, type NovelAiProviderModelId} from "nbook/shared/text-to-image-provider-registry";
import type {TextToImageRecipeStyle} from "nbook/shared/text-to-image-recipe";

export type NovelAiNegativeQualityPreset = TextToImageRecipeStyle["negativeQualityPreset"];

const QUALITY_TAGS: Record<NovelAiProviderModelId, string> = {
    "nai-diffusion-4-5-full": "very aesthetic, masterpiece, no text",
    "nai-diffusion-4-5-curated": "very aesthetic, masterpiece, no text, -0.8::feet::, rating:general",
    "nai-diffusion-4-full": "no text, best quality, very aesthetic, absurdres",
    "nai-diffusion-4-curated-preview": "rating:general, best quality, very aesthetic, absurdres",
    "nai-diffusion-3": "best quality, amazing quality, very aesthetic, absurdres",
    "nai-diffusion-furry-3": "{best quality}, {amazing quality}",
};

const NEGATIVE_PRESETS: Record<NovelAiProviderModelId, Partial<Record<NovelAiNegativeQualityPreset, {ucPreset: number; content: string}>>> = {
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

/** 内置 Provider Grammar 的正向 quality 控制串。 */
export function novelAiQualityTags(modelInput: string): string {
    return QUALITY_TAGS[NovelAiProviderModelIdSchema.parse(modelInput)];
}

/** 内置 Provider Grammar 的负向 UC preset 与控制串；缺失组合稳定回退到该模型 none。 */
export function resolveNovelAiNegativePreset(
    modelInput: string,
    preset: NovelAiNegativeQualityPreset,
): {ucPreset: number; content: string} {
    const model = NovelAiProviderModelIdSchema.parse(modelInput);
    return NEGATIVE_PRESETS[model][preset] ?? NEGATIVE_PRESETS[model].none ?? {ucPreset: 3, content: ""};
}
