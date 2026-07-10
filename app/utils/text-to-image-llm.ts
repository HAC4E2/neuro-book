import {escapeAttribute, unescapeAttribute} from "nbook/shared/markdown-workbench";
import type {
    TextToImageLlmApiConfig,
    TextToImageLlmContextEntry,
    TextToImageLlmContextPreset,
    TextToImageLlmContextRole,
    TextToImageGenerationResult,
    TextToImagePromptTask,
} from "nbook/app/stores/text-to-image";
import {
    parseTextToImageResultMarkdown,
    renderTextToImageResultMarkdown,
    type TextToImageResultPayload,
} from "nbook/app/components/markdown-studio/tiptap/TextToImageResult";

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
export type TextToImageImagineBlock = {
    raw: string;
    inner: string;
    tagName: "imagine" | "image";
    triggerText: string | null;
    responsePrefix: string;
    responseIndex: number;
};

export type TextToImageImagineInsertResult = {
    markdown: string;
    inserted: number;
    matched: number;
    appended: number;
    skippedDuplicate: number;
};

export type TextToImagePromptPlaceholderInsertResult = {
    markdown: string;
    inserted: number;
    matched: number;
    appended: number;
};

export type TextToImagePromptPlacementParagraph = {
    id: string;
    index: number;
    text: string;
    start: number;
    end: number;
};

export type TextToImagePromptPlacementPrompt = {
    id: string;
    order: number;
    prompt: string;
    responseIndex: number;
    nearbyText: string;
};

export type TextToImagePromptPlacementDraft = {
    paragraphs: TextToImagePromptPlacementParagraph[];
    prompts: TextToImagePromptPlacementPrompt[];
};

export type TextToImagePromptPlacement = {
    promptId: string;
    afterParagraphId: string;
    reason: string;
    confidence: number;
};

export type TextToImagePromptPlacementInsertResult = {
    markdown: string;
    inserted: number;
    skipped: number;
};

export type TextToImagePromptPlaceholderReplaceResult = {
    markdown: string;
    replaced: boolean;
    prompt: string;
};

export type TextToImageResultReplaceResult = {
    markdown: string;
    replaced: boolean;
    payload: TextToImageResultPayload | null;
};

export type TextToImageGeneratedImageMarkdownInput = {
    id: string;
    fileName: string;
    savedPath: string;
    dataUrl: string;
    width: number;
    height: number;
    seed: number;
};

export type TextToImageGeneratedImageResultMarkdownInput = {
    id: string;
    activeIndex?: number;
    images: TextToImageGenerationResult[];
};

const TEXT_TO_IMAGE_PROMPT_PLACEHOLDER_PATTERN = /<text-to-image-prompt\s+id="([^"]+)">\n?([\s\S]*?)\n?<\/text-to-image-prompt>/giu;
const TEXT_TO_IMAGE_RESULT_MARKDOWN_PATTERN = /<text-to-image-result\s+id="([^"]+)">\n?([\s\S]*?)\n?<\/text-to-image-result>/giu;

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

export function formatTextToImageLlmMessages(messages: TextToImageLlmMessage[]): string {
    return messages.map((message, index) => [
        `#${index + 1} ${message.role.toUpperCase()}`,
        formatTextToImageLlmContent(message.content),
    ].join("\n")).join("\n\n");
}

