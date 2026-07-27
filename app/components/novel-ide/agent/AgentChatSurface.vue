<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useNovelIdeStore, type AgentWorkspaceSyncPayload} from "nbook/app/stores/novel-ide";
import {isNovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {hasVisibleInvocationError, isContinuationPointMessage, toPendingUserInputSession, type AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import {applyClientVariablePatch, buildAgentClientState} from "nbook/app/components/novel-ide/agent/client-variables";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import {useAgentSessionStream, type AgentSessionStreamRecoveryReason} from "nbook/app/components/novel-ide/agent/useAgentSessionStream";
import {applyAgentCommandResult} from "nbook/app/components/novel-ide/agent/agent-command-result";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {useCostDisplay} from "nbook/app/composables/useCostDisplay";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import AgentChatFlow from "nbook/app/components/novel-ide/agent/AgentChatFlow.vue";
import AgentSystemPromptPanel from "nbook/app/components/novel-ide/agent/AgentSystemPromptPanel.vue";
import AgentComposer from "nbook/app/components/novel-ide/agent/AgentComposer.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import AgentLinkedAgentPanel from "nbook/app/components/novel-ide/agent/AgentLinkedAgentPanel.vue";
import AgentSessionDialog from "nbook/app/components/novel-ide/agent/AgentSessionDialog.vue";
import AgentSessionTreeDialog from "nbook/app/components/novel-ide/agent/AgentSessionTreeDialog.vue";
import AgentSessionAttachmentPanel from "nbook/app/components/novel-ide/agent/AgentSessionAttachmentPanel.vue";
import {deriveAgentTreeState, resolveBranchSwitchTarget} from "nbook/app/components/novel-ide/agent/session-tree";
import {AgentSessionListRequestGuard} from "nbook/app/components/novel-ide/agent/session-list-request-guard";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useThemeManager} from "nbook/app/composables/useThemeManager";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {formatCost, formatCostExact, usingCnyRate} from "nbook/app/utils/cost-format";
import {promptCacheHitRate, type PromptCacheUsage} from "nbook/app/utils/prompt-cache";
import type {ConfigModelSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentQueuedMessageDto, AgentSessionAttachmentItemDto, AgentSessionInteractionDto, AgentSessionListPageDto, AgentSessionListQueryDto, AgentSessionRecoveryDto, AgentSessionSummaryDto, AgentPendingUserInputDto, AgentMode} from "nbook/shared/dto/agent-session.dto";
import {AgentModeSchema} from "nbook/shared/dto/agent-session.dto";
import type {AgentCommandResult, InvokeAgentResult} from "nbook/shared/dto/agent-session.dto";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {InlineEditPayload} from "nbook/app/utils/inline-editor-selection";
import {LowCodeJsonObjectSchema} from "nbook/shared/dto/low-code-form.dto";
import {
    AgentComposerDraftSession,
    type AgentComposerDraftContext,
    type AgentComposerDraftSaveResult,
    type AgentComposerSubmission,
} from "nbook/app/components/novel-ide/agent/agent-composer-draft";
import {
    agentMessageMarkdown,
} from "nbook/app/components/novel-ide/agent/agent-user-message-markdown";
import {
    attachmentIdFromMarkdownTarget,
    parseAgentImageMarkdown,
} from "nbook/shared/agent/agent-image-markdown";
import {
    reconcileInvocationReceipt,
    reconcileInvocationTransportFailure,
} from "nbook/app/components/novel-ide/agent/agent-invocation-reconciliation";

type LeaderCreateProfileOption = {
    profileKey: string;
    label: string;
    iconClass: string;
};

const NO_SESSION_INTERACTION: AgentSessionInteractionDto = {
    canInvoke: false,
    canResolveUserInput: false,
    canRegisterAttachment: false,
    canInsertAttachment: false,
    canMutateHistory: false,
    canChangeRuntime: false,
    canArchive: false,
    canRestore: false,
    canAbort: false,
};

const INLINE_EDITOR_PROFILE_KEY = "inline.editor";

const props = defineProps<{
    active: boolean;
    layout: "drawer" | "workbench";
    novelId: string;
    historyInboxRefreshKey?: string | number;
    selectedFilePath?: string;
    /** 打开消息 Markdown 中的 workspace 引用。 */
    openReference?: (target: string) => void;
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "sync-workspace", payload: AgentWorkspaceSyncPayload): void;
    (e: "open-reference", target: string): void;
    (e: "open-history-inbox"): void;
}>();

const inputText = ref("");
const chatFlowRef = ref<InstanceType<typeof AgentChatFlow> | null>(null);
const inputRef = ref<InstanceType<typeof AgentComposer> | null>(null);

const sessions = ref<AgentSessionSummaryDto[]>([]);
const sessionListTotal = ref(0);
const sessionListHasMore = ref(false);
const sessionListNextOffset = ref<number | null>(null);
const activeSessionId = ref<number | null>(null);
const inlineEditorSessions = ref<AgentSessionSummaryDto[]>([]);
const inlineEditorSessionId = ref<number | null>(null);
const inlineEditorSessionLoading = ref(false);
const inlineEditorResultText = ref("");
const linkedAgentPanelOpen = ref(false);
const loadingSession = ref(false);
const sessionListLoading = ref(false);
const linkedAgentsLoading = ref(false);
const previousSelectedFilePath = ref<string | null>(props.selectedFilePath || null);
const fileChangedSinceLastSend = ref(false);
const selectionVersion = ref(0);
const sessionDialogOpen = ref(false);
const sessionTreeDialogOpen = ref(false);
const systemPromptPanelOpen = ref(false);
const attachmentPanelOpen = ref(false);
const sessionAttachments = ref<AgentSessionAttachmentItemDto[]>([]);
const knownSessionAttachments = ref<AgentSessionAttachmentItemDto[]>([]);
const sessionAttachmentUniqueTotal = ref(0);
const sessionAttachmentPageTotal = ref(0);
const sessionAttachmentHasMore = ref(false);
const sessionAttachmentNextOffset = ref<number | null>(null);
const sessionAttachmentLoading = ref(false);
const sessionAttachmentSearch = ref("");
const sessionActionId = ref<number | null>(null);
const editingMessageId = ref<string | null>(null);
const editingMessageText = ref("");
const historyAttachmentInsertRequest = ref<{id: number; item: AgentSessionAttachmentItemDto} | null>(null);
const messageActionId = ref<string | null>(null);
const selectableModels = ref<ConfigModelSettingsDto["enabledModels"]>([]);
const resolvedDefaultProfileKey = ref("leader.default");
const sessionModelDraft = ref<AgentSessionModelDraft>({
    modelKey: null,
    reasoningEffort: null,
});
const sessionModelPopoverOpen = ref(false);
const sessionModelSaving = ref(false);
const inlineSessionModelDraft = ref<AgentSessionModelDraft>({
    modelKey: null,
    reasoningEffort: null,
});
const inlineSessionModelPopoverOpen = ref(false);
const inlineSessionModelSaving = ref(false);
const submittingUserInputKey = ref<string | null>(null);
const userInputSelectedAnswers = ref<Record<string, number[]>>({});
const userInputNotes = ref<Record<string, string>>({});
let defaultProfileResolveRequest = 0;
let ensureSessionRequest: Promise<AgentSessionSummaryDto[]> | null = null;
let suppressLeaderProfileReset = false;
let inlineEditorSessionRequestId = 0;
let sessionAttachmentRequestId = 0;
let historyAttachmentInsertRequestId = 0;
let sessionAttachmentSearchTimer: ReturnType<typeof setTimeout> | null = null;
let composerDraftWarning = "";
let composerDraftSession: AgentComposerDraftSession | null = null;
const composerContextGeneration = ref(0);
const sessionListRequestGuard = new AgentSessionListRequestGuard();
const hiddenWritingModeProfileKeys = new Set(["rp.leader", "simulator.leader"]);

/**
 * 应用 session 列表分页结果。
 */
function applySessionListPage(page: AgentSessionListPageDto, append: boolean): AgentSessionSummaryDto[] {
    if (append) {
        const seenSessionIds = new Set(sessions.value.map((sessionSummary) => sessionSummary.sessionId));
        sessions.value = [
            ...sessions.value,
            ...page.items.filter((sessionSummary) => {
                if (seenSessionIds.has(sessionSummary.sessionId)) {
                    return false;
                }
                seenSessionIds.add(sessionSummary.sessionId);
                return true;
            }),
        ];
    } else {
        sessions.value = page.items;
    }
    sessionListTotal.value = page.total;
    sessionListHasMore.value = page.hasMore;
    sessionListNextOffset.value = page.nextOffset ?? null;
    return sessions.value;
}

const sanitizeHtml = ref<((html: string) => string) | null>(null);
const session = useAgentSession();
const inlineEditorSession = useAgentSession();
const agentApi = useAgentSessionApi();
const configApi = useConfigApi();
const themeManager = useThemeManager();
const costDisplay = useCostDisplay();
const messages = session.messages;
const running = session.running;
const inlineEditorMessages = inlineEditorSession.messages;
const inlineEditorRunning = inlineEditorSession.running;
const connectionStatus = session.connectionStatus;
const runPhase = session.runPhase;
const pendingUserInputSession = session.pendingUserInputSession;
const pendingUserInputSessionsComputed = computed(() => {
    const pendings = session.recoveryShell.value?.pendingUserInputs ?? [];
    return pendings.map((pending: AgentPendingUserInputDto) => toPendingUserInputSession(pending, messages.value))
        .filter((s): s is AgentPendingUserInputSession => s !== null);
});
const {confirm, prompt} = useDialog();
const notification = useNotification();
const {t} = useI18n();

const ideStore = useNovelIdeStore();
const {
    selectedStoryThreadId,
    selectedStorySceneId,
    workspaceTree,
} = storeToRefs(ideStore);

/** 打开 Agent 消息里的 workspace 引用。 */
function openMessageReference(target: string): void {
    if (props.openReference) {
        props.openReference(target);
        return;
    }
    emit("open-reference", target);
}

const novelIdRef = toRef(props, "novelId");
const {
    resolveMenu: resolveInputMenu,
    menuRefreshKey: agentMenuRefreshKey,
    refreshSkillCatalog,
} = useStructuredReferenceMenu({
    novelId: novelIdRef,
    selectedStoryThreadId,
    selectedStorySceneId,
    workspaceTree,
});

provide("sanitizeHtml", sanitizeHtml);

const activeRecovery = computed(() => session.recoveryShell.value);
const activeSummary = computed(() => activeRecovery.value?.summary ?? null);
const activeInteraction = computed(() => activeSummary.value?.interaction ?? NO_SESSION_INTERACTION);
const activeSummarizer = computed(() => activeRecovery.value?.summarizer ?? null);
const linkedAgents = computed(() => activeRecovery.value?.linkedAgents ?? []);
const linkedByAgents = computed(() => activeRecovery.value?.linkedByAgents ?? []);
const queuedMessages = computed<AgentQueuedMessageDto[]>(() => [
    ...activeRecovery.value?.steerQueue.items ?? [],
    ...activeRecovery.value?.followUpQueue.items ?? [],
].sort((left, right) => left.createdAt - right.createdAt));
const linkedAgentCount = computed(() => linkedAgents.value.length + linkedByAgents.value.length);
const agentMode = computed<AgentMode>(() => activeRecovery.value?.agentMode ?? "normal");
const activeModelSupportsImages = computed(() => {
    const selectedKey = sessionModelDraft.value.modelKey;
    const selected = selectedKey
        ? selectableModels.value.find((model) => model.key === selectedKey)
        : selectableModels.value.find((model) => model.providerId === activeRecovery.value?.model?.providerConfigId
            && model.modelId === activeRecovery.value?.model?.modelId);
    return selected?.input.includes("image") ?? false;
});
const renderNodes = computed(() => messages.value);
const inlineEditorCurrentTurnMessages = computed<AgentMessage[]>(() => {
    const latestUserIndex = inlineEditorMessages.value.findLastIndex((message) => message.type === "user");
    return latestUserIndex >= 0
        ? inlineEditorMessages.value.slice(latestUserIndex + 1)
        : inlineEditorMessages.value;
});
const inlineEditPreview = computed(() => {
    const toolCall = inlineEditorCurrentTurnMessages.value
        .flatMap((message) => message.toolCalls ?? [])
        .filter((item) => (item.name === "edit" || item.name === "write") && (item.status === "streaming" || item.status === "running"))
        .at(-1);
    if (!toolCall) {
        return "";
    }
    const path = readToolPath(toolCall);
    const status = t("agent.chatSurface.inlineRunning");
    const result = toolCall.error || toolCall.result || "";
    return [`${status}${path ? `：${path}` : ""}`, result].filter(Boolean).join("\n");
});
const inlineEditorLiveView = computed(() => {
    const latestAssistant = inlineEditorCurrentTurnMessages.value
        .filter((message) => message.type === "ai")
        .at(-1);
    return {
        thinking: latestAssistant?.thinking ?? "",
        content: latestAssistant?.content ?? "",
        status: latestAssistant?.status ?? null,
        editPreview: inlineEditPreview.value,
        resultText: inlineEditorResultText.value,
    };
});
const inlineEditorSessionLabel = computed(() => {
    const selected = inlineEditorSessions.value.find((item) => item.sessionId === inlineEditorSessionId.value)
        ?? inlineEditorSession.recoveryShell.value?.summary
        ?? null;
    if (!selected) {
        return t("agent.chatSurface.inlineSessionLabel");
    }
    return selected.title || `Inline AI #${String(selected.sessionId)}`;
});
const messageActionsDisabled = computed(() => Boolean(messageActionId.value));
const historyMutationDisabled = computed(() => Boolean(messageActionId.value) || !activeInteraction.value.canMutateHistory);
const composerReadonly = computed(() => pendingUserInputSession.value
    ? !activeInteraction.value.canResolveUserInput
    : !activeInteraction.value.canInvoke);
