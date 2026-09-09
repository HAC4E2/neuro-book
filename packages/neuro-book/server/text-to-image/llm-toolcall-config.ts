import {randomBytes} from "node:crypto";
import {
    TextToImageLlmProviderSettingsSchema,
    TextToImageTailMessagesConfigSchema,
    TextToImageToolCallConfigSchema,
    type TextToImageGlobalConfig,
    type TextToImageLlmProviderSettings,
    type TextToImageTailMessagesConfig,
    type TextToImageToolCallConfig,
} from "nbook/shared/dto/text-to-image.dto";
import {
    DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG,
    DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG,
} from "nbook/shared/text-to-image-toolcall-defaults";
import type {LlmChatMessage} from "nbook/server/text-to-image/llm-chat";

export type LlmToolDefinition = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, {type: "string"; description: string}>;
            required: string[];
        };
    };
};

export type ResolvedTextToImageLlmProviderSettings = Omit<TextToImageLlmProviderSettings, "toolCallConfig" | "tailMessagesConfig"> & {
    toolCallConfig: NonNullable<TextToImageLlmProviderSettings["toolCallConfig"]>;
    tailMessagesConfig: NonNullable<TextToImageLlmProviderSettings["tailMessagesConfig"]>;
};

export type PreparedLlmToolCallRequest = {
    messages: LlmChatMessage[];
    tools?: [LlmToolDefinition];
    toolChoice?: {type: "function"; function: {name: string}};
    toolName?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

/** Resolve global settings and complete Provider overrides without mutating either source. */
export function resolveTextToImageLlmSettings(
    globalConfig: Pick<TextToImageGlobalConfig, "toolCallConfig" | "tailMessagesConfig"> | undefined,
    providerSettings: unknown,
): ResolvedTextToImageLlmProviderSettings {
    const parsedProvider = TextToImageLlmProviderSettingsSchema.parse(providerSettings);
    const providerRecord = isRecord(providerSettings) ? providerSettings : {};
    const globalTool = globalConfig?.toolCallConfig === undefined
        ? TextToImageToolCallConfigSchema.parse(DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG)
        : TextToImageToolCallConfigSchema.parse(globalConfig.toolCallConfig);
    const globalTail = globalConfig?.tailMessagesConfig === undefined
        ? TextToImageTailMessagesConfigSchema.parse(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG)
        : TextToImageTailMessagesConfigSchema.parse(globalConfig.tailMessagesConfig);
    const tool = hasOwn(providerRecord, "toolCallConfig")
        ? TextToImageToolCallConfigSchema.parse(providerRecord.toolCallConfig)
        : globalTool;
    const tail = hasOwn(providerRecord, "tailMessagesConfig")
        ? TextToImageTailMessagesConfigSchema.parse(providerRecord.tailMessagesConfig)
        : globalTail;
    return {
        ...parsedProvider,
        toolCallConfig: tool,
        tailMessagesConfig: tail,
    };
}

export function resolveToolCallConfig(value: unknown): TextToImageToolCallConfig {
    return TextToImageToolCallConfigSchema.parse(value);
}

export function resolveTailMessagesConfig(value: unknown): TextToImageTailMessagesConfig {
    return TextToImageTailMessagesConfigSchema.parse(value);
}

function createToolName(config: TextToImageToolCallConfig, bytes: Uint8Array): string {
    if (config.nameMode === "fixed") {
        return config.fixedName;
    }
    const suffix = Array.from(bytes.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const prefix = config.prefix.slice(0, 48);
    return `${prefix}${suffix}`.slice(0, 64);
}

function replaceToolName(value: string, toolName: string): string {
    return value
        .split("%TOOL_NAME%").join(toolName)
        .split("TOOL_NAME%").join(toolName)
        .split("%s").join(toolName);
}

/** Prepare the final OpenAI message/tool envelope after ordinary message preparation. */
export function prepareLlmToolCallRequest(
    messages: LlmChatMessage[],
    toolConfigInput: TextToImageToolCallConfig,
    tailConfigInput: TextToImageTailMessagesConfig,
    randomSource: () => Uint8Array = () => randomBytes(8),
): PreparedLlmToolCallRequest {
    const toolConfig = TextToImageToolCallConfigSchema.parse(toolConfigInput);
    const tailConfig = TextToImageTailMessagesConfigSchema.parse(tailConfigInput);
    if (!toolConfig.enabled) {
        return {messages: messages.map((message) => ({...message}))};
    }
    const toolName = createToolName(toolConfig, randomSource());
    const properties: Record<string, {type: "string"; description: string}> = {};
    const required: string[] = [];
    for (const field of toolConfig.fields) {
        properties[field.name] = {type: "string", description: field.description};
        if (field.required) required.push(field.name);
    }
    const tools: [LlmToolDefinition] = [{
        type: "function",
        function: {
            name: toolName,
            description: toolConfig.desc,
            parameters: {type: "object", properties, required},
        },
    }];
    const finalMessages = messages.map((message) => ({...message}));
    if (tailConfig.enabled) {
        for (const message of tailConfig.messages) {
            if (message.content === "") continue;
            finalMessages.push({role: message.role, content: replaceToolName(message.content, toolName)});
        }
    }
    return {
        messages: finalMessages,
        tools,
        toolChoice: {type: "function", function: {name: toolName}},
        toolName,
    };
}