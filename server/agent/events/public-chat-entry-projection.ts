import type {ToolCall, ToolResultMessage} from "@earendil-works/pi-ai";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {visibleStoredUserContent} from "nbook/server/agent/messages/stored-user-markdown";
import {
    CHAT_ENTRY_MAX_BLOCKS,
    CHAT_ENTRY_PREVIEW_BYTES,
    CHAT_ENTRY_SERIALIZED_TEXT_BYTES,
} from "nbook/server/agent/events/public-event-policy";
import {
    budgetText,
    createPublicProjectionBudget,
    projectPublicAttachment,
    projectPublicToolArgs,
    projectPublicToolName,
    projectPublicToolResult,
    textPreview,
} from "nbook/server/agent/events/public-tool-projection";
import {createPublicTextBudget, projectPublicText} from "nbook/server/agent/events/public-text-projection";
import {
    PUBLIC_ASSISTANT_TEXT_BYTES,
    PUBLIC_ASSISTANT_TOOL_CALLS,
    PUBLIC_TOOL_ARGS_TEXT_BYTES,
} from "nbook/server/agent/events/public-event-policy";
import type {SessionEntry} from "nbook/server/agent/session/types";
import type {AgentChatEntryDto, AgentChatUserEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";

export type AgentChatEntryProjectionContext = {
    /** assistant entry 所属 invocation；非 assistant 时忽略。 */
    invocationId?: string;
};

/**
 * 将 append-only 账本 entry 投影为 Chat Flow 的有界公开 entry。
 */
export function projectAgentChatEntry(
    entry: SessionEntry,
    context: AgentChatEntryProjectionContext = {},
): AgentChatEntryDto | null {
    if (entry.type === "message") {
        return projectMessageEntry(entry, context);
    }
    if (entry.type === "custom_message") {
        const content = customMessageText(entry.message);
        const reminder = content.includes("<system-reminder>")
            || customMessageKind(entry.message) === "system-reminder"
            || customMessageKind(entry.message) === "reminder";
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "system",
            source: reminder ? "reminder" : "custom",
            label: reminder ? "System Reminder" : `Custom: ${customMessageKind(entry.message)}`,
            content: textPreview(content, CHAT_ENTRY_PREVIEW_BYTES),
        };
    }
    if (entry.type === "compaction") {
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "system",
            source: "compaction",
            label: "Compaction",
            content: textPreview(entry.summary, CHAT_ENTRY_PREVIEW_BYTES),
        };
    }
    if (entry.type === "branch_summary") {
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "system",
            source: "branch_summary",
            label: "Branch Summary",
            content: textPreview(entry.summary, CHAT_ENTRY_PREVIEW_BYTES),
        };
    }
    if (entry.type === "invocation_lifecycle" && entry.status === "error") {
        const message = entry.errorInfo?.message?.trim() || entry.error?.trim();
        if (!message) {
            return null;
        }
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "invocation_error",
            invocationId: entry.invocationId,
            message: textPreview(message, CHAT_ENTRY_PREVIEW_BYTES),
            phase: entry.errorInfo?.phase ?? "unknown",
            ...(entry.errorInfo?.retryable === undefined ? {} : {retryable: entry.errorInfo.retryable}),
            ...(entry.errorInfo?.code ? {code: entry.errorInfo.code} : {}),
        };
    }
    return null;
}

/**
 * 投影标准 message entry。
 */