const composerReadonlyReason = computed(() => {
    if (activeSummary.value?.archived) {
        return "当前 Session 已归档；恢复后才能继续交互。";
    }
    if (activeSummary.value?.profileAvailability !== "loaded") {
        return activeSummary.value?.profileIssueMessage || "当前 Profile 缺失或不可运行。";
    }
    if (pendingUserInputSession.value && !activeInteraction.value.canResolveUserInput) {
        return "当前等待输入状态不可回答。";
    }
    return "当前 Session 暂不可交互。";
});
const canContinueWithoutInput = computed(() => {
    if (!activeInteraction.value.canInvoke || running.value || inputText.value.trim() || messages.value.length === 0) {
        return false;
    }
    return isContinuationPointMessage(messages.value.at(-1), {
        allowSettledAiToolCalls: activeSummary.value?.status === "interrupted",
    });
});
const connectionStatusLabel = computed(() => {
    switch (connectionStatus.value) {
        case "connecting": return t("agent.chatSurface.connecting");
        case "reconnecting": return t("agent.chatSurface.reconnecting");
        case "recovering": return t("agent.chatSurface.recovering");
        case "disconnected": return t("agent.chatSurface.disconnected");
        default: return "";
    }
});
const connectionNeedsAction = computed(() => connectionStatus.value === "disconnected" || sessionStream.reconnectAttempt.value > 3);
const runPhaseLabel = computed(() => {
    switch (runPhase.value) {
        case "model_pending": return t("agent.chatSurface.phaseModelPending");
        case "thinking": return t("agent.chatSurface.phaseThinking");
        case "assistant_streaming": return t("agent.chatSurface.phaseAssistantStreaming");
        case "tool_args_streaming": return t("agent.chatSurface.phaseToolArgsStreaming");
        case "tool_running": return t("agent.chatSurface.phaseToolRunning");
        case "tool_streaming": return t("agent.chatSurface.phaseToolStreaming");
        case "waiting_user": return t("agent.chatSurface.phaseWaitingUser");
        case "finishing": return t("agent.chatSurface.phaseFinishing");
        default: return t("agent.chatSurface.phaseRunning");
    }
});

const systemLeaderProfileKey = computed(() => {
    return ideStore.workspaceKind === "user-assets" ? "leader.assets" : "leader.default";
});

const leaderProfileKey = computed(() => {
    if (ideStore.workspaceKind !== "user-assets" && hiddenWritingModeProfileKeys.has(resolvedDefaultProfileKey.value)) {
        return systemLeaderProfileKey.value;
    }
    return resolvedDefaultProfileKey.value || systemLeaderProfileKey.value;
});

const createProfileOptions = computed<LeaderCreateProfileOption[]>(() => {
    const defaultKey = leaderProfileKey.value;
    const options: LeaderCreateProfileOption[] = [
        {
            profileKey: defaultKey,
            label: defaultKey === systemLeaderProfileKey.value ? profileDisplayName(defaultKey) : t("agent.profiles.defaultPrefix", {name: profileDisplayName(defaultKey)}),
            iconClass: profileIconClass(defaultKey),
        },
    ];
    if (ideStore.workspaceKind !== "user-assets") {
        options.push(
            {profileKey: "leader.default", label: profileDisplayName("leader.default"), iconClass: profileIconClass("leader.default")},
        );
    }
    const seen = new Set<string>();
    return options.filter((option) => {
        if (seen.has(option.profileKey)) {
            return false;
        }
        seen.add(option.profileKey);
        return true;
    });
});
const createProfileDropdownItems = computed<DropdownItem[]>(() => createProfileOptions.value.map((option) => ({
    label: option.label,
    value: option.profileKey,
    iconClass: option.iconClass,
    active: option.profileKey === activeSummary.value?.profileKey,
})));
const canChooseCreateProfile = computed(() => createProfileOptions.value.length > 1);

const workspaceKey = computed(() => {
    if (ideStore.workspaceKind === "user-assets") {
        return "user-assets";
    }
    return ideStore.currentNovelId || "workspace";
});

const agentWorkspaceRoot = computed(() => ideStore.workspaceKind === "user-assets" ? "workspace/.nbook" : ideStore.currentWorkspaceRoot || "workspace");

/**
 * 把 Agent 面板内 API 异常统一转换为 notification 文案。
 */
const notifyAgentError = (error: unknown, fallback: string, title = fallback): string => {
    const message = resolveApiErrorMessage(error, fallback);
    notification.error(message, {title});
    return message;
};

/**
 * 将 InlineEditPayload 转成 DTO 接受的 JsonValue。
 */
function inlineEditPayloadToJson(payload: InlineEditPayload): JsonValue {
    return {
        version: payload.version,
        task: payload.task,
        targetPath: payload.targetPath,
        instruction: payload.instruction,
        references: payload.references.map((reference) => {
            const output: {[key: string]: JsonValue} = {
                ref: reference.ref,
                path: reference.path,
                match: reference.match,
                text: reference.text,
            };
            if (reference.range) {
                output.range = {
                    startLine: reference.range.startLine,
                    endLine: reference.range.endLine,
                };
            }
            return output;
        }),
    };
}

/**
 * 从文件工具参数中读取 path，用于 Inline AI 轻量预览。
 */
function readToolPath(toolCall: AgentToolCall): string {
    const argsText = toolCall.argsJson || toolCall.argsText;
    if (!argsText.trim()) {
        return "";
    }
    try {
        const parsed = JSON.parse(argsText) as {path?: string};
        return typeof parsed.path === "string" ? parsed.path : "";
    } catch {
        return "";
    }
}

/**
 * 生成等待用户输入实例的稳定 key，用来避免旧 pending 的提交态影响下一组问题。
 */
function pendingUserInputKey(session: typeof pendingUserInputSession.value): string | null {
    if (!session) {
        return null;
    }
    const firstQuestion = session.questions[0];
    const toolKey = firstQuestion?.toolCallId ?? firstQuestion?.toolNodeId;
    return toolKey ? `${session.assistantMessageId}\n${toolKey}` : session.assistantMessageId;
}

/**
 * 返回 profile 在抽屉里的短名称。
 */
function profileDisplayName(profileKey: string): string {
    switch (profileKey) {
        case "leader.assets": return t("agent.profiles.leaderAssets");
        case "rp.leader": return t("agent.profiles.rpLeader");
        case "simulator.leader": return t("agent.profiles.simulatorLeader");
        case "leader.default": return t("agent.profiles.leaderDefault");
        default: return profileKey;
    }
}

/**
 * 返回创建菜单使用的 profile 图标。
 */
function profileIconClass(profileKey: string): string {
    switch (profileKey) {
        case "leader.assets": return "i-lucide-folder-heart";
        case "rp.leader": return "i-lucide-theater";
        case "simulator.leader": return "i-lucide-orbit";
        case "leader.default": return "i-lucide-sparkles";
        default: return "i-lucide-bot";
    }
}

const currentPendingUserInputKey = computed(() => pendingUserInputKey(pendingUserInputSession.value));
const submittingCurrentUserInput = computed(() => {
    return Boolean(submittingUserInputKey.value && submittingUserInputKey.value === currentPendingUserInputKey.value);
});

/**
 * 当前挂起提问 session 变化时，重置本地答案草稿。
 */
watch(() => pendingUserInputSession.value?.assistantMessageId ?? null, () => {
    userInputSelectedAnswers.value = {};
    userInputNotes.value = {};
}, {immediate: true});

const activeDrawerTitle = computed(() => profileDisplayName(activeSummary.value?.profileKey ?? leaderProfileKey.value));
const activeSessionTitle = computed(() => activeSummary.value?.title || (activeSessionId.value ? `Session #${String(activeSessionId.value)}` : t("agent.session.unnamed")));
const activeSessionSummaryText = computed(() => activeSummary.value?.summary?.trim() || activeSummary.value?.lastMessagePreview?.trim() || t("agent.session.noRecentMessages"));
const summarizerStatus = computed<null | {
    label: string;
    icon: string;
    className: string;
    title: string;
    spinning: boolean;
}>(() => {
    const state = activeSummarizer.value;
    if (!state) {
        return null;
    }
    if (state.running && state.dirty) {
        return {
            label: t("agent.chatSurface.summaryQueued"),
            icon: "i-lucide-refresh-cw",
            className: "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]",
            title: t("agent.chatSurface.summaryQueuedTitle"),
            spinning: true,
        };
    }
    if (state.running) {
        return {
            label: t("agent.chatSurface.summarizing"),
            icon: "i-lucide-loader-circle",
            className: "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]",
            title: t("agent.chatSurface.summarizingTitle"),
            spinning: true,
        };
    }
    if (state.lastError) {
        return {
            label: t("agent.chatSurface.summaryFailed"),
            icon: "i-lucide-triangle-alert",
            className: "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]",
            title: state.lastError,
            spinning: false,
        };
    }
    return null;
});
const sessionModelSelectionValue = computed(() => sessionModelDraft.value.modelKey);
const sessionThinkingResolvedLabel = computed(() => {
    const requested = activeRecovery.value?.thinkingLevel ?? null;
    const effective = activeRecovery.value?.effectiveThinkingLevel ?? "off";
    if (requested === null) {
        return t("agent.chatSurface.followProfileCurrent", {level: thinkingLevelLabel(effective)});
    }
    if (requested === effective) {
        return thinkingLevelLabel(effective);
    }
    return t("agent.chatSurface.requestedEffective", {requested: thinkingLevelLabel(requested), effective: thinkingLevelLabel(effective)});
});
const inlineSessionModelSelectionValue = computed(() => inlineSessionModelDraft.value.modelKey);
const inlineSessionThinkingResolvedLabel = computed(() => {
    const requested = inlineEditorSession.recoveryShell.value?.thinkingLevel ?? null;
    const effective = inlineEditorSession.recoveryShell.value?.effectiveThinkingLevel ?? "off";
    if (requested === null) {
        return t("agent.chatSurface.followProfileCurrent", {level: thinkingLevelLabel(effective)});
    }
    if (requested === effective) {
        return thinkingLevelLabel(effective);
    }
    return t("agent.chatSurface.requestedEffective", {requested: thinkingLevelLabel(requested), effective: thinkingLevelLabel(effective)});
});
const drawerIconClass = computed(() => "i-lucide-sparkles text-[var(--accent-text)]");

const sessionTreeState = computed(() => deriveAgentTreeState(activeRecovery.value?.tree ?? []));
const branchSwitcherStateByMessageId = computed(() => sessionTreeState.value.switcherByMessageId);

const contextUsageCompactLabel = computed(() => {
    const usage = activeRecovery.value?.contextUsage;
    if (!usage) {
        return "- / -";
    }
    return `${formatCompactTokenCount(usage.usedTokens)} / ${formatCompactTokenCount(usage.limitTokens)}`;
});
const contextUsageExactLabel = computed(() => {
    const usage = activeRecovery.value?.contextUsage;
    if (!usage) {
        return t("agent.chatSurface.contextUnknown");
    }
    const percent = typeof usage.percent === "number" && Number.isFinite(usage.percent)
        ? `（${formatPercent(usage.percent)}）`
        : "";
    return t("agent.chatSurface.contextEstimate", {used: formatTokenCount(usage.usedTokens), limit: formatTokenCount(usage.limitTokens), percent});
});
const contextPercentCompactLabel = computed(() => {
    const percent = activeRecovery.value?.contextUsage?.percent;
    return typeof percent === "number" && Number.isFinite(percent) ? formatPercent(percent) : "";
});
const cumulativeInputCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.input));
const cumulativeOutputCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.output));
const cumulativeCacheCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.cacheRead));
const cumulativeCacheWriteCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.cacheWrite));
const cumulativeCacheHitRateLabel = computed(() => {
    const usage = activeSummary.value?.usage;
    return usage ? formatCacheHitRate(usage) : "";
});
const costDisplayOptions = computed(() => costDisplay.costDisplayOptions.value);
const costExchangeRateSuffix = computed(() => {
    if (!usingCnyRate(costDisplayOptions.value)) {
        return "";
    }
    return costDisplay.exchangeRateStale.value ? t("agent.chatSurface.cachedRateSuffix") : t("agent.chatSurface.currentRateSuffix");
});
const cumulativeCostCompactLabel = computed(() => formatCost(activeSummary.value?.usage?.cost.total, costDisplayOptions.value));
const cumulativeUsageExactLabel = computed(() => {
    const usage = activeSummary.value?.usage;
    if (!usage) {
        return t("agent.chatSurface.totalUsageEmpty");
    }
    const costLabel = formatCost(usage.cost.total, costDisplayOptions.value)
        ? t("agent.chatSurface.totalUsageWithCost", {
            compactCost: formatCost(usage.cost.total, costDisplayOptions.value),
            inputCost: formatCostExact(usage.cost.input, costDisplayOptions.value),
            outputCost: formatCostExact(usage.cost.output, costDisplayOptions.value),
            cacheReadCost: formatCostExact(usage.cost.cacheRead, costDisplayOptions.value),
            cacheWriteCost: formatCostExact(usage.cost.cacheWrite, costDisplayOptions.value),
            totalCost: formatCostExact(usage.cost.total, costDisplayOptions.value),
            suffix: costExchangeRateSuffix.value,
        })
        : "";
    return t("agent.chatSurface.totalUsage", {
        input: formatTokenCount(usage.input),
        output: formatTokenCount(usage.output),
        cacheRead: formatTokenCount(usage.cacheRead),
        cacheWrite: formatTokenCount(usage.cacheWrite),
        hitRate: formatCacheHitRate(usage),
        cost: costLabel,
    });
});

/**
 * 将 token 数值格式化为精确文本。
 */
function formatTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }
    return new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 0}).format(value);
}

/**
 * 将 token 数值格式化为 K/M 紧凑文本。
 */
function formatCompactTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
    }
    return `${value}`;
}

/**
 * 格式化 context 使用百分比。
 */
function formatPercent(value: number): string {
    return `${new Intl.NumberFormat("zh-CN", {
        maximumFractionDigits: value >= 10 ? 0 : 1,
    }).format(value)}%`;
}

/**
 * 格式化 prompt cache 命中率；口径见 `app/utils/prompt-cache.ts`，无从计算时显示 —。
 *
 * 这里传入的是**会话累计** usage，只适合当粗略指示。首轮全量 cacheWrite 会永久压在
 * 累计分母里，判断缓存健康度要看上下文面板的逐请求时间轴。
 */
function formatCacheHitRate(usage: PromptCacheUsage): string {
    const rate = promptCacheHitRate(usage);
    return rate === null ? "—" : formatPercent(rate);
}

/**
 * 显示 PI thinking level 的中文标签。
 */
