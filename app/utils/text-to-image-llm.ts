import type {
    TextToImageLlmApiConfig,
    TextToImageLlmContextEntry,
    TextToImageLlmContextPreset,
    TextToImageLlmContextRole,
    TextToImagePromptTask,
} from "nbook/app/stores/text-to-image";

export type TextToImageLlmMessage = {
    role: TextToImageLlmContextRole;
    content: string;
};

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

export type TextToImageImagineBlock = {
    raw: string;
    inner: string;
    tagName: "imagine" | "image";
    triggerText: string | null;
};

export type TextToImageImagineInsertResult = {
    markdown: string;
    inserted: number;
    matched: number;
    appended: number;
    skippedDuplicate: number;
};

export function buildTextToImageLlmMessages(options: {
    task: TextToImagePromptTask;
    userRequest: string;
    taskPrompt?: string;
    contextPreset: TextToImageLlmContextPreset | null;
    extraDetectionText?: string;
}): TextToImageLlmMessage[] {
    const taskPrompt = options.taskPrompt?.trim() ?? "";
    const userRequest = options.userRequest.trim();
    const detectionText = [
        taskPrompt,
        userRequest,
        options.extraDetectionText?.trim() ?? "",
    ].filter(Boolean).join("\n");
    const contextMessages = (options.contextPreset?.entries ?? [])
        .filter((entry) => shouldSendContextEntry(entry, detectionText))
        .map((entry) => ({
            role: entry.role,
            content: entry.content.trim(),
        }));
    return [
        ...contextMessages,
        ...(taskPrompt ? [{role: "system" as const, content: taskPrompt}] : []),
        ...(userRequest ? [{role: "user" as const, content: userRequest}] : []),
    ];
}

export function formatTextToImageLlmMessages(messages: TextToImageLlmMessage[]): string {
    return messages.map((message, index) => [
        `#${index + 1} ${message.role.toUpperCase()}`,
        message.content,
    ].join("\n")).join("\n\n");
}

