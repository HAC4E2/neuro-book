<script setup lang="ts">
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentComposerInput from "nbook/app/components/novel-ide/agent/AgentComposerInput.vue";
import AgentSessionModelControls from "nbook/app/components/novel-ide/agent/AgentSessionModelControls.vue";
import AgentUserInputPrompt from "nbook/app/components/novel-ide/agent/AgentUserInputPrompt.vue";
import AgentWorkspaceChanges from "nbook/app/components/novel-ide/agent/AgentWorkspaceChanges.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {AgentQueuedMessageDto, AgentMode, AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import {publicValuePreviewJsonValue} from "nbook/app/components/novel-ide/agent/agent-message";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";
import type {ComposerImageNode} from "nbook/app/components/novel-ide/agent/composer-image-transaction";
import {useComposerImageTransaction} from "nbook/app/components/novel-ide/agent/useComposerImageTransaction";

const props = defineProps<{
    inputText: string;
    pendingSession: AgentPendingUserInputSession | null;
    selectedAnswers: Record<string, number[]>;
    notes: Record<string, string>;
    submittingUserInput: boolean;
    running: boolean;
    readonly?: boolean;
    readonlyReason?: string;
    canRegisterAttachments: boolean;
    canInsertAttachments: boolean;
    canAbort: boolean;
    loadingSession: boolean;
    sessionModelSaving: boolean;
    sessionModelPopoverOpen: boolean;
    sessionModelSelectionValue: string | null;
    sessionThinkingResolvedLabel: string;
    sessionModelDraft: AgentSessionModelDraft;
    selectableModels: EnabledModelOptionDto[];
    agentMode: AgentMode;
    canContinueWithoutInput: boolean;
    contextUsageExactLabel: string;
    contextUsageCompactLabel: string;
    contextPercentCompactLabel: string;
    cumulativeUsageExactLabel: string;
    cumulativeInputCompactLabel: string;
    cumulativeOutputCompactLabel: string;
    cumulativeCacheCompactLabel: string;
    cumulativeCacheWriteCompactLabel: string;
    cumulativeCacheHitRateLabel: string;
    cumulativeCostCompactLabel: string;
    connectionStatusLabel: string;
    runPhaseLabel: string;
    connectionNeedsAction: boolean;
    queuedMessages: AgentQueuedMessageDto[];
    menuRefreshKey: string | number;
    projectPath: string | null;
    historyInboxRefreshKey: string | number;
    historyInboxActive: boolean;
    sessionId: number | null;
    sessionAttachments: AgentSessionAttachmentItemDto[];
    modelSupportsImages: boolean;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
}>();

const emit = defineEmits<{
    (e: "update:inputText", value: string): void;
    (e: "update:selectedAnswers", value: Record<string, number[]>): void;
    (e: "update:notes", value: Record<string, string>): void;
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "submit-user-input", payload: {
        assistantMessageId: string;
        resume?: boolean;
        answers: Array<{
            toolNodeId: string;
            questionIndex?: number;
            selectedOptionIndex?: number;
            note?: string;
            ignored?: boolean;
        }>;
    }): void;
    /** Task 63: Low-Code Form 提交事件 */
    (e: "submit-user-input-form", payload: {
        assistantMessageId: string;
        toolCallId: string;
        data: import("nbook/shared/dto/low-code-form.dto").LowCodeJsonObject;
    }): void;
    (e: "cancel-user-input", payload: {assistantMessageId: string}): void;
    (e: "send"): void;
    (e: "steer"): void;
    (e: "followup"): void;
    (e: "stop"): void;
    (e: "cycle-mode"): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
    (e: "reconnect-events"): void;
    (e: "refresh-history"): void;
    (e: "open-history-inbox"): void;
    (e: "open-workspace-file", path: string): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;
}>();

const inputRef = ref<InstanceType<typeof AgentComposerInput> | null>(null);
const userInputPromptRef = ref<InstanceType<typeof AgentUserInputPrompt> | null>(null);
const {t} = useI18n();
const imageFileInputRef = ref<HTMLInputElement | null>(null);
const activeQuestionKey = ref("");
const composerExpanded = ref(false);
const activeQuestionState = ref({
    canContinue: false,
    submitButtonLabel: t("agent.composer.continue"),
});

