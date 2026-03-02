import type {BaseMessage} from "@langchain/core/messages";
import {isSystemMessage} from "@langchain/core/messages";

/**
 * 生成稳定消息 ID。
 */
export function getStableMessageId(message: BaseMessage, index: number): string {
    if (typeof message.id === "string" && message.id.trim()) {
        return message.id;
    }

    const createdAt = message.additional_kwargs?.messageCreatedAt;
    if (typeof createdAt === "string" && createdAt) {
        return `message-${createdAt}-${String(index)}`;
    }

    return `message-${String(index)}`;
}

/**
 * 判断是否为旧编辑器上下文消息。
 */
export function isEditorContextMessage(message: BaseMessage): boolean {
    return isSystemMessage(message) && message.name === "editor_context";
}
