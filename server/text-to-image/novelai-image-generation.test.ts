import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    generateNovelAiImage,
    NovelAiHttpError,
    requestCompiledNovelAiImage,
    requestNovelAiImages,
    TextToImageGenerateRequestSchema,
    type CompiledNovelAiReferenceResolver,
} from "nbook/server/text-to-image/novelai-image-generation";
import {createIllustrationCompiledRequestHash, type IllustrationCompiledRequest} from "nbook/shared/text-to-image-execution";
import {resolveProviderCapability} from "nbook/shared/text-to-image-provider-registry";
import {illustrationCompiledRequestFixture} from "nbook/server/text-to-image/execution.test-fixtures";

const temporaryDirectories: string[] = [];

describe("NovelAI image generation", () => {
    afterEach(async () => {
        vi.unstubAllGlobals();
        await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
            await rm(directory, {recursive: true, force: true});
        }));
    });

    it("rejects token and image URL fields in the public request", () => {
        expect(TextToImageGenerateRequestSchema.safeParse({
            ...generateInput("C:/output"),
            novelAi: {
                ...generateInput("C:/output").novelAi,
                token: "cleartext-token",
                imageBaseUrl: "https://attacker.example",
            },
        }).success).toBe(false);
    });

    it("uses the resolved credential and fixed official endpoint", async () => {
        const fetchImpl = vi.fn(async () => new Response(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ])));
        vi.stubGlobal("fetch", fetchImpl);

        const result = await requestNovelAiImages(queueInput(), "provider-token", new AbortController().signal, fetchImpl as never);

        expect(fetchImpl).toHaveBeenCalledWith("https://image.novelai.net/ai/generate-image", expect.objectContaining({
            headers: expect.objectContaining({Authorization: "Bearer provider-token"}),
        }), expect.objectContaining({allowPrivateNetwork: false}));
        expect(result.images[0]).toMatchObject({
            mimeType: "image/png",
            width: 832,
            height: 1216,
            seed: 123,
        });
        expect(result.images[0]).not.toHaveProperty("dataUrl");
    });

    it("uses the Recipe-owned style and advanced NovelAI controls", async () => {
        const fetchImpl = vi.fn(async () => new Response(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ])));
        const input = {
            ...queueInput(),
            novelAi: {
                ...queueInput().novelAi,
                aiDefaultCharacterPosition: false,
                variety: true,
                smeaMode: "auto" as const,
                smeaDyn: false,
                decrisper: true,
            },
            style: {
                positivePrefix: "recipe prefix",
                positiveSuffix: "recipe suffix",
                negativePrefix: "recipe negative prefix",
                negativeSuffix: "recipe negative suffix",
                useFurryDataset: false,
                positiveQualityPreset: false,
                negativeQualityPreset: "none" as const,
            },
        };

        await requestNovelAiImages(input, "provider-token", new AbortController().signal, fetchImpl as never);

        const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
        expect(requestBody.input).toBe("recipe prefix, sunlit room, recipe suffix");
        expect(requestBody.parameters).toMatchObject({
            dynamic_thresholding: true,
            autoSmea: true,
            v4_prompt: {use_coords: true},
            v4_negative_prompt: {
                caption: {base_caption: "recipe negative prefix, recipe negative suffix"},
            },
        });
        expect(requestBody.parameters.skip_cfg_above_sigma).toBeTypeOf("number");
    });

    it("maps a strict CompiledRequest to exact NovelAI wire data without rebuilding prompt or seed", async () => {
        const fetchImpl = vi.fn(async () => new Response(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ])));
        const fixture = illustrationCompiledRequestFixture(0);
        const {compiledRequestHash: _oldHash, ...base} = fixture;
        const requestBase = {
            ...base,
            prompt: "exact compiled prompt",
            negativePrompt: "exact compiled negative",
            characterPrompts: [{
                characterId: "character-1",
                center: {x: 0.25, y: 0.75},
                prompt: "exact character prompt",
                negativePrompt: "exact character negative",
            }],
            parameters: {
                ...base.parameters,
                sampler: "k_euler_ancestral",
                noiseSchedule: "native-schedule",
                seed: 987654,
                aiDefaultCharacterPosition: false,
                qualityToggle: false,
                ucPreset: 2,
            },
        };
        const request = {...requestBase, compiledRequestHash: createIllustrationCompiledRequestHash(requestBase)};
        const random = vi.spyOn(Math, "random").mockImplementation(() => {
            throw new Error("CompiledRequest adapter 不得生成随机 seed");
        });

        const response = await requestCompiledNovelAiImage(request, "provider-token", new AbortController().signal, fetchImpl as never);

        expect(random).not.toHaveBeenCalled();
        random.mockRestore();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
        expect(body).toMatchObject({input: "exact compiled prompt", model: request.model, action: "generate"});
        expect(body.parameters).toMatchObject({
            sampler: "k_euler_ancestral",
            noise_schedule: "native-schedule",
            seed: 987654,
            n_samples: 1,
            qualityToggle: false,
            ucPreset: 2,
            negative_prompt: "exact compiled negative",
            v4_prompt: {
                caption: {
                    base_caption: "exact compiled prompt",
                    char_captions: [{centers: [{x: 0.25, y: 0.75}], char_caption: "exact character prompt"}],
                },
                use_coords: true,
            },
            v4_negative_prompt: {
                caption: {
                    base_caption: "exact compiled negative",
                    char_captions: [{centers: [{x: 0.25, y: 0.75}], char_caption: "exact character negative"}],
                },
            },
        });
        expect(response.request).toEqual({model: request.model, seed: 987654, compiledRequestHash: request.compiledRequestHash});
    });

    it("P5 参考资产：Vibe encoding 走缓存命中、Character Reference 与 Inpaint 蒙版读字节，wire 与 action=inpaint 就绪", async () => {
        const hash64 = "a".repeat(64);
        // encode-vibe 返回二进制；fetch 仅被 encode-vibe 调用（缓存命中时不调用）
        const fetchImpl = vi.fn(async () => new Response(new Uint8Array([0x01, 0x02, 0x03])));
        // 生成图片响应返回一张 PNG
        const generateFetch = vi.fn(async (_url: string, _init: unknown) => new Response(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ])));
        // 路由：/ai/encode-vibe 用 fetchImpl，/ai/generate-image 用 generateFetch
        const dispatchFetch = vi.fn(async (url: string, init: unknown) => {
            return String(url).includes("encode-vibe") ? fetchImpl(url, init) : generateFetch(url, init);
        });
        const resolver: CompiledNovelAiReferenceResolver = {
            readBytes: vi.fn(async (contentHash) => ({
                bytes: new Uint8Array([0x10, 0x20, 0x30 + contentHash.charCodeAt(0) % 10]),
                mimeType: contentHash === hash64 ? "image/png" : "image/png",
            })),
            findVibeEncoding: vi.fn(async () => new Uint8Array([0xaa, 0xbb])),  // 缓存命中
            storeVibeEncoding: vi.fn(async () => undefined),
        };
        const fixture = illustrationCompiledRequestFixture(0);
        const {compiledRequestHash: _old, ...base} = fixture;
        const requestBase = {
            ...base,
            references: {
                normalizeVibeStrengths: false,
                vibeReferences: [{contentHash: hash64, strength: 0.6, informationExtracted: 0.5}],
                characterReferences: [{contentHash: hash64, strength: 0.4, informationExtracted: null}],
                inpaint: {contentHash: hash64, strength: 1, informationExtracted: null},
            },
        };
        const request = {...requestBase, compiledRequestHash: createIllustrationCompiledRequestHash(requestBase)} as IllustrationCompiledRequest;

        const response = await requestCompiledNovelAiImage(request, "provider-token", new AbortController().signal, dispatchFetch as never, resolver);

        expect(response.request.model).toBe(request.model);
        expect(resolver.findVibeEncoding).toHaveBeenCalledWith(hash64, request.model, 0.5);
        expect(resolver.storeVibeEncoding).not.toHaveBeenCalled();  // 缓存命中不派生
        expect(fetchImpl).not.toHaveBeenCalled();  // 未走 encode-vibe
        expect(resolver.readBytes).toHaveBeenCalledWith(hash64);  // char-ref + inpaint 读字节
        const body = JSON.parse(String(generateFetch.mock.calls[0]?.[1]?.body));
        expect(body.action).toBe("inpaint");
        expect(body.parameters.normalize_reference_strength_multiple).toBe(false);
        expect(body.parameters.reference_image_multiple).toEqual([Buffer.from(new Uint8Array([0xaa, 0xbb])).toString("base64")]);
        expect(body.parameters.reference_strength_multiple).toEqual([0.6]);
        expect(body.parameters.reference_information_extracted_multiple).toEqual([0.5]);
        expect(body.parameters.use_character_reference).toBe(true);
        expect(body.parameters.character_reference_image_multiple).toHaveLength(1);
        expect(body.parameters.mask).toEqual(Buffer.from(new Uint8Array([0x10, 0x20, 0x37])).toString("base64"));
    });

    it("P5 参考资产：Vibe encoding 缓存未命中时调用 /ai/encode-vibe 派生并缓存", async () => {
        const hash64 = "b".repeat(64);
        const encodeFetch = vi.fn(async () => new Response(new Uint8Array([0xcc, 0xdd, 0xee])));
        const generateFetch = vi.fn(async () => new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
        const dispatchFetch = vi.fn(async (url: string, init: unknown) =>
            String(url).includes("encode-vibe") ? encodeFetch(url, init) : generateFetch(url, init));
        const resolver: CompiledNovelAiReferenceResolver = {
            readBytes: vi.fn(async () => ({bytes: new Uint8Array([0x01, 0x02]), mimeType: "image/png"})),
            findVibeEncoding: vi.fn(async () => null),  // 未命中
            storeVibeEncoding: vi.fn(async () => undefined),
        };
        const fixture = illustrationCompiledRequestFixture(0);
        const {compiledRequestHash: _old, ...base} = fixture;
        const requestBase = {
            ...base,
            references: {
                normalizeVibeStrengths: true,
                vibeReferences: [{contentHash: hash64, strength: 0.7, informationExtracted: 0.6}],
                characterReferences: [],
                inpaint: null,
            },
        };
        const request = {...requestBase, compiledRequestHash: createIllustrationCompiledRequestHash(requestBase)} as IllustrationCompiledRequest;

        await requestCompiledNovelAiImage(request, "provider-token", new AbortController().signal, dispatchFetch as never, resolver);

        expect(encodeFetch).toHaveBeenCalledTimes(1);
        const encodeBody = JSON.parse(String(encodeFetch.mock.calls[0]?.[1]?.body));
        expect(encodeBody.model).toBe(request.model);
        expect(encodeBody.informationExtracted).toBe(0.6);
        expect(resolver.storeVibeEncoding).toHaveBeenCalledWith(hash64, request.model, 0.6, expect.any(Uint8Array));
    });

    // P5-1 安全网：CompiledRequest 全部高级标量参数必须确定性地投影到 NovelAI wire。
    // 覆盖 Route B 唯一 paid adapter `requestCompiledNovelAiImage` 的 V4/V3 两条分支，
    // 防止后续 P5 reference 字段扩展时回归既有标量贯通。
    describe("CompiledRequest advanced parameters -> NovelAI wire", () => {
        function buildRequest(overrides: {
            model: string;
            parameters: Partial<typeof fixture.parameters>;
        }) {
            const {compiledRequestHash: _omit, ...base} = illustrationCompiledRequestFixture(0);
            const parameters = {...base.parameters, ...overrides.parameters};
            // capability snapshot 必须与 CompiledRequest model 绑定，V3 fixture 需重新解算。
            const capabilitySnapshot = resolveProviderCapability({kind: "novelai-model", modelId: overrides.model});
            const requestBase = {...base, model: overrides.model, capabilitySnapshot, parameters};
            return {...requestBase, compiledRequestHash: createIllustrationCompiledRequestHash(requestBase)};
        }

        async function captureWire(request: ReturnType<typeof buildRequest>) {
            const fetchImpl = vi.fn(async () => new Response(Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ])));
            await requestCompiledNovelAiImage(request, "provider-token", new AbortController().signal, fetchImpl as never);
            return JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {parameters: Record<string, unknown>};
        }

        let fixture: ReturnType<typeof illustrationCompiledRequestFixture>;
        beforeEach(() => {
            fixture = illustrationCompiledRequestFixture(0);
        });

        it("V4 variety=true 投影为 skip_cfg_above_sigma 数值，关闭时为 null", async () => {
            const off = await captureWire(buildRequest({
                model: "nai-diffusion-4-5-full",
                parameters: {variety: false},
            }));
            expect(off.parameters.skip_cfg_above_sigma).toBeNull();

            const on = await captureWire(buildRequest({
                model: "nai-diffusion-4-5-full",
                parameters: {variety: true},
            }));
            expect(on.parameters.skip_cfg_above_sigma).toBeTypeOf("number");
            expect(on.parameters.skip_cfg_above_sigma).toBeCloseTo(58 * Math.sqrt((4 * (832 / 8) * (1216 / 8)) / 63232), 6);
        });

        it("V4 smeaMode=auto 投影为 autoSmea=true 且不发送手动 sm/sm_dyn", async () => {
            const wire = await captureWire(buildRequest({
                model: "nai-diffusion-4-5-full",
                parameters: {smeaMode: "auto", smeaDyn: false},
            }));
            expect(wire.parameters).toMatchObject({autoSmea: true});
            expect(wire.parameters).not.toHaveProperty("sm");
            expect(wire.parameters).not.toHaveProperty("sm_dyn");
        });

        it("V4 decrisper=true 投影为 dynamic_thresholding=true", async () => {
            const wire = await captureWire(buildRequest({
                model: "nai-diffusion-4-5-full",
                parameters: {decrisper: true},
            }));
            expect(wire.parameters.dynamic_thresholding).toBe(true);
        });

        it("V4 aiDefaultCharacterPosition=false 投影为 use_coords=true", async () => {
            const wire = await captureWire(buildRequest({
                model: "nai-diffusion-4-5-full",
                parameters: {aiDefaultCharacterPosition: false},
            }));
            expect(wire.parameters.use_coords).toBe(true);
            expect(wire.parameters.v4_prompt.use_coords).toBe(true);
        });

        it("V4 qualityToggle/ucPreset 原样透传", async () => {
            const wire = await captureWire(buildRequest({
                model: "nai-diffusion-4-5-full",
                parameters: {qualityToggle: false, ucPreset: 2},
            }));
            expect(wire.parameters).toMatchObject({qualityToggle: false, ucPreset: 2});
        });

        it("V3 smeaMode=on+smeaDyn=true 投影为 sm/sm_dyn 且 autoSmea=false、无 v4_prompt", async () => {
            const wire = await captureWire(buildRequest({
                model: "nai-diffusion-3",
                parameters: {smeaMode: "on", smeaDyn: true},
            }));
            expect(wire.parameters).toMatchObject({autoSmea: false, sm: true, sm_dyn: true});
            expect(wire.parameters).not.toHaveProperty("v4_prompt");
            expect(wire.parameters).not.toHaveProperty("use_coords");
        });

        it("V3 smeaMode=off 投影为 sm=false、不发送 sm_dyn 之外的随机项", async () => {
            const wire = await captureWire(buildRequest({
                model: "nai-diffusion-3",
                parameters: {smeaMode: "off", smeaDyn: false},
            }));
            expect(wire.parameters).toMatchObject({autoSmea: false, sm: false, sm_dyn: false});
        });

        it("V3 decrisper/variety 与 V4 共用同一段投影", async () => {
            const wire = await captureWire(buildRequest({
                model: "nai-diffusion-3",
                parameters: {decrisper: true, variety: true},
            }));
            expect(wire.parameters).toMatchObject({dynamic_thresholding: true});
            expect(wire.parameters.skip_cfg_above_sigma).toBeTypeOf("number");
        });
    });

    it("does not hide retry for explicit NovelAI 429/5xx responses", async () => {
        const fetchImpl = vi.fn(async () => new Response("busy", {status: 503}));

        const result = requestCompiledNovelAiImage(
            illustrationCompiledRequestFixture(0),
            "provider-token",
            new AbortController().signal,
            fetchImpl as never,
        );

        await expect(result).rejects.toBeInstanceOf(NovelAiHttpError);
        await expect(result).rejects.toMatchObject({status: 503, retryable: true, code: "NOVELAI_HTTP_503"});
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("只在 V3 请求中发送手动 SMEA 与 SMEA Dyn", async () => {
        const fetchImpl = vi.fn(async () => new Response(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ])));
        const input = {
            ...queueInput(),
            novelAi: {
                ...queueInput().novelAi,
                model: "nai-diffusion-3",
                smeaMode: "on" as const,
                smeaDyn: true,
            },
        };

        await requestNovelAiImages(input, "provider-token", new AbortController().signal, fetchImpl as never);

        const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
        expect(requestBody.parameters).toMatchObject({
            autoSmea: false,
            sm: true,
            sm_dyn: true,
        });
        expect(requestBody.parameters).not.toHaveProperty("v4_prompt");
    });

    it("does not include an upstream credential echo in errors", async () => {
        const outputPath = await createOutputPath();
        const fetchImpl = vi.fn(async () => new Response("request-token", {status: 401}));
        vi.stubGlobal("fetch", fetchImpl);
        const input = {
            ...generateInput(outputPath),
            novelAi: {
                ...generateInput(outputPath).novelAi,
                token: "request-token",
                imageBaseUrl: "https://attacker.example",
            },
        };

        const request = generateNovelAiImage(input as never, "provider-token", fetchImpl as never);
        await expect(request).rejects.toThrow("NovelAI 请求失败：401");
        await expect(request).rejects.not.toThrow("request-token");
    });
});