const images = useComposerImageTransaction({
    editor: () => inputRef.value,
    sessionId: () => props.sessionId,
    value: () => props.inputText,
    sessionAttachments: () => props.sessionAttachments,
    canRegister: () => props.canRegisterAttachments && !props.readonly && !props.pendingSession,
    canInsert: () => props.canInsertAttachments && !props.readonly && !props.pendingSession,
    blockedReason: () => props.pendingSession
        ? "等待用户回答期间不能上传或插入图片。"
        : props.readonlyReason || "当前 Session 不能上传或插入图片。",
    projectPath: () => props.projectPath,
    onAttachmentRegistered: (item) => emit("attachment-registered", item),
});
const composerGeneration = images.generation;
const imageDocument = images.imageDocument;
const resolvedImageItems = images.resolvedItems;

const activeComposerValue = computed(() => {
    if (!props.pendingSession || !activeQuestionKey.value) {
        return props.inputText;
    }
    return props.notes[activeQuestionKey.value] ?? "";
});

/** 各模式在 Composer 上的图标、样式与文案配置。 */
const AGENT_MODE_META: Record<AgentMode, {icon: string; buttonClass: string; badgeVisible: boolean}> = {
    normal: {icon: "i-lucide-pencil-line", buttonClass: "text-[var(--text-muted)] hover:text-[var(--text-main)]", badgeVisible: false},
    discuss: {icon: "i-lucide-messages-square", buttonClass: "text-[var(--status-info,var(--accent-text))] bg-[var(--accent-bg)]", badgeVisible: true},
    plan: {icon: "i-lucide-clipboard-list", buttonClass: "text-[var(--accent-text)] bg-[var(--accent-bg)]", badgeVisible: true},
};

const agentModeMeta = computed(() => AGENT_MODE_META[props.agentMode]);
const agentModeLabel = computed(() => t(`agent.mode.${props.agentMode}`));
const modeButtonTitle = computed(() => t("agent.composer.cycleModeTitle", {mode: agentModeLabel.value}));

const composerPlaceholder = computed(() => {
    if (props.pendingSession) {
        return t("agent.composer.pendingPlaceholder");
    }
    if (props.agentMode === "discuss") {
        return t("agent.composer.discussPlaceholder");
    }
    if (props.agentMode === "plan") {
        return t("agent.composer.planPlaceholder");
    }
    return t("agent.composer.messagePlaceholder");
});

const runInputText = computed(() => props.inputText);
const canStopReadonlyRun = computed(() => props.readonly && props.running && props.canAbort && !runInputText.value.trim());
const composerImages = computed(() => props.pendingSession
    ? []
    : images.stableImages.value);
const sessionAttachmentByTarget = computed(() => new Map(
    [...resolvedImageItems.value, ...props.sessionAttachments].map((item) => [item.target, item]),
));
const documentPendingImages = computed(() => props.pendingSession
    ? []
    : images.pendingImages.value);
const pendingImageCount = computed(() => documentPendingImages.value.length);
const imageUsage = images.usage;
const failedPendingImage = images.failed;
const canRegisterImages = images.canRegister;
const composerMenuRefreshKey = computed(() => [
    props.menuRefreshKey,
    images.menuRefreshKey.value,
].join(":"));
const imageCapabilityWarning = computed(() => composerImages.value.length > 0 && !props.modelSupportsImages);

const sendDisabled = computed(() => {
    if (props.readonly) {
        return !canStopReadonlyRun.value;
    }
    if (props.pendingSession) {
        return props.submittingUserInput || !activeQuestionState.value.canContinue;
    }
    if (pendingImageCount.value > 0) {
        return true;
    }
    if (imageUsage.value.unresolvedStable > 0) {
        return true;
    }
    if (images.metadataError.value) {
        return true;
    }
    if (images.budgetError.value) {
        return true;
    }
    if (props.running) {
        return false;
    }
    return !props.inputText.trim() && !props.canContinueWithoutInput;
});

const sendIconClass = computed(() => {
    if (pendingImageCount.value > 0) {
        return failedPendingImage.value
            ? "i-lucide-image-off"
            : "i-lucide-loader-2 animate-spin";
    }
    if (props.pendingSession && props.submittingUserInput) {
        return "i-lucide-loader-2 animate-spin";
    }
    if (props.pendingSession) {
        return "i-lucide-corner-down-left";
    }
    if (props.running && !runInputText.value.trim()) {
        return "i-lucide-square";
    }
    if (props.running) {
        return "i-lucide-corner-down-left";
    }
    if (props.canContinueWithoutInput) {
        return "i-lucide-chevrons-right";
    }
    return "i-lucide-send";
});

