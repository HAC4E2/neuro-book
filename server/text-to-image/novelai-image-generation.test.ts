import {describe, expect, it, vi} from "vitest";
import {requestNovelAiImages, type NovelAiImageInput} from "nbook/server/text-to-image/novelai-image-generation";
import type {LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";
import {NovelAiRequestScheduler} from "nbook/server/text-to-image/novelai-request-scheduler";

describe("requestNovelAiImages", () => {
    it("encodes structured character slots in the NAI4.5 v4 prompt", async () => {
        const calls: Array<{init: RequestInit}> = [];
        const fetchImpl: LlmFetchImpl = async (_value, init) => {
            calls.push({init});
            return new Response(JSON.stringify({images: [Buffer.from([1]).toString("base64")]}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        };

        await requestNovelAiImages(input({
            fetchImpl,
            characterPrompts: [{
                prompt: "1girl, blue eyes",
                negativePrompt: "blurry",
                centerX: 0.3,
                centerY: 0.5,
            }],
        }));

        const body = JSON.parse(String(calls[0]?.init.body)) as {
            parameters: {
                v4_prompt: {caption: {char_captions: Array<{char_caption: {base_caption: string}; centers: Array<{x: number; y: number}>}>}};
                v4_negative_prompt: {caption: {char_captions: Array<{char_caption: {base_caption: string}}>}};
            };
        };
        expect(body.parameters.v4_prompt.caption.char_captions).toEqual([{
            char_caption: {base_caption: "1girl, blue eyes"},
            centers: [{x: 0.3, y: 0.5}],
        }]);
        expect(body.parameters.v4_negative_prompt.caption.char_captions).toEqual([{
            char_caption: {base_caption: "blurry"},
        }]);
    });

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

    it("sends the original image, mask, and strength for inpaint", async () => {
        const calls: Array<{url: string; init: RequestInit}> = [];
        const fetchImpl: LlmFetchImpl = async (value, init) => {
            calls.push({url: value.toString(), init});
            return new Response(JSON.stringify({
                images: [Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")],
            }), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        };
        const resolver = {
            readReference: async (relativePath: string): Promise<Uint8Array> => (
                relativePath === "assets/tti/original.png"
                    ? new Uint8Array([1, 2, 3])
                    : new Uint8Array([4, 5, 6])
            ),
        };

        await requestNovelAiImages(input({
            fetchImpl,
            inpaint: {
                imageId: "assets/tti/original.png",
                maskId: "assets/tti-masks/mask.png",
                strength: 0.42,
            },
        }), resolver);

        const body = JSON.parse(String(calls[0]?.init.body)) as {
            parameters: {
                image: string;
                mask: string;
                inpaintImg2ImgStrength: number;
            };
        };
        expect(body.parameters).toMatchObject({
            image: Buffer.from([1, 2, 3]).toString("base64"),
            mask: Buffer.from([4, 5, 6]).toString("base64"),
            inpaintImg2ImgStrength: 0.42,
        });
    });

    it("同一个调度器串行安排两次 NovelAI 生图请求", async () => {
        vi.useFakeTimers();
        try {
            const scheduler = new NovelAiRequestScheduler();
            const calls: string[] = [];
            const fetchImpl: LlmFetchImpl = async () => {
                calls.push("request");
                return new Response(JSON.stringify({images: [Buffer.from([1]).toString("base64")]}), {
                    status: 200,
                    headers: {"content-type": "application/json"},
                });
            };
            const first = requestNovelAiImages(input({fetchImpl, scheduler, requestIntervalMs: 15_000}));
            const second = requestNovelAiImages(input({fetchImpl, scheduler, requestIntervalMs: 15_000}));

            await vi.advanceTimersByTimeAsync(0);
            await first;
            expect(calls).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(14_999);
            expect(calls).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1);
            await second;
            expect(calls).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
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
        requestIntervalMs: 15_000,
        scheduler: new NovelAiRequestScheduler({sleep: async () => {}}),
        ...overrides,
    };
}