function thinkingLevelLabel(level: ThinkingLevelDto): string {
    switch (level) {
        case "off": return t("agent.composer.off");
        case "minimal": return t("agent.composer.minimal");
        case "low": return t("agent.composer.low");
        case "medium": return t("agent.composer.medium");
        case "high": return t("agent.composer.high");
        case "xhigh": return t("agent.composer.xhigh");
        case "max": return t("agent.composer.max");
    }
}

/**
 * 组装 Novel IDE 客户端变量快照。目前新 profile 第一版不走 header，但保留本地上下文组装入口。
 */
const buildClientState = () => {
    const isUserAssetsWorkspace = ideStore.workspaceKind === "user-assets";
    return buildAgentClientState({
        activePanel: isNovelIdeTab(ideStore.activeLeftTab) ? ideStore.activeLeftTab : null,
        theme: ideStore.activeThemeId,
        novelId: isUserAssetsWorkspace ? "" : ideStore.currentNovelId,
        workspace: ideStore.currentWorkspaceRoot || null,
        workspaceKind: ideStore.workspaceKind,
        selectedFilePath: props.selectedFilePath || null,
        selectedStoryThreadId: isUserAssetsWorkspace ? null : selectedStoryThreadId.value,
        selectedStorySceneId: isUserAssetsWorkspace ? null : selectedStorySceneId.value,
        previousSelectedFilePath: previousSelectedFilePath.value,
        fileChangedSinceLastSend: fileChangedSinceLastSend.value,
        selectionVersion: selectionVersion.value,
    });
};

/**
 * 读取可选模型列表。
 */
const loadSelectableModels = async (): Promise<void> => {
    try {
        const settings = await configApi.bootstrap();
        selectableModels.value = settings.modelSettings.enabledModels;
        costDisplay.setCostCurrency(settings.ui.costCurrency);
        void costDisplay.ensureExchangeRate(configApi.exchangeRate);
    } catch (error) {
        console.error("读取模型列表失败", error);
        selectableModels.value = [];
    }
};

/**
 * 按当前 workspace 解析默认 Agent Profile。
 */
const loadResolvedLeaderProfileKey = async (): Promise<void> => {
    const requestId = ++defaultProfileResolveRequest;
    if (ideStore.workspaceKind !== "user-assets" && !ideStore.currentNovelId) {
        if (requestId === defaultProfileResolveRequest) {
            resolvedDefaultProfileKey.value = systemLeaderProfileKey.value;
        }
        return;
    }
    try {
        const settings = await configApi.bootstrap();
        if (requestId !== defaultProfileResolveRequest) {
            return;
        }
        resolvedDefaultProfileKey.value = settings.defaultProfileSettings.effectiveProfileKey || systemLeaderProfileKey.value;
        costDisplay.setCostCurrency(settings.ui.costCurrency);
        void costDisplay.ensureExchangeRate(configApi.exchangeRate);
    } catch (error) {
        if (requestId !== defaultProfileResolveRequest) {
            return;
        }
        console.error("读取默认 Agent Profile 失败", error);
        resolvedDefaultProfileKey.value = systemLeaderProfileKey.value;
    }
};

/**
 * 刷新 session 列表。
 */
const refreshSessions = async (): Promise<AgentSessionSummaryDto[]> => {
    return refreshSessionsWithQuery({
        profileGroup: "leader",
        status: "active",
        relation: "all",
        limit: 50,
    });
};

/**
 * 按弹窗筛选条件刷新 session 列表。
 */
const refreshSessionsWithQuery = async (query: AgentSessionListQueryDto = {}): Promise<AgentSessionSummaryDto[]> => {
    const requestQuery = {
        ...query,
        workspaceKey: workspaceKey.value,
    };
    const request = sessionListRequestGuard.begin(requestQuery);
    if (!request.shouldFetch) {
        return sessions.value;
    }
    sessionListRequestGuard.start();
    sessionListLoading.value = true;
    try {
        const page = await agentApi.listSessions(requestQuery);
        if (!sessionListRequestGuard.accepts(request)) {
            return sessions.value;
        }
        const nextSessions = applySessionListPage(page, request.append);
        sessionListRequestGuard.markApplied(request);
        return nextSessions;
    } catch (error) {
        if (!sessionListRequestGuard.accepts(request)) {
            return sessions.value;
        }
        console.error("刷新 session 列表失败", error);
        notifyAgentError(error, t("agent.chatSurface.loadSessionsFailed"));
        throw error;
    } finally {
        sessionListLoading.value = sessionListRequestGuard.finish(request);
    }
};

/**
 * 恢复当前 workspace 下已有的有效 session，不主动创建新 session。
 */
const ensureSessionReady = async (): Promise<AgentSessionSummaryDto[]> => {
    if (ensureSessionRequest) {
        return ensureSessionRequest;
    }
    ensureSessionRequest = ensureSessionReadyInternal();
    try {
        return await ensureSessionRequest;
    } finally {
        ensureSessionRequest = null;
    }
};

/**
 * 执行 session 恢复。
 */
const ensureSessionReadyInternal = async (): Promise<AgentSessionSummaryDto[]> => {
    if (!props.active) {
        return sessions.value;
    }
    if (activeSessionId.value) {
        return sessions.value;
    }
    await loadResolvedLeaderProfileKey();
    if (activeSessionId.value) {
        return sessions.value;
    }
    const list = await refreshSessions();
    if (activeSessionId.value) {
        return list;
    }
    const rememberedId = readLastSessionId();
    const rememberedSession = rememberedId ? list.find((item) => item.sessionId === rememberedId) : undefined;
    const target = rememberedSession ?? list[0];
    if (target) {
        await loadSession(target.sessionId);
        return list;
    }
    return list;
};

/**
 * 显式创建一个新的 session。只能由按钮、弹窗或 /new 这类用户命令调用。
 */
const createSession = async (profileKey?: string): Promise<AgentSessionSummaryDto[]> => {
    await loadResolvedLeaderProfileKey();
    const created = await agentApi.createSession({
        profileKey: profileKey || leaderProfileKey.value,
        initial: {},
        workspaceRoot: agentWorkspaceRoot.value,
        workspaceKey: workspaceKey.value,
        projectPath: ideStore.workspaceKind === "user-assets" ? undefined : ideStore.currentNovelId,
    });
    await refreshSessions();
    await loadSession(created.sessionId);
    return sessions.value;
};

/** 草稿保存结果只使用控制器捕获的 context，不能读取已经切换后的响应式 key。 */
function handleComposerDraftSave(result: AgentComposerDraftSaveResult, context: AgentComposerDraftContext): void {
    if (result === "oversize" && composerDraftWarning !== `${context.workspaceKey}:${String(context.sessionId)}:oversize`) {
        composerDraftWarning = `${context.workspaceKey}:${String(context.sessionId)}:oversize`;
        notification.warning("Composer 草稿超过 256 KiB，已停止保存该草稿。", {title: "草稿过大"});
    }
    if (result === "unsafe" && composerDraftWarning !== `${context.workspaceKey}:${String(context.sessionId)}:unsafe`) {
        composerDraftWarning = `${context.workspaceKey}:${String(context.sessionId)}:unsafe`;
        notification.warning("草稿包含 data/blob 图片地址，已按安全规则丢弃。", {title: "草稿未保存"});
    }
}

function ensureComposerDraftSession(): AgentComposerDraftSession | null {
    if (!import.meta.client) {
        return null;
    }
    composerDraftSession ??= new AgentComposerDraftSession(localStorage, handleComposerDraftSave);
    return composerDraftSession;
}

/** 立即持久化控制器当前 context；pending File 永远不进入 inputText。 */
function saveComposerDraftNow(): void {
    const drafts = ensureComposerDraftSession();
    if (!drafts) return;
    drafts.update(inputText.value);
    drafts.flush();
}

/** 原子切换草稿 context，并返回用于 remount Composer 的 generation。 */
function switchComposerDraftContext(sessionId: number): void {
    const drafts = ensureComposerDraftSession();
    if (!drafts) {
        composerContextGeneration.value += 1;
        inputText.value = "";
        return;
    }
    const result = drafts.switchContext(workspaceKey.value, sessionId);
    composerContextGeneration.value = result.generation;
    inputText.value = result.text;
    if (result.discarded) {
        notification.warning("检测到损坏、过期或不安全的 Composer 草稿，已自动丢弃。", {title: "草稿已清理"});
    }
}

/** 捕获本次提交的 context/revision，供迟到 acceptance compare-and-clear。 */
function captureComposerSubmission(sessionId: number, text: string): AgentComposerSubmission | null {
    if (activeSessionId.value !== sessionId) return null;
    const drafts = ensureComposerDraftSession();
    drafts?.update(text);
    return drafts?.capture(text) ?? null;
}

function clearComposerAfterAccepted(
    sessionId: number,
    acceptedText: string,
    submission = captureComposerSubmission(sessionId, acceptedText),
): void {
    if (!submission) {
        return;
    }
    const result = ensureComposerDraftSession()?.accept(submission);
    if (result?.clearEditor && activeSessionId.value === sessionId && inputText.value === acceptedText) {
        inputText.value = "";
    }
}

/** 重置附件分页状态；Session 切换时旧请求通过 requestId 失效。 */
function resetSessionAttachments(): void {
    sessionAttachmentRequestId += 1;
    sessionAttachments.value = [];
    knownSessionAttachments.value = [];
    sessionAttachmentUniqueTotal.value = 0;
    sessionAttachmentPageTotal.value = 0;
    sessionAttachmentHasMore.value = false;
    sessionAttachmentNextOffset.value = null;
    sessionAttachmentLoading.value = false;
    sessionAttachmentSearch.value = "";
    attachmentPanelOpen.value = false;
    if (sessionAttachmentSearchTimer) {
        clearTimeout(sessionAttachmentSearchTimer);
        sessionAttachmentSearchTimer = null;
    }
}

/** 附件控制事件只使目录缓存失效；刷新目录与计数，不触发完整 Session recovery。 */
function invalidateSessionAttachments(): void {
    const sessionId = activeSessionId.value;
    if (!sessionId) {
        return;
    }
    sessionAttachmentRequestId += 1;
    sessionAttachmentLoading.value = false;
    knownSessionAttachments.value = [];
    void loadSessionAttachments(true);
    if (sessionAttachmentSearch.value) {
        void agentApi.getSessionAttachments(sessionId, {offset: 0, limit: 1}).then((page) => {
            if (activeSessionId.value === sessionId) {
                sessionAttachmentUniqueTotal.value = page.total;
            }
        }).catch(() => {});
    }
}

/** 合并已经看见的附件，避免附件面板搜索结果覆盖 Composer 的 Session 附件来源。 */
function rememberSessionAttachments(items: AgentSessionAttachmentItemDto[]): void {
    const byId = new Map(knownSessionAttachments.value.map((item) => [item.attachment.attachmentId, item]));
    for (const item of items) {
        byId.set(item.attachment.attachmentId, item);
    }
    knownSessionAttachments.value = [...byId.values()].sort((left, right) =>
        right.lastSeenAt - left.lastSeenAt
        || left.attachment.attachmentId.localeCompare(right.attachment.attachmentId));
}

/** 加载附件目录；搜索与分页结果都由服务端按 Attachment ID 去重。 */
async function loadSessionAttachments(reset = true): Promise<void> {
    const sessionId = activeSessionId.value;
    if (!sessionId || sessionAttachmentLoading.value || (!reset && !sessionAttachmentHasMore.value)) {
        return;
    }
    const requestId = ++sessionAttachmentRequestId;
    sessionAttachmentLoading.value = true;
    try {
        const page = await agentApi.getSessionAttachments(sessionId, {
            search: sessionAttachmentSearch.value || undefined,
            offset: reset ? 0 : sessionAttachmentNextOffset.value ?? sessionAttachments.value.length,
            limit: 40,
        });
        if (requestId !== sessionAttachmentRequestId || sessionId !== activeSessionId.value) {
            return;
        }
        const currentIds = new Set(reset ? [] : sessionAttachments.value.map((item) => item.attachment.attachmentId));
        sessionAttachments.value = reset
            ? page.items
            : [...sessionAttachments.value, ...page.items.filter((item) => !currentIds.has(item.attachment.attachmentId))];
        rememberSessionAttachments(page.items);
        sessionAttachmentPageTotal.value = page.total;
        if (!sessionAttachmentSearch.value) {
            sessionAttachmentUniqueTotal.value = page.total;
        }
        sessionAttachmentHasMore.value = page.hasMore;
        sessionAttachmentNextOffset.value = page.nextOffset ?? null;
    } catch (error) {
        if (requestId === sessionAttachmentRequestId) {
            notifyAgentError(error, "加载 Session 附件失败");
        }
    } finally {
        if (requestId === sessionAttachmentRequestId) {
            sessionAttachmentLoading.value = false;
        }
    }
}

function toggleAttachmentPanel(): void {
    if (!activeSessionId.value) {
        return;
    }
    attachmentPanelOpen.value = !attachmentPanelOpen.value;
    if (attachmentPanelOpen.value) {
        void loadSessionAttachments(true);
    }
}

function updateAttachmentSearch(value: string): void {
    sessionAttachmentSearch.value = value;
    if (sessionAttachmentSearchTimer) {
        clearTimeout(sessionAttachmentSearchTimer);
    }
    sessionAttachmentSearchTimer = setTimeout(() => {
        sessionAttachmentSearchTimer = null;
        void loadSessionAttachments(true);
    }, 250);
}

function registerSessionAttachment(item: AgentSessionAttachmentItemDto): void {
    rememberSessionAttachments([item]);
    const remaining = sessionAttachments.value.filter((current) => current.attachment.attachmentId !== item.attachment.attachmentId);
    sessionAttachments.value = [item, ...remaining];
    sessionAttachmentRequestId += 1;
    sessionAttachmentLoading.value = false;
    void loadSessionAttachments(true);
}

function insertSessionAttachment(item: AgentSessionAttachmentItemDto): void {
    if (!activeInteraction.value.canInsertAttachment) {
        return;
    }
    if (editingMessageId.value) {
        historyAttachmentInsertRequest.value = {id: ++historyAttachmentInsertRequestId, item};
    } else {
        inputRef.value?.insertAttachment(item);
    }
    attachmentPanelOpen.value = false;
}

/**
 * 切换到指定 session，并拉取 recovery。
 */