function queueInput() {
    const input = generateInput("");
    return {
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        novelAi: {
            model: input.novelAi.model,
            sampler: input.novelAi.sampler,
            noiseSchedule: input.novelAi.noiseSchedule,
            promptGuidance: input.novelAi.promptGuidance,
            promptGuidanceRescale: input.novelAi.promptGuidanceRescale,
            width: input.novelAi.width,
            height: input.novelAi.height,
            steps: input.novelAi.steps,
            seed: input.novelAi.seed,
            count: input.count,
            aiDefaultCharacterPosition: input.novelAi.aiDefaultCharacterPosition,
            variety: input.novelAi.variety,
            smeaMode: input.novelAi.smeaMode,
            smeaDyn: input.novelAi.smeaDyn,
            decrisper: input.novelAi.decrisper,
        },
        style: {
            positivePrefix: "",
            positiveSuffix: "",
            negativePrefix: "",
            negativeSuffix: "",
            useFurryDataset: false,
            positiveQualityPreset: true,
            negativeQualityPreset: "none" as const,
        },
    };
}

function generateInput(outputPath: string) {
    return {
        providerId: 11,
        novelAi: {
            model: "nai-diffusion-4-5-full",
            sampler: "k_euler_ancestral",
            noiseSchedule: "karras",
            promptGuidance: 5,
            promptGuidanceRescale: 0,
            aiDefaultCharacterPosition: true,
            variety: false,
            smeaMode: "auto" as const,
            smeaDyn: false,
            decrisper: false,
            width: 832,
            height: 1216,
            steps: 28,
            seed: 123,
        },
        style: null,
        character: null,
        characters: [],
        outfits: [],
        promptRules: [],
        prompt: "sunlit room",
        negativePrompt: "",
        count: 1,
        output: {imageSavePath: outputPath},
    };
}

async function createOutputPath(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-novelai-generation-"));
    temporaryDirectories.push(directory);
    return directory;
}
