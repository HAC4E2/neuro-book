import {
    TextToImageTailMessagesConfigSchema,
    TextToImageToolCallConfigSchema,
    type TextToImageTailMessagesConfig,
    type TextToImageToolCallConfig,
} from "nbook/shared/dto/text-to-image.dto";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrap(value: unknown, type: "antigravity_tool_config" | "antigravity_tail_config"): unknown {
    if (!isRecord(value)) return value;
    if (value.type !== undefined || value.version !== undefined) {
        if (value.type !== type) throw new Error(`文件类型必须是 ${type}`);
        if (value.version !== "1.0") throw new Error("只支持 version 1.0 配置文件");
        return value.data;
    }
    return value;
}

export function parseTextToImageToolConfig(value: unknown): TextToImageToolCallConfig {
    return TextToImageToolCallConfigSchema.parse(unwrap(value, "antigravity_tool_config"));
}

export function parseTextToImageTailConfig(value: unknown): TextToImageTailMessagesConfig {
    return TextToImageTailMessagesConfigSchema.parse(unwrap(value, "antigravity_tail_config"));
}

export function exportTextToImageToolConfig(config: TextToImageToolCallConfig): Record<string, unknown> {
    return {
        type: "antigravity_tool_config",
        version: "1.0",
        exportedAt: new Date().toISOString(),
        data: TextToImageToolCallConfigSchema.parse(config),
    };
}

export function exportTextToImageTailConfig(config: TextToImageTailMessagesConfig): Record<string, unknown> {
    return {
        type: "antigravity_tail_config",
        version: "1.0",
        exportedAt: new Date().toISOString(),
        data: TextToImageTailMessagesConfigSchema.parse(config),
    };
}