import type {
    AgentConversationMessageDto,
    AgentConversationNodeDto,
    AgentPendingUserInputQuestionDto,
    AgentPendingUserInputSessionDto,
    AgentConversationToolCallDto,
    AgentConversationTreeSnapshotDto,
    AgentToolNodeStatusDto,
} from "nbook/shared/dto/agent-chat.dto";
import {toStableArgsJson} from "nbook/app/components/novel-ide/agent/tool-args-stream";

/**
 * 消息类型。
 */
export type MessageType = "user" | "ai" | "system";

/**
 * 系统消息在前端的展示类型。
 */
export type SystemMessageDisplayKind = "prompt" | "reminder" | "system";

/**
 * 消息状态。
 */
export type MessageStatus = "streaming" | "done" | "stopped";

/**
 * Tool Call 状态。
 */
export type ToolCallStatus = "streaming" | "invalid" | "running" | "success" | "error";

/**
 * 单个 Tool Call 实体。
 */
export type AgentToolCall = {
    id: string;
    index: number;
    name: string;
    argsText: string;
    argsJson?: string;
    status: ToolCallStatus;
    error?: string;
    result?: string;
    rawResult?: unknown;
    /** subagent 调度使用的线程 ID */
    subagentThreadId?: string;
    /** 所属 assistant 消息 ID */
    assistantMessageId?: string;
};

/**
 * 单条消息实体。
 */
export type AgentMessage = {
    id: string;
    type: MessageType;
    /** 仅 system 消息使用：用于区分首轮系统提示和运行时提醒。 */
    systemDisplayKind?: SystemMessageDisplayKind;
    content: string;
    html?: string;
    status?: MessageStatus;
    toolCalls?: AgentToolCall[];
    timestamp?: string;
    model?: string;
    tokens?: number;
    thinking?: string;
};

/**
 * 前端使用的历史树索引。
 */
export type AgentConversationTreeIndex = {
    revision: number;
    activeCursorId: string | null;
    rootNodeId: string | null;
    nodes: AgentConversationNodeDto[];
    nodeMap: Map<string, AgentConversationNodeDto>;
    activePathIds: string[];
};

export type AgentPendingUserInputQuestion = AgentPendingUserInputQuestionDto;
export type AgentPendingUserInputSession = AgentPendingUserInputSessionDto;

/**
 * 消息级 continuation 切换状态。
 */
export type AgentMessageSwitcherState = {
    nodeIds: string[];
    currentIndex: number;
    total: number;
};

/**
 * 对话流中的渲染节点。一条 AgentMessage 可展开为多个 ChatNode。
 */
export type ChatNode =
    | { kind: "text"; message: AgentMessage }
    | { kind: "tool"; message: AgentMessage; toolCall: AgentToolCall };

/**
 * 将消息列表展开为渲染节点列表。
 */
export const toChatNodes = (messages: AgentMessage[]): ChatNode[] => {
    const nodes: ChatNode[] = [];
    for (const message of messages) {
        if (message.type !== "ai") {
            nodes.push({kind: "text", message});
            continue;
        }
        if (message.content || message.thinking || !message.toolCalls?.length) {
            nodes.push({kind: "text", message});
        }
        const toolCalls = message.toolCalls ?? [];
        const lastTaskToolIndex = toolCalls.findLastIndex((toolCall) => toolCall.name === "task_create" || toolCall.name === "task_set_status");
        for (const [toolIndex, toolCall] of toolCalls.entries()) {
            if ((toolCall.name === "task_create" || toolCall.name === "task_set_status") && toolIndex !== lastTaskToolIndex) {
                continue;
            }
            nodes.push({kind: "tool", message, toolCall});
        }
    }
    return nodes;
};

/**
 * 格式化相对时间。
 */
export const formatTimestamp = (isoString?: string): string => {
    if (!isoString) return "";
    const date = new Date(isoString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
        return "刚刚";
    } else if (diffInSeconds < 3600) {
        return `${String(Math.floor(diffInSeconds / 60))} 分钟前`;
    } else if (diffInSeconds < 86400) {
        return `${String(Math.floor(diffInSeconds / 3600))} 小时前`;
    }
    return date.toLocaleDateString();
};

