import {setTimeout as delay} from "node:timers/promises";
import {fetchTextToImageProvider} from "nbook/server/text-to-image/provider-fetch";

export type LlmChatContent = string | Array<Record<string, unknown>>;

export type LlmChatMessage = {
    role: "system" | "user" | "assistant";
    content: LlmChatContent;
};

/** 测试注入的 fetch；生产由 provider-fetch 使用默认实现。 */
export type LlmFetchImpl = (value: string, init: RequestInit) => Promise<Response>;

export type RequestLlmCompletionInput = {
    baseUrl: string;
    credential: string;
    model: string;
    messages: LlmChatMessage[];
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    stream?: boolean;
    sendImages?: boolean;
    mergeSystemUser?: boolean;
    retryCount?: number;
    signal?: AbortSignal;
    allowPrivateNetwork?: boolean;
    /** 测试注入；生产由 fetchTextToImageProvider 使用默认 fetch。 */
    fetchImpl?: LlmFetchImpl;
};

const RETRY_DELAY_MS = 2_000;
type ProviderFetchDependencies = NonNullable<Parameters<typeof fetchTextToImageProvider>[3]>;

/**
 * OpenAI 兼容 `/chat/completions` 直调。
 * 安全出站复用 provider-fetch 的 URL/DNS/重定向策略；429/5xx/空响应按 retryCount 重试。
 */
export async function requestLlmCompletion(input: RequestLlmCompletionInput): Promise<string> {
    const messages = prepareMessages(input.messages, {
        sendImages: input.sendImages ?? false,
        mergeSystemUser: input.mergeSystemUser ?? false,
    });
    const body = {
        model: input.model,
        temperature: input.temperature ?? 0.7,
        top_p: input.topP ?? 1,
        max_tokens: input.maxTokens ?? 512,
        stream: input.stream ?? false,
        messages,
    };
    const baseUrl = input.baseUrl.replace(/\/+$/u, "");
    const retryCount = input.retryCount ?? 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        const response = await fetchTextToImageProvider(
            `${baseUrl}/chat/completions`,
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${input.credential}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(body),
                signal: input.signal,
            },
            {allowPrivateNetwork: input.allowPrivateNetwork ?? false},
            input.fetchImpl ? {fetchImpl: input.fetchImpl as ProviderFetchDependencies["fetchImpl"]} : {},
        );

        if (response.status === 429 || response.status >= 500) {
            if (attempt < retryCount) {
                await delay(RETRY_DELAY_MS);
                continue;
            }
            throw new Error(`LLM 请求失败：HTTP ${response.status}`);
        }
        if (!response.ok) {
            throw new Error(`LLM 请求失败：HTTP ${response.status}`);
        }

        const content = input.stream
            ? await readSseContent(response)
            : await readJsonContent(response);
        if (content.trim() === "") {
            lastError = new Error("LLM 返回空响应");
            if (attempt < retryCount) {
                await delay(RETRY_DELAY_MS);
                continue;
            }
            throw lastError;
        }
        return content;
    }

    throw lastError ?? new Error("LLM 请求失败");
}

function prepareMessages(
    messages: LlmChatMessage[],
    options: {sendImages: boolean; mergeSystemUser: boolean},
): LlmChatMessage[] {
    const filtered = options.sendImages
        ? messages
        : messages.map((message) => ({
            ...message,
            content: stripImageContent(message.content),
        }));
    return options.mergeSystemUser ? mergeSystemUserMessages(filtered) : filtered;
}

function stripImageContent(content: LlmChatContent): LlmChatContent {
    if (typeof content === "string") return content;
    return content.filter((part) => {
        if (typeof part !== "object" || part === null) return true;
        return !("type" in part && part.type === "image_url");
    });
}

function mergeSystemUserMessages(messages: LlmChatMessage[]): LlmChatMessage[] {
    const merged: LlmChatMessage[] = [];
    for (const message of messages) {
        const previous = merged.at(-1);
        if (previous && canMerge(previous.role, message.role) && typeof previous.content === "string" && typeof message.content === "string") {
            previous.content = `${previous.content}\n${message.content}`;
            continue;
        }
        merged.push({...message});
    }
    return merged;
}

function canMerge(previous: LlmChatMessage["role"], next: LlmChatMessage["role"]): boolean {
    return previous === next || (previous === "system" && next === "user") || (previous === "user" && next === "system");
}

async function readJsonContent(response: Response): Promise<string> {
    const data = await response.json() as {
        choices?: Array<{message?: {content?: unknown}}>;
    };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
}

async function readSseContent(response: Response): Promise<string> {
    if (!response.body) return "";
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const reader = response.body.getReader();
    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
            for (const line of event.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (data === "[DONE]") return content;
                try {
                    const parsed = JSON.parse(data) as {
                        choices?: Array<{delta?: {content?: unknown}}>;
                    };
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (typeof delta === "string") content += delta;
                } catch {
                    // 忽略不完整 SSE 帧；后续 chunk 会补全。
                }
            }
        }
    }
    buffer += decoder.decode();
    return content;
}
