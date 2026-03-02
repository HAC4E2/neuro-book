<script setup lang="ts">
import { useAgentApi } from "nbook/app/composables/useAgentApi";
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";
import type { AgentStreamEventDto } from "nbook/shared/dto/agent-chat.dto";
import { useAgentThreadSession } from "nbook/app/components/novel-ide/agent/useAgentThreadSession";
import AgentChatFlow from "nbook/app/components/novel-ide/agent/AgentChatFlow.vue";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";

const props = defineProps<{
    /** 当前 invoke_subagent 的 tool call 数据。 */
    toolCall: AgentToolCall;
}>();

const agentApi = useAgentApi();

type BubbleStatus = "idle" | "loading" | "streaming" | "waiting_user" | "completed" | "failed";

const subagentThreadId = computed(() => props.toolCall.subagentThreadId);

const bubbleStatus = ref<BubbleStatus>("idle");
const inputText = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const abortController = ref<AbortController | null>(null);
const session = useAgentThreadSession();
const messages = session.messages;
const running = session.running;

/**
 * 解析 leader 侧 invoke_subagent 的最终完成结果。
 * 只有成功完成时才会携带 walkthrough/data；失败时保持为空。
 */
const completionResult = computed<{
    walkthrough: string;
    data?: unknown;
} | null>(() => {
    if (!props.toolCall.result) {
        return null;
    }
    try {
        const parsed = JSON.parse(props.toolCall.result) as {
            walkthrough?: string;
            data?: unknown;
        };
        if (typeof parsed.walkthrough !== "string" || !parsed.walkthrough.trim()) {
            return null;
        }
        return {
            walkthrough: parsed.walkthrough,
            data: parsed.data,
        };
    } catch {
        return null;
    }
});

/* ── 状态指示 ── */

const statusDotClass = computed(() => {
    switch (bubbleStatus.value) {
        case "loading":
        case "streaming":
            return "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse";
        case "waiting_user":
            return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse";
        case "completed":
            return "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]";
        case "failed":
            return "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]";
        default:
            return "bg-[var(--text-muted)]";
    }
});

const statusLabel = computed(() => {
    switch (bubbleStatus.value) {
        case "loading": return "Loading";
        case "streaming": return "Running";
        case "waiting_user": return "Waiting";
        case "completed": return "Done";
        case "failed": return "Error";
        default: return "Idle";
    }
});

/* ── SSE 事件处理 ── */
/**
 * 处理 subagent SSE 事件流。
 */
const handleSubagentEvent = (payload: AgentStreamEventDto): void => {
    const threadId = subagentThreadId.value;
    if (!threadId) return;
    session.applyEvent(payload);

    if (payload.type === "thread_snapshot") {
        if (payload.thread.status === "running") {
            bubbleStatus.value = "streaming";
        } else if (payload.thread.status === "waiting_user") {
            bubbleStatus.value = "waiting_user";
        } else if (payload.thread.status === "failed") {
            bubbleStatus.value = "failed";
        } else if (payload.thread.status === "idle" && messages.value.length === 0) {
            bubbleStatus.value = "idle";
        } else {
            bubbleStatus.value = "completed";
        }
        return;
    }

    if (payload.type === "run_state") {
        if (payload.status === "running") {
            bubbleStatus.value = "streaming";
        } else if (payload.status === "waiting_user") {
            bubbleStatus.value = "waiting_user";
        } else if (payload.status === "failed") {
            bubbleStatus.value = "failed";
        } else {
            bubbleStatus.value = "completed";
        }
        return;
    }

    if (
        payload.type === "thinking_delta"
        || payload.type === "assistant_delta"
        || payload.type === "tool_call_started"
        || payload.type === "tool_args_delta"
        || payload.type === "tool_exec_started"
        || payload.type === "tool_output_delta"
        || payload.type === "tool_finished"
    ) {
        bubbleStatus.value = "streaming";
    }
};

/* ── 加载与订阅 ── */

/**
 * 订阅 subagent 的 thread 级长期 SSE 流。
 */
const subscribe = async (): Promise<void> => {
    const threadId = subagentThreadId.value;
    if (!threadId) return;
    if (abortController.value) return;

    abortController.value = new AbortController();

    try {
        await agentApi.subscribeThreadStream(threadId, handleSubagentEvent, abortController.value.signal);
    } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
            bubbleStatus.value = "failed";
        }
    } finally {
        abortController.value = null;
    }
};

/**
 * 建立 subagent thread stream，并等待首帧同步消息初始化界面。
 */
const connectStream = async (): Promise<void> => {
    const threadId = subagentThreadId.value;
    if (!threadId) return;

    bubbleStatus.value = "loading";
    try {
        await subscribe();
    } catch (e) {
        console.error(`加载 subagent ${threadId} 失败`, e);
        bubbleStatus.value = "failed";
    }
};

/* ── subagent 独立输入 ── */

/**
 * 调整输入框高度。
 */
const resizeInput = (): void => {
    if (!textareaRef.value) return;
    textareaRef.value.style.height = "0px";
    textareaRef.value.style.height = `${String(Math.max(36, Math.min(textareaRef.value.scrollHeight, 120)))}px`;
};

/**
 * 向 subagent 发送消息（用于 ask_user 回答场景）。
 */