export async function requestTextToImageLlmCompletion(apiConfig: TextToImageLlmApiConfig, messages: TextToImageLlmMessage[]): Promise<string> {
    const response = await fetch("/api/text-to-image/llm-completion", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            apiBaseUrl: apiConfig.apiBaseUrl,
            apiKey: apiConfig.apiKey,
            model: apiConfig.model,
            parameters: apiConfig.parameters,
            stream: apiConfig.stream,
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

export async function requestTextToImageLlmModels(apiConfig: Pick<TextToImageLlmApiConfig, "apiBaseUrl" | "apiKey">): Promise<string[]> {
    const response = await fetch("/api/text-to-image/llm-models", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            apiBaseUrl: apiConfig.apiBaseUrl,
            apiKey: apiConfig.apiKey,
        }),
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
export function extractImagineBlocks(response: string): TextToImageImagineBlock[] {
    return [
        ...extractBlocksByTag(response, "imagine"),
        ...extractBlocksByTag(response, "image"),
    ].sort((left, right) => left.responseIndex - right.responseIndex);
}

export function insertTextToImagePromptPlaceholdersIntoMarkdown(markdown: string, blocks: TextToImageImagineBlock[]): TextToImagePromptPlaceholderInsertResult {
    const placements = blocks
        .map((block, order) => ({
            block,
            order,
            prompt: normalizeBlockText(block.inner),
            insertAt: resolvePromptPlaceholderInsertAt(markdown, block),
        }))
        .filter((placement) => placement.prompt.length > 0);
    const matchedPlacements = placements
        .filter((placement) => placement.insertAt >= 0)
        .sort((left, right) => right.insertAt - left.insertAt || right.order - left.order);

    let nextMarkdown = markdown;
    for (const placement of matchedPlacements) {
        nextMarkdown = insertBlockAt(nextMarkdown, placement.insertAt, renderTextToImagePromptPlaceholderMarkdown({
            id: createTextToImagePromptPlaceholderId(placement.order),
            prompt: placement.prompt,
        }));
    }

    return {
        markdown: nextMarkdown,
        inserted: matchedPlacements.length,
        matched: matchedPlacements.length,
        appended: 0,
    };
}

export function buildTextToImagePromptPlacementDraft(
    markdown: string,
    blocks: TextToImageImagineBlock[],
    options: {createId?: (order: number) => string} = {},
): TextToImagePromptPlacementDraft {
    const paragraphs = collectMarkdownParagraphs(markdown);
    const prompts = blocks
        .map((block, order) => ({
            id: options.createId?.(order) ?? createTextToImagePromptPlaceholderId(order),
            order,
            prompt: normalizeBlockText(block.inner),
            responseIndex: block.responseIndex,
            nearbyText: readPromptNearbyText(block),
        }))
        .filter((prompt) => prompt.prompt.length > 0);
    return {paragraphs, prompts};
}

export function insertTextToImagePromptPlaceholdersByPlacement(
    markdown: string,
    draft: TextToImagePromptPlacementDraft,
    placements: TextToImagePromptPlacement[],
): TextToImagePromptPlacementInsertResult {
    const paragraphById = new Map(draft.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
    const promptById = new Map(draft.prompts.map((prompt) => [prompt.id, prompt]));
    const seenPromptIds = new Set<string>();
    const insertions: Array<{insertAt: number; order: number; prompt: TextToImagePromptPlacementPrompt}> = [];
    let skipped = 0;

    for (const placement of placements) {
        const prompt = promptById.get(placement.promptId);
        const paragraph = paragraphById.get(placement.afterParagraphId);
        if (!prompt || !paragraph || seenPromptIds.has(prompt.id)) {
            skipped += 1;
            continue;
        }
        seenPromptIds.add(prompt.id);
        insertions.push({
            insertAt: paragraph.end,
            order: prompt.order,
            prompt,
        });
    }

    let nextMarkdown = markdown;
    for (const insertion of insertions.sort((left, right) => right.insertAt - left.insertAt || right.order - left.order)) {
        nextMarkdown = insertBlockAt(nextMarkdown, insertion.insertAt, renderTextToImagePromptPlaceholderMarkdown({
            id: insertion.prompt.id,
            prompt: insertion.prompt.prompt,
        }));
    }

    return {
        markdown: nextMarkdown,
        inserted: insertions.length,
        skipped,
    };
}

export function replaceTextToImagePromptPlaceholder(markdown: string, id: string, replacementMarkdown: string): TextToImagePromptPlaceholderReplaceResult {
    TEXT_TO_IMAGE_PROMPT_PLACEHOLDER_PATTERN.lastIndex = 0;
    for (const match of markdown.matchAll(TEXT_TO_IMAGE_PROMPT_PLACEHOLDER_PATTERN)) {
        const matchedId = unescapeAttribute(match[1] ?? "");
        if (matchedId !== id) {
            continue;
        }
        const index = match.index ?? -1;
        if (index < 0) {
            break;
        }
        return {
            markdown: `${markdown.slice(0, index)}${replacementMarkdown}${markdown.slice(index + match[0].length)}`,
            replaced: true,
            prompt: (match[2] ?? "").trim(),
        };
    }
    return {markdown, replaced: false, prompt: ""};
}

export function buildGeneratedImageMarkdown(image: TextToImageGeneratedImageMarkdownInput): string {
    const url = image.savedPath.trim()
        ? `/api/text-to-image/image?path=${encodeURIComponent(image.savedPath)}&v=${encodeURIComponent(image.id)}`
        : image.dataUrl;
    const titleParts = [
        image.fileName,
        image.seed >= 0 ? `seed ${image.seed}` : "",
        image.width && image.height ? `${image.width}x${image.height}` : "",
        image.savedPath,
    ].filter(Boolean);
    return `![NovelAI 生成图片](${url} "${escapeMarkdownTitle(titleParts.join(" | "))}")`;
}

export function buildGeneratedImageResultMarkdown(input: TextToImageGeneratedImageResultMarkdownInput): string {
    return renderTextToImageResultMarkdown({
        id: input.id,
        activeIndex: input.activeIndex ?? Math.max(0, input.images.length - 1),
        items: input.images,
    });
}

export function replaceTextToImageResultMarkdown(markdown: string, id: string, replacementMarkdown: string): TextToImageResultReplaceResult {
    TEXT_TO_IMAGE_RESULT_MARKDOWN_PATTERN.lastIndex = 0;
    for (const match of markdown.matchAll(TEXT_TO_IMAGE_RESULT_MARKDOWN_PATTERN)) {
        const matchedId = unescapeAttribute(match[1] ?? "");
        if (matchedId !== id) {
            continue;
        }
        const index = match.index ?? -1;
        if (index < 0) {
            break;
        }
        return {
            markdown: `${markdown.slice(0, index)}${replacementMarkdown}${markdown.slice(index + match[0].length)}`,
            replaced: true,
            payload: parseTextToImageResultMarkdown(match[0]),
        };
    }
    return {markdown, replaced: false, payload: null};
}

export function createTextToImageGeneratedResultId(sourceId: string): string {
    const normalized = sourceId.trim().replace(/[^\w-]+/gu, "-").replace(/^-+|-+$/gu, "");
    return `tti-result-${normalized || Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

    let nextMarkdown = markdown;
    for (const placement of matchedPlacements) {
        nextMarkdown = insertBlockAt(nextMarkdown, placement.insertAt, placement.text);
    }

    return {
        markdown: nextMarkdown,
        inserted: matchedPlacements.length,
        matched: matchedPlacements.length,
        appended: 0,
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

type PromptTemplateRenderResult = {
    content: string;
    usedUserRequestSlot: boolean;
};

const USER_REQUEST_PROMPT_SLOT_KEYS = new Set([
    "用户需求",
    "用户输入",
    "本次玩家输入",
    "请求体",
    "request",
    "userrequest",
    "userinput",
]);

function createPromptTemplateContext(userRequest: string, variables: Record<string, string> = {}): Map<string, string> {
    const entries = {
        "用户需求": userRequest,
        "用户输入": userRequest,
        "本次玩家输入": userRequest,
        "请求体": userRequest,
        request: userRequest,
        userRequest,
        userInput: userRequest,
        ...variables,
    };
    return new Map(Object.entries(entries).map(([key, value]) => [normalizePromptSlotKey(key), value]));
}

function renderPromptTemplate(content: string, context: Map<string, string>): PromptTemplateRenderResult {
    let usedUserRequestSlot = false;
    const rendered = content.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (match, rawKey: string) => {
        const normalizedKey = normalizePromptSlotKey(rawKey);
        const value = context.get(normalizedKey);
        if (value === undefined) {
            return match;
        }
        if (USER_REQUEST_PROMPT_SLOT_KEYS.has(normalizedKey)) {
            usedUserRequestSlot = true;
        }
        return value;
    });
    return {
        content: rendered,
        usedUserRequestSlot,
    };
}

function normalizePromptSlotKey(key: string): string {
    return key.trim().toLocaleLowerCase().replace(/[\s_\-:/：｜|（）()【】\[\]{}]+/gu, "");
}

function extractBlocksByTag(response: string, tagName: "imagine" | "image"): TextToImageImagineBlock[] {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "giu");
    const blocks: TextToImageImagineBlock[] = [];
    for (const match of response.matchAll(pattern)) {
        const raw = match[0];
        const responseIndex = match.index ?? 0;
        const inner = readTagInner(raw, tagName);
        blocks.push({
            raw: raw.trim(),
            inner,
            tagName,
            triggerText: readTriggerText(inner),
            responsePrefix: response.slice(0, responseIndex),
            responseIndex,
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

function resolvePromptPlaceholderInsertAt(markdown: string, block: TextToImageImagineBlock): number {
    if (block.triggerText) {
        const triggerEnd = findTriggerEnd(markdown, block.triggerText);
        if (triggerEnd >= 0) {
            return triggerEnd;
        }
    }
    return findResponseContextEnd(markdown, block.responsePrefix);
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

function findResponseContextEnd(markdown: string, responsePrefix: string): number {
    const cleanPrefix = stripGeneratedImageTags(responsePrefix).trimEnd();
    if (!cleanPrefix) {
        return -1;
    }
    const normalizedMarkdown = normalizeLineEndingsWithIndexMap(markdown);
    const normalizedPrefix = normalizeLineEndingsWithIndexMap(cleanPrefix).text;
    const maxLength = Math.min(360, normalizedPrefix.length);
    const candidateLengths = [maxLength, 240, 160, 100, 60, 36, 20, 12, 8, 4]
        .filter((length, index, array) => length > 0 && array.indexOf(length) === index);
    for (const length of candidateLengths) {
        const candidate = normalizedPrefix.slice(-length).trimStart();
        if (candidate.length < Math.min(4, length)) {
            continue;
        }
        const foundAt = normalizedMarkdown.text.lastIndexOf(candidate);
        if (foundAt >= 0) {
            const normalizedEnd = foundAt + candidate.length - 1;
            return (normalizedMarkdown.indexMap[normalizedEnd] ?? normalizedEnd) + 1;
        }
    }
    return -1;
}

function stripGeneratedImageTags(value: string): string {
    return value.replace(/<(?:imagine|image)\b[^>]*>[\s\S]*?<\/(?:imagine|image)>/giu, "");
}

function readPromptNearbyText(block: TextToImageImagineBlock): string {
    const cleanPrefix = stripGeneratedImageTags(block.responsePrefix).trim();
    if (!cleanPrefix) {
        return "";
    }
    return cleanPrefix.slice(Math.max(0, cleanPrefix.length - 360));
}

function normalizeLineEndingsWithIndexMap(value: string): {text: string; indexMap: number[]} {
    let text = "";
    const indexMap: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char === "\r") {
            if (value[index + 1] === "\n") {
                text += "\n";
                indexMap.push(index + 1);
                index += 1;
                continue;
            }
            text += "\n";
            indexMap.push(index);
            continue;
        }
        text += char;
        indexMap.push(index);
    }
    return {text, indexMap};
}

function insertBlockAt(markdown: string, index: number, blockText: string): string {
    return `${markdown.slice(0, index)}${blockSeparatorBefore(markdown.slice(0, index))}${blockText}${blockSeparatorAfter(markdown.slice(index))}${markdown.slice(index)}`;
}

function collectMarkdownParagraphs(markdown: string): TextToImagePromptPlacementParagraph[] {
    const paragraphs: TextToImagePromptPlacementParagraph[] = [];
    let paragraphStart = -1;
    let paragraphEnd = 0;
    const paragraphLines: string[] = [];
    let index = 0;
    while (index < markdown.length) {
        const lineStart = index;
        const newlineMatch = /\r\n|\n|\r/u.exec(markdown.slice(index));
        const lineEnd = newlineMatch ? index + (newlineMatch.index ?? 0) : markdown.length;
        const line = markdown.slice(lineStart, lineEnd);
        if (line.trim()) {
            if (paragraphStart < 0) {
                paragraphStart = lineStart;
            }
            paragraphLines.push(line.trim());
            paragraphEnd = lineEnd;
        } else if (paragraphStart >= 0) {
            paragraphs.push({
                id: `p-${paragraphs.length + 1}`,
                index: paragraphs.length,
                text: paragraphLines.join("\n"),
                start: paragraphStart,
                end: paragraphEnd,
            });
            paragraphStart = -1;
            paragraphEnd = 0;
            paragraphLines.length = 0;
        }
        if (!newlineMatch) {
            index = markdown.length;
        } else {
            index = lineEnd + newlineMatch[0].length;
        }
    }
    if (paragraphStart >= 0) {
        paragraphs.push({
            id: `p-${paragraphs.length + 1}`,
            index: paragraphs.length,
            text: paragraphLines.join("\n"),
            start: paragraphStart,
            end: paragraphEnd,
        });
    }
    return paragraphs;
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

function createTextToImagePromptPlaceholderId(order: number): string {
    return `tti-${Date.now().toString(36)}-${order.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderTextToImagePromptPlaceholderMarkdown(payload: {id: string; prompt: string}): string {
    return `<text-to-image-prompt id="${escapeAttribute(payload.id)}">\n${payload.prompt.trim()}\n</text-to-image-prompt>`;
}

function escapeMarkdownTitle(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
