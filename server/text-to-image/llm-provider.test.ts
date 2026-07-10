import {describe, expect, it, vi} from "vitest";
import {
    listTextToImageLlmModels,
    requestTextToImageLlmCompletion,
} from "nbook/server/text-to-image/llm-provider";

describe("text-to-image LLM provider", () => {
    it("lists OpenAI-compatible models through the server adapter", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: [{id: "zeta"}, {id: "alpha"}],
            models: ["alpha", {name: "beta"}],
        })));

        const models = await listTextToImageLlmModels({
            apiBaseUrl: "https://llm.example/v1/",
            apiKey: "secret",
        }, fetchImpl as unknown as typeof fetch);

        expect(models).toEqual(["alpha", "beta", "zeta"]);
        expect(fetchImpl).toHaveBeenCalledWith("https://llm.example/v1/models", {
            method: "GET",
            headers: {
                Authorization: "Bearer secret",
            },
        });
    });

    it("requests chat completions and returns assistant text", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{message: {content: "  <image>sunlit room</image>  "}}],
        })));

        const content = await requestTextToImageLlmCompletion({
            apiBaseUrl: "https://llm.example/v1",
            apiKey: "",
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
    });
});

async function readRequestBody(body: unknown): Promise<unknown> {
    if (typeof body !== "string") {
        return null;
    }
    return JSON.parse(body);
}
