import {z} from "zod";
import {
    fetchTextToImageProvider,
    type TextToImageProviderFetch,
} from "nbook/server/text-to-image/provider-fetch";

const TextToImageLlmTextContentPartSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
}).strict();

const TextToImageLlmImageContentPartSchema = z.object({
    type: z.literal("image_url"),
    image_url: z.object({
        url: z.string(),
    }).strict(),
}).strict();

const TextToImageLlmMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.union([
        z.string(),
        z.array(z.union([TextToImageLlmTextContentPartSchema, TextToImageLlmImageContentPartSchema])),
    ]),
}).strict();

export const TextToImageLlmModelsRequestSchema = z.object({
    providerId: z.number().int().positive(),
}).strict();

export const TextToImageLlmCompletionRequestSchema = z.object({
    providerId: z.number().int().positive(),
    model: z.string().trim().min(1),
    parameters: z.object({
        temperature: z.number().default(0.7),
        topP: z.number().default(1),
        maxTokens: z.number().int().positive().default(4096),
    }).strict(),
    stream: z.boolean().default(false),
    messages: z.array(TextToImageLlmMessageSchema).min(1),
}).strict();

export type TextToImageLlmModelsRequest = z.infer<typeof TextToImageLlmModelsRequestSchema>;
export type TextToImageLlmCompletionRequest = z.infer<typeof TextToImageLlmCompletionRequestSchema>;
export type TextToImageLlmCompletionResponse = {
    content: string;
};

/** 仅在服务端内部传递的已解析 Provider 连接信息。 */
export type TextToImageLlmProviderConnection = {
    baseUrl: string;
    credential: string;
    allowPrivateNetwork: boolean;
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
export async function listTextToImageLlmModels(
    input: TextToImageLlmProviderConnection,
    fetchImpl: TextToImageProviderFetch = fetchTextToImageProvider,
): Promise<string[]> {
    const url = `${normalizeApiBaseUrl(input.baseUrl)}/models`;
    const headers = buildAuthorizationHeaders(input.credential);
    const response = await fetchImpl(url, {
        method: "GET",
        headers,
    }, {allowPrivateNetwork: input.allowPrivateNetwork});
    if (!response.ok) {
        throw new Error(`LLM 模型列表请求失败（状态 ${response.status}）`);
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
    input: TextToImageLlmProviderConnection & Pick<TextToImageLlmCompletionRequest, "model" | "parameters" | "stream" | "messages">,
    fetchImpl: TextToImageProviderFetch = fetchTextToImageProvider,
): Promise<string> {
    const url = `${normalizeApiBaseUrl(input.baseUrl)}/chat/completions`;
    const response = await fetchImpl(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...buildAuthorizationHeaders(input.credential),
        },
        body: JSON.stringify({
            model: input.model.trim(),
            temperature: input.parameters.temperature,
            top_p: input.parameters.topP,
            max_tokens: input.parameters.maxTokens,
            stream: input.stream,
            messages: input.messages,
        }),
    }, {allowPrivateNetwork: input.allowPrivateNetwork});
    if (!response.ok) {
        throw new Error(`LLM 补全请求失败（状态 ${response.status}）`);
    }
    if (input.stream) {
        return await readStreamingResponse(response);
    }
    const data = await response.json() as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
}

function normalizeApiBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/u, "");
}

function buildAuthorizationHeaders(credential: string): Record<string, string> {
    const token = credential.trim();
    return token ? {Authorization: `Bearer ${token}`} : {};
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
