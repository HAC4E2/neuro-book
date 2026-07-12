import {describe, expect, it, vi} from "vitest";
import {
    listTextToImageLlmModels,
    requestTextToImageLlmCompletion,
    TextToImageLlmCompletionRequestSchema,
    TextToImageLlmModelsRequestSchema,
} from "nbook/server/text-to-image/llm-provider";

describe("text-to-image LLM provider", () => {
    it("lists OpenAI-compatible models through the server adapter", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: [{id: "zeta"}, {id: "alpha"}],
            models: ["alpha", {name: "beta"}],
        })));

        const models = await listTextToImageLlmModels({
            baseUrl: "https://llm.example/v1/",
            credential: "secret",
            allowPrivateNetwork: false,
        }, fetchImpl as unknown as typeof fetch);

        expect(models).toEqual(["alpha", "beta", "zeta"]);
        expect(fetchImpl).toHaveBeenCalledWith("https://llm.example/v1/models", {
            method: "GET",
            headers: {
                Authorization: "Bearer secret",
            },
        }, {allowPrivateNetwork: false});
    });

    it("requests chat completions and returns assistant text", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{message: {content: "  <image>sunlit room</image>  "}}],
        })));

        const content = await requestTextToImageLlmCompletion({
            baseUrl: "https://llm.example/v1",
            credential: "",
            allowPrivateNetwork: false,
            model: "writer-model",
            parameters: {
                temperature: 0.4,
                topP: 0.8,
                maxTokens: 1200,
            },
            stream: false,
            messages: [
                {role: "system", content: "You write image prompts."},
                {role: "user", content: "chapter text"},
            ],
        }, fetchImpl as unknown as typeof fetch);

        expect(content).toBe("<image>sunlit room</image>");
        expect(await readRequestBody(fetchImpl.mock.calls[0]?.[1]?.body)).toEqual({
            model: "writer-model",
            temperature: 0.4,
            top_p: 0.8,
            max_tokens: 1200,
            stream: false,
            messages: [
                {role: "system", content: "You write image prompts."},
                {role: "user", content: "chapter text"},
            ],
        });
        expect(fetchImpl.mock.calls[0]?.[2]).toEqual({allowPrivateNetwork: false});
    });

    it("rejects legacy secret-bearing public request fields", () => {
        expect(TextToImageLlmModelsRequestSchema.safeParse({
            providerId: 1,
            apiKey: "secret",
        }).success).toBe(false);
        expect(TextToImageLlmCompletionRequestSchema.safeParse({
            providerId: 1,
            apiBaseUrl: "https://attacker.example/v1",
            model: "model",
            parameters: {temperature: 0.7, topP: 1, maxTokens: 100},
            stream: false,
            messages: [{role: "user", content: "hello"}],
        }).success).toBe(false);
    });

    it("does not include an upstream credential echo in errors", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response("Bearer server-only-token", {
            status: 500,
        }));

        const request = listTextToImageLlmModels({
            baseUrl: "https://llm.example/v1",
            credential: "server-only-token",
            allowPrivateNetwork: false,
        }, fetchImpl as unknown as typeof fetch);

        await expect(request).rejects.toThrow("LLM 模型列表请求失败");
        await expect(request).rejects.not.toThrow("server-only-token");
    });
});

async function readRequestBody(body: unknown): Promise<unknown> {
    if (typeof body !== "string") {
        return null;
    }
    return JSON.parse(body);
}