/**
 * 获取 ToolCall 的状态边框颜色类名。
 */
export const toolStatusClass = (toolCall: AgentToolCall): string => {
    switch (toolCall.status) {
        case "success": return "bg-green-500/10 text-green-500";
        case "error":
        case "invalid":
            return "bg-rose-500/10 text-rose-500";
        case "running":
        case "streaming":
            return "bg-blue-500/10 text-[var(--accent-text)]";
        default:
            return "bg-[var(--bg-input)] text-[var(--text-muted)]";
    }
};

/**
 * 获取 ToolCall 的状态图标。
 */
export const toolStatusIcon = (toolCall: AgentToolCall): string => {
    switch (toolCall.status) {
        case "success": return "i-lucide-check";
        case "error":
        case "invalid":
            return "i-lucide-x";
        case "running":
        case "streaming":
            return "i-lucide-loader-circle";
        default:
            return "i-lucide-circle-dashed";
    }
};

/**
 * 返回消息状态文本。
 */
export const messageStatusLabel = (message: AgentMessage): string => {
    if (message.toolCalls?.some((toolCall) => toolCall.status === "running")) {
        return "执行工具中";
    }
    if (message.toolCalls?.some((toolCall) => toolCall.status === "streaming")) {
        return "生成工具调用";
    }
    if (message.status === "streaming") {
        return "生成中";
    }
    return "";
};

/**
 * 选择更稳定的 tool call 状态，避免后到的低优先级状态覆盖终态。
 */
export const mergeToolCallStatus = (
    nextStatus: ToolCallStatus,
    previousStatus?: ToolCallStatus,
): ToolCallStatus => {
    if (!previousStatus) return nextStatus;
    if ((nextStatus === "streaming" || nextStatus === "running") && ["success", "error", "invalid"].includes(previousStatus)) {
        return previousStatus;
    }
    if (nextStatus === "streaming" && previousStatus === "running") {
        return previousStatus;
    }
    return nextStatus;
};

/**
 * 合并 assistant 上的 tool call，保持已有运行结果。
 */
export const mergeToolCalls = (nextToolCalls?: AgentToolCall[], previousToolCalls?: AgentToolCall[]): AgentToolCall[] | undefined => {
    if (!nextToolCalls?.length && !previousToolCalls?.length) {
        return undefined;
    }

    const previousMap = new Map((previousToolCalls ?? []).map((toolCall) => [toolCall.id, toolCall]));
    const merged = (nextToolCalls ?? []).map((toolCall) => {
        const previous = previousMap.get(toolCall.id);
        if (!previous) {
            return toolCall;
        }
        return {
            ...toolCall,
            status: mergeToolCallStatus(toolCall.status, previous.status),
            error: toolCall.error ?? previous.error,
            result: toolCall.result ?? previous.result,
            rawResult: toolCall.rawResult ?? previous.rawResult,
            subagentThreadId: toolCall.subagentThreadId ?? previous.subagentThreadId,
        };
    });

    for (const previous of previousToolCalls ?? []) {
        if (!merged.some((toolCall) => toolCall.id === previous.id)) {
            merged.push(previous);
        }
    }

    return merged.sort((left, right) => left.index - right.index);
};

/**
 * 将服务端快照工具节点转换为本地模型。
 */
export const toLocalToolCall = (toolCall: AgentConversationToolCallDto): AgentToolCall => {
    return {
        id: toolCall.id,
        assistantMessageId: toolCall.assistantMessageId,
        index: toolCall.callIndex,
        name: toolCall.toolName,
        argsText: toolCall.argsText,
        argsJson: toStableArgsJson(toolCall.argsText),
        status: mapToolNodeStatus(toolCall.status),
        result: toolCall.outputText,
        rawResult: toolCall.rawResult,
        subagentThreadId: toolCall.subagentThreadId,
    };
};

/**
 * 将服务端草稿消息转换为本地模型。
 */
