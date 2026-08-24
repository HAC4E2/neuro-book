import {describe, expect, it, vi} from "vitest";
import {
    requestNovelAiImages,
    resolveNovelAiRequestSeed,
    type NovelAiImageInput,
} from "nbook/server/text-to-image/novelai-image-generation";
import type {LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";
import {NovelAiRequestScheduler} from "nbook/server/text-to-image/novelai-request-scheduler";
import type {NovelAiProxyResolver} from "nbook/server/text-to-image/novelai-proxy";

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
                v4_prompt: {caption: {char_captions: Array<{char_caption: string; centers: Array<{x: number; y: number}>}>}};
                v4_negative_prompt: {caption: {char_captions: Array<{char_caption: string; centers: Array<{x: number; y: number}>}>}};
            };
        };
        expect(body.parameters.v4_prompt.caption.char_captions).toEqual([{
            char_caption: "1girl, blue eyes",
            centers: [{x: 0.3, y: 0.5}],
        }]);
        expect(body.parameters.v4_negative_prompt.caption.char_captions).toEqual([{
            char_caption: "blurry",
            centers: [{x: 0.3, y: 0.5}],
        }]);
    });

    it("disables coordinate mode when a structured character has no center", async () => {
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
            aiDefaultCharacterPosition: false,
            characterPrompts: [
                {prompt: "left character", negativePrompt: "", centerX: 0.3, centerY: 0.5},
                {prompt: "right character", negativePrompt: ""},
            ],
        }));

        const body = JSON.parse(String(calls[0]?.init.body)) as {
            parameters: {
                use_coords: boolean;
                v4_prompt: {
                    use_coords: boolean;
                    caption: {char_captions: Array<Record<string, unknown>>};
                };
            };
        };
        expect(body.parameters.use_coords).toBe(false);
        expect(body.parameters.v4_prompt.use_coords).toBe(false);
        expect(body.parameters.v4_prompt.caption.char_captions).toEqual([
            {char_caption: "left character", centers: [{x: 0.3, y: 0.5}]},
            {char_caption: "right character", centers: [{}]},
        ]);
    });

    it("includes a bounded NovelAI response detail for HTTP errors", async () => {
        const fetchImpl: LlmFetchImpl = async () => new Response(
            JSON.stringify({message: "invalid character centers"}),
            {status: 500, headers: {"content-type": "application/json"}},
        );

        await expect(requestNovelAiImages(input({fetchImpl}))).rejects.toThrow(
            "NovelAI 生成失败：HTTP 500：{\"message\":\"invalid character centers\"}",
        );
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
            parameters: {width: 832},
        });
        expect(body.parameters.seed).toBeGreaterThanOrEqual(0);
        expect(body.parameters.seed).toBeLessThanOrEqual(4294967295);
    });

    it("converts the reroll sentinel into a valid uint32 seed", () => {
        expect(resolveNovelAiRequestSeed(-1, () => 123456789)).toBe(123456789);
        expect(resolveNovelAiRequestSeed(42, () => 123456789)).toBe(42);
        expect(() => resolveNovelAiRequestSeed(-1, () => -1)).toThrow("随机 Seed 生成失败");
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
    it("uses one NovelAI dispatcher for Vibe encoding and image generation", async () => {
        const dispatcher = {kind: "novelai-dispatcher"};
        const dispatchersSeen: unknown[] = [];
        const fetchImpl: LlmFetchImpl = async (value, init) => {
            dispatchersSeen.push((init as RequestInit & {dispatcher?: unknown}).dispatcher);
            if (value.toString().endsWith("/encode-vibe")) {
                return new Response(new Uint8Array([1, 2, 3]), {status: 200});
            }
            return new Response(JSON.stringify({images: [Buffer.from([1]).toString("base64")]}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        };
        const proxyResolver: NovelAiProxyResolver = {
            resolveDispatcher: vi.fn(async () => dispatcher as never),
            invalidate: vi.fn(async () => {}),
        };

        await requestNovelAiImages(input({
            fetchImpl,
            proxyResolver,
            vibe: {
                enabled: true,
                imageId: "assets/tti/reference.png",
                informationExtracted: 0.3,
                referenceStrength: 0.6,
            },
        }), {
            readReference: async () => new Uint8Array([4, 5, 6]),
        });

        expect(dispatchersSeen).toEqual([dispatcher, dispatcher]);
        expect(proxyResolver.resolveDispatcher).toHaveBeenCalledTimes(1);
        expect(proxyResolver.invalidate).not.toHaveBeenCalled();
    });

    it("invalidates the NovelAI dispatcher only for connection failures", async () => {
        const dispatcher = {kind: "novelai-dispatcher"};
        const invalidate = vi.fn(async () => {});
        const fetchImpl: LlmFetchImpl = async () => {
            const error = new Error("Connect Timeout Error");
            Object.assign(error, {code: "UND_ERR_CONNECT_TIMEOUT"});
            throw error;
        };
        const proxyResolver: NovelAiProxyResolver = {
            resolveDispatcher: vi.fn(async () => dispatcher as never),
            invalidate,
        };

        await expect(requestNovelAiImages(input({fetchImpl, proxyResolver}))).rejects.toMatchObject({
            name: "TextToImageProviderConnectionError",
        });
        expect(invalidate).toHaveBeenCalledTimes(1);

        const httpErrorFetch: LlmFetchImpl = async () => new Response("rate limited", {status: 429});
        const httpErrorResolver: NovelAiProxyResolver = {
            resolveDispatcher: vi.fn(async () => dispatcher as never),
            invalidate: vi.fn(async () => {}),
        };
        await expect(requestNovelAiImages(input({
            fetchImpl: httpErrorFetch,
            proxyResolver: httpErrorResolver,
        }))).rejects.toMatchObject({status: 429});
        expect(httpErrorResolver.invalidate).not.toHaveBeenCalled();
    });

    it("V4.5 payload 不发送 sm/sm_dyn/decrisp，Decrisp 只映射 dynamic_thresholding", async () => {
        const calls: Array<{init: RequestInit}> = [];
        const fetchImpl: LlmFetchImpl = async (_value, init) => {
            calls.push({init});
            return new Response(JSON.stringify({images: [Buffer.from([1]).toString("base64")]}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        };
        await requestNovelAiImages(input({fetchImpl, model: "nai-diffusion-4-5-full", decrisp: true}));
        await requestNovelAiImages(input({fetchImpl, model: "nai-diffusion-4-5-curated", decrisp: false}));

        const full = JSON.parse(String(calls[0]?.init.body)) as {parameters: Record<string, unknown>};
        const curated = JSON.parse(String(calls[1]?.init.body)) as {parameters: Record<string, unknown>};
        expect(full.parameters.dynamic_thresholding).toBe(true);
        expect(curated.parameters.dynamic_thresholding).toBe(false);
        for (const body of [full.parameters, curated.parameters]) {
            expect(body).not.toHaveProperty("sm");
            expect(body).not.toHaveProperty("sm_dyn");
            expect(body).not.toHaveProperty("decrisp");
        }
    });

    it("V5 使用 params_version 4、native 与首发默认参数合同", async () => {
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
            model: "nai-diffusion-5-full",
            steps: Number.NaN,
            scale: Number.NaN,
            sampler: "",
            noiseSchedule: "native",
            variety: true,
            decrisp: true,
        }));

        const body = JSON.parse(String(calls[0]?.init.body)) as {model: string; use_new_shared_trial: boolean; parameters: Record<string, unknown>};
        expect(body.model).toBe("nai-diffusion-5-full");
        expect(body.use_new_shared_trial).toBe(true);
        expect(body.parameters).toMatchObject({
            params_version: 4,
            scale: 7,
            sampler: "k_euler_ancestral",
            steps: 23,
            noise_schedule: "native",
        });
        expect(body.parameters.skip_cfg_above_sigma).toEqual(expect.any(Number));
        expect(body.parameters).toHaveProperty("v4_prompt");
        expect(body.parameters).toHaveProperty("v4_negative_prompt");
        expect(body.parameters).not.toHaveProperty("variety");
        expect(body.parameters).not.toHaveProperty("dynamic_thresholding");
    });

    it("V5 Curated 尊重 DDIM、关闭质量开关和 Variety，不发送 V4.5 字段", async () => {
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
            model: "nai-diffusion-5-curated",
            sampler: "ddim_v3",
            noiseSchedule: "native",
            positiveQualityPreset: false,
            ucPreset: 4,
            variety: false,
        }));

        const body = JSON.parse(String(calls[0]?.init.body)) as {parameters: Record<string, unknown>};
        expect(body.parameters).toMatchObject({
            params_version: 4,
            sampler: "ddim_v3",
            noise_schedule: "native",
            qualityToggle: false,
            skip_cfg_above_sigma: null,
        });
        expect(body.parameters).not.toHaveProperty("variety");
        expect(body.parameters).not.toHaveProperty("dynamic_thresholding");
        expect(body.parameters).not.toHaveProperty("ai_default_character_position");
    });

    it("V5 在请求前拒绝启用的参考图，不调用 Vibe 编码或生图端点", async () => {
        const fetchImpl = vi.fn(async () => new Response("{}", {status: 200})) as unknown as LlmFetchImpl;
        await expect(requestNovelAiImages(input({
            fetchImpl,
            model: "nai-diffusion-5-curated",
            vibe: {enabled: true, imageId: "assets/tti/reference.png", informationExtracted: 0.3, referenceStrength: 0.6},
        }), {readReference: async () => new Uint8Array([1])})).rejects.toThrow("当前 V5 模型不支持所选参数：Vibe Transfer");
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("V5 局部重绘使用官方对应模型与 infill action", async () => {
        const calls: Array<{init: RequestInit}> = [];
        const fetchImpl: LlmFetchImpl = async (_value, init) => {
            calls.push({init});
            return new Response(JSON.stringify({images: [Buffer.from([1]).toString("base64")]}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        };
        const resolver = {readReference: async () => new Uint8Array([1, 2, 3])};
        for (const model of ["nai-diffusion-5-full", "nai-diffusion-5-curated"]) {
            await requestNovelAiImages(input({
                fetchImpl,
                model,
                inpaint: {imageId: "image.png", maskId: "mask.png", strength: 0.5},
            }), resolver);
        }
        const bodies = calls.map((call) => JSON.parse(String(call.init.body)) as {model: string; action: string});
        expect(bodies).toEqual([
            expect.objectContaining({model: "nai-diffusion-5-full-inpainting", action: "infill"}),
            expect.objectContaining({model: "nai-diffusion-4-5-curated-inpainting", action: "infill"}),
        ]);
    });

    it("拒绝 V5/V4.5 之外的模型", async () => {
        const fetchImpl: LlmFetchImpl = async () => new Response("{}", {status: 200});
        await expect(requestNovelAiImages(input({fetchImpl, model: "nai-diffusion-3"}))).rejects.toThrow(/V5\/V4\.5/u);
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
        variety: false,
        decrisp: false,
        aiDefaultCharacterPosition: true,
        requestIntervalMs: 15_000,
        scheduler: new NovelAiRequestScheduler({sleep: async () => {}}),
        ...overrides,
    };
}
