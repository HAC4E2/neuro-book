import {z} from "zod";
import {withBrowserProxyForFetch} from "nbook/server/utils/browser-proxy";

const TextToImageLlmTextContentPartSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
});

const TextToImageLlmImageContentPartSchema = z.object({
    type: z.literal("image_url"),
    image_url: z.object({
        url: z.string(),
    }),
});

const TextToImageLlmMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.union([
        z.string(),
        z.array(z.union([TextToImageLlmTextContentPartSchema, TextToImageLlmImageContentPartSchema])),
    ]),
});

export const TextToImageLlmModelsRequestSchema = z.object({
    apiBaseUrl: z.string().trim().min(1),
    apiKey: z.string().default(""),
});

export const TextToImageLlmCompletionRequestSchema = z.object({
    apiBaseUrl: z.string().trim().min(1),
    apiKey: z.string().default(""),
    model: z.string().trim().min(1),
    parameters: z.object({
        temperature: z.number().default(0.7),
        topP: z.number().default(1),
        maxTokens: z.number().int().positive().default(4096),
    }),
    stream: z.boolean().default(false),
    messages: z.array(TextToImageLlmMessageSchema).min(1),
});

export type TextToImageLlmModelsRequest = z.infer<typeof TextToImageLlmModelsRequestSchema>;
export type TextToImageLlmCompletionRequest = z.infer<typeof TextToImageLlmCompletionRequestSchema>;
export type TextToImageLlmCompletionResponse = {
    content: string;
};

type ModelListEntry = string | {
    id?: string;
    model?: string;
    name?: string;
};

type ModelListResponse = ModelListEntry[] | {
    data?: ModelListEntry[];
    models?: ModelListEntry[];
};

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

/**
 * 通过服务端统一读取 OpenAI-compatible 模型列表，避免前端直连带来的 CORS 与代理差异。
 */
export async function listTextToImageLlmModels(input: TextToImageLlmModelsRequest, fetchImpl: typeof fetch = fetch): Promise<string[]> {
    const url = `${normalizeApiBaseUrl(input.apiBaseUrl)}/models`;
    const headers = buildAuthorizationHeaders(input.apiKey);
    const response = await requestWithOptionalBrowserProxy(fetchImpl, url, {
        method: "GET",
        headers,
    });
    if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new Error(message || `LLM 模型列表读取失败：${response.status}`);
    }
    const data = await response.json() as ModelListResponse;
    const entries = Array.isArray(data)
        ? data
        : [
            ...(data.data ?? []),
            ...(data.models ?? []),
        ];
    const models = entries
        .map((entry) => typeof entry === "string" ? entry : entry.id ?? entry.model ?? entry.name ?? "")
        .map((model) => model.trim())
        .filter((model) => model.length > 0);
    return Array.from(new Set(models)).sort((left, right) => left.localeCompare(right));
}

/**
 * 通过服务端统一发送 OpenAI-compatible chat completion 请求。
 */
export async function requestTextToImageLlmCompletion(
    input: TextToImageLlmCompletionRequest,
    fetchImpl: typeof fetch = fetch,
): Promise<string> {
    const url = `${normalizeApiBaseUrl(input.apiBaseUrl)}/chat/completions`;
    const response = await requestWithOptionalBrowserProxy(fetchImpl, url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...buildAuthorizationHeaders(input.apiKey),
        },
        body: JSON.stringify({
            model: input.model.trim(),
            temperature: input.parameters.temperature,
            top_p: input.parameters.topP,
            max_tokens: input.parameters.maxTokens,
            stream: input.stream,
            messages: input.messages,
        }),
    });
    if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new Error(message || `LLM 请求失败：${response.status}`);
    }
    if (input.stream) {
        return await readStreamingResponse(response);
    }
    const data = await response.json() as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
    return apiBaseUrl.trim().replace(/\/+$/u, "");
}

function buildAuthorizationHeaders(apiKey: string): Record<string, string> {
    const token = apiKey.trim();
    return token ? {Authorization: `Bearer ${token}`} : {};
}

async function requestWithOptionalBrowserProxy(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
    const resolvedInit = fetchImpl === fetch ? await withBrowserProxyForFetch(url, init) : init;
    return await fetchImpl(url, resolvedInit);
}

async function readStreamingResponse(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
        return "";
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) {
                continue;
            }
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") {
                continue;
            }
            try {
                const json = JSON.parse(payload) as {choices?: Array<{delta?: {content?: string}; message?: {content?: string}}>};
                output += json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
            } catch {
                output += payload;
            }
        }
    }
    return output.trim();
}