export const toLocalMessage = (message: AgentConversationMessageDto): AgentMessage => ({
    id: message.id,
    type: message.role === "assistant" ? "ai" : message.role === "system" ? "system" : "user",
    content: message.content,
    status: message.status,
    timestamp: formatTimestamp(message.createdAt),
    model: message.model,
    tokens: message.tokens,
    thinking: message.thinking,
    toolCalls: message.toolCalls?.map(toLocalToolCall),
});

/**
 * 从历史 metadata 推断系统消息展示类型。
 */
const resolveSystemDisplayKind = (rawAdditionalKwargs: Record<string, unknown>): SystemMessageDisplayKind | undefined => {
    if (rawAdditionalKwargs.messageOrigin === "system_prompt") {
        return "prompt";
    }
    if (typeof rawAdditionalKwargs.systemMessageKind === "string") {
        return "reminder";
    }
    return undefined;
};

/**
 * 建立历史树索引。
 */
export const createConversationTreeIndex = (
    tree: AgentConversationTreeSnapshotDto,
): AgentConversationTreeIndex => {
    const nodes = [...tree.nodes].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const activePathIds: string[] = [];
    let currentId = tree.activeCursorId;

    while (currentId) {
        const current = nodeMap.get(currentId);
        if (!current || current.archivedAt) {
            break;
        }
        activePathIds.push(current.id);
        currentId = current.parentId;
    }

    return {
        revision: tree.revision,
        activeCursorId: tree.activeCursorId,
        rootNodeId: tree.rootNodeId,
        nodes,
        nodeMap,
        activePathIds: activePathIds.reverse(),
    };
};

/**
 * 从历史树派生当前聊天界面的 message 列表。
 */
export const deriveMessagesFromConversationTree = (treeIndex: AgentConversationTreeIndex): AgentMessage[] => {
    const messages: AgentMessage[] = [];

    for (const nodeId of treeIndex.activePathIds) {
        const node = treeIndex.nodeMap.get(nodeId);
        if (!node || node.archivedAt) {
            continue;
        }

        if (node.role === "tool") {
            const assistant = messages.at(-1);
            if (!assistant || assistant.type !== "ai") {
                continue;
            }
            const toolCalls = [...(assistant.toolCalls ?? [])];
            toolCalls.push(toToolCallFromNode(node));
            assistant.toolCalls = toolCalls.sort((left, right) => left.index - right.index);
            continue;
        }

        messages.push({
            id: node.id,
            type: node.role === "assistant" ? "ai" : node.role === "system" ? "system" : "user",
            systemDisplayKind: node.role === "system"
                ? resolveSystemDisplayKind(node.rawAdditionalKwargs)
                : undefined,
            content: node.content,
            status: node.status,
            timestamp: formatTimestamp(node.createdAt),
            model: typeof node.rawAdditionalKwargs.model === "string"
                ? node.rawAdditionalKwargs.model
                : undefined,
            tokens: typeof node.rawAdditionalKwargs.tokens === "number"
                ? node.rawAdditionalKwargs.tokens
                : undefined,
            thinking: typeof node.rawAdditionalKwargs.thinking === "string"
                ? node.rawAdditionalKwargs.thinking
                : undefined,
        });
    }

    return messages;
};

/**
 * 计算某条用户消息对应的 continuation 切换状态。
 */
export const resolveMessageSwitcher = (
    treeIndex: AgentConversationTreeIndex,
    messageId: string,
): AgentMessageSwitcherState | null => {
    const target = treeIndex.nodeMap.get(messageId);
    if (!target || target.archivedAt || target.role !== "user") {
        return null;
    }

    const siblingUserIds = resolveVisibleSiblingUserIds(treeIndex, target);
    if (siblingUserIds.length > 1) {
        return {
            nodeIds: siblingUserIds,
            currentIndex: Math.max(0, siblingUserIds.indexOf(target.id)),
            total: siblingUserIds.length,
        };
    }

    const childContinuationIds = target.childIds
        .map((childId) => treeIndex.nodeMap.get(childId))
        .filter((node): node is AgentConversationNodeDto => node !== undefined && node.archivedAt === null)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((node) => node.id);
    if (childContinuationIds.length <= 1) {
        return null;
    }

    const currentNodeId = childContinuationIds.find((nodeId) => treeIndex.activePathIds.includes(nodeId)) ?? childContinuationIds[0];
    if (!currentNodeId) {
        return null;
    }

    return {
        nodeIds: childContinuationIds,
        currentIndex: Math.max(0, childContinuationIds.indexOf(currentNodeId)),
        total: childContinuationIds.length,
    };
};