const loadSession = async (sessionId: number): Promise<void> => {
    saveComposerDraftNow();
    sessionStream.stop();
    resetSessionAttachments();
    activeSessionId.value = sessionId;
    switchComposerDraftContext(sessionId);
    session.reset();
    cancelEditingMessage();
    messageActionId.value = null;
    linkedAgentPanelOpen.value = false;
    systemPromptPanelOpen.value = false;
    saveLastSessionId(sessionId);

    try {
        const recovery = await agentApi.getSessionRecovery(sessionId);
        session.applyRecovery(recovery);
        syncSessionModelState(recovery.summary);
        void loadSessionAttachments(true);
        void sessionStream.start(sessionId);
        fileChangedSinceLastSend.value = false;
        await nextTick();
        scrollToBottom();
    } catch (error) {
        console.error(`加载 session ${String(sessionId)} 失败`, error);
        notifyAgentError(error, t("agent.chatSurface.loadSessionFailed"));
    }
};

/**
 * 从服务端重新同步当前 session recovery。
 */
const syncActiveSessionRecovery = async (reason: AgentSessionStreamRecoveryReason = "manual_refresh"): Promise<boolean> => {
    if (!activeSessionId.value) {
        return false;
    }
    return sessionStream.syncRecovery(reason);
};

/** 加载当前 active path 的更早 durable history。 */
const loadPreviousHistory = async (): Promise<void> => {
    await session.loadPrevious(agentApi.getSessionHistory);
    if (session.needsRecovery.value) {
        const reason = session.recoveryReasons.value.includes("invalid_history_cursor")
            ? "invalid_history_cursor"
            : "active_path_changed";
        await syncActiveSessionRecovery(reason);
    }
};

/** 用户显式打开或刷新时才构建 System Prompt。 */
const loadActiveSystemPrompt = async (refresh = false): Promise<void> => {
    await session.loadSystemPrompt(agentApi.getSessionSystemPrompt, refresh);
};

let linkedAgentRelationsRequestId = 0;

/**
 * 只刷新关联 Agent 面板数据，不触碰当前对话消息流。
 */
const refreshLinkedAgentRelations = async (): Promise<void> => {
    const targetSessionId = activeSessionId.value;
    if (!targetSessionId) {
        return;
    }
    const requestId = ++linkedAgentRelationsRequestId;
    linkedAgentsLoading.value = true;
    try {
        const relations = await agentApi.getSessionRelations(targetSessionId);
        if (requestId !== linkedAgentRelationsRequestId || activeSessionId.value !== targetSessionId) {
            return;
        }
        session.applyRelations(relations);
    } catch (error) {
        if (requestId !== linkedAgentRelationsRequestId || activeSessionId.value !== targetSessionId) {
            return;
        }
        console.error(`刷新 session ${String(targetSessionId)} 关联 Agent 失败`, error);
        notifyAgentError(error, t("agent.chatSurface.refreshLinkedFailed"));
    } finally {
        if (requestId === linkedAgentRelationsRequestId) {
            linkedAgentsLoading.value = false;
        }
    }
};

/**
 * durable mutation 后进入与 SSE 共用的 recovery single-flight。
 */
const syncMutationRecovery = async (): Promise<void> => {
    await syncActiveSessionRecovery("active_path_changed");
};

/**
 * 应用 command HTTP 返回。轻控制命令只更新 live shell，不补拉完整 recovery。
 */
const applyCommandResult = async (result: AgentCommandResult): Promise<void> => {
    await applyAgentCommandResult(result, {
        activeSessionId: () => activeSessionId.value,
        applyLiveState: session.applyLiveState,
        needsRecovery: () => session.needsRecovery.value,
        syncRecovery: () => syncActiveSessionRecovery("active_path_changed"),
        syncSessionModelState,
        refreshSessions,
        loadSession,
    });
};

/**
 * 统一处理阻塞 invoke 的 HTTP 返回。SSE 正常时错误会以 session entry 进入消息流；
 * 这里负责补 recovery，并在事件流缺失时给一个即时通知兜底。
 */
const handleInvokeResult = async (result: InvokeAgentResult): Promise<void> => {
    if (result.status !== "error") {
        return;
    }
    await syncActiveSessionRecovery("invoke_error_fallback");
    if (!hasVisibleInvocationError(messages.value, result.invocationId)) {
        notification.error(result.error ?? t("agent.chatSurface.runFailed"), {title: t("agent.chatSurface.runFailed")});
    }
};

/**
 * 处理后台 Inline AI invoke 结果，并把最终摘要留给 PromptBar 展示。
 */
const handleInlineEditorInvokeResult = async (result: InvokeAgentResult): Promise<void> => {
    inlineEditorResultText.value = result.reportResult?.result ?? result.finalMessage ?? "";
    if (result.status !== "error") {
        await refreshInlineEditorSessions();
        return;
    }
    await inlineEditorStream.syncRecovery("invoke_error_fallback");
    inlineEditorResultText.value = result.error ?? t("agent.chatSurface.runFailed");
    throw new Error(inlineEditorResultText.value);
};

/**
 * 委托 AgentChatFlow 滚动到底部。
 */
const scrollToBottom = (): void => {
    chatFlowRef.value?.scrollToBottom();
};

const acknowledgeClientPatch = async (sessionId: number, request: Parameters<typeof applyClientVariablePatch>[0]): Promise<void> => {
    const toolCallId = request.toolCallId === undefined ? undefined : assertPublicToolCallId(request.toolCallId);
    try {
        const appliedValue = await applyClientVariablePatch(request, buildClientState(), {
            setActivePanel: (value) => {
                ideStore.activeLeftTab = value;
            },
            setTheme: (value) => themeManager.setTheme(value),
            customThemeIds: ideStore.customThemes.map((theme) => theme.id),
        });
        await agentApi.acknowledgeClientVariablePatch(sessionId, {
            namespace: "client",
            path: request.path,
            operations: request.operations,
            appliedValue,
            invocationId: request.invocationId,
            toolCallId,
        });
    } catch (error) {
        await agentApi.acknowledgeClientVariablePatch(sessionId, {
            namespace: "client",
            path: request.path,
            operations: request.operations,
            error: error instanceof Error ? error.message : String(error),
            invocationId: request.invocationId,
            toolCallId,
        });
    }
};

/**
 * 发送或继续前确保当前 session SSE 处于连接状态。
 */
const ensureActiveSessionEvents = async (): Promise<void> => {
    await sessionStream.ensure();
};

/**
 * 发送 Inline AI 前确保后台 inline session SSE 处于连接状态。
 */
const ensureInlineEditorEvents = async (): Promise<void> => {
    await inlineEditorStream.ensure();
};

/**
 * 用户显式要求立即重连事件流。
 */
const reconnectActiveSessionEvents = async (): Promise<void> => {
    try {
        await sessionStream.reconnectNow();
    } catch (error) {
        console.error("重新连接 Agent 事件流失败", error);
        notifyAgentError(error, t("agent.chatSurface.reconnectFailed"));
    }
};

/**
 * Task 63: 提交 Low-Code Form 数据。
 */
const submitUserInputForm = async (payload: {
    assistantMessageId: string;
    toolCallId: string;
    data: import("nbook/shared/dto/low-code-form.dto").LowCodeJsonObject;
}): Promise<void> => {
    if (!activeSessionId.value || !pendingUserInputSession.value || !activeInteraction.value.canResolveUserInput) {
        return;
    }
    const pendingSession = pendingUserInputSession.value;
    const pendingKey = pendingUserInputKey(pendingSession);
    if (pendingKey && submittingUserInputKey.value === pendingKey) {
        return;
    }

    // 验证提交的 formData
    const dataValidation = LowCodeJsonObjectSchema.safeParse(payload.data);
    if (!dataValidation.success) {
        console.error("submitUserInputForm: payload.data 验证失败", dataValidation.error);
        notification.error(t("agent.chatSurface.invalidFormData"), {title: t("agent.chatSurface.submitAnswersFailed")});
        return;
    }

    try {
        submittingUserInputKey.value = pendingKey;
        await ensureActiveSessionEvents();
        session.clearPendingUserInputSession();
        userInputSelectedAnswers.value = {};
        userInputNotes.value = {};

        const result = await agentApi.invokeSession(activeSessionId.value, {
            mode: "continue",
            clientState: buildClientState(),
            resolution: {
                kind: "user_input",
                toolCallId: payload.toolCallId,
                data: dataValidation.data,
            },
        });
        await handleInvokeResult(result);
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("提交 Low-Code Form 失败", error);
        await syncActiveSessionRecovery();
        notifyAgentError(error, t("agent.chatSurface.submitAnswersFailed"));
        throw error;
    } finally {
        if (submittingUserInputKey.value === pendingKey) {
            submittingUserInputKey.value = null;
        }
    }
};

/**
 * 提交结构化问题答案（支持单个或批量）。
 */
const submitUserInputAnswers = async (payload: {
    assistantMessageId: string;
    resume?: boolean;
    answers: Array<{
        toolNodeId: string;
        questionIndex?: number;
        selectedOptionIndex?: number;
        note?: string;
        ignored?: boolean;
    }>;
}): Promise<void> => {
    if (!activeSessionId.value || !pendingUserInputSession.value || !activeInteraction.value.canResolveUserInput) {
        return;
    }
    const pendingSession = pendingUserInputSession.value;
    const pendingKey = pendingUserInputKey(pendingSession);
    if (pendingKey && submittingUserInputKey.value === pendingKey) {
        return;
    }
    try {
        submittingUserInputKey.value = pendingKey;
        await ensureActiveSessionEvents();
        const toolCallId = pendingSession.questions[0]?.toolCallId;
        const firstQuestion = pendingSession.questions[0];
        if (!toolCallId || !firstQuestion) {
            return;
        }
        const answers = payload.answers.map((answer, index) => {
            const questionIndex = answer.questionIndex ?? index;
            const question = pendingSession.questions.find((item) => {
                return item.toolNodeId === answer.toolNodeId && item.questionIndex === questionIndex;
            }) ?? pendingSession.questions[questionIndex] ?? firstQuestion;
            return {
                questionIndex,
                text: answer.ignored
                    ? t("agent.chatSurface.userTerminated")
                    : formatAnswerText(question.options, answer.selectedOptionIndex, answer.note),
                selectedOptionIndex: answer.selectedOptionIndex,
                note: answer.note,
                ignored: answer.ignored,
            };
        });
        session.clearPendingUserInputSession();
        userInputSelectedAnswers.value = {};
        userInputNotes.value = {};

        // 如果有多个待审批项，一次性提交所有审批
        const allPendingSessions = pendingUserInputSessionsComputed.value;
        if (allPendingSessions.length > 1) {
            type AnswerItem = {
                questionIndex: number;
                text: string;
                selectedOptionIndex?: number;
                note?: string;
                ignored?: boolean;
            };
            type ResolutionItem = {
                kind: "tool_approval";
                toolCallId: string;
                approved: boolean;
                resultText: string;
                answers: AnswerItem[];
            } | {
                kind: "user_input";
                toolCallId: string;
                answers: AnswerItem[];
            };
            const resolutionCandidates: Array<ResolutionItem | null> = allPendingSessions.map((session: AgentPendingUserInputSession) => {
                const rawSessionToolCallId = session.questions[0]?.toolCallId;
                const sessionFirstQuestion = session.questions[0];
                if (!rawSessionToolCallId || !sessionFirstQuestion) {
                    return null;
                }
                const sessionToolCallId = assertPublicToolCallId(rawSessionToolCallId);
                // 只有第一个审批使用用户交互的答案，其余使用默认批准
                const isFirstSession = session === pendingSession;
                const sessionAnswers: AnswerItem[] = isFirstSession
                    ? answers
                    : [{
                        questionIndex: 0,
                        text: t("agent.userInput.approve"),
                        selectedOptionIndex: 0,
                    }];

                if (sessionFirstQuestion.kind === "tool_approval") {
                    return {
                        kind: "tool_approval" as const,
                        toolCallId: sessionToolCallId,
                        approved: isFirstSession ? isApprovalApproved(payload.answers[0]) : true,
                        resultText: sessionAnswers.map((a) => a.text).join("\n"),
                        answers: sessionAnswers,
                    };
                }
                return {
                    kind: "user_input" as const,
                    toolCallId: sessionToolCallId,
                    answers: sessionAnswers,
                };
            });
            const resolutions = resolutionCandidates.filter((resolution): resolution is ResolutionItem => resolution !== null);

            const result = await agentApi.invokeSession(activeSessionId.value, {
                mode: "continue",
                clientState: buildClientState(),
                resolutions,
            });
            await handleInvokeResult(result);
            await syncActiveSessionRecovery();
        } else {
            // 单个审批，保持原有逻辑
            const result = await agentApi.invokeSession(activeSessionId.value, {
                mode: "continue",
                clientState: buildClientState(),
                resolution: firstQuestion.kind === "tool_approval"
                    ? {
                        kind: "tool_approval",
                        toolCallId,
                        approved: isApprovalApproved(payload.answers[0]),
                        resultText: answers.map((answer) => answer.text).join("\n"),
                        answers,
                    }
                    : {
                        kind: "user_input",
                        toolCallId,
                        answers,
                    },
            });
            await handleInvokeResult(result);
            await syncActiveSessionRecovery();
        }
    } catch (error) {
        // pendingUserInputSession 现在是 computed，会自动从 session 状态恢复
        console.error("提交问题答案失败", error);
        await syncActiveSessionRecovery();
        notifyAgentError(error, t("agent.chatSurface.submitAnswersFailed"));
        throw error;
    } finally {
        if (submittingUserInputKey.value === pendingKey) {
            submittingUserInputKey.value = null;
        }
    }
};

/**
 * 提交当前挂起中的整组结构化答案。
 */
const submitPendingUserInputAnswers = (): void => {
    if (!pendingUserInputSession.value || submittingCurrentUserInput.value || !activeInteraction.value.canResolveUserInput) {
        return;
    }
    void submitUserInputAnswers({
        assistantMessageId: pendingUserInputSession.value.assistantMessageId,
        answers: pendingUserInputSession.value.questions.map((question) => {
            const key = `${question.toolNodeId}\n${question.questionIndex}`;
            const selected = userInputSelectedAnswers.value[key] ?? [];
            return {
                toolNodeId: question.toolNodeId,
                questionIndex: question.questionIndex,
                selectedOptionIndex: selected[0],
                note: userInputNotes.value[key]?.trim() || undefined,
            };
        }),
    });
};

