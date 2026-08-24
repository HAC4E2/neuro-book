import {setTimeout as delay} from "node:timers/promises";
import {
    fetchTextToImageProvider,
    resolveTextToImageOutboundPolicy,
} from "nbook/server/text-to-image/provider-fetch";
import {
    resolveTextToImageRuntimePlaceholdersWithVariables,
    type TextToImageRuntimePlaceholderContext,
} from "nbook/server/text-to-image/runtime-placeholder";
import type {TextToImageLlmTraceHandle} from "nbook/server/text-to-image/llm-trace";

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
    /** 运行时占位符上下文；缺省时只替换空值。 */
    runtime?: TextToImageRuntimePlaceholderContext;
    /** 测试注入；生产由 fetchTextToImageProvider 使用默认 fetch。 */
    fetchImpl?: LlmFetchImpl;
    /** 可选调试观察器；只接收增量，不会参与业务解析。 */
    trace?: TextToImageLlmTraceHandle;
};

const RETRY_DELAY_MS = 2_000;
type ProviderFetchDependencies = NonNullable<Parameters<typeof fetchTextToImageProvider>[3]>;

/**
 * OpenAI 兼容 `/chat/completions` 直调。
 * 安全出站复用 provider-fetch 的 URL/DNS/重定向策略；429/5xx/空响应按 retryCount 重试。
 */
export async function requestLlmCompletion(input: RequestLlmCompletionInput): Promise<string> {
    const messages = prepareLlmMessages(input.messages, input.runtime, {
        sendImages: input.sendImages ?? false,
        mergeSystemUser: input.mergeSystemUser ?? false,
    });
    const body = {
        model: input.model,
        temperature: input.temperature ?? 1,
        top_p: input.topP ?? 1,
        max_tokens: input.maxTokens ?? 30000,
        stream: input.stream ?? false,
        messages,
    };
    const baseUrl = input.baseUrl.replace(/\/+$/u, "");
    const retryCount = input.retryCount ?? 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
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
                {
                    ...resolveTextToImageOutboundPolicy(),
                    allowPrivateNetwork: input.allowPrivateNetwork ?? false,
                },
                input.fetchImpl ? {fetchImpl: input.fetchImpl as ProviderFetchDependencies["fetchImpl"]} : {},
            );

            if (response.status === 429 || response.status >= 500) {
                if (attempt < retryCount) {
                    input.trace?.retrying(attempt + 1, `HTTP ${response.status}`);
                    await delay(RETRY_DELAY_MS);
                    continue;
                }
                throw new Error(`LLM 请求失败：HTTP ${response.status}`);
            }
            if (!response.ok) {
                throw new Error(`LLM 请求失败：HTTP ${response.status}`);
            }

            const content = input.stream
                ? await readSseContent(response, (delta) => input.trace?.delta(delta, attempt + 1))
                : await readJsonContent(response, (delta) => input.trace?.delta(delta, attempt + 1));
            if (content.trim() === "") {
                throw new Error("LLM 返回空响应");
            }
            input.trace?.completed(content, attempt + 1);
            return content;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < retryCount) {
                input.trace?.retrying(attempt + 1, lastError.message);
                await delay(RETRY_DELAY_MS);
                continue;
            }
            input.trace?.failed(lastError.message, attempt + 1);
            throw lastError;
        }
    }

    throw lastError ?? new Error("LLM 请求失败");
}

function applyRuntimePlaceholders(
    messages: LlmChatMessage[],
    runtime: TextToImageRuntimePlaceholderContext | undefined,
): LlmChatMessage[] {
    const effectiveRuntime = runtime ?? {};
    const variables: Record<string, string> = {...(effectiveRuntime.variables ?? {})};
    const worldVariables: Record<string, string> = {...(effectiveRuntime.worldVariables ?? {})};
    const emittedCharacterSections = new Set<string>();
    return messages.map((message) => {
        const messageRuntime = resolveMessageRuntime(message.content, effectiveRuntime, emittedCharacterSections);
        return {
            ...message,
            content: resolveMessageContent(message.content, messageRuntime, variables, worldVariables),
        };
    });
}

function resolveMessageRuntime(
    content: LlmChatContent,
    runtime: TextToImageRuntimePlaceholderContext,
    emittedCharacterSections: Set<string>,
): TextToImageRuntimePlaceholderContext {
    const text = typeof content === "string"
        ? content
        : content
            .filter((part) => typeof part === "object" && part !== null && "type" in part && part.type === "text")
            .map((part) => "text" in part && typeof part.text === "string" ? part.text : "")
            .join("\n");
    if (text.includes("{{角色启用列表}}")) {
        for (const section of extractCharacterSections(runtime.characterList ?? "")) {
            emittedCharacterSections.add(normalizeCharacterSection(section));
        }
    }
    if (!text.includes("{{通用角色启用列表}}")) {
        return runtime;
    }
    return {
        ...runtime,
        commonCharacterList: filterEmittedCharacterSections(runtime.commonCharacterList ?? "", emittedCharacterSections),
    };
}

function extractCharacterSections(value: string): string[] {
    return [...value.matchAll(/<人物>[\s\S]*?<\/人物>/gu)].map((match) => match[0] ?? "");
}

function filterEmittedCharacterSections(value: string, emitted: Set<string>): string {
    return value
        .replace(/<人物>[\s\S]*?<\/人物>/gu, (section) => (
            emitted.has(normalizeCharacterSection(section)) ? "" : section
        ))
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

function normalizeCharacterSection(value: string): string {
    return value.replace(/\s+/gu, " ").trim();
}

function resolveMessageContent(
    content: LlmChatContent,
    runtime: TextToImageRuntimePlaceholderContext,
    variables: Record<string, string>,
    worldVariables: Record<string, string>,
): LlmChatContent {
    if (typeof content === "string") {
        return resolveTextToImageRuntimePlaceholdersWithVariables(content, runtime, variables, worldVariables);
    }
    return content.map((part) => {
        if (typeof part !== "object" || part === null || !("type" in part) || part.type !== "text" || typeof part.text !== "string") {
            return part;
        }
        return {
            ...part,
            text: resolveTextToImageRuntimePlaceholdersWithVariables(part.text, runtime, variables, worldVariables),
        };
    });
}

/** 预览与正式 Provider 请求共用的最终消息准备函数。 */
export function prepareLlmMessages(
    messages: LlmChatMessage[],
    runtime: TextToImageRuntimePlaceholderContext | undefined,
    options: {sendImages: boolean; mergeSystemUser: boolean},
): LlmChatMessage[] {
    const resolved = applyRuntimePlaceholders(messages, runtime);
    const filtered = options.sendImages
        ? resolved
        : resolved.map((message) => ({
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

async function readJsonContent(response: Response, onDelta?: (delta: string) => void): Promise<string> {
    const data = await response.json() as {
        choices?: Array<{message?: {content?: unknown}}>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") onDelta?.(content);
    return typeof content === "string" ? content : "";
}

async function readSseContent(response: Response, onDelta?: (delta: string) => void): Promise<string> {
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
                    if (typeof delta === "string") {
                        content += delta;
                        onDelta?.(delta);
                    }
                } catch {
                    // 忽略不完整 SSE 帧；后续 chunk 会补全。
                }
            }
        }
    }
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") break;
        try {
            const parsed = JSON.parse(data) as {
                choices?: Array<{delta?: {content?: unknown}}>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
                content += delta;
                onDelta?.(delta);
            }
        } catch {
            // 忽略结束时仍不完整的 SSE 帧。
        }
    }
    return content;
}