/**
 * 读取当前活动光标的角色。
 */
export const resolveActiveCursorRole = (
    treeIndex: AgentConversationTreeIndex | null,
): AgentConversationNodeDto["role"] | null => {
    if (!treeIndex?.activeCursorId) {
        return null;
    }
    return treeIndex.nodeMap.get(treeIndex.activeCursorId)?.role ?? null;
};

/**
 * 用稳定 key 对消息数组做原地 reconcile。
 */
export const reconcileMessages = (previousMessages: AgentMessage[], nextMessages: AgentMessage[]): AgentMessage[] => {
    const previousMap = new Map(previousMessages.map((message) => [message.id, message]));
    return nextMessages.map((message) => {
        const previous = previousMap.get(message.id);
        if (!previous) {
            return message;
        }
        return {
            ...previous,
            ...message,
            toolCalls: mergeToolCalls(message.toolCalls, previous.toolCalls),
        };
    });
};

/**
 * 从输入参数提取 subagentThreadId。
 */
export const parseSubagentThreadIdInfo = (inputText: string): string | undefined => {
    try {
        const parsed = JSON.parse(inputText);
        return parsed.subagentThreadId as string | undefined;
    } catch {
        return undefined;
    }
};

/**
 * 从工具调用结果中提取 subagentThreadId。
 */
export const parseSubagentResultThreadId = (resultText?: string): string | undefined => {
    if (!resultText) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(resultText) as {subagentThreadId?: string};
        return parsed.subagentThreadId;
    } catch {
        return undefined;
    }
};

/**
 * 读取某条用户消息的可见 sibling user 节点。
 */
const resolveVisibleSiblingUserIds = (
    treeIndex: AgentConversationTreeIndex,
    node: AgentConversationNodeDto,
): string[] => {
    if (!node.parentId) {
        return [node.id];
    }
    const parent = treeIndex.nodeMap.get(node.parentId);
    if (!parent) {
        return [node.id];
    }
    return parent.childIds
        .map((childId) => treeIndex.nodeMap.get(childId))
        .filter((child): child is AgentConversationNodeDto => child !== undefined && child.archivedAt === null && child.role === "user")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((child) => child.id);
};

/**
 * 将树中的 tool 节点转换为本地 ToolCall。
 */
const toToolCallFromNode = (node: AgentConversationNodeDto): AgentToolCall => {
    const toolNodeId = typeof node.rawAdditionalKwargs.toolNodeId === "string"
        ? node.rawAdditionalKwargs.toolNodeId
        : node.toolCallId ?? node.id;
    return {
        id: toolNodeId,
        assistantMessageId: node.assistantMessageId ?? undefined,
        index: parseToolCallIndex(toolNodeId),
        name: node.toolName ?? "unknown",
        argsText: node.toolArgs ?? "",
        argsJson: toStableArgsJson(node.toolArgs ?? ""),
        status: node.toolStatus === "error" ? "error" : "success",
        result: node.content,
        rawResult: node.rawAdditionalKwargs.toolResultRaw,
        subagentThreadId: typeof node.rawAdditionalKwargs.subagentThreadId === "string"
            ? node.rawAdditionalKwargs.subagentThreadId
            : undefined,
    };
};

const mapToolNodeStatus = (backendStatus: AgentToolNodeStatusDto): ToolCallStatus => {
    switch (backendStatus) {
        case "drafting": return "streaming";
        case "running": return "running";
        case "error": return "error";
        case "success": return "success";
    }
};

const parseToolCallIndex = (toolNodeId: string): number => {
    const separatorIndex = toolNodeId.lastIndexOf("-tool-");
    if (separatorIndex < 0) {
        return 0;
    }
    const rawIndex = Number(toolNodeId.slice(separatorIndex + "-tool-".length));
    return Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
};