provide(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, {
    pendingSession: pendingUserInputSession,
    submitting: submittingCurrentUserInput,
    draft: {
        selectedAnswers: userInputSelectedAnswers,
        notes: userInputNotes,
    },
    submitAnswers: submitPendingUserInputAnswers,
});

/**
 * 取消当前等待中的用户输入并终止本轮 ReAct loop。
 */
const cancelPendingUserInput = async (payload?: {assistantMessageId: string}): Promise<void> => {
    if (!activeSessionId.value || !pendingUserInputSession.value || !activeInteraction.value.canAbort) {
        return;
    }
    const pendingSession = pendingUserInputSession.value;
    if (payload?.assistantMessageId && payload.assistantMessageId !== pendingSession.assistantMessageId) {
        return;
    }
    const pendingKey = pendingUserInputKey(pendingSession);
    if (pendingKey && submittingUserInputKey.value === pendingKey) {
        return;
    }
    try {
        submittingUserInputKey.value = pendingKey;
        await agentApi.abortSession(activeSessionId.value, {
            reason: "user cancelled pending user input",
            clearQueue: true,
        });
        session.clearPendingUserInputSession();
        userInputSelectedAnswers.value = {};
        userInputNotes.value = {};
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("取消用户输入等待失败", error);
        await syncActiveSessionRecovery();
        notifyAgentError(error, t("agent.chatSurface.cancelUserInputFailed"));
    } finally {
        if (submittingUserInputKey.value === pendingKey) {
            submittingUserInputKey.value = null;
        }
    }
};

/**
 * 停止当前运行。
 */
const stopRun = async (): Promise<void> => {
    if (!activeSessionId.value || !running.value || !activeInteraction.value.canAbort) {
        return;
    }
    try {
        await agentApi.abortSession(activeSessionId.value, {reason: "user abort"});
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("停止 Agent 运行失败", error);
    }
};

/**
 * 切换到指定 Agent 模式（三态按钮、Shift+Tab 与 /mode 命令共用）。
 */
const setAgentMode = async (mode: AgentMode): Promise<void> => {
    if (!activeSessionId.value || !activeInteraction.value.canChangeRuntime) {
        return;
    }
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "mode",
            mode,
        });
        await applyCommandResult(result);
    } catch (error) {
        console.error("切换 Agent 模式失败", error);
        notifyAgentError(error, t("agent.chatSurface.switchModeFailed"));
    }
};

/**
 * 循环切换 Agent 模式：normal → discuss → plan → normal。
 */
const cycleAgentMode = async (): Promise<void> => {
    const order: AgentMode[] = ["normal", "discuss", "plan"];
    const next = order[(order.indexOf(agentMode.value) + 1) % order.length] ?? "normal";
    await setAgentMode(next);
};

/** 为乐观图片预览补齐当前正文引用的 Session Attachment metadata。 */
async function resolveComposerAttachmentItems(
    sessionId: number,
    markdown: string,
): Promise<AgentSessionAttachmentItemDto[]> {
    const attachmentIds = [...new Set(parseAgentImageMarkdown(markdown).flatMap((part) => {
        if (part.type !== "image") {
            return [];
        }
        const attachmentId = attachmentIdFromMarkdownTarget(part.target);
        return attachmentId ? [attachmentId] : [];
    }))];
    const byId = new Map(knownSessionAttachments.value.map((item) => [item.attachment.attachmentId, item]));
    const missingIds = attachmentIds.filter((attachmentId) => !byId.has(attachmentId));
    if (missingIds.length > 0) {
        const resolved = await agentApi.resolveSessionAttachments(sessionId, missingIds);
        rememberSessionAttachments(resolved.items);
        for (const item of resolved.items) {
            byId.set(item.attachment.attachmentId, item);
        }
    }
    return attachmentIds.flatMap((attachmentId) => {
        const item = byId.get(attachmentId);
        return item ? [item] : [];
    });
}

/** 等待 durable user entry 或 queue item，二者都是输入已接受的 SSE 旁证。 */
function waitForOptimisticAdmission(
    clientMessageId: string,
): {promise: Promise<void>; stop: () => void} {
    let stopWatch = (): void => {};
    let settled = false;
    const promise = new Promise<void>((resolve) => {
        const check = (): void => {
            if (settled) {
                return;
            }
            const accepted = session.durableEntries.value.some((entry) => {
                return entry.type === "user" && entry.clientMessageId === clientMessageId;
            }) || queuedMessages.value.some((item) => item.clientMessageId === clientMessageId);
            if (!accepted) {
                return;
            }
            settled = true;
            stopWatch();
            resolve();
        };
        stopWatch = watch([session.durableEntries, queuedMessages], check);
        check();
    });
    return {
        promise,
        stop: () => {
            settled = true;
            stopWatch();
        },
    };
}

/**
 * 发送输入内容。
 */
const send = async (): Promise<void> => {
    const message = inputText.value.trim();
    if (pendingUserInputSession.value) {
        return;
    }
    if (!activeSessionId.value) {
        notification.info(t("agent.chatSurface.noSessionMessage"), {title: t("agent.chatSurface.noSessionTitle")});
        sessionDialogOpen.value = true;
        return;
    }
    if (!activeInteraction.value.canInvoke) {
        return;
    }
    const sessionId = activeSessionId.value;

    if (message.startsWith("/")) {
        try {
            if (await handleSlashCommand(message)) {
                clearComposerAfterAccepted(sessionId, inputText.value);
                return;
            }
        } catch (error) {
            console.error("执行 Agent 命令失败", error);
            notifyAgentError(error, t("agent.chatSurface.runFailed"));
            return;
        }
    }

    if (!message) {
        if (canContinueWithoutInput.value) {
            try {
                await ensureActiveSessionEvents();
                const result = await agentApi.invokeSession(sessionId, {
                    mode: "continue",
                    clientState: buildClientState(),
                });
                await handleInvokeResult(result);
            } catch (error) {
                console.error("继续 Agent 运行失败", error);
                notifyAgentError(error, t("agent.chatSurface.runFailed"));
            }
        }
        return;
    }

    const prompt = inputText.value;
    const attachmentItems = await resolveComposerAttachmentItems(sessionId, prompt);
    if (activeSessionId.value !== sessionId || inputText.value !== prompt) {
        return;
    }
    const clientMessageId = crypto.randomUUID();
    const draftSubmission = captureComposerSubmission(sessionId, prompt);
    const optimisticMessageId = session.appendOptimisticUserMessage(clientMessageId, prompt, attachmentItems);
    const admission = waitForOptimisticAdmission(clientMessageId);
    let accepted = false;
    const request = (async () => {
        await ensureActiveSessionEvents();
        return agentApi.invokeSession(sessionId, {
            mode: "prompt",
            clientMessageId,
            message: {text: prompt},
            clientState: buildClientState(),
        });
    })();
    try {
        const first = await Promise.race([
            admission.promise.then(() => ({kind: "accepted" as const})),
            request.then(
                (result) => ({kind: "result" as const, result}),
                (error: unknown) => ({kind: "error" as const, error}),
            ),
        ]);
        let result: InvokeAgentResult;
        if (first.kind === "accepted") {
            accepted = true;
            clearComposerAfterAccepted(sessionId, prompt, draftSubmission);
            result = await request;
        } else if (first.kind === "result") {
            result = first.result;
            const reconciliation = reconcileInvocationReceipt(clientMessageId, result.acceptance);
            accepted = reconciliation.state === "accepted";
            if (reconciliation.state === "accepted") {
                clearComposerAfterAccepted(sessionId, prompt, draftSubmission);
            } else {
                session.removeOptimisticUserMessage(optimisticMessageId);
                notification.error(result.error ?? t("agent.chatSurface.runFailed"), {title: t("agent.chatSurface.runFailed")});
                return;
            }
        } else {
            throw first.error;
        }
        await handleInvokeResult(result);
    } catch (error) {
        if (!accepted) {
            const reconciliation = reconcileInvocationTransportFailure();
            if (reconciliation.state === "unknown") {
                session.markOptimisticUserMessageUnknown(clientMessageId);
            }
        }
        console.error("发送 Agent 消息失败", error);
        if (accepted) {
            notification.warning("消息已被 Session 接受，但请求连接提前中断；后续状态将由事件流继续收敛。", {title: "连接中断"});
        } else {
            notification.warning("未收到服务器 acceptance；消息结果未知，未自动重试。", {title: "发送结果未知"});
        }
    } finally {
        admission.stop();
    }
};

/**
 * 发送 Inline AI 编辑任务。调用方只负责构造 visible message 与 payload。
 */
const sendInlineEditorPrompt = async (payload: InlineEditPayload, visibleMessage: string): Promise<void> => {
    const targetSession = await ensureInlineEditorSession();
    if (targetSession.status === "running" || targetSession.status === "waiting") {
        throw new Error(t("agent.chatSurface.inlineRunningError"));
    }
    if (inlineEditorSessionId.value !== targetSession.sessionId || !inlineEditorSession.recoveryShell.value) {
        await loadInlineEditorSession(targetSession.sessionId);
    }

    inlineEditorResultText.value = "";
    const clientMessageId = crypto.randomUUID();
    const optimisticId = inlineEditorSession.appendOptimisticUserMessage(clientMessageId, visibleMessage);
    let receivedReceipt = false;
    try {
        await ensureInlineEditorEvents();
        const result = await agentApi.invokeSession(targetSession.sessionId, {
            mode: "prompt",
            clientMessageId,
            message: {text: visibleMessage},
            input: inlineEditPayloadToJson(payload),
            clientState: buildClientState(),
        });
        receivedReceipt = true;
        const reconciliation = reconcileInvocationReceipt(clientMessageId, result.acceptance);
        if (reconciliation.state === "rejected") {
            inlineEditorSession.removeOptimisticUserMessage(optimisticId);
            throw new Error(result.error ?? t("agent.chatSurface.runFailed"));
        }
        await handleInlineEditorInvokeResult(result);
    } catch (error) {
        if (!receivedReceipt) {
            inlineEditorSession.markOptimisticUserMessageUnknown(clientMessageId);
        }
        throw error;
    }
};

/**
 * 打开或创建 Inline AI Session，供 PromptBar 主动绑定。
 */
const openInlineEditorSession = async (): Promise<AgentSessionSummaryDto> => {
    const targetSession = await ensureInlineEditorSession();
    if (activeSessionId.value !== targetSession.sessionId) {
        await loadSession(targetSession.sessionId);
    }
    return targetSession;
};

/**
 * 停止后台 Inline AI session 当前运行。
 */
const stopInlineEditorPrompt = async (): Promise<void> => {
    if (!inlineEditorSessionId.value) {
        return;
    }
    await agentApi.abortSession(inlineEditorSessionId.value, {});
    inlineEditorResultText.value = t("agent.chatSurface.stopped");
    await inlineEditorStream.syncRecovery("manual_refresh");
    await refreshInlineEditorSessions();
};

/** 运行中的 steer/follow-up 共用同一 receipt、SSE 与 transport unknown 对账。 */
const sendRunningMessage = async (mode: "steer" | "followup"): Promise<void> => {
    const message = inputText.value.trim();
    if (!activeSessionId.value || !running.value || !activeInteraction.value.canInvoke || !message) {
        return;
    }
    const sessionId = activeSessionId.value;
    const prompt = inputText.value;
    const attachmentItems = await resolveComposerAttachmentItems(sessionId, prompt);
    if (activeSessionId.value !== sessionId || inputText.value !== prompt) {
        return;
    }
    const clientMessageId = crypto.randomUUID();
    const draftSubmission = captureComposerSubmission(sessionId, prompt);
    const optimisticMessageId = session.appendOptimisticUserMessage(
        clientMessageId,
        prompt,
        attachmentItems,
        mode,
    );
    const admission = waitForOptimisticAdmission(clientMessageId);
    let accepted = false;
    const request = (async () => {
        await ensureActiveSessionEvents();
        return agentApi.invokeSession(sessionId, {
            mode,
            clientMessageId,
            message: {text: prompt},
            clientState: buildClientState(),
        });
    })();
    try {
        const first = await Promise.race([
            admission.promise.then(() => ({kind: "accepted" as const})),
            request.then(
                (result) => ({kind: "result" as const, result}),
                (error: unknown) => ({kind: "error" as const, error}),
            ),
        ]);
        let result: InvokeAgentResult;
        if (first.kind === "accepted") {
            accepted = true;
            clearComposerAfterAccepted(sessionId, prompt, draftSubmission);
            result = await request;
        } else if (first.kind === "result") {
            result = first.result;
            const reconciliation = reconcileInvocationReceipt(clientMessageId, result.acceptance);
            accepted = reconciliation.state === "accepted";
            if (!accepted) {
                session.removeOptimisticUserMessage(optimisticMessageId);
                notification.error(result.error ?? t("agent.chatSurface.runFailed"), {
                    title: mode === "steer" ? t("agent.chatSurface.steerFailed") : t("agent.chatSurface.queueFailed"),
                });
                return;
            }
            clearComposerAfterAccepted(sessionId, prompt, draftSubmission);
            if (result.acceptance.state === "queued") {
                session.removeOptimisticUserMessage(optimisticMessageId);
            }
        } else {
            throw first.error;
        }
        await handleInvokeResult(result);
        if (result.status !== "error") {
            notification.success(mode === "steer" ? t("agent.chatSurface.steered") : t("agent.chatSurface.queued"));
        }
    } catch (error) {
        if (!accepted) {
            session.markOptimisticUserMessageUnknown(clientMessageId);
            notification.warning("未收到服务器 acceptance；消息结果未知，未自动重试。", {title: "发送结果未知"});
        } else {
            notification.warning("消息已被 Session 接受，但请求连接提前中断；后续状态将由事件流继续收敛。", {title: "连接中断"});
        }
        console.error(mode === "steer" ? "引导消息失败" : "排队消息失败", error);
    } finally {
        admission.stop();
    }
};

/**
 * 运行中引导当前 Agent loop。
 */
const steer = async (): Promise<void> => sendRunningMessage("steer");

/** 运行中把消息排到当前 loop 结束后继续执行。 */
const followup = async (): Promise<void> => {
    await sendRunningMessage("followup");
};

/**
 * 处理前端识别的 slash command。
 */