const sendToSubagent = async (): Promise<void> => {
    const threadId = subagentThreadId.value;
    const text = inputText.value.trim();
    if (!threadId || !text || running.value) return;

    session.appendOptimisticUserMessage(text);

    inputText.value = "";
    resizeInput();

    void subscribe();

    // 调度 subagent 运行
    await agentApi.invokeThread(
        threadId,
        agentApi.createPromptDispatchBody(text),
    );
    bubbleStatus.value = "streaming";
};

const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendToSubagent();
    }
};

const onInput = (event: Event): void => {
    inputText.value = (event.target as HTMLTextAreaElement).value;
    resizeInput();
};

/* ── 生命周期 ── */

/**
 * 监听 parent tool call 状态变化来启动订阅或加载历史。
 */
watch(() => props.toolCall.status, (status) => {
    // running 状态 → 初始化 SSE 订阅
    if (status === "running" && bubbleStatus.value === "idle" && subagentThreadId.value) {
        void connectStream();
    }
    // 已完成 → 加载完整历史
    if ((status === "success" || status === "error") && bubbleStatus.value === "idle") {
        void connectStream();
    }
    // 流式 fallback：parent 已标记成功但本地还没完成
    if (status === "success" && bubbleStatus.value !== "completed" && bubbleStatus.value !== "idle" && bubbleStatus.value !== "loading") {
        bubbleStatus.value = "completed";
        abortController.value?.abort();
        void connectStream();
    }
}, { immediate: true });

watch(subagentThreadId, (threadId, previousThreadId) => {
    if (threadId === previousThreadId) return;
    abortController.value?.abort();
    session.reset();
    bubbleStatus.value = "idle";
    if (!threadId) return;
    void connectStream();
}, { immediate: true });

onBeforeUnmount(() => {
    abortController.value?.abort();
});
</script>

<template>
    <!-- Subagent 执行气泡 -->
    <div class="mt-2 space-y-2">
        <!-- 身份标题栏 -->
        <div class="flex items-center gap-2">
            <span class="h-2 w-2 rounded-full" :class="statusDotClass" />
            <span class="text-xs font-semibold text-[var(--text-main)]">
                {{ subagentThreadId ? `Subagent #${subagentThreadId.slice(-6)}` : 'Subagent' }}
            </span>
            <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                {{ statusLabel }}
            </span>
        </div>

        <!-- 最终 walkthrough 展示 -->
        <div v-if="completionResult" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
            <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Walkthrough</div>
            <div class="text-xs leading-6 text-[var(--text-main)] max-h-[300px] overflow-y-auto pr-1">
                <AgentMarkdownContent :content="completionResult.walkthrough" />
            </div>
            <div v-if="completionResult.data !== undefined" class="mt-3">
                <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Data</div>
                <div class="break-all whitespace-pre-wrap rounded border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-xs text-[var(--text-secondary)] max-h-[200px] overflow-y-auto pr-1">
                    {{ JSON.stringify(completionResult.data, null, 2) }}
                </div>
            </div>
        </div>

        <!-- 对话流区域 -->
        <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-main)]/50 overflow-hidden flex flex-col" :class="{'border-blue-500/30': bubbleStatus === 'streaming', 'border-green-500/30': bubbleStatus === 'completed', 'border-amber-500/30': bubbleStatus === 'waiting_user', 'border-rose-500/30': bubbleStatus === 'failed'}">
            <!-- 内嵌 AgentChatFlow 渲染 subagent 消息流 -->
            <div class="flex flex-col max-h-[400px] min-h-0">
                <AgentChatFlow :messages="messages" :running="running" mode="subagent" />
            </div>

            <!-- 独立输入框（用于 subagent 提问回答） -->
            <div v-if="bubbleStatus === 'waiting_user' || bubbleStatus === 'completed'" class="border-t border-[var(--border-color)] p-2">
                <div class="flex items-end gap-2">
                    <textarea
                        ref="textareaRef"
                        :value="inputText"
                        rows="1"
                        placeholder="回复 Subagent…"
                        class="min-h-[36px] max-h-[120px] flex-1 resize-none overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]"
                        @input="onInput"
                        @keydown="onKeydown"
                    ></textarea>
                    <button class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!inputText.trim() || running" @click="void sendToSubagent()">
                        <span class="i-lucide-send h-3.5 w-3.5"></span>
                    </button>
                </div>
            </div>
        </div>

        <!-- 错误状态 fallback -->
        <div v-if="bubbleStatus === 'failed' && messages.length === 0" class="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500 font-mono">
            Subagent 执行失败。
        </div>

        <!-- 无 threadId fallback -->
        <template v-if="!subagentThreadId">
            <div class="mt-2 space-y-2 opacity-50">
                <div>
                    <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Arguments (Fallback)</div>
                    <div class="break-all whitespace-pre-wrap rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 font-mono text-xs text-[var(--text-secondary)]">
                        {{ props.toolCall.argsJson ?? props.toolCall.argsText }}
                    </div>
                </div>
                <div v-if="props.toolCall.result">
                    <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Result (Fallback)</div>
                    <div class="break-all whitespace-pre-wrap rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 font-mono text-xs text-[var(--text-secondary)]">
                        {{ props.toolCall.result }}
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>