function projectMessageEntry(
    entry: Extract<SessionEntry, {type: "message"}>,
    context: AgentChatEntryProjectionContext,
): AgentChatEntryDto | null {
    const message = entry.message;
    if (message.role === "user") {
        if (entry.origin !== "prompt" && entry.intent !== "steer") {
            return null;
        }
        if (!entry.clientMessageId || !entry.intent) {
            throw new Error(`公开用户消息 ${entry.id} 缺少 clientMessageId 或 intent`);
        }
        const visible = visibleStoredUserContent(message, entry.intent);
        const publicContent = projectUserContent(visible.blocks);
        return {
            id: entry.id,
            clientMessageId: entry.clientMessageId,
            timestamp: entry.timestamp,
            type: "user",
            ...publicContent,
            intent: entry.intent,
        };
    }
    if (message.role === "assistant") {
        const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
        const thinking = message.content.filter((block) => block.type === "thinking").map((block) => block.thinking).join("");
        const textBudget = createPublicProjectionBudget(PUBLIC_ASSISTANT_TEXT_BYTES);
        const error = message.errorMessage ? budgetText(message.errorMessage, textBudget, 8 * 1024) : undefined;
        const content = budgetText(text, textBudget, 48 * 1024);
        const thinkingPreview = budgetText(thinking, textBudget);
        const rawToolCalls = message.content
            .map((block, index) => ({block, index}))
            .filter((item): item is {block: ToolCall; index: number} => item.block.type === "toolCall");
        const toolArgsBudget = createPublicProjectionBudget(PUBLIC_TOOL_ARGS_TEXT_BYTES);
        const toolCalls = rawToolCalls
            .slice(0, PUBLIC_ASSISTANT_TOOL_CALLS)
            .map(({block, index}) => ({
                id: assertPublicToolCallId(block.id),
                index,
                name: projectPublicToolName(block.name),
                args: projectPublicToolArgs(block.name, block.arguments, toolArgsBudget),
            }));
        return {
            id: textPreview(entry.id, 512).preview,
            timestamp: entry.timestamp,
            type: "assistant",
            ...(context.invocationId ? {invocationId: context.invocationId} : {}),
            content,
            thinking: thinkingPreview,
            ...(error ? {error} : {}),
            status: entry.status ?? "done",
            model: textPreview(message.responseModel ?? message.model, 1024).preview,
            usage: {
                ...message.usage,
                cost: {...message.usage.cost},
            },
            toolCalls,
            omittedToolCalls: Math.max(0, rawToolCalls.length - toolCalls.length),
        };
    }
    if (message.role !== "toolResult") {
        return null;
    }
    return projectToolResultEntry(entry.id, entry.timestamp, message);
}

/** 投影 user message 的唯一保序公开内容；steer envelope 已由 intent 驱动解包。 */
function projectUserContent(
    visibleBlocks: ReturnType<typeof visibleStoredUserContent>["blocks"],
): Pick<AgentChatUserEntryDto, "blocks" | "omittedBlocks" | "textSummary"> {
    const textBudget = createPublicTextBudget(CHAT_ENTRY_PREVIEW_BYTES, CHAT_ENTRY_SERIALIZED_TEXT_BYTES);
    const blocks: AgentChatUserEntryDto["blocks"] = [];
    let textBytes = 0;
    let textOmitted = false;
    visibleBlocks.forEach(({block, contentIndex}) => {
        if (block.type === "text") {
            textBytes += Buffer.byteLength(block.text, "utf8");
            if (blocks.length >= CHAT_ENTRY_MAX_BLOCKS) {
                textOmitted = textOmitted || block.text.length > 0;
                return;
            }
            const content = projectPublicText(block.text, textBudget);
            textOmitted = textOmitted || content.omitted;
            blocks.push({type: "text", contentIndex, content});
            return;
        }
        if (blocks.length >= CHAT_ENTRY_MAX_BLOCKS) {
            return;
        }
        if (block.type === "attachment") {
            const attachment = projectPublicAttachment(block.attachment, block.name);
            if (attachment) {
                blocks.push({type: "attachment", contentIndex, attachment});
            }
        }
    });
    return {
        blocks,
        omittedBlocks: Math.max(0, visibleBlocks.length - blocks.length),
        textSummary: {bytes: textBytes, omitted: textOmitted},
    };
}

/**
 * 投影 durable tool result。
 */
function projectToolResultEntry(
    id: string,
    timestamp: number,
    message: ToolResultMessage | Extract<StoredAgentMessage, {role: "toolResult"}>,
): AgentChatEntryDto {
    return {
        id,
        timestamp,
        type: "tool_result",
        toolCallId: assertPublicToolCallId(message.toolCallId),
        toolName: projectPublicToolName(message.toolName),
        result: projectPublicToolResult(message.toolName, {
            content: message.content,
            details: message.details,
        }),
        isError: message.isError,
    };
}

/**
 * custom message 只读取受支持的文本字段，禁止 JSON.stringify 任意对象。
 */
function customMessageText(message: unknown): string {
    if (message === null || typeof message !== "object") {
        return "";
    }
    const record = message as Record<string, unknown>;
    if (typeof record.content === "string") {
        return record.content;
    }
    if (!Array.isArray(record.content)) {
        return "";
    }
    return record.content
        .filter((block): block is {type: "text"; text: string} => {
            return block !== null
                && typeof block === "object"
                && "type" in block
                && block.type === "text"
                && "text" in block
                && typeof block.text === "string";
        })
        .map((block) => block.text)
        .join("\n");
}

/**
 * custom message 的公开类别。
 */
function customMessageKind(message: unknown): string {
    if (message === null || typeof message !== "object") {
        return "custom";
    }
    const record = message as Record<string, unknown>;
    if (typeof record.customType === "string") {
        return textPreview(record.customType, 256).preview || "custom";
    }
    if (typeof record.role === "string") {
        return textPreview(record.role, 256).preview || "custom";
    }
    return "custom";
}