const sendButtonTitle = computed(() => {
    if (pendingImageCount.value > 0) {
        return failedPendingImage.value
            ? "请重试或移除上传失败的图片"
            : "图片上传完成后才能发送";
    }
    if (imageUsage.value.unresolvedStable > 0) {
        return "正在校验 Session 图片附件";
    }
    if (images.metadataError.value) {
        return images.metadataError.value;
    }
    if (images.budgetError.value) {
        return images.budgetError.value;
    }
    if (canStopReadonlyRun.value) {
        return t("agent.composer.stop");
    }
    if (props.readonly) {
        return props.readonlyReason || t("agent.composer.readonly");
    }
    if (props.pendingSession) {
        return activeQuestionState.value.submitButtonLabel || t("agent.composer.continue");
    }
    if (props.running && runInputText.value.trim()) {
        return composerExpanded.value ? t("agent.composer.steerQueueExpanded") : t("agent.composer.steerQueue");
    }
    if (props.running) {
        return t("agent.composer.stop");
    }
    if (props.canContinueWithoutInput) {
        return t("agent.composer.continue");
    }
    return t("agent.composer.send");
});

const expandButtonTitle = computed(() => composerExpanded.value ? t("agent.composer.collapseEditor") : t("agent.composer.expandEditor"));
const expandButtonIcon = computed(() => composerExpanded.value ? "i-lucide-minimize-2" : "i-lucide-maximize-2");

const queuedMessageText = (item: AgentQueuedMessageDto): string => {
    const text = item.text?.preview.trim();
    if (text) {
        return text;
    }
    if (item.images.length > 0) {
        return `包含 ${String(item.images.length + item.omittedImages)} 张图片`;
    }
    return item.input === undefined ? "" : JSON.stringify(publicValuePreviewJsonValue(item.input));
};

const queuedMessageIcon = (item: AgentQueuedMessageDto): string => item.kind === "steer" ? "i-lucide-corner-down-left" : "i-lucide-list-plus";

const queuedMessageLabel = (item: AgentQueuedMessageDto): string => item.kind === "steer" ? t("agent.composer.steer") : t("agent.composer.queue");

const resolveComposerMenu = (context: AgentTriggerMenuContext): AgentTriggerMenuState => {
    const state = props.resolveMenu(context);
    if (context.kind === "command") {
        if (!context.hasPlainTextBeforeTrigger) {
            return state;
        }
        const blockedIds = new Set(["command:compact", "command:clear", "command:new"]);
        return {
            ...state,
            sections: state.sections
                .map((section) => ({
                    ...section,
                    items: section.items.filter((item) => !blockedIds.has(item.id)),
                }))
                .filter((section) => section.items.length > 0),
        };
    }
    return images.decorateMenu(context, state);
};

/**
 * 聚焦底部输入框。
 */
const focus = (): void => {
    inputRef.value?.focus();
};

/** 文件选择、粘贴和拖拽统一进入有序 pending 节点队列。 */
function queueImageFiles(payload: {files: File[]; position?: number}): void {
    images.queueFiles(payload);
}

/** 重试失败图片。 */
function retryPendingImage(uploadId: string): void {
    images.retry(uploadId);
}

/** 移除 pending 图片并中止请求。 */
function removePendingImage(uploadId: string): void {
    images.remove(uploadId);
}

function selectImageFiles(): void {
    if (canRegisterImages.value) {
        imageFileInputRef.value?.click();
    }
}

function handleImageFileSelection(event: Event): void {
    const input = event.target as HTMLInputElement;
    queueImageFiles({files: Array.from(input.files ?? [])});
    input.value = "";
}

function notifyImageFilesBlocked(): void {
    images.notifyBlocked();
}

/** 附件面板重新插入时只改正文，不创建新的 Session 登记。 */
function insertAttachment(item: AgentSessionAttachmentItemDto): void {
    images.insertAttachment(item);
}

function composerImageUrl(target: string): string | null {
    const item = sessionAttachmentByTarget.value.get(target);
    return item ? agentAttachmentUrl(props.sessionId, item.locator.entryId, item.locator.contentIndex) : null;
}

function removeComposerImage(index: number): void {
    inputRef.value?.removeImageAt(index);
}

/** TipTap 文档变化是 pending 存在性、顺序和发送门禁的唯一输入。 */
function handleImageDocument(nodes: ComposerImageNode[]): void {
    if (props.pendingSession) {
        imageDocument.value = [];
        return;
    }
    images.applyDocument(nodes);
}