const handleSlashCommand = async (message: string): Promise<boolean> => {
    if (!activeSessionId.value) {
        return false;
    }
    const [command, ...rest] = message.trim().split(/\s+/);
    if (command === "/new") {
        await createSession();
        return true;
    }
    if (command === "/clear") {
        if (!activeInteraction.value.canMutateHistory) {
            return true;
        }
        const result = await agentApi.moveTree(activeSessionId.value, {
            position: "empty",
        });
        session.applyLiveState(result.state);
        await syncMutationRecovery();
        return true;
    }
    if (command === "/mode") {
        const requested = AgentModeSchema.safeParse(rest[0]);
        if (requested.success) {
            await setAgentMode(requested.data);
        } else {
            await cycleAgentMode();
        }
        return true;
    }
    if (command === "/plan") {
        await setAgentMode("plan");
        return true;
    }
    if (command === "/compact") {
        await compactSession(rest.join(" ") || undefined);
        return true;
    }
    if (command === "/model") {
        if (!activeInteraction.value.canChangeRuntime) {
            return true;
        }
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey: rest[0] ?? null,
        });
        await applyCommandResult(result);
        return true;
    }
    if (command === "/rename") {
        if (!activeInteraction.value.canChangeRuntime) {
            return true;
        }
        // 用原始剩余文本作为标题，保留标题内部的连续空格。
        const title = message.trim().slice("/rename".length).trim();
        if (!title) {
            notification.error(t("agent.chatSurface.renameMissingTitle"));
            return true;
        }
        await renameSession(activeSessionId.value, title);
        return true;
    }
    if (command === "/summarize") {
        if (!activeInteraction.value.canChangeRuntime) {
            return true;
        }
        try {
            const result = await agentApi.runCommand(activeSessionId.value, {
                command: "summarize",
            });
            await applyCommandResult(result);
            notification.success(t("agent.chatSurface.summarizeStarted"));
        } catch (error) {
            console.error("重新生成摘要失败", error);
            notifyAgentError(error, t("agent.chatSurface.summarizeFailed"));
        }
        return true;
    }
    return false;
};

/**
 * 手动压缩当前 Session 上下文。压缩过程走 session SSE，同步一次 recovery 让 UI 立刻进入 running。
 */
const compactSession = async (instructions?: string): Promise<void> => {
    if (!activeSessionId.value || !activeInteraction.value.canChangeRuntime) {
        return;
    }
    try {
        await ensureActiveSessionEvents();
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "compact",
            instructions,
        });
        await applyCommandResult(result);
    } catch (error) {
        console.error("压缩 Session 失败", error);
        notifyAgentError(error, t("agent.chatSurface.compactFailed"));
    }
};

/**
 * 返回复制/编辑使用的完整正文；被公开预算截断的用户消息按需读取。
 */
async function resolveMessageMarkdown(message: AgentMessage): Promise<{text: string; complete: boolean}> {
    const local = agentMessageMarkdown(message);
    if (local !== null) {
        return {text: local, complete: true};
    }
    if (message.type === "user" && activeSessionId.value && !message.id.startsWith("optimistic-user-")) {
        const result = await agentApi.getSessionUserContent(activeSessionId.value, message.id);
        return {text: result.text, complete: true};
    }
    return {text: message.content, complete: false};
}

/**
 * 复制消息正文；用户消息始终输出文字与图片 Markdown 的完整原顺序。
 */
const copyMessage = async (message: AgentMessage): Promise<void> => {
    try {
        const resolved = await resolveMessageMarkdown(message);
        if (!resolved.text.trim()) {
            return;
        }
        await navigator.clipboard.writeText(resolved.text);
        notification.success(resolved.complete ? t("agent.chatSurface.copied") : t("agent.chatSurface.previewCopied"));
    } catch (error) {
        console.error("复制 Agent 消息失败", error);
        notifyAgentError(error, "读取完整用户消息失败");
    }
};

/**
 * 复制工具调用内容。
 */
const copyToolCall = async (toolCall: AgentToolCall): Promise<void> => {
    const text = [toolCall.argsJson ?? toolCall.argsText, toolCall.result ?? "", toolCall.error ?? ""]
        .filter((value) => value.trim())
        .join("\n\n");
    if (!text) {
        return;
    }
    await navigator.clipboard.writeText(text);
    notification.success(t("agent.chatSurface.toolCopied"));
};

const startEditingMessage = async (message: AgentMessage): Promise<void> => {
    if (historyMutationDisabled.value) {
        return;
    }
    messageActionId.value = message.id;
    try {
        const resolved = await resolveMessageMarkdown(message);
        if (!resolved.complete) {
            return;
        }
        editingMessageText.value = resolved.text;
        editingMessageId.value = message.id;
    } catch (error) {
        console.error("读取待编辑 Agent 消息失败", error);
        notifyAgentError(error, "读取完整用户消息失败");
    } finally {
        messageActionId.value = null;
    }
};

const cancelEditingMessage = (): void => {
    editingMessageId.value = null;
    editingMessageText.value = "";
    historyAttachmentInsertRequest.value = null;
};

/**
 * 更新当前 session 模型覆盖。
 */
const updateSessionModelSelection = async (modelKey: string | null): Promise<void> => {
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey,
    };

    if (!activeSessionId.value || !activeInteraction.value.canChangeRuntime || sessionModelSaving.value) {
        return;
    }
    sessionModelSaving.value = true;
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey,
        });
        await applyCommandResult(result);
    } catch (error) {
        console.error("更新 session 模型失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateModelFailed"));
    } finally {
        sessionModelSaving.value = false;
    }
};

/**
 * 更新当前 session 的 thinking 覆盖。
 */
const updateSessionThinkingLevel = async (thinkingLevel: ThinkingLevelDto | null): Promise<void> => {
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        reasoningEffort: thinkingLevel,
    };

    if (!activeSessionId.value || !activeInteraction.value.canChangeRuntime || sessionModelSaving.value) {
        return;
    }
    sessionModelSaving.value = true;
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "thinking",
            thinkingLevel,
        });
        await applyCommandResult(result);
    } catch (error) {
        console.error("更新 session 推理强度失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateThinkingFailed"));
    } finally {
        sessionModelSaving.value = false;
    }
};

function toggleSessionModelPopover(): void {
    if (!activeInteraction.value.canChangeRuntime) {
        return;
    }
    sessionModelPopoverOpen.value = !sessionModelPopoverOpen.value;
}

async function applySessionModelSettings(): Promise<void> {
    if (!activeInteraction.value.canChangeRuntime) {
        return;
    }
    const nextModelKey = sessionModelDraft.value.modelKey;
    const nextThinkingLevel = sessionModelDraft.value.reasoningEffort;
    await updateSessionModelSelection(nextModelKey);
    await updateSessionThinkingLevel(nextThinkingLevel);
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey: nextModelKey,
        reasoningEffort: nextThinkingLevel,
    };
    sessionModelPopoverOpen.value = false;
}

async function resetSessionModelSettings(): Promise<void> {
    if (!activeInteraction.value.canChangeRuntime) {
        return;
    }
    await updateSessionModelSelection(null);
    await updateSessionThinkingLevel(null);
    sessionModelPopoverOpen.value = false;
}

function modelDraftFromRecovery(recovery: Pick<AgentSessionRecoveryDto, "model" | "thinkingLevel"> | null): AgentSessionModelDraft {
    const model = recovery?.model ?? null;
    return {
        modelKey: model ? `${model.providerConfigId}/${model.modelId}` : null,
        reasoningEffort: recovery?.thinkingLevel ?? null,
    };
}

function syncSessionModelState(_summary: AgentSessionSummaryDto | null): void {
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        ...modelDraftFromRecovery(session.recoveryShell.value),
    };
}

function syncInlineSessionModelState(): void {
    inlineSessionModelDraft.value = {
        ...inlineSessionModelDraft.value,
        ...modelDraftFromRecovery(inlineEditorSession.recoveryShell.value),
    };
}

/**
 * 判断 Inline AI session 模型设置此刻是否允许写入。
 */
function inlineSessionModelActionBlocked(): boolean {
    return !inlineEditorSessionId.value || inlineEditorRunning.value || inlineEditorSessionLoading.value || inlineSessionModelSaving.value;
}

/**
 * 丢弃未落库草稿，恢复为当前 recovery 中的真实模型设置。
 */
function restoreInlineSessionModelDraft(): void {
    syncInlineSessionModelState();
}

/**
 * 更新 Inline AI session 模型覆盖，不影响右侧主 Agent 当前会话。
 */
const updateInlineSessionModelSelection = async (modelKey: string | null): Promise<boolean> => {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        return false;
    }
    const sessionId = inlineEditorSessionId.value;
    if (!sessionId) {
        restoreInlineSessionModelDraft();
        return false;
    }

    inlineSessionModelDraft.value = {
        ...inlineSessionModelDraft.value,
        modelKey,
    };

    inlineSessionModelSaving.value = true;
    try {
        await agentApi.runCommand(sessionId, {
            command: "model",
            modelKey,
        });
        await inlineEditorStream.syncRecovery("manual_refresh");
        syncInlineSessionModelState();
        return true;
    } catch (error) {
        console.error("更新 Inline AI session 模型失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateModelFailed"));
        restoreInlineSessionModelDraft();
        return false;
    } finally {
        inlineSessionModelSaving.value = false;
    }
};

/**
 * 更新 Inline AI session 推理强度覆盖。
 */
const updateInlineSessionThinkingLevel = async (thinkingLevel: ThinkingLevelDto | null): Promise<boolean> => {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        return false;
    }
    const sessionId = inlineEditorSessionId.value;
    if (!sessionId) {
        restoreInlineSessionModelDraft();
        return false;
    }

    inlineSessionModelDraft.value = {
        ...inlineSessionModelDraft.value,
        reasoningEffort: thinkingLevel,
    };

    inlineSessionModelSaving.value = true;
    try {
        await agentApi.runCommand(sessionId, {
            command: "thinking",
            thinkingLevel,
        });
        await inlineEditorStream.syncRecovery("manual_refresh");
        syncInlineSessionModelState();
        return true;
    } catch (error) {
        console.error("更新 Inline AI session 推理强度失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateThinkingFailed"));
        restoreInlineSessionModelDraft();
        return false;
    } finally {
        inlineSessionModelSaving.value = false;
    }
};

function toggleInlineSessionModelPopover(): void {
    if (!inlineSessionModelPopoverOpen.value && inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    inlineSessionModelPopoverOpen.value = !inlineSessionModelPopoverOpen.value;
}

function setInlineSessionModelDraft(value: AgentSessionModelDraft): void {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        return;
    }
    inlineSessionModelDraft.value = value;
}

function setInlineSessionModelPopoverOpen(value: boolean): void {
    if (value && inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    inlineSessionModelPopoverOpen.value = value;
}

async function applyInlineSessionModelSettings(): Promise<void> {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    const nextModelKey = inlineSessionModelDraft.value.modelKey;
    const nextThinkingLevel = inlineSessionModelDraft.value.reasoningEffort;
    await updateInlineSessionModelSelection(nextModelKey);
    await updateInlineSessionThinkingLevel(nextThinkingLevel);
    restoreInlineSessionModelDraft();
    inlineSessionModelPopoverOpen.value = false;
}

async function resetInlineSessionModelSettings(): Promise<void> {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    await updateInlineSessionModelSelection(null);
    await updateInlineSessionThinkingLevel(null);
    restoreInlineSessionModelDraft();
    inlineSessionModelPopoverOpen.value = false;
}

const sessionStream = useAgentSessionStream({
    session,
    api: agentApi,
    activeSessionId,
    applyRecoverySideEffects: async (recovery, result) => {
        syncSessionModelState(recovery.summary);
        if (result.historyWindowReset) {
            await nextTick();
            chatFlowRef.value?.scrollToBottom();
        }
    },
    onEvent: async (event) => {
        if (event.kind === "session" && event.event.type === "session_attachments_changed") {
            invalidateSessionAttachments();
        }
        if (event.kind === "session" && event.event.type === "client_variable_patch_requested" && activeSessionId.value) {
            await acknowledgeClientPatch(activeSessionId.value, event.event.request);
        }
    },
    onError: (error, fallback) => {
        console.error(fallback, error);
        notifyAgentError(error, fallback);
    },
});

const inlineEditorStream = useAgentSessionStream({
    session: inlineEditorSession,
    api: agentApi,
    activeSessionId: inlineEditorSessionId,
    applyRecoverySideEffects: () => {
        syncInlineSessionModelState();
    },
    onEvent: async (event) => {
        if (event.kind === "session" && event.event.type === "client_variable_patch_requested" && inlineEditorSessionId.value) {
            await acknowledgeClientPatch(inlineEditorSessionId.value, event.event.request);
        }
    },
    onError: (error, fallback) => {
        console.error(fallback, error);
        notifyAgentError(error, fallback);
    },
});

const cycleMessageBranch = async (messageId: string, direction: -1 | 1): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
        return;
    }
    const target = resolveBranchSwitchTarget(sessionTreeState.value, messageId, direction);
    if (!target) {
        return;
    }
    messageActionId.value = messageId;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: target.id,
            position: "at",
        });
        session.applyLiveState(result.state);
        await syncMutationRecovery();
    } catch (error) {
        console.error("切换消息分支失败", error);
        notifyAgentError(error, t("agent.chatSurface.switchBranchFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const selectTreeNode = async (entryId: string): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
        return;
    }
    messageActionId.value = entryId;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: entryId,
            position: "at",
        });
        session.applyLiveState(result.state);
        await syncMutationRecovery();
    } catch (error) {
        console.error("切换 Session Tree 节点失败", error);
        notifyAgentError(error, t("agent.chatSurface.switchTreeFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const saveEditedMessage = async (payload: {message: AgentMessage; content: string}): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
        return;
    }
    messageActionId.value = payload.message.id;
    try {
        await ensureActiveSessionEvents();
        const clientMessageId = crypto.randomUUID();
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: payload.message.id,
            position: "before",
            next: {
                type: "invoke",
                mode: "prompt",
                clientMessageId,
                message: {text: payload.content},
                clientState: buildClientState(),
            },
        });
        session.applyLiveState(result.state);
        if (result.invocation) {
            const reconciliation = reconcileInvocationReceipt(clientMessageId, result.invocation.acceptance);
            if (reconciliation.state === "rejected") {
                notification.error(result.invocation.error ?? t("agent.chatSurface.rewriteFailed"), {title: t("agent.chatSurface.rewriteFailed")});
                return;
            }
            await handleInvokeResult(result.invocation);
        }
        cancelEditingMessage();
        await syncActiveSessionRecovery();
        notification.success(t("agent.chatSurface.messageUpdated"));
    } catch (error) {
        console.error("改写消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.rewriteFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const refreshMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
        return;
    }
    messageActionId.value = message.id;
    try {
        await ensureActiveSessionEvents();
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: message.id,
            position: message.type === "user" ? "at" : "before",
            next: {
                type: "invoke",
                mode: "continue",
                clientState: buildClientState(),
            },
        });
        session.applyLiveState(result.state);
        if (result.invocation) {
            await handleInvokeResult(result.invocation);
        }
        cancelEditingMessage();
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("刷新消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.refreshMessageFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const rollbackMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
        return;
    }
    const confirmed = await confirm(t("agent.chatSurface.rollbackConfirm"), t("agent.chatSurface.rollbackTitle"));
    if (!confirmed) {
        return;
    }
    messageActionId.value = message.id;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: message.id,
            position: "at",
        });
        session.applyLiveState(result.state);
        await syncMutationRecovery();
        cancelEditingMessage();
        notification.success(t("agent.chatSurface.rollbackSuccess"));
    } catch (error) {
        console.error("回退消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.rollbackFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const openSessionDialog = async (): Promise<void> => {
    await ensureSessionReady();
    sessionDialogOpen.value = true;
};

const selectSession = async (sessionId: number): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    if (sessionId === activeSessionId.value) {
        sessionDialogOpen.value = false;
        return;
    }
    loadingSession.value = true;
    try {
        await loadSession(sessionId);
        sessionDialogOpen.value = false;
    } finally {
        loadingSession.value = false;
    }
};

