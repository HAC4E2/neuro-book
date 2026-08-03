import {describe, expect, it} from "vitest";
import {requestNovelAiImages, type NovelAiImageInput} from "nbook/server/text-to-image/novelai-image-generation";
import type {LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";

describe("requestNovelAiImages", () => {
    it("发送 JSON 请求并解码 base64 images", async () => {
        const calls: Array<{url: string; init: RequestInit}> = [];
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
        const fetchImpl: LlmFetchImpl = async (value, init) => {
            calls.push({url: value.toString(), init});
            return new Response(JSON.stringify({images: [pngBase64]}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        };

        const images = await requestNovelAiImages(input({fetchImpl}));

        expect(images).toHaveLength(1);
        expect(Buffer.from(images[0]!).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
        expect(calls[0]?.url).toBe("https://image.novelai.net/ai/generate-image");
        const body = JSON.parse(String(calls[0]?.init.body)) as {
            input: string;
            model: string;
            action: string;
            parameters: {width: number; seed: number};
        };
        expect(body).toMatchObject({
            input: "1girl",
            model: "nai-diffusion-4-5-full",
            action: "generate",
            parameters: {width: 832, seed: -1},
        });
    });
});

function input(overrides: Partial<NovelAiImageInput>): NovelAiImageInput {
    return {
        credential: "pst-test",
        baseUrl: "https://image.novelai.net",
        model: "nai-diffusion-4-5-full",
        prompt: "1girl",
        negativePrompt: "blurry",
        width: 832,
        height: 1216,
        steps: 28,
        seed: -1,
        sampler: "k_euler_ancestral",
        noiseSchedule: "karras",
        scale: 5,
        cfgRescale: 0,
        smea: false,
        smeaDyn: false,
        variety: false,
        decrisp: false,
        aiDefaultCharacterPosition: true,
        ...overrides,
    };
}