watch(() => props.pendingSession, (pendingSession) => {
    if (pendingSession) {
        images.reset();
    }
});

/**
 * 同步输入框内容。
 */
function updateComposerValue(value: string): void {
    if (!props.pendingSession || !activeQuestionKey.value) {
        emit("update:inputText", value);
        return;
    }
    emit("update:notes", {
        ...props.notes,
        [activeQuestionKey.value]: value,
    });
}

/**
 * 更新当前活跃问题，供底部输入框写入 note。
 */
function setActiveQuestion(payload: {toolNodeId: string; questionIndex: number; key: string; canContinue: boolean; submitButtonLabel: string}): void {
    activeQuestionKey.value = payload.key;
    activeQuestionState.value = {
        canContinue: payload.canContinue,
        submitButtonLabel: payload.submitButtonLabel,
    };
}

/**
 * 处理回答备注输入提交。
 */
function submitComposer(payload?: {ctrlKey?: boolean; metaKey?: boolean}): void {
    if (props.readonly || pendingImageCount.value > 0) {
        return;
    }
    if (props.pendingSession) {
        submitActiveQuestion();
        return;
    }
    if (props.running && runInputText.value.trim()) {
        if (payload?.ctrlKey || payload?.metaKey) {
            emit("followup");
        } else {
            emit("steer");
        }
        return;
    }
    emit("send");
}

/**
 * 继续或提交当前 request_user_input 问题。
 */
function submitActiveQuestion(): void {
    if (props.readonly) {
        return;
    }
    userInputPromptRef.value?.continueQuestion();
}

/**
 * 处理右下角按钮点击。
 */
function submitButton(event: MouseEvent): void {
    if ((props.readonly && !canStopReadonlyRun.value) || pendingImageCount.value > 0) {
        return;
    }
    if (props.pendingSession) {
        submitActiveQuestion();
        return;
    }
    if (props.running && !runInputText.value.trim()) {
        emit("stop");
        return;
    }
    if (props.running) {
        if (event.ctrlKey || event.metaKey) {
            emit("followup");
        } else {
            emit("steer");
        }
        return;
    }
    emit("send");
}

defineExpose({focus, insertAttachment});
</script>

