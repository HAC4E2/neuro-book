import {fetchTextToImageProvider} from "nbook/server/text-to-image/provider-fetch";
import type {LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";

export type NovelAiImageInput = {
    credential: string;
    baseUrl: string;
    model: string;
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    seed: number;
    sampler: string;
    noiseSchedule: string;
    scale: number;
    cfgRescale: number;
    smea: boolean;
    smeaDyn: boolean;
    variety: boolean;
    decrisp: boolean;
    aiDefaultCharacterPosition: boolean;
    signal?: AbortSignal;
    /** 测试注入；生产由 provider-fetch 使用默认 fetch。 */
    fetchImpl?: LlmFetchImpl;
};

/**
 * NovelAI `/ai/generate-image` JSON 直调。
 * 响应 `images` 为 base64 图片数组；安全出站复用 provider-fetch。
 */
export async function requestNovelAiImages(input: NovelAiImageInput): Promise<Uint8Array[]> {
    const body = {
        input: input.prompt,
        model: input.model,
        action: "generate",
        parameters: {
            width: input.width,
            height: input.height,
            steps: input.steps,
            seed: input.seed,
            scale: input.scale,
            cfg_rescale: input.cfgRescale,
            sampler: input.sampler,
            noise_schedule: input.noiseSchedule,
            negative_prompt: input.negativePrompt,
            sm: input.smea,
            sm_dyn: input.smeaDyn,
            variety: input.variety,
            decrisp: input.decrisp,
            legacy: false,
            ai_default_character_position: input.aiDefaultCharacterPosition,
        },
        use_new_shared_trial: true,
    };
    const baseUrl = input.baseUrl.replace(/\/+$/u, "");
    const response = await fetchTextToImageProvider(
        `${baseUrl}/ai/generate-image`,
        {
            method: "POST",
            headers: {
                authorization: `Bearer ${input.credential}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: input.signal,
        },
        {allowPrivateNetwork: false},
        input.fetchImpl ? {fetchImpl: input.fetchImpl as never} : {},
    );
    if (!response.ok) {
        throw new Error(`NovelAI 生成失败：HTTP ${response.status}`);
    }
    const data = await response.json() as {images?: Array<string>};
    const images = data.images ?? [];
    if (images.length === 0) {
        throw new Error("NovelAI 未返回图片");
    }
    return images.map((base64) => Uint8Array.from(Buffer.from(base64, "base64")));
}
