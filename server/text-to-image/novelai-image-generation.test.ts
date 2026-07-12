import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    generateNovelAiImage,
    requestNovelAiImages,
    TextToImageGenerateRequestSchema,
} from "nbook/server/text-to-image/novelai-image-generation";

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