<template>
    <!-- Agent 底部输入容器 -->
    <div class="relative shrink-0 bg-[var(--bg-panel)] px-2 pb-1">
        <!-- request_user_input 回答区 -->
        <div v-if="props.pendingSession" class="flex min-w-0 w-full pb-2">
            <AgentUserInputPrompt
                ref="userInputPromptRef"
                :session="props.pendingSession"
                :selected-answers="props.selectedAnswers"
                :notes="props.notes"
                :submitting="props.submittingUserInput"
                :readonly="props.readonly"
                @update:selected-answers="emit('update:selectedAnswers', $event)"
                @update:notes="emit('update:notes', $event)"
                @active-question-change="setActiveQuestion"
                @submit="emit('submit-user-input', $event)"
                @submit-form="emit('submit-user-input-form', $event)"
                @cancel="emit('cancel-user-input', $event)"
            />
        </div>

        <!-- pending 引导/队列 -->
        <div v-if="!props.pendingSession && props.queuedMessages.length > 0" class="flex min-w-0 flex-wrap gap-1 px-1 pb-1.5">
            <div
                v-for="item in props.queuedMessages"
                :key="item.id"
                class="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                :title="`${queuedMessageLabel(item)}：${queuedMessageText(item)}`"
            >
                <span :class="queuedMessageIcon(item)" class="h-3 w-3 shrink-0 text-[var(--accent-text)]"></span>
                <span class="shrink-0 font-medium">{{ queuedMessageLabel(item) }}</span>
                <span class="max-w-[18rem] truncate text-[var(--text-muted)]">{{ queuedMessageText(item) }}</span>
            </div>
        </div>

        <AgentWorkspaceChanges :project-path="props.projectPath" :refresh-key="props.historyInboxRefreshKey" :active="props.historyInboxActive" @open-full="emit('open-history-inbox')" @open-file="emit('open-workspace-file', $event)" />

        <!-- 消息输入栏 -->
        <div class="flex flex-col rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm transition-all focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]" style="--composer-radius: 0.75rem;">
            <!-- 正文图片派生缩略图：删除只移除对应 Markdown 标记。 -->
            <div v-if="composerImages.length > 0" class="flex min-w-0 gap-1.5 overflow-x-auto border-b border-[var(--border-color)]/50 px-2 py-1.5">
                <div v-for="(image, index) in composerImages" :key="`${image.target}:${String(index)}`" class="group relative h-12 w-16 shrink-0 overflow-hidden rounded border border-[var(--border-color)] bg-[var(--bg-panel)]">
                    <img v-if="composerImageUrl(image.target)" :src="composerImageUrl(image.target) || undefined" :alt="image.label" class="h-full w-full object-cover" />
                    <div v-else class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"><span class="i-lucide-image h-4 w-4"></span></div>
                    <button type="button" class="absolute right-0.5 top-0.5 rounded bg-[var(--bg-panel)]/90 p-0.5 text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--status-danger)] group-hover:opacity-100 disabled:hidden" :disabled="props.readonly" title="从正文移除图片" @click="removeComposerImage(index)">
                        <span class="i-lucide-x h-3 w-3"></span>
                    </button>
                    <div class="absolute inset-x-0 bottom-0 truncate bg-[var(--bg-panel)]/85 px-1 text-[8px] text-[var(--text-secondary)]" :title="image.label">{{ image.label }}</div>
                </div>
            </div>

            <div v-if="imageCapabilityWarning" class="flex items-center gap-1.5 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1 text-[10px] text-[var(--status-warning)]">
                <span class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0"></span>
                <span>当前模型未声明图片输入能力；仍可发送，后端会使用文本占位。</span>
            </div>

            <div v-if="images.metadataError.value" class="flex items-center gap-1.5 border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-1 text-[10px] text-[var(--status-danger)]">
                <span class="i-lucide-image-off h-3.5 w-3.5 shrink-0"></span>
                <span class="min-w-0 flex-1 truncate" :title="images.metadataError.value">{{ images.metadataError.value }}</span>
                <button type="button" class="rounded p-1 hover:bg-[var(--bg-hover)]" title="重新校验图片附件" @click="images.retryMetadata">
                    <span class="i-lucide-refresh-cw h-3 w-3"></span>
                </button>
            </div>

            <AgentComposerInput
                ref="inputRef"
                borderless
                :generation="composerGeneration"
                :model-value="activeComposerValue"
                :placeholder="composerPlaceholder"
                :expanded="composerExpanded"
                :readonly="props.readonly"
                :enable-image-files="canRegisterImages"
                :menu-refresh-key="composerMenuRefreshKey"
                :resolve-menu="resolveComposerMenu"
                :on-skill-trigger-start="props.onSkillTriggerStart"
                @update:model-value="updateComposerValue"
                @submit="submitComposer"
                @cycle-mode="emit('cycle-mode')"
                @image-files="queueImageFiles"
                @image-files-blocked="notifyImageFilesBlocked"
                @image-document="handleImageDocument"
                @pending-image-retry="retryPendingImage"
                @pending-image-remove="removePendingImage"
            />

            <div class="flex items-center justify-between border-t border-[var(--border-color)]/50 px-2 py-2">
                <div class="flex min-w-0 items-center gap-2">
                    <AgentSessionModelControls
                        :session-model-selection-value="props.sessionModelSelectionValue"
                        :session-thinking-resolved-label="props.sessionThinkingResolvedLabel"
                        :session-model-draft="props.sessionModelDraft"
                        :selectable-models="props.selectableModels"
                        :session-model-saving="props.sessionModelSaving"
                        :session-model-popover-open="props.sessionModelPopoverOpen"
                        :readonly="props.readonly"
                        :running="props.running"
                        :loading-session="props.loadingSession"
                        dropdown-direction="up"
                        root-class="w-[320px]"
                        popover-class="w-[360px]"
                        @update:session-model-popover-open="emit('update:sessionModelPopoverOpen', $event)"
                        @update:session-model-draft="emit('update:sessionModelDraft', $event)"
                        @update-session-model-selection="emit('update-session-model-selection', $event)"
                        @toggle-session-model-popover="emit('toggle-session-model-popover')"
                        @apply-session-model-settings="emit('apply-session-model-settings')"
                        @reset-session-model-settings="emit('reset-session-model-settings')"
                    />

                    <input ref="imageFileInputRef" class="hidden" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" @change="handleImageFileSelection" />
                    <button
                        type="button"
                        class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
                        :disabled="!canRegisterImages"
                        title="选择图片（可多选，也可拖拽或粘贴）"
                        @click="selectImageFiles"
                    >
                        <span class="i-lucide-image-plus h-3.5 w-3.5"></span>
                    </button>

                    <button
                        class="rounded p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                        :class="composerExpanded ? 'bg-[var(--bg-hover)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                        :title="expandButtonTitle"
                        @click="composerExpanded = !composerExpanded"
                    >
                        <span :class="expandButtonIcon" class="h-3.5 w-3.5"></span>
                    </button>

                    <!-- 三态模式切换按钮：normal → discuss → plan 循环 -->
                    <button
                        class="rounded p-1.5 transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        :class="agentModeMeta.buttonClass"
                        :disabled="props.readonly || props.running"
                        :title="modeButtonTitle"
                        @click="emit('cycle-mode')"
                    >
                        <span :class="agentModeMeta.icon" class="h-3.5 w-3.5"></span>
                    </button>
                </div>
                <button
                    class="flex items-center justify-center rounded bg-[var(--accent-bg)] p-1.5 text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="sendDisabled"
                    :title="sendButtonTitle"
                    @click.prevent="submitButton"
                >
                    <span :class="sendIconClass" class="h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <!-- token 与运行状态 -->
        <div class="mt-1.5 flex flex-wrap items-center justify-center gap-1 text-[9px] text-[var(--text-muted)]">
            <div :title="props.contextUsageExactLabel" class="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-gauge h-3 w-3 shrink-0"></span>
                <span class="truncate font-medium text-[var(--text-secondary)]">{{ props.contextUsageCompactLabel }}</span>
                <span v-if="props.contextPercentCompactLabel" class="rounded-full bg-[var(--accent-bg)] px-1 py-[1px] text-[8px] font-semibold text-[var(--accent-text)]">{{ props.contextPercentCompactLabel }}</span>
            </div>
            <div :title="props.cumulativeUsageExactLabel" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-arrow-down h-3 w-3"></span>
                <span>{{ props.cumulativeInputCompactLabel }}</span>
                <span class="i-lucide-arrow-up h-3 w-3"></span>
                <span>{{ props.cumulativeOutputCompactLabel }}</span>
                <span class="i-lucide-database-zap h-3 w-3"></span>
                <span>{{ props.cumulativeCacheCompactLabel }}</span>
                <template v-if="props.cumulativeCacheHitRateLabel">
                    <span class="i-lucide-percent h-3 w-3"></span>
                    <span>{{ props.cumulativeCacheHitRateLabel }}</span>
                </template>
                <template v-if="props.cumulativeCacheWriteCompactLabel !== '-' && props.cumulativeCacheWriteCompactLabel !== '0'">
                    <span class="i-lucide-hard-drive-upload h-3 w-3"></span>
                    <span>{{ props.cumulativeCacheWriteCompactLabel }}</span>
                </template>
                <template v-if="props.cumulativeCostCompactLabel">
                    <span class="i-lucide-circle-dollar-sign h-3 w-3"></span>
                    <span>{{ props.cumulativeCostCompactLabel }}</span>
                </template>
            </div>
            <div v-if="props.connectionStatusLabel" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-wifi h-3 w-3"></span>
                <span>{{ props.connectionStatusLabel }}</span>
            </div>
            <template v-if="props.connectionNeedsAction">
                <button class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.composer.reconnectTitle')" @click="emit('reconnect-events')">
                    <span class="i-lucide-refresh-cw h-3 w-3"></span>
                    <span>{{ t("agent.composer.reconnect") }}</span>
                </button>
                <button class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.composer.refreshHistoryTitle')" @click="emit('refresh-history')">
                    <span class="i-lucide-history h-3 w-3"></span>
                    <span>{{ t("agent.composer.refreshHistory") }}</span>
                </button>
            </template>
            <div v-if="props.running" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
                <span>{{ props.runPhaseLabel || t("agent.composer.running") }}</span>
            </div>
            <!-- 当前模式徽标：非 normal 模式时展示 -->
            <div v-if="agentModeMeta.badgeVisible" class="inline-flex items-center gap-1 rounded-full border border-[var(--accent-main)]/30 bg-[var(--accent-bg)] px-1.5 py-0.5 text-[var(--accent-text)]" :title="modeButtonTitle">
                <span :class="agentModeMeta.icon" class="h-3 w-3"></span>
                <span>{{ agentModeLabel }}</span>
            </div>
        </div>
    </div>
</template>
