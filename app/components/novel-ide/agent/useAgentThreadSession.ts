import type {
    AgentConversationTreeSnapshotDto,
    AgentPendingUserInputSessionDto,
    AgentStreamEventDto,
    AgentThreadSnapshotEventDto,
} from "nbook/shared/dto/agent-chat.dto";
import {
    createConversationTreeIndex,
    deriveMessagesFromConversationTree,
    reconcileMessages,
    toLocalMessage,
    toLocalToolCall,
    type AgentConversationTreeIndex,
    type AgentMessage,
    type AgentToolCall,
} from "nbook/app/components/novel-ide/agent/agent-message";
import {toStableArgsJson} from "nbook/app/components/novel-ide/agent/tool-args-stream";

type PendingToolEventBuffer = {
    callIndex?: number;
    toolName?: string;
    argsText: string;
    outputText: string;
    subagentThreadId?: string;
    execStarted: boolean;
};

/**
 * 统一管理 history tree + draft SSE，并派生当前 UI message 列表。
 */
export function useAgentThreadSession() {
    const treeIndex = ref<AgentConversationTreeIndex | null>(null);
    const messages = ref<AgentMessage[]>([]);
    const draftMessage = ref<AgentMessage | null>(null);
    const running = ref(false);
    const pendingUserInputSession = ref<AgentPendingUserInputSessionDto | null>(null);
    const pendingToolBuffers = ref<Record<string, PendingToolEventBuffer>>({});

    /**
     * 重置当前会话状态。
     */
    const reset = (): void => {
        treeIndex.value = null;
        messages.value = [];
        draftMessage.value = null;
        running.value = false;
        pendingUserInputSession.value = null;
        pendingToolBuffers.value = {};
    };

    /**
     * 追加乐观用户消息。
     * 仅用于仍走 prompt 模式的 subagent 气泡。
     */
    const appendOptimisticUserMessage = (content: string): void => {
        messages.value = reconcileMessages(messages.value, [
            ...messages.value,
            {
                id: `user-${String(Date.now())}`,
                type: "user",
                content,
                status: "done",
                timestamp: "刚刚",
            },
        ]);
    };

    /**
     * 应用首帧快照。
     */
    const applySnapshot = (payload: AgentThreadSnapshotEventDto): void => {
        applyConversationTree(payload.conversationTree);
        pendingToolBuffers.value = {};
        running.value = payload.thread.status === "running" || payload.thread.status === "waiting_user";
        draftMessage.value = payload.draft ? toLocalMessage(payload.draft) : null;
        pendingUserInputSession.value = payload.pendingUserInputSession;
        rebuildUiMessages();
    };

    /**
     * 应用一次完整历史树快照。
     */
    const applyConversationTree = (payload: AgentConversationTreeSnapshotDto): void => {
        treeIndex.value = createConversationTreeIndex(payload);
        if (draftMessage.value && treeIndex.value.nodeMap.has(draftMessage.value.id)) {
            draftMessage.value = null;
        }
        rebuildUiMessages();
    };

    /**
     * 单独更新挂起中的结构化问题。
     */
    const setPendingUserInputSession = (payload: AgentPendingUserInputSessionDto | null): void => {
        pendingUserInputSession.value = payload;
    };

    /**
     * 应用一条增量事件。
     */
    const applyEvent = (payload: AgentStreamEventDto): void => {
        if (payload.type === "thread_snapshot") {
            applySnapshot(payload);
            return;
        }

        if (payload.type === "history_snapshot") {
            applyConversationTree(payload.conversationTree);
            return;
        }

        if (payload.type === "run_state") {
            running.value = payload.status === "running" || payload.status === "waiting_user";
            if (payload.status !== "waiting_user") {
                pendingUserInputSession.value = null;
            }
            if (payload.status === "completed" || payload.status === "stopped" || payload.status === "failed") {
                pendingToolBuffers.value = {};
                draftMessage.value = null;
                rebuildUiMessages();
            }
            return;
        }

        if (payload.type === "user_input_requested") {
            running.value = true;
            pendingUserInputSession.value = payload.session;
            rebuildUiMessages();
            return;
        }

        if (payload.type === "thinking_delta") {
            appendThinkingDelta(payload.messageId, payload.chunkText);
            return;
        }

        if (payload.type === "assistant_delta") {
            appendAssistantDelta(payload.messageId, payload.chunkText);
            return;
        }

        if (payload.type === "tool_call_started") {
            const pending = takePendingToolBuffer(payload.assistantMessageId, payload.toolNodeId);
            upsertStreamingToolCall(payload.assistantMessageId, {
                id: payload.toolNodeId,
                assistantMessageId: payload.assistantMessageId,
                index: pending?.callIndex ?? payload.callIndex,
                name: payload.toolName,
                argsText: pending?.argsText ?? "",
                argsJson: toStableArgsJson(pending?.argsText),
                status: pending?.execStarted ? "running" : "streaming",
                result: pending?.outputText || undefined,
                subagentThreadId: payload.subagentThreadId ?? pending?.subagentThreadId,
            });
            return;
        }

        if (payload.type === "tool_args_delta") {
            if (!hasStreamingToolCall(payload.assistantMessageId, payload.toolNodeId)) {
                bufferToolEvent(payload.assistantMessageId, payload.toolNodeId, {
                    argsText: payload.argsChunk,
                });
                return;
            }
            appendToolArgsDelta(payload.assistantMessageId, payload.toolNodeId, payload.argsChunk);
            return;
        }

        if (payload.type === "tool_exec_started") {
            if (!hasStreamingToolCall(payload.assistantMessageId, payload.toolNodeId)) {
                bufferToolEvent(payload.assistantMessageId, payload.toolNodeId, {
                    execStarted: true,
                    subagentThreadId: payload.subagentThreadId,
                });
                return;
            }
            upsertStreamingToolCall(payload.assistantMessageId, {
                id: payload.toolNodeId,
                assistantMessageId: payload.assistantMessageId,
                index: 0,
                name: "",
                argsText: "",
                status: "running",
                subagentThreadId: payload.subagentThreadId,
            });
            return;
        }

        if (payload.type === "tool_output_delta") {
            if (!hasStreamingToolCall(payload.assistantMessageId, payload.toolNodeId)) {
                bufferToolEvent(payload.assistantMessageId, payload.toolNodeId, {
                    outputText: payload.outputChunk,
                });
                return;
            }
            appendToolOutputDelta(payload.assistantMessageId, payload.toolNodeId, payload.outputChunk);
            return;
        }

        if (payload.type === "tool_finished") {
            takePendingToolBuffer(payload.assistantMessageId, payload.toolCall.toolNodeId);
            upsertStreamingToolCall(payload.assistantMessageId, toLocalToolCall(payload.toolCall));
            return;
        }

        if (payload.type === "assistant_done") {
            if (!draftMessage.value || draftMessage.value.id !== payload.message.id) {
                draftMessage.value = toLocalMessage(payload.message);
            }
            rebuildUiMessages();
        }
    };

    /**
     * 根据 tree + draft 重建界面消息列表。
     */
    const rebuildUiMessages = (): void => {
        const committedMessages = treeIndex.value
            ? deriveMessagesFromConversationTree(treeIndex.value)
            : [];
        const nextMessages = draftMessage.value
            ? upsertDraftIntoMessages(committedMessages, draftMessage.value)
            : committedMessages;
        messages.value = reconcileMessages(messages.value, nextMessages);
    };

    /**
     * 把 draft assistant 合并进当前消息序列。
     */
    const upsertDraftIntoMessages = (committedMessages: AgentMessage[], draft: AgentMessage): AgentMessage[] => {
        const targetIndex = committedMessages.findIndex((message) => message.id === draft.id);
        if (targetIndex === -1) {
            return [...committedMessages, {
                ...draft,
                type: "ai",
                status: "streaming",
            }];
        }

        const nextMessages = [...committedMessages];
        nextMessages[targetIndex] = {
            ...nextMessages[targetIndex],
            ...draft,
            type: "ai",
            status: "streaming",
        };
        return nextMessages;
    };

    /**
     * 确保 draft assistant 存在。
     */
    const ensureDraftAssistant = (messageId: string): AgentMessage => {
        if (!draftMessage.value || draftMessage.value.id !== messageId) {
            draftMessage.value = {
                id: messageId,
                type: "ai",
                content: "",
                status: "streaming",
                timestamp: "刚刚",
                toolCalls: [],
            };
        }
        return draftMessage.value;
    };

    /**
     * 追加 thinking 文本增量。
     */
    const appendThinkingDelta = (messageId: string, chunkText: string): void => {
        const draft = ensureDraftAssistant(messageId);
        draftMessage.value = {
            ...draft,
            thinking: `${draft.thinking ?? ""}${chunkText}`,
            status: "streaming",
        };
        rebuildUiMessages();
    };

    /**
     * 追加 assistant 文本增量。
     */
    const appendAssistantDelta = (messageId: string, chunkText: string): void => {
        const draft = ensureDraftAssistant(messageId);
        draftMessage.value = {
            ...draft,
            content: `${draft.content}${chunkText}`,
            status: "streaming",
        };
        rebuildUiMessages();
    };

    /**
     * 以 assistantMessageId + toolNodeId 为主键更新工具节点。
     */
    const upsertStreamingToolCall = (assistantMessageId: string, toolCall: AgentToolCall): void => {
        const draft = ensureDraftAssistant(assistantMessageId);
        const toolCalls = [...(draft.toolCalls ?? [])];
        const targetIndex = toolCalls.findIndex((item) => item.id === toolCall.id);
        if (targetIndex === -1) {
            toolCalls.push(toolCall);
        } else {
            const previous = toolCalls[targetIndex]!;
            toolCalls[targetIndex] = {
                ...previous,
                ...toolCall,
                index: previous.index,
                name: toolCall.name && toolCall.name !== "unknown" ? toolCall.name : previous.name,
                argsText: toolCall.argsText || previous.argsText,
                argsJson: toolCall.argsJson ?? previous.argsJson,
                result: toolCall.result ?? previous.result,
                rawResult: toolCall.rawResult ?? previous.rawResult,
                error: toolCall.error ?? previous.error,
                subagentThreadId: toolCall.subagentThreadId ?? previous.subagentThreadId,
            };
        }

        draftMessage.value = {
            ...draft,
            status: "streaming",
            toolCalls: toolCalls.sort((left, right) => left.index - right.index),
        };
        rebuildUiMessages();
    };

    /**
     * 判断当前 draft 上是否已经创建过目标工具节点。
     */
    const hasStreamingToolCall = (assistantMessageId: string, toolNodeId: string): boolean => {
        return Boolean(
            draftMessage.value
            && draftMessage.value.id === assistantMessageId
            && draftMessage.value.toolCalls?.some((toolCall) => toolCall.id === toolNodeId),
        );
    };

    /**
     * 缓存尚未等到 tool_call_started 的工具事件。
     */
    const bufferToolEvent = (
        assistantMessageId: string,
        toolNodeId: string,
        patch: Partial<PendingToolEventBuffer>,
    ): void => {
        const key = getPendingToolBufferKey(assistantMessageId, toolNodeId);
        const previous = pendingToolBuffers.value[key];
        pendingToolBuffers.value = {
            ...pendingToolBuffers.value,
            [key]: {
                callIndex: patch.callIndex ?? previous?.callIndex,
                toolName: patch.toolName ?? previous?.toolName,
                argsText: `${previous?.argsText ?? ""}${patch.argsText ?? ""}`,
                outputText: `${previous?.outputText ?? ""}${patch.outputText ?? ""}`,
                subagentThreadId: patch.subagentThreadId ?? previous?.subagentThreadId,
                execStarted: patch.execStarted ?? previous?.execStarted ?? false,
            },
        };
    };

    /**
     * 取出并清空某个工具节点的缓冲事件。
     */
    const takePendingToolBuffer = (assistantMessageId: string, toolNodeId: string): PendingToolEventBuffer | undefined => {
        const key = getPendingToolBufferKey(assistantMessageId, toolNodeId);
        const target = pendingToolBuffers.value[key];
        if (!target) {
            return undefined;
        }
        const nextBuffers = {...pendingToolBuffers.value};
        delete nextBuffers[key];
        pendingToolBuffers.value = nextBuffers;
        return target;
    };

    /**
     * 追加流式 tool 参数增量。
     */
    const appendToolArgsDelta = (assistantMessageId: string, toolNodeId: string, chunkText: string): void => {
        const currentToolCall = draftMessage.value?.toolCalls?.find((toolCall) => toolCall.id === toolNodeId);
        const nextArgsText = `${currentToolCall?.argsText ?? ""}${chunkText}`;
        upsertStreamingToolCall(assistantMessageId, {
            id: toolNodeId,
            assistantMessageId,
            index: currentToolCall?.index ?? 0,
            name: currentToolCall?.name ?? "unknown",
            argsText: nextArgsText,
            argsJson: toStableArgsJson(nextArgsText),
            status: "streaming",
            result: currentToolCall?.result,
            subagentThreadId: currentToolCall?.subagentThreadId,
        });
    };

    /**
     * 追加流式 tool 输出增量。
     */
    const appendToolOutputDelta = (assistantMessageId: string, toolNodeId: string, chunkText: string): void => {
        const currentToolCall = draftMessage.value?.toolCalls?.find((toolCall) => toolCall.id === toolNodeId);
        if (!currentToolCall) {
            return;
        }
        upsertStreamingToolCall(assistantMessageId, {
            ...currentToolCall,
            result: `${currentToolCall.result ?? ""}${chunkText}`,
        });
    };

    return {
        applyConversationTree,
        applyEvent,
        applySnapshot,
        appendOptimisticUserMessage,
        messages,
        pendingUserInputSession,
        reset,
        running,
        setPendingUserInputSession,
        treeIndex,
    };
}

const getPendingToolBufferKey = (assistantMessageId: string, toolNodeId: string): string => {
    return `${assistantMessageId}:${toolNodeId}`;
};
