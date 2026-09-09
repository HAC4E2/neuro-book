import {TextToImageToolCallConfigSchema, type TextToImageToolCallConfig} from "nbook/shared/dto/text-to-image.dto";

export type ToolCallResponse = {
    choices?: Array<{
        message?: {
            content?: unknown;
            tool_calls?: unknown;
        };
        delta?: {
            content?: unknown;
            tool_calls?: unknown;
        };
        finish_reason?: unknown;
    }>;
};

type ToolCall = {
    function?: {name?: unknown; arguments?: unknown};
};

function getToolCalls(value: unknown): ToolCall[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ToolCall => typeof item === "object" && item !== null) as ToolCall[];
}

function parseArguments(value: unknown): Record<string, unknown> {
    if (typeof value !== "string" || value === "") {
        throw new Error("LLM 工具参数不是完整 JSON 字符串");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(`LLM 工具参数 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("LLM 工具参数必须是 JSON 对象");
    }
    return parsed as Record<string, unknown>;
}

function wrapField(value: string, tag: string): string {
    if (tag === "") return value;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const wrapped = new RegExp(`^<${escaped}>[\\s\\S]*</${escaped}>$`, "u");
    if (wrapped.test(value)) return value;
    if (tag === "thinking" && new RegExp("^<think>[\\s\\S]*<\\/think>$", "u").test(value)) return value;
    return `<${tag}>${value}</${tag}>`;
}

function decodeOneToolCall(call: ToolCall, config: TextToImageToolCallConfig, expectedName: string): string {
    const name = call.function?.name;
    if (name !== expectedName) {
        throw new Error(`LLM 返回未知工具：${typeof name === "string" ? name : "(缺少名称)"}`);
    }
    const args = parseArguments(call.function?.arguments);
    const values: string[] = [];
    for (const field of config.fields) {
        const raw = args[field.name];
        if (raw === undefined) {
            if (field.required) throw new Error(`LLM 工具缺少必填字段：${field.name}`);
            continue;
        }
        if (typeof raw !== "string") {
            throw new Error(`LLM 工具字段不是字符串：${field.name}`);
        }
        if (field.required && raw.length === 0) {
            throw new Error(`LLM 工具必填字段为空：${field.name}`);
        }
        values.push(wrapField(raw, field.wrapTag));
    }
    if (values.length === 0 || values.every((value) => value === "")) {
        throw new Error("LLM 工具没有可用输出");
    }
    return values.join("\n\n");
}

/** Decode choices[0] using the configured tool contract; no tool is ever executed. */
export function decodeLlmCompletionPayload(
    payload: unknown,
    options: {toolEnabled: boolean; toolName?: string; toolConfig?: TextToImageToolCallConfig},
): string {
    const value = payload as ToolCallResponse;
    const choice = value.choices?.[0];
    if (!choice) throw new Error("LLM 返回缺少 choices[0]");
    const content = choice.message?.content;
    const calls = getToolCalls(choice.message?.tool_calls);
    if (!options.toolEnabled) {
        return typeof content === "string" ? content : "";
    }
    if (calls.length === 0) {
        if (typeof content === "string" && content.trim() !== "") return content;
        throw new Error("LLM 未返回工具内容或文本");
    }
    if (!options.toolName || !options.toolConfig) throw new Error("LLM 工具解码缺少工具配置");
    const config = TextToImageToolCallConfigSchema.parse(options.toolConfig);
    return calls.map((call) => decodeOneToolCall(call, config, options.toolName as string)).join("\n\n");
}

export type SseAccumulator = {
    content: string;
    calls: Map<number, {name: string; arguments: string}>;
    finishReason: string | null;
    done: boolean;
};

function accumulateToolCalls(target: Map<number, {name: string; arguments: string}>, raw: unknown): void {
    if (!Array.isArray(raw)) return;
    for (const [position, item] of raw.entries()) {
        if (typeof item !== "object" || item === null) continue;
        const record = item as {index?: unknown; function?: {name?: unknown; arguments?: unknown}};
        const index = typeof record.index === "number" && Number.isInteger(record.index) ? record.index : position;
        const current = target.get(index) ?? {name: "", arguments: ""};
        if (typeof record.function?.name === "string") current.name += record.function.name;
        if (typeof record.function?.arguments === "string") current.arguments += record.function.arguments;
        target.set(index, current);
    }
}

export function createSseAccumulator(): SseAccumulator {
    return {content: "", calls: new Map(), finishReason: null, done: false};
}

export function accumulateSsePayload(accumulator: SseAccumulator, payload: unknown, onDelta?: (delta: string) => void): void {
    const value = payload as ToolCallResponse;
    const choice = value.choices?.[0];
    if (!choice) return;
    if (typeof choice.finish_reason === "string") accumulator.finishReason = choice.finish_reason;
    const delta = choice.delta?.content;
    if (typeof delta === "string") {
        accumulator.content += delta;
        onDelta?.(delta);
    }
    accumulateToolCalls(accumulator.calls, choice.delta?.tool_calls);
}

export function finishSseAccumulator(
    accumulator: SseAccumulator,
    options: {toolEnabled: boolean; toolName?: string; toolConfig?: TextToImageToolCallConfig},
): string {
    if (accumulator.finishReason === "length") throw new Error("LLM 流式响应因 length 截断，工具参数不完整");
    if (!options.toolEnabled) {
        if (accumulator.content.trim() === "") throw new Error("LLM 返回空响应");
        return accumulator.content;
    }
    if (accumulator.calls.size === 0) {
        if (accumulator.content.trim() !== "") return accumulator.content;
        throw new Error("LLM 未返回工具内容或文本");
    }
    if (!options.toolName || !options.toolConfig) throw new Error("LLM 工具解码缺少工具配置");
    const config = TextToImageToolCallConfigSchema.parse(options.toolConfig);
    return [...accumulator.calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => decodeOneToolCall({function: call}, config, options.toolName as string)).join("\n\n");
}