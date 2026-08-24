import {buildRequestMessages, type TextToImagePromptMode} from "nbook/server/text-to-image/llm-context";
import {
    requestLlmCompletion,
    type RequestLlmCompletionInput,
} from "nbook/server/text-to-image/llm-chat";
import {extractLlmImagePrompts, stripLlmReasoningBlocks} from "nbook/server/text-to-image/llm-output";
import type {TextToImageContextEntry, TextToImageLlmProviderSettings} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageRuntimePlaceholderContext} from "nbook/server/text-to-image/runtime-placeholder";
import type {TextToImageLlmTraceHandle} from "nbook/server/text-to-image/llm-trace";

export function extractTagModifyPrompt(text: string): string {
    const cleaned = stripLlmReasoningBlocks(text);
    const wrappedPrompts = extractLlmImagePrompts(cleaned);
    const candidate = wrappedPrompts.at(-1) ?? stripCodeFence(cleaned);
    const prompt = candidate
        .replace(/^<image\b[^>]*>/iu, "")
        .replace(/<\/image>$/iu, "")
        .replace(/^<prompts?\b[^>]*>/iu, "")
        .replace(/<\/prompts?>$/iu, "")
        .replace(/\s*\r?\n\s*/gu, " ")
        .trim();
    if (prompt === "") {
        throw new Error("Tag 修改 LLM 输出为空");
    }
    return prompt;
}

export function buildTagModifySystemPrompt(): string {
    return [
        "你是 NovelAI Tag 修改助手。根据当前正向 Tag 和用户修改要求，生成新的、可直接发送给 NovelAI 的英文 Danbooru/Stable Diffusion Tag 串。",
        "",
        "输出要求：",
        "- 只输出最终正向 Tag，不输出解释、Markdown、JSON 或自然语言段落。",
        "- 多个 Tag 使用英文逗号分隔；保留用户没有要求修改的场景、构图、角色和画面信息。",
        "- 可以直接输出 Tag，也可以兼容 image###...### 或 <image><prompts>...</prompts></image> 包装。",
    ].join("\n");
}

export function buildTagModifyUserPrompt(input: {
    currentPrompt: string;
    modificationRequest: string;
}): string {
    return [
        "当前正向 Tag：",
        "<current_prompt>",
        input.currentPrompt.trim(),
        "</current_prompt>",
        "",
        "用户修改要求：",
        "<modification_request>",
        input.modificationRequest.trim(),
        "</modification_request>",
        "",
        "请只返回修改后的正向 Tag 串。",
    ].join("\n");
}

export async function generateTagModifyPrompt(input: {
    provider: {
        baseUrl: string;
        credential: string;
        settings: Record<string, unknown>;
    };
    currentPrompt: string;
    modificationRequest: string;
    contextEntries?: TextToImageContextEntry[];
    promptMode?: TextToImagePromptMode;
    runtime?: TextToImageRuntimePlaceholderContext;
    trace?: TextToImageLlmTraceHandle;
    complete?: typeof requestLlmCompletion;
}): Promise<string> {
    const settings = TextToImageLlmProviderSettingsSchema.parse({
        ...input.provider.settings,
        baseUrl: input.provider.baseUrl,
    });
    const runtime = buildTagModifyRuntime(input);
    const complete = input.complete ?? requestLlmCompletion;
    const content = await complete({
        baseUrl: input.provider.baseUrl,
        credential: input.provider.credential,
        model: settings.model,
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
        stream: settings.stream,
        sendImages: settings.sendImages,
        mergeSystemUser: settings.mergeSystemUser,
        retryCount: settings.retryCount,
        runtime,
        trace: input.trace,
        messages: buildRequestMessages(input.contextEntries ?? [], runtime, [
            {role: "system", content: buildTagModifySystemPrompt()},
            {
                role: "user",
                content: buildTagModifyUserPrompt({
                    currentPrompt: input.currentPrompt,
                    modificationRequest: input.modificationRequest,
                }),
            },
        ], input.promptMode),
    });
    return extractTagModifyPrompt(content);
}

function buildTagModifyRuntime(input: {
    currentPrompt: string;
    modificationRequest: string;
    runtime?: TextToImageRuntimePlaceholderContext;
}): TextToImageRuntimePlaceholderContext {
    const context = [input.runtime?.context ?? "", input.currentPrompt.trim()]
        .filter((part) => part !== "")
        .join("\n");
    return {
        ...input.runtime,
        context,
        userDemand: input.modificationRequest.trim(),
    };
}

function stripCodeFence(value: string): string {
    return value
        .replace(/^```(?:text|plaintext|tag|tags)?\s*/iu, "")
        .replace(/\s*```$/u, "")
        .trim();
}

export type TagModifyProviderSettings = TextToImageLlmProviderSettings;
export type TagModifyCompletionInput = RequestLlmCompletionInput;