const createSessionFromDialog = async (profileKey?: string): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    loadingSession.value = true;
    try {
        await createSession(profileKey);
        sessionDialogOpen.value = false;
    } finally {
        loadingSession.value = false;
    }
};

/**
 * 从抽屉头部显式创建 session，并避免重复点击连建多个空 session。
 */
const createSessionFromHeader = async (profileKey?: string): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    loadingSession.value = true;
    try {
        await createSession(profileKey);
    } finally {
        loadingSession.value = false;
    }
};

/**
 * 重命名 session 的共享核心：/rename 命令与侧边栏/列表按钮共用。
 * 改名后标题所有权归用户，自动摘要不再覆盖标题；失败走通知反馈。
 */
const renameSession = async (sessionId: number, title: string): Promise<void> => {
    try {
        const result = await agentApi.runCommand(sessionId, {
            command: "rename",
            title,
        });
        if (sessionId === activeSessionId.value) {
            await applyCommandResult(result);
        }
        await refreshSessions();
        notification.success(t("agent.chatSurface.renamed"));
    } catch (error) {
        console.error("重命名 session 失败", error);
        notifyAgentError(error, t("agent.chatSurface.renameFailed"));
    }
};

/**
 * 手动重命名 session：弹输入框后走共享 renameSession 核心。
 */
const renameSessionFromDialog = async (target: AgentSessionSummaryDto): Promise<void> => {
    if (loadingSession.value || sessionActionId.value || target.interaction?.canChangeRuntime !== true) {
        return;
    }
    const title = (await prompt(t("agent.session.renamePrompt"), target.title ?? "", t("agent.session.rename")))?.trim();
    if (!title) {
        return;
    }
    sessionActionId.value = target.sessionId;
    try {
        await renameSession(target.sessionId, title);
    } finally {
        sessionActionId.value = null;
    }
};

const archiveSessionFromDialog = async (target: AgentSessionSummaryDto): Promise<void> => {
    if (loadingSession.value || sessionActionId.value || target.interaction?.canArchive !== true) {
        return;
    }
    sessionActionId.value = target.sessionId;
    try {
        await agentApi.runCommand(target.sessionId, {
            command: "archive",
            reason: "archived from drawer",
        });
        await refreshSessions();
        if (target.sessionId !== activeSessionId.value) {
            return;
        }
        await loadSession(target.sessionId);
    } finally {
        sessionActionId.value = null;
    }
};

/** unknown attempt 只有用户确认可能重复后才以新 clientMessageId 重新发送。 */
const resendUnknownMessage = async (message: AgentMessage): Promise<void> => {
    if (message.deliveryState !== "unknown" || !activeSessionId.value) {
        return;
    }
    const markdown = agentMessageMarkdown(message);
    if (markdown === null) {
        notification.error("无法重建这条未知消息的完整正文。", {title: "无法重新发送"});
        return;
    }
    if (inputText.value && inputText.value !== markdown) {
        notification.warning("Composer 中已有其它草稿，请先处理当前草稿。", {title: "未重新发送"});
        return;
    }
    const accepted = await confirm(
        "服务器可能已经接受原消息。重新发送会生成新的 clientMessageId，并可能产生重复内容。",
        "确认重新发送",
    );
    if (!accepted) {
        return;
    }
    inputText.value = markdown;
    await nextTick();
    if (running.value && message.deliveryMode === "steer") {
        await steer();
        return;
    }
    if (running.value && message.deliveryMode === "followup") {
        await followup();
        return;
    }
    await send();
};

/** 用户可移除仅存在于当前页面内存中的 unknown optimistic 占位。 */
const dismissUnknownMessage = (message: AgentMessage): void => {
    if (message.deliveryState === "unknown") {
        session.removeOptimisticUserMessage(message.id);
    }
};

/** 恢复归档 Session；关系账本未 detach 的关系会由 effective view 自动重新显现。 */
const restoreSessionFromDialog = async (target: AgentSessionSummaryDto): Promise<void> => {
    if (loadingSession.value || sessionActionId.value || target.interaction?.canRestore !== true) {
        return;
    }
    sessionActionId.value = target.sessionId;
    try {
        await agentApi.runCommand(target.sessionId, {command: "restore"});
        await refreshSessions();
        if (target.sessionId === activeSessionId.value) {
            await loadSession(target.sessionId);
        }
        notification.success("Session 已恢复");
    } catch (error) {
        notifyAgentError(error, "恢复 Session 失败");
    } finally {
        sessionActionId.value = null;
    }
};

/**
 * 清空当前 workspace 绑定的 Agent session 状态。workspace 切换时必须硬重置，
 * 避免同 profile 的不同 Project Workspace 复用旧会话。
 */
function resetWorkspaceSessionState(): void {
    const drafts = ensureComposerDraftSession();
    if (drafts) {
        drafts.update(inputText.value);
        composerContextGeneration.value = drafts.clearContext();
    }
    sessionStream.stop();
    inlineEditorStream.stop();
    activeSessionId.value = null;
    inlineEditorSessionId.value = null;
    sessions.value = [];
    inlineEditorSessions.value = [];
    linkedAgentPanelOpen.value = false;
    sessionDialogOpen.value = false;
    sessionTreeDialogOpen.value = false;
    sessionModelPopoverOpen.value = false;
    inlineSessionModelPopoverOpen.value = false;
    inlineSessionModelSaving.value = false;
    cancelEditingMessage();
    messageActionId.value = null;
    inputText.value = "";
    resetSessionAttachments();
    session.reset();
    inlineEditorSession.reset();
    inlineEditorResultText.value = "";
    syncSessionModelState(null);
    syncInlineSessionModelState();
}

watch(() => props.selectedFilePath, (nextFilePath, previousFilePath) => {
    const nextValue = nextFilePath || null;
    const previousValue = previousFilePath || null;
    if (nextValue === previousValue) {
        return;
    }
    previousSelectedFilePath.value = previousValue;
    fileChangedSinceLastSend.value = true;
    selectionVersion.value += 1;
});

watch(() => props.active, async (active) => {
    if (!active) {
        sessionDialogOpen.value = false;
        linkedAgentPanelOpen.value = false;
        sessionModelPopoverOpen.value = false;
        inlineSessionModelPopoverOpen.value = false;
        attachmentPanelOpen.value = false;
        cancelEditingMessage();
        messageActionId.value = null;
        return;
    }
    await loadSelectableModels();
    await loadResolvedLeaderProfileKey();
    await ensureSessionReady();
    await nextTick();
    requestAnimationFrame(() => {
        inputRef.value?.focus();
        scrollToBottom();
    });
});

watch(linkedAgentPanelOpen, (open) => {
    if (open) {
        void refreshLinkedAgentRelations();
    }
});

watch(activeSessionId, () => {
    if (linkedAgentPanelOpen.value) {
        void refreshLinkedAgentRelations();
    }
});

watch(leaderProfileKey, async () => {
    if (suppressLeaderProfileReset) {
        return;
    }
    resetWorkspaceSessionState();
    if (!props.active) {
        return;
    }
    await ensureSessionReady();
});

watch(() => [ideStore.workspaceKind, ideStore.currentNovelId] as const, async () => {
    suppressLeaderProfileReset = true;
    try {
        await loadResolvedLeaderProfileKey();
        resetWorkspaceSessionState();
        if (!props.active) {
            return;
        }
        await ensureSessionReady();
        await nextTick();
    } finally {
        suppressLeaderProfileReset = false;
    }
});

watch(() => ideStore.configRevision, async () => {
    if (!props.active) {
        return;
    }
    await loadSelectableModels();
    await loadResolvedLeaderProfileKey();
    await syncActiveSessionRecovery("manual_refresh");
});

onBeforeUnmount(() => {
    composerDraftSession?.dispose();
    composerDraftSession = null;
    sessionStream.stop();
    inlineEditorStream.stop();
    resetSessionAttachments();
});

watch(queuedMessages, (items) => {
    session.consumeOptimisticClientMessageIds(items.map((item) => item.clientMessageId));
});

watch(inputText, () => {
    composerDraftSession?.update(inputText.value);
});

onMounted(() => {
    void (async () => {
        if (!import.meta.client) {
            return;
        }
        await loadSelectableModels();
        await loadResolvedLeaderProfileKey();
        const {default: createDOMPurify} = await import("dompurify");
        const purifier = createDOMPurify(window);
        sanitizeHtml.value = (html) => purifier.sanitize(html) as string;
    })();
});

defineExpose({
    activeSessionId,
    sessions,
    loadingSession,
    linkedAgentsLoading,
    running,
    selectableModels,
    inlineEditorRunning,
    inlineEditorResultText,
    inlineEditorLiveView,
    inlineEditorSessionId,
    inlineEditorSessions,
    inlineEditorSessionLoading,
    inlineEditPreview,
    inlineEditorSessionLabel,
    inlineSessionModelDraft,
    inlineSessionModelPopoverOpen,
    inlineSessionModelSaving,
    inlineSessionModelSelectionValue,
    inlineSessionThinkingResolvedLabel,
    sessionActionId,
    ensureSessionReady,
    refreshSessionsWithQuery,
    selectSession,
    createSession: createSessionFromHeader,
    archiveSessionFromDialog,
    restoreSessionFromDialog,
    renameSessionFromDialog,
    openInlineEditorSession,
    refreshInlineEditorSessions,
    selectInlineEditorSession,
    createInlineEditorSession,
    setInlineSessionModelDraft,
    setInlineSessionModelPopoverOpen,
    updateInlineSessionModelSelection,
    toggleInlineSessionModelPopover,
    applyInlineSessionModelSettings,
    resetInlineSessionModelSettings,
    sendInlineEditorPrompt,
    stopInlineEditorPrompt,
});

/**
 * 确保 Project 级 Inline AI Session 可用。
 */
async function ensureInlineEditorSession(): Promise<AgentSessionSummaryDto> {
    const list = await refreshInlineEditorSessions();
    const selected = inlineEditorSessionId.value
        ? list.find((item) => item.sessionId === inlineEditorSessionId.value)
        : undefined;
    if (selected) {
        return selected;
    }
    return createInlineEditorSession();
}

/**
 * 刷新当前 Project Workspace 下的 Inline AI sessions。
 */
async function refreshInlineEditorSessions(): Promise<AgentSessionSummaryDto[]> {
    const requestId = ++inlineEditorSessionRequestId;
    inlineEditorSessionLoading.value = true;
    try {
        const page = await agentApi.listSessions({
            workspaceKey: workspaceKey.value,
            profileGroup: "all",
            profileKey: INLINE_EDITOR_PROFILE_KEY,
            status: "active",
            relation: "all",
            limit: 50,
        });
        if (requestId !== inlineEditorSessionRequestId) {
            return inlineEditorSessions.value;
        }
        inlineEditorSessions.value = page.items;
        const rememberedId = readInlineEditorSessionId();
        const remembered = rememberedId ? page.items.find((item) => item.sessionId === rememberedId) : undefined;
        const current = inlineEditorSessionId.value ? page.items.find((item) => item.sessionId === inlineEditorSessionId.value) : undefined;
        const target = current ?? remembered ?? page.items[0];
        if (target && inlineEditorSessionId.value !== target.sessionId) {
            await loadInlineEditorSession(target.sessionId, {invalidateRefresh: false});
        }
        if (!target) {
            inlineEditorSessionId.value = null;
            inlineEditorSession.reset();
            inlineEditorResultText.value = "";
            inlineEditorStream.stop();
            syncInlineSessionModelState();
        }
        return inlineEditorSessions.value;
    } finally {
        if (requestId === inlineEditorSessionRequestId) {
            inlineEditorSessionLoading.value = false;
        }
    }
}

/**
 * 创建一个新的 Project 级 Inline AI session，并设为 PromptBar 当前 session。
 */
async function createInlineEditorSession(): Promise<AgentSessionSummaryDto> {
    const created = await agentApi.createSession({
        profileKey: INLINE_EDITOR_PROFILE_KEY,
        initial: {},
        workspaceRoot: agentWorkspaceRoot.value,
        workspaceKey: workspaceKey.value,
        projectPath: ideStore.workspaceKind === "user-assets" ? undefined : ideStore.currentNovelId,
    });
    await loadInlineEditorSession(created.sessionId);
    await refreshInlineEditorSessions();
    const recovery = inlineEditorSession.recoveryShell.value ?? await agentApi.getSessionRecovery(created.sessionId);
    return recovery.summary;
}

/**
 * 选择 PromptBar 当前使用的 Inline AI session，不影响右侧 Agent 面板。
 */
async function selectInlineEditorSession(sessionId: number): Promise<void> {
    if (inlineEditorSessionId.value === sessionId) {
        return;
    }
    await loadInlineEditorSession(sessionId);
}

/**
 * 加载后台 Inline AI session recovery，并启动它自己的 SSE。
 */
