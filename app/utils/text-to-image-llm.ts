import type {
    TextToImageLlmContextEntry,
    TextToImageLlmContextPreset,
    TextToImageLlmContextRole,
    TextToImageLlmParameters,
    TextToImagePromptTask,
} from "nbook/app/stores/text-to-image";

export type TextToImageLlmContentPart = {
    type: "text";
    text: string;
} | {
    type: "image_url";
    image_url: {
        url: string;
    };
};

export type TextToImageLlmMessage = {
    role: TextToImageLlmContextRole;
    content: string | TextToImageLlmContentPart[];
};

type TextToImageLlmCompletionApiResponse = {
    content: string;
};

type TextToImageLlmModelsApiResponse = {
    models: string[];
};

export type TextToImageLlmCompletionInput = {
    providerId: number;
    model: string;
    parameters: TextToImageLlmParameters;
    stream: boolean;
};

/** 根据任务提示词和上下文预设构造服务端 LLM 请求消息。 */
export function buildTextToImageLlmMessages(options: {
    task: TextToImagePromptTask;
    userRequest: string;
    taskPrompt?: string;
    contextPreset: TextToImageLlmContextPreset | null;
    extraDetectionText?: string;
    requestVariables?: Record<string, string>;
}): TextToImageLlmMessage[] {
    const taskPrompt = options.taskPrompt?.trim() ?? "";
    const userRequest = options.userRequest.trim();
    const templateContext = createPromptTemplateContext(userRequest, options.requestVariables);
    const detectionText = [
        taskPrompt,
        userRequest,
        options.extraDetectionText?.trim() ?? "",
    ].filter(Boolean).join("\n");
    let userRequestSlotUsed = false;
    const contextMessages = (options.contextPreset?.entries ?? [])
        .filter((entry) => shouldSendContextEntry(entry, detectionText))
        .map((entry) => {
            const rendered = renderPromptTemplate(entry.content.trim(), templateContext);
            userRequestSlotUsed ||= rendered.usedUserRequestSlot;
            return {
                role: entry.role,
                content: rendered.content,
            };
        });
    const renderedTaskPrompt = taskPrompt ? renderPromptTemplate(taskPrompt, templateContext) : null;
    userRequestSlotUsed ||= renderedTaskPrompt?.usedUserRequestSlot ?? false;
    return [
        ...contextMessages,
        ...(renderedTaskPrompt ? [{role: "system" as const, content: renderedTaskPrompt.content}] : []),
        ...(userRequest && !userRequestSlotUsed ? [{role: "user" as const, content: userRequest}] : []),
    ];
}

/** 将消息格式化为可读预览，绝不包含 Provider 凭据。 */
export function formatTextToImageLlmMessages(messages: TextToImageLlmMessage[]): string {
    return messages.map((message, index) => [
        `#${index + 1} ${message.role.toUpperCase()}`,
        formatTextToImageLlmContent(message.content),
    ].join("\n")).join("\n\n");
}

/** 通过服务端 Provider 执行补全，浏览器侧只传递 Provider ID。 */
export async function requestTextToImageLlmCompletion(input: TextToImageLlmCompletionInput, messages: TextToImageLlmMessage[]): Promise<string> {
    const response = await fetch("/api/text-to-image/llm-completion", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            providerId: input.providerId,
            model: input.model,
            parameters: input.parameters,
            stream: input.stream,
            messages,
        }),
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `LLM 请求失败：${response.status}`);
    }
    const data = await response.json() as TextToImageLlmCompletionApiResponse;
    return data.content.trim();
}

/** 读取 Provider 暴露的模型列表。 */
export async function requestTextToImageLlmModels(providerId: number): Promise<string[]> {
    const response = await fetch("/api/text-to-image/llm-models", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({providerId}),
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `LLM 模型列表读取失败：${response.status}`);
    }
    const data = await response.json() as TextToImageLlmModelsApiResponse;
    return data.models;
}

function formatTextToImageLlmContent(content: TextToImageLlmMessage["content"]): string {
    if (typeof content === "string") {
        return content;
    }
    return content.map((part) => part.type === "text" ? part.text : "[image reference omitted]").join("\n");
}

function shouldSendContextEntry(entry: TextToImageLlmContextEntry, detectionText: string): boolean {
    if (!entry.enabled || !entry.content.trim()) {
        return false;
    }
    if (entry.triggerMode === "always") {
        return true;
    }
    return detectionText.includes(entry.name.trim());
}

function createPromptTemplateContext(userRequest: string, variables: Record<string, string> = {}): Map<string, string> {
    const context = new Map<string, string>();
    for (const [key, value] of Object.entries(variables)) {
        context.set(normalizePromptSlotKey(key), value);
    }
    for (const key of ["request", "userRequest", "input", "content", "currentChapter"]) {
        context.set(normalizePromptSlotKey(key), userRequest);
    }
    return context;
}

function renderPromptTemplate(content: string, context: Map<string, string>): {content: string; usedUserRequestSlot: boolean} {
    let usedUserRequestSlot = false;
    const rendered = content.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (match, rawKey: string) => {
        const key = normalizePromptSlotKey(rawKey);
        const value = context.get(key);
        if (value === undefined) {
            return match;
        }
        if (["request", "userrequest", "input", "content", "currentchapter"].includes(key)) {
            usedUserRequestSlot = true;
        }
        return value;
    });
    return {content: rendered, usedUserRequestSlot};
}

function normalizePromptSlotKey(key: string): string {
    return key.trim().replace(/[\s_-]+/gu, "").toLowerCase();
}