export async function requestTextToImageLlmCompletion(apiConfig: TextToImageLlmApiConfig, messages: TextToImageLlmMessage[]): Promise<string> {
    const headers: HeadersInit = {"Content-Type": "application/json"};
    if (apiConfig.apiKey.trim()) {
        headers.Authorization = `Bearer ${apiConfig.apiKey.trim()}`;
    }
    const response = await fetch(`${apiConfig.apiBaseUrl.trim().replace(/\/+$/u, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: apiConfig.model.trim(),
            temperature: apiConfig.parameters.temperature,
            top_p: apiConfig.parameters.topP,
            max_tokens: apiConfig.parameters.maxTokens,
            stream: apiConfig.stream,
            messages,
        }),
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `LLM 请求失败：${response.status}`);
    }
    if (apiConfig.stream) {
        return await readStreamingResponse(response);
    }
    const data = await response.json() as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export function extractImagineBlocks(response: string): TextToImageImagineBlock[] {
    const imagineBlocks = extractBlocksByTag(response, "imagine");
    return imagineBlocks.length ? imagineBlocks : extractBlocksByTag(response, "image");
}

export function insertImagineBlocksIntoMarkdown(markdown: string, blocks: TextToImageImagineBlock[]): TextToImageImagineInsertResult {
    const uniqueBlocks = blocks
        .map((block, order) => ({block, order, text: normalizeBlockText(block.inner)}))
        .filter(({text}) => text.length > 0);
    const skippedDuplicate = uniqueBlocks.filter(({text}) => markdown.includes(text)).length;
    const pendingBlocks = uniqueBlocks.filter(({text}) => !markdown.includes(text));
    const placements = pendingBlocks.map(({block, order, text}) => {
        const insertAt = block.triggerText ? findTriggerEnd(markdown, block.triggerText) : -1;
        return {block, order, text, insertAt};
    });
    const matchedPlacements = placements
        .filter((placement) => placement.insertAt >= 0)
        .sort((left, right) => right.insertAt - left.insertAt || right.order - left.order);
    const appendedPlacements = placements
        .filter((placement) => placement.insertAt < 0)
        .sort((left, right) => left.order - right.order);

    let nextMarkdown = markdown;
    for (const placement of matchedPlacements) {
        nextMarkdown = insertBlockAt(nextMarkdown, placement.insertAt, placement.text);
    }
    if (appendedPlacements.length) {
        nextMarkdown = appendBlocks(nextMarkdown, appendedPlacements.map((placement) => placement.text));
    }

    return {
        markdown: nextMarkdown,
        inserted: matchedPlacements.length + appendedPlacements.length,
        matched: matchedPlacements.length,
        appended: appendedPlacements.length,
        skippedDuplicate,
    };
}

function shouldSendContextEntry(entry: TextToImageLlmContextEntry, detectionText: string): boolean {
    if (!entry.enabled || !entry.content.trim()) {
        return false;
    }
    if (entry.triggerMode !== "trigger") {
        return true;
    }
    const triggerName = entry.name.trim();
    return Boolean(triggerName && detectionText.toLocaleLowerCase().includes(triggerName.toLocaleLowerCase()));
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

function extractBlocksByTag(response: string, tagName: "imagine" | "image"): TextToImageImagineBlock[] {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "giu");
    const blocks: TextToImageImagineBlock[] = [];
    for (const match of response.matchAll(pattern)) {
        const raw = match[0];
        const inner = readTagInner(raw, tagName);
        blocks.push({
            raw: raw.trim(),
            inner,
            tagName,
            triggerText: readTriggerText(inner),
        });
    }
    return blocks;
}

function readTagInner(raw: string, tagName: "imagine" | "image"): string {
    const pattern = new RegExp(`^<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>$`, "iu");
    return raw.match(pattern)?.[1]?.trim() ?? raw.trim();
}

function readTriggerText(inner: string): string | null {
    const match = inner.match(/^\s*regex\s*:\s*(.+?)\s*$/imu);
    const trigger = match?.[1]?.trim() ?? "";
    return trigger ? stripWrappingQuote(trigger) : null;
}

function stripWrappingQuote(value: string): string {
    if (value.length < 2) {
        return value;
    }
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'") || (first === "`" && last === "`")) {
        return value.slice(1, -1).trim();
    }
    return value;
}

function normalizeBlockText(value: string): string {
    return value.replace(/^\s*regex\s*:\s*.+?(?:\r?\n|$)/imu, "").trim();
}

function findTriggerEnd(markdown: string, triggerText: string): number {
    const literalIndex = markdown.indexOf(triggerText);
    if (literalIndex >= 0) {
        return literalIndex + triggerText.length;
    }
    try {
        const match = new RegExp(triggerText, "u").exec(markdown);
        if (match?.index !== undefined && match[0].length > 0) {
            return match.index + match[0].length;
        }
    } catch {
        return -1;
    }
    return -1;
}

function insertBlockAt(markdown: string, index: number, blockText: string): string {
    return `${markdown.slice(0, index)}${blockSeparatorBefore(markdown.slice(0, index))}${blockText}${blockSeparatorAfter(markdown.slice(index))}${markdown.slice(index)}`;
}

function appendBlocks(markdown: string, blockTexts: string[]): string {
    const suffix = blockTexts.join("\n\n");
    return `${markdown.trimEnd()}${markdown.trimEnd() ? "\n\n" : ""}${suffix}\n`;
}

function blockSeparatorBefore(previousText: string): string {
    if (!previousText.trimEnd()) {
        return "";
    }
    return previousText.endsWith("\n\n") ? "" : previousText.endsWith("\n") ? "\n" : "\n\n";
}

function blockSeparatorAfter(nextText: string): string {
    if (!nextText.trimStart()) {
        return "\n";
    }
    return nextText.startsWith("\n\n") ? "" : nextText.startsWith("\n") ? "\n" : "\n\n";
}