async function loadInlineEditorSession(sessionId: number, options: {invalidateRefresh?: boolean} = {}): Promise<AgentSessionSummaryDto> {
    if (options.invalidateRefresh !== false) {
        inlineEditorSessionRequestId += 1;
    }
    inlineEditorStream.stop();
    inlineEditorSessionId.value = sessionId;
    inlineEditorSession.reset();
    inlineEditorResultText.value = "";
    saveInlineEditorSessionId(sessionId);
    const recovery = await agentApi.getSessionRecovery(sessionId);
    if (recovery.summary.profileKey !== INLINE_EDITOR_PROFILE_KEY) {
        throw new Error(t("agent.chatSurface.inlineLoadFailed"));
    }
    inlineEditorSession.applyRecovery(recovery);
    syncInlineSessionModelState();
    inlineEditorSessions.value = inlineEditorSessions.value.some((item) => item.sessionId === recovery.summary.sessionId)
        ? inlineEditorSessions.value.map((item) => item.sessionId === recovery.summary.sessionId ? recovery.summary : item)
        : [recovery.summary, ...inlineEditorSessions.value];
    void inlineEditorStream.start(sessionId);
    return recovery.summary;
}

function readInlineEditorSessionId(): number | null {
    if (!import.meta.client) {
        return null;
    }
    const raw = localStorage.getItem(`agent:inline-editor-session:${workspaceKey.value}`);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function saveInlineEditorSessionId(sessionId: number): void {
    if (!import.meta.client) {
        return;
    }
    localStorage.setItem(`agent:inline-editor-session:${workspaceKey.value}`, String(sessionId));
}

function readLastSessionId(): number | null {
    if (!import.meta.client) {
        return null;
    }
    const raw = localStorage.getItem(`agent:last-session:${workspaceKey.value}`);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function saveLastSessionId(sessionId: number): void {
    if (!import.meta.client) {
        return;
    }
    localStorage.setItem(`agent:last-session:${workspaceKey.value}`, String(sessionId));
}

function formatAnswerText(
    options: Array<{label: string}>,
    selectedOptionIndex?: number,
    note?: string,
): string {
    const selectedText = selectedOptionIndex === undefined
        ? ""
        : selectedOptionIndex === -1 ? t("agent.userInput.otherAnswer") : options[selectedOptionIndex]?.label ?? String(selectedOptionIndex);
    if (selectedText && note?.trim()) {
        return `${selectedText}\n${t("agent.planApproval.note", {note: note.trim()})}`;
    }
    return note?.trim() || selectedText || t("agent.userInput.continue");
}

function isApprovalApproved(answer?: {
    selectedOptionIndex?: number;
    ignored?: boolean;
}): boolean {
    if (!answer || answer.ignored) {
        return false;
    }
    return answer.selectedOptionIndex === 0;
}
</script>

<template>
    <!-- Agent Chat Surface -->
    <section
        class="relative flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-panel)]"
        :class="[props.layout === 'workbench' ? 'border-x border-[var(--border-color)]' : '', props.active ? '' : 'pointer-events-none opacity-0']"
        :aria-hidden="!props.active"
    >
        <!-- 抽屉头部 -->
            <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3">
                <div class="min-w-0 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded border border-[var(--accent-main)] bg-[var(--accent-bg)]">
                        <span class="h-3.5 w-3.5" :class="drawerIconClass"></span>
                    </div>
                    <div class="min-w-0">
                        <div class="flex min-w-0 items-center gap-1.5">
                            <div class="truncate text-sm font-medium tracking-wide text-[var(--text-main)]" :title="activeSessionTitle">{{ activeSessionTitle }}</div>
                            <span class="inline-flex shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[9px] font-medium tracking-normal text-[var(--text-muted)]" :title="activeDrawerTitle">{{ activeDrawerTitle }}</span>
                        </div>
                        <div class="flex min-w-0 items-center gap-1.5">
                            <div class="truncate text-[10px] leading-4 text-[var(--text-muted)]" :title="activeSessionSummaryText">{{ activeSessionSummaryText }}</div>
                            <span v-if="summarizerStatus" class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-normal" :class="summarizerStatus.className" :title="summarizerStatus.title">
                                <span class="h-3 w-3" :class="[summarizerStatus.icon, summarizerStatus.spinning ? 'animate-spin' : '']"></span>
                                {{ summarizerStatus.label }}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <Dropdown v-if="canChooseCreateProfile" :items="createProfileDropdownItems" root-class="relative inline-block" menu-class="right-0 top-full mt-1.5 w-44" compact @select="void createSessionFromHeader($event)">
                        <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :title="t('agent.session.newChat')" :disabled="loadingSession">
                            <span class="i-lucide-plus h-4 w-4"></span>
                        </button>
                    </Dropdown>
                    <button v-else class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :title="t('agent.session.newChat')" :disabled="loadingSession" @click="void createSessionFromHeader()">
                        <span class="i-lucide-plus h-4 w-4"></span>
                    </button>
                    <button class="flex items-center gap-1 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': attachmentPanelOpen}" title="查看当前 Session 的全部附件" :disabled="!activeSessionId" @click="toggleAttachmentPanel">
                        <span class="i-lucide-paperclip h-4 w-4"></span>
                        <span v-if="sessionAttachmentUniqueTotal" class="rounded-sm bg-[var(--accent-main)] px-1 text-[9px] font-bold text-[var(--text-inverse)]">{{ sessionAttachmentUniqueTotal }}</span>
                    </button>
                    <button class="flex items-center gap-1.5 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': linkedAgentPanelOpen}" :title="t('agent.chatSurface.linkedAgentsTitle')" @click="linkedAgentPanelOpen = !linkedAgentPanelOpen">
                        <span class="i-lucide-users h-4 w-4"></span>
                        <span v-if="linkedAgentCount" class="rounded-sm bg-[var(--accent-main)] px-1 text-[9px] font-bold text-[var(--text-inverse)]">{{ linkedAgentCount }}</span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :title="t('agent.chatSurface.sessionTreeTitle')" :disabled="!activeSessionId || !activeInteraction.canMutateHistory" @click="sessionTreeDialogOpen = true">
                        <span class="i-lucide-git-branch h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': systemPromptPanelOpen}" :title="t('agent.systemPrompt.open')" :disabled="!activeSessionId" @click="systemPromptPanelOpen = !systemPromptPanelOpen">
                        <span class="i-lucide-terminal-square h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.chatSurface.sessionListTitle')" @click="void openSessionDialog()">
                        <span class="i-lucide-messages-square h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
            </div>

            <AgentSessionAttachmentPanel
                v-if="attachmentPanelOpen && activeSessionId"
                :session-id="activeSessionId"
                :items="sessionAttachments"
                :total="sessionAttachmentPageTotal"
                :has-more="sessionAttachmentHasMore"
                :loading="sessionAttachmentLoading"
                :search="sessionAttachmentSearch"
                :insert-disabled="!activeInteraction.canInsertAttachment"
                @update:search="updateAttachmentSearch"
                @load-more="void loadSessionAttachments(false)"
                @insert="insertSessionAttachment"
                @close="attachmentPanelOpen = false"
            />

            <!-- Linked Agent 面板 -->
            <AgentLinkedAgentPanel
                v-if="linkedAgentPanelOpen"
                :session-id="activeSessionId"
                :owned-agents="linkedAgents"
                :linked-by-agents="linkedByAgents"
                :loading="linkedAgentsLoading"
                @select="void loadSession($event); linkedAgentPanelOpen = false"
                @refresh="void refreshLinkedAgentRelations()"
                @close="linkedAgentPanelOpen = false"
            />

            <AgentSystemPromptPanel
                v-model="systemPromptPanelOpen"
                :value="session.systemPrompt.value"
                :loading="session.systemPromptLoading.value"
                :error="session.systemPromptError.value"
                :open-reference="openMessageReference"
                @load="void loadActiveSystemPrompt()"
                @refresh="void loadActiveSystemPrompt(true)"
            />

            <!-- 消息序列 -->
            <AgentChatFlow
                ref="chatFlowRef"
                :messages="renderNodes"
                :session-id="activeSessionId"
                :running="running"
                mode="main"
                :editing-message-id="editingMessageId"
                :editing-message-text="editingMessageText"
                :message-action-disabled="messageActionsDisabled"
                :run-action-disabled="historyMutationDisabled"
                :saving-edit="Boolean(messageActionId)"
                :session-attachments="knownSessionAttachments"
                :can-register-attachments="activeInteraction.canRegisterAttachment"
                :can-insert-attachments="activeInteraction.canInsertAttachment"
                :project-path="props.novelId || null"
                :model-supports-images="activeModelSupportsImages"
                :attachment-insert-request="historyAttachmentInsertRequest"
                :branch-switcher-state-by-message-id="branchSwitcherStateByMessageId"
                :menu-refresh-key="agentMenuRefreshKey"
                :resolve-editor-menu="resolveInputMenu"
                :on-editor-skill-trigger-start="refreshSkillCatalog"
                :open-reference="openMessageReference"
                :cost-display-options="costDisplayOptions"
                :cost-exchange-rate-suffix="costExchangeRateSuffix"
                :history-has-previous="session.hasPrevious.value"
                :history-loading="session.historyLoading.value"
                :history-error="session.historyError.value"
                @copy="void copyMessage($event)"
                @copy-tool="void copyToolCall($event)"
                @start-edit="void startEditingMessage($event)"
                @cancel-edit="cancelEditingMessage"
                @save-edit="void saveEditedMessage($event)"
                @retry="void refreshMessage($event)"
                @delete="void rollbackMessage($event)"
                @cycle-branch="void cycleMessageBranch($event.messageId, $event.direction)"
                @load-previous="void loadPreviousHistory()"
                @attachment-registered="registerSessionAttachment"
            />

            <AgentComposer
                :key="composerContextGeneration"
                ref="inputRef"
                v-model:input-text="inputText"
                v-model:selected-answers="userInputSelectedAnswers"
                v-model:notes="userInputNotes"
                v-model:session-model-popover-open="sessionModelPopoverOpen"
                v-model:session-model-draft="sessionModelDraft"
                :pending-session="pendingUserInputSession"
                :submitting-user-input="submittingCurrentUserInput"
                :running="running"
                :readonly="composerReadonly"
                :readonly-reason="composerReadonlyReason"
                :can-register-attachments="activeInteraction.canRegisterAttachment"
                :can-insert-attachments="activeInteraction.canInsertAttachment"
                :can-abort="activeInteraction.canAbort"
                :loading-session="loadingSession"
                :session-model-saving="sessionModelSaving"
                :session-model-selection-value="sessionModelSelectionValue"
                :session-thinking-resolved-label="sessionThinkingResolvedLabel"
                :selectable-models="selectableModels"
                :agent-mode="agentMode"
                :can-continue-without-input="canContinueWithoutInput"
                :context-usage-exact-label="contextUsageExactLabel"
                :context-usage-compact-label="contextUsageCompactLabel"
                :context-percent-compact-label="contextPercentCompactLabel"
                :cumulative-usage-exact-label="cumulativeUsageExactLabel"
                :cumulative-input-compact-label="cumulativeInputCompactLabel"
                :cumulative-output-compact-label="cumulativeOutputCompactLabel"
                :cumulative-cache-compact-label="cumulativeCacheCompactLabel"
                :cumulative-cache-write-compact-label="cumulativeCacheWriteCompactLabel"
                :cumulative-cache-hit-rate-label="cumulativeCacheHitRateLabel"
                :cumulative-cost-compact-label="cumulativeCostCompactLabel"
                :connection-status-label="connectionStatusLabel"
                :run-phase-label="runPhaseLabel"
                :connection-needs-action="connectionNeedsAction"
                :queued-messages="queuedMessages"
                :menu-refresh-key="agentMenuRefreshKey"
                :project-path="props.novelId || null"
                :history-inbox-refresh-key="props.historyInboxRefreshKey ?? 0"
                :history-inbox-active="props.active"
                :session-id="activeSessionId"
                :session-attachments="knownSessionAttachments"
                :model-supports-images="activeModelSupportsImages"
                :resolve-menu="resolveInputMenu"
                :on-skill-trigger-start="refreshSkillCatalog"
                @submit-user-input="void submitUserInputAnswers($event)"
                @submit-user-input-form="void submitUserInputForm($event)"
                @cancel-user-input="void cancelPendingUserInput($event)"
                @send="void send()"
                @steer="void steer()"
                @followup="void followup()"
                @stop="void stopRun()"
                @cycle-mode="void cycleAgentMode()"
                @toggle-session-model-popover="toggleSessionModelPopover"
                @update-session-model-selection="void updateSessionModelSelection($event)"
                @apply-session-model-settings="void applySessionModelSettings()"
                @reset-session-model-settings="void resetSessionModelSettings()"
                @reconnect-events="void reconnectActiveSessionEvents()"
                @refresh-history="void syncActiveSessionRecovery()"
                @open-history-inbox="emit('open-history-inbox')"
                @open-workspace-file="openMessageReference"
                @attachment-registered="registerSessionAttachment"
                @resend-unknown="void resendUnknownMessage($event)"
                @dismiss-unknown="dismissUnknownMessage($event)"
            />

            <!-- Session 管理弹窗 -->
            <AgentSessionDialog
                v-model="sessionDialogOpen"
                :sessions="sessions"
                :total="sessionListTotal"
                :has-more="sessionListHasMore"
                :next-offset="sessionListNextOffset"
                :active-session-id="activeSessionId"
                :loading="loadingSession || sessionListLoading"
                :running="running"
                :action-id="sessionActionId"
                :create-profile-options="createProfileOptions"
                :can-choose-create-profile="canChooseCreateProfile"
                @select="void selectSession($event)"
                @create="void createSessionFromDialog($event)"
                @archive="void archiveSessionFromDialog($event)"
                @restore="void restoreSessionFromDialog($event)"
                @rename="void renameSessionFromDialog($event)"
                @refresh="void refreshSessionsWithQuery($event)"
                @load-more="void refreshSessionsWithQuery($event)"
            />

            <AgentSessionTreeDialog
                v-model="sessionTreeDialogOpen"
                :tree="activeRecovery?.tree ?? []"
                :active-leaf-id="activeRecovery?.activeLeafId ?? null"
                :running="running"
                :can-activate="activeInteraction.canMutateHistory"
                @select="void selectTreeNode($event)"
            />
    </section>
</template>
