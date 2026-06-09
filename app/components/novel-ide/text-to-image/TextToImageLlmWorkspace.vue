<script setup lang="ts">
import {storeToRefs} from "pinia";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {
    MAX_TEXT_TO_IMAGE_LLM_TOKENS,
    TEXT_TO_IMAGE_PROMPT_TASKS,
    useTextToImageStore,
    type TextToImageLlmContextEntry,
    type TextToImageLlmContextPreset,
    type TextToImageLlmContextRole,
    type TextToImageLlmContextTriggerMode,
    type TextToImageLlmParameters,
    type TextToImagePromptTask,
} from "nbook/app/stores/text-to-image";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    buildTextToImageLlmMessages,
    formatTextToImageLlmMessages,
    requestTextToImageLlmCompletion,
    type TextToImageLlmMessage,
} from "nbook/app/utils/text-to-image-llm";

type ModelListEntry = string | {
    id?: string;
    model?: string;
    name?: string;
};

type ModelListResponse = ModelListEntry[] | {
    data?: ModelListEntry[];
    models?: ModelListEntry[];
};

type JsonRecord = Record<string, unknown>;

const store = useTextToImageStore();
const notification = useNotification();
const {
    activeLlmApiConfig,
    activeLlmContextPreset,
    activeLlmContextPresetId,
    llm,
    llmContextPresets,
    llmTaskBindings,
    taskPrompts,
} = storeToRefs(store);

const contextFileInputRef = ref<HTMLInputElement | null>(null);
const selectedContextEntryId = ref("");
const connectingLlm = ref(false);
const llmConnectionStatus = ref<"idle" | "success" | "failed">("idle");
const llmConnectionMessage = ref("");
const selectedTestTask = ref<TextToImagePromptTask>("bodyImage");
const testUserPrompt = ref("请根据当前配置生成一段简短测试回复。");
const testResponse = ref("");
const testBusy = ref(false);
const testError = ref("");
const lastSentPromptPreview = ref("");

const roleOptions: SelectOption[] = [
    {value: "system", label: "SYS", description: "系统上下文"},
    {value: "user", label: "USER", description: "用户上下文"},
    {value: "assistant", label: "AI", description: "助手历史上下文"},
];

const triggerModeOptions: SelectOption[] = [
    {value: "always", label: "常开", description: "每次请求都会发送"},
    {value: "trigger", label: "触发", description: "本次请求文本包含条目名时发送"},
];

const llmParameterControls: Array<{key: keyof TextToImageLlmParameters; label: string; min: number; max: number; step: number}> = [
    {key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05},
    {key: "topP", label: "Top P", min: 0, max: 1, step: 0.05},
    {key: "maxTokens", label: "Max Tokens", min: 1, max: MAX_TEXT_TO_IMAGE_LLM_TOKENS, step: 100},
];

const promptTaskOptions = computed<SelectOption[]>(() => TEXT_TO_IMAGE_PROMPT_TASKS.map((task) => ({
    value: task.key,
    label: task.label,
    description: task.description,
    iconClass: task.key === "bodyImage" ? "i-lucide-image" : task.key === "characterDesign" ? "i-lucide-palette" : "i-lucide-square-pen",
})));

const apiConfigOptions = computed<SelectOption[]>(() => llm.value.apiConfigs.map((config) => ({
    value: config.id,
    label: config.name || "未命名 API 配置",
    description: config.model || config.apiBaseUrl || "未配置",
    iconClass: "i-lucide-plug",
})));

const llmModelOptions = computed<SelectOption[]>(() => {
    const model = llm.value.model.trim();
    const modelOptions = llm.value.availableModels.map((modelId) => ({
        value: modelId,
        label: modelId,
        iconClass: "i-lucide-box",
    }));
    if (!model || modelOptions.some((option) => option.value === model)) {
        return modelOptions;
    }
    return [
        {value: model, label: `${model}（当前）`, iconClass: "i-lucide-box"},
        ...modelOptions,
    ];
});

const contextPresetOptions = computed<SelectOption[]>(() => llmContextPresets.value.map((preset) => ({
    value: preset.id,
    label: preset.name || "未命名上下文",
    description: `${preset.entries.length} 个条目`,
    iconClass: "i-lucide-list-tree",
})));

const selectedContextEntry = computed(() => activeLlmContextPreset.value?.entries.find((entry) => entry.id === selectedContextEntryId.value) ?? null);

const testMessages = computed<TextToImageLlmMessage[]>(() => {
    const {contextPreset} = store.resolveLlmTaskBinding(selectedTestTask.value);
    return buildTextToImageLlmMessages({
        task: selectedTestTask.value,
        userRequest: testUserPrompt.value,
        taskPrompt: taskPrompts.value[selectedTestTask.value]?.prompt,
        contextPreset,
    });
});

watch(() => activeLlmContextPreset.value?.id, () => {
    selectedContextEntryId.value = activeLlmContextPreset.value?.entries[0]?.id ?? "";
}, {immediate: true});

function selectApiConfig(configId: string): void {
    store.activateLlmApiConfig(configId);
    llmConnectionStatus.value = "idle";
    llmConnectionMessage.value = "";
}

function updateActiveApiName(name: string): void {
    if (!llm.value.activeApiConfigId) {
        return;
    }
    store.updateLlmApiConfig(llm.value.activeApiConfigId, {name});
}

function addApiConfig(): void {
    const config = store.addLlmApiConfig();
    notification.success(`已新建 API 配置：${config.name}`);
}

function saveApiConfig(): void {
    store.saveActiveLlmApiConfig();
    notification.success("API 配置已保存");
}

function deleteActiveApiConfig(): void {
    if (!llm.value.activeApiConfigId || llm.value.apiConfigs.length <= 1) {
        return;
    }
    store.deleteLlmApiConfig(llm.value.activeApiConfigId);
    notification.success("API 配置已删除");
}

function updateLlmApiBaseUrl(apiBaseUrl: string): void {
    store.updateLlmSettings({
        apiBaseUrl,
        availableModels: [],
        model: "",
    });
    llmConnectionStatus.value = "idle";
    llmConnectionMessage.value = "";
}

function updateLlmApiKey(apiKey: string): void {
    store.updateLlmSettings({
        apiKey,
        availableModels: [],
        model: "",
    });
    llmConnectionStatus.value = "idle";
    llmConnectionMessage.value = "";
}

function updateLlmParameter(key: keyof TextToImageLlmParameters, value: string | number): void {
    const nextValue = Number(value);
    if (key === "temperature") {
        store.updateLlmParameters({temperature: nextValue});
        return;
    }
    if (key === "topP") {
        store.updateLlmParameters({topP: nextValue});
        return;
    }
    store.updateLlmParameters({maxTokens: nextValue});
}

function formatLlmParameter(key: keyof TextToImageLlmParameters): string {
    const value = llm.value.parameters[key];
    return key === "maxTokens" ? String(Math.round(value)) : value.toFixed(2);
}

async function connectLlm(): Promise<void> {
    if (connectingLlm.value) {
        return;
    }
    const apiBaseUrl = llm.value.apiBaseUrl.trim().replace(/\/+$/, "");
    if (!apiBaseUrl) {
        llmConnectionStatus.value = "failed";
        llmConnectionMessage.value = "连接失败";
        return;
    }
    connectingLlm.value = true;
    llmConnectionStatus.value = "idle";
    llmConnectionMessage.value = "";
    try {
        const headers: HeadersInit = {};
        if (llm.value.apiKey.trim()) {
            headers.Authorization = `Bearer ${llm.value.apiKey.trim()}`;
        }
        const response = await fetch(`${apiBaseUrl}/models`, {headers});
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json() as ModelListResponse;
        const list = Array.isArray(data)
            ? data
            : Array.isArray(data.data)
                ? data.data
                : Array.isArray(data.models)
                    ? data.models
                    : [];
        const models = list.map((item) => typeof item === "string" ? item : item.id ?? item.model ?? item.name ?? "")
            .filter((item) => item.trim().length > 0);
        if (models.length === 0) {
            throw new Error("没有返回可用模型");
        }
        store.updateLlmSettings({
            apiBaseUrl,
            availableModels: models,
            model: models.includes(llm.value.model) ? llm.value.model : models[0] ?? "",
        });
        store.saveActiveLlmApiConfig();
        llmConnectionStatus.value = "success";
        llmConnectionMessage.value = `已连接，获取到 ${models.length} 个模型`;
    } catch {
        store.updateLlmSettings({availableModels: []});
        llmConnectionStatus.value = "failed";
        llmConnectionMessage.value = "连接失败";
    } finally {
        connectingLlm.value = false;
    }
}

function toggleLlmBoolean(key: "stream" | "sendImages"): void {
    store.updateLlmSettings({[key]: !llm.value[key]});
}

function addContextPreset(): void {
    const preset = store.addLlmContextPreset();
    selectedContextEntryId.value = "";
    notification.success(`已新建上下文预设：${preset.name}`);
}

function saveContextPreset(): void {
    if (!activeLlmContextPreset.value) {
        return;
    }
    store.updateLlmContextPreset(activeLlmContextPreset.value.id, {});
    notification.success("上下文预设已保存");
}

function updateContextPresetName(name: string): void {
    if (!activeLlmContextPreset.value) {
        return;
    }
    store.updateLlmContextPreset(activeLlmContextPreset.value.id, {name});
}

function deleteActiveContextPreset(): void {
    if (!activeLlmContextPreset.value || llmContextPresets.value.length <= 1) {
        return;
    }
    store.deleteLlmContextPreset(activeLlmContextPreset.value.id);
    notification.success("上下文预设已删除");
}

function addContextEntry(): void {
    if (!activeLlmContextPreset.value) {
        return;
    }
    const entry = store.addLlmContextEntry(activeLlmContextPreset.value.id, {
        name: `条目 ${activeLlmContextPreset.value.entries.length + 1}`,
        role: "system",
        triggerMode: "always",
        content: "",
    });
    selectedContextEntryId.value = entry?.id ?? "";
}

function updateContextEntry(entryId: string, patch: Partial<TextToImageLlmContextEntry>): void {
    if (!activeLlmContextPreset.value) {
        return;
    }
    store.updateLlmContextEntry(activeLlmContextPreset.value.id, entryId, patch);
}

function deleteContextEntry(entryId: string): void {
    if (!activeLlmContextPreset.value) {
        return;
    }
    store.deleteLlmContextEntry(activeLlmContextPreset.value.id, entryId);
    if (selectedContextEntryId.value === entryId) {
        selectedContextEntryId.value = activeLlmContextPreset.value.entries.find((entry) => entry.id !== entryId)?.id ?? "";
    }
}

function openContextImportDialog(): void {
    contextFileInputRef.value?.click();
}

async function importContextJson(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) {
        return;
    }
    try {
        const text = await file.text();
        const data = JSON.parse(text) as unknown;
        const entries = parseContextEntriesFromJson(data);
        const name = readJsonName(data) || file.name.replace(/\.[^.]+$/u, "");
        const preset = store.addLlmContextPreset(name, entries);
        selectedContextEntryId.value = preset.entries[0]?.id ?? "";
        notification.success(`已导入上下文预设：${preset.name}`);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "导入 JSON 失败"));
    }
}

function exportActiveContextPreset(): void {
    if (!activeLlmContextPreset.value) {
        return;
    }
    downloadJsonFile(`${activeLlmContextPreset.value.name || "context-preset"}.json`, activeLlmContextPreset.value);
}

function exportAllContextPresets(): void {
    downloadJsonFile("all-context-presets.json", {
        presets: llmContextPresets.value,
        exportedAt: new Date().toISOString(),
    });
}

function updateTaskBinding(task: TextToImagePromptTask, patch: {apiConfigId?: string; contextPresetId?: string}): void {
    store.updateLlmTaskBinding(task, patch);
}

function taskBinding(task: TextToImagePromptTask): {apiConfigId: string; contextPresetId: string} {
    const fallbackApi = llm.value.activeApiConfigId || (llm.value.apiConfigs[0]?.id ?? "");
    const fallbackContext = activeLlmContextPresetId.value || (llmContextPresets.value[0]?.id ?? "");
    const binding = llmTaskBindings.value[task];
    return {
        apiConfigId: binding?.apiConfigId || fallbackApi,
        contextPresetId: binding?.contextPresetId || fallbackContext,
    };
}

async function sendTestRequest(): Promise<void> {
    if (testBusy.value) {
        return;
    }
    const {apiConfig} = store.resolveLlmTaskBinding(selectedTestTask.value);
    const apiBaseUrl = apiConfig.apiBaseUrl.trim().replace(/\/+$/, "");
    if (!apiBaseUrl || !apiConfig.model.trim()) {
        testError.value = "请先为该任务配置 API 和模型";
        return;
    }
    testBusy.value = true;
    testError.value = "";
    testResponse.value = "";
    const messages = testMessages.value;
    lastSentPromptPreview.value = formatTextToImageLlmMessages(messages);
    try {
        testResponse.value = await requestTextToImageLlmCompletion(apiConfig, messages);
    } catch (error) {
        testError.value = resolveApiErrorMessage(error, "测试请求失败");
    } finally {
        testBusy.value = false;
    }
}

function parseContextEntriesFromJson(data: unknown): Partial<TextToImageLlmContextEntry>[] {
    const entries = normalizeJsonEntries(readJsonEntrySource(data));
    if (entries.length) {
        return entries;
    }
    throw new Error("JSON 中没有可用的上下文条目");
}

function normalizeJsonEntries(source: unknown): Partial<TextToImageLlmContextEntry>[] {
    if (Array.isArray(source)) {
        return source
            .map((item, index) => normalizeJsonEntry(item, `条目 ${index + 1}`))
            .filter((entry) => entry.content?.trim());
    }
    if (isRecord(source)) {
        return Object.entries(source)
            .map(([key, value]) => normalizeJsonEntry(value, key))
            .filter((entry) => entry.content?.trim());
    }
    const entry = normalizeJsonEntry(source, "条目");
    return entry.content?.trim() ? [entry] : [];
}

function readJsonEntrySource(data: unknown): unknown {
    if (Array.isArray(data) || !isRecord(data)) {
        return data;
    }
    for (const key of ["entries", "prompts", "messages", "context", "items", "preset", "data"]) {
        const value = data[key];
        if (Array.isArray(value) || isRecord(value)) {
            return readJsonEntrySource(value);
        }
    }
    const entries = Object.entries(data);
    if (entries.length === 1) {
        const wrapped = entries[0]?.[1];
        if (Array.isArray(wrapped) || isRecord(wrapped)) {
            return readJsonEntrySource(wrapped);
        }
    }
    return data;
}

function normalizeJsonEntry(value: unknown, fallbackName: string): Partial<TextToImageLlmContextEntry> {
    if (typeof value === "string") {
        return {
            name: fallbackName,
            role: "system",
            triggerMode: "always",
            content: value,
            enabled: true,
        };
    }
    if (!isRecord(value)) {
        return {
            name: fallbackName,
            role: "system",
            triggerMode: "always",
            content: JSON.stringify(value),
            enabled: true,
        };
    }
    const name = readString(value.name)
        || readString(value.title)
        || readString(value.identifier)
        || readString(value.id)
        || readString(value.label)
        || readString(value.key)
        || fallbackName;
    const content = readEntryContent(value);
    const role = normalizeRole(readString(value.role) || readString(value.type) || readString(value.identifier));
    const triggerMode = normalizeTriggerMode(readString(value.triggerMode) || readString(value.trigger_mode) || readString(value.mode));
    const enabled = typeof value.enabled === "boolean"
        ? value.enabled
        : typeof value.enable === "boolean"
            ? value.enable
            : typeof value.disabled === "boolean"
                ? !value.disabled
                : true;
    return {name, role, triggerMode, content, enabled};
}

function readEntryContent(value: JsonRecord): string {
    for (const key of [
        "content",
        "prompt",
        "text",
        "message",
        "value",
        "system_prompt",
        "systemPrompt",
        "user_prompt",
        "userPrompt",
        "assistant_prompt",
        "assistantPrompt",
        "description",
        "instruction",
    ]) {
        const content = readContentValue(value[key]);
        if (content) {
            return content;
        }
    }
    return "";
}

function readContentValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value.map((item) => readContentValue(item)).filter(Boolean).join("\n");
    }
    if (isRecord(value)) {
        return readEntryContent(value);
    }
    return "";
}

function readJsonName(data: unknown): string {
    if (!isRecord(data)) {
        return "";
    }
    const directName = readString(data.name) || readString(data.title) || readString(data.presetName);
    if (directName) {
        return directName;
    }
    const entries = Object.entries(data);
    if (entries.length === 1 && (Array.isArray(entries[0]?.[1]) || isRecord(entries[0]?.[1]))) {
        return entries[0]?.[0] ?? "";
    }
    return "";
}

function normalizeRole(value: string): TextToImageLlmContextRole {
    const normalized = value.toLowerCase();
    if (normalized.includes("assistant") || normalized === "ai") {
        return "assistant";
    }
    if (normalized.includes("user")) {
        return "user";
    }
    return "system";
}

function normalizeTriggerMode(value: string): TextToImageLlmContextTriggerMode {
    const normalized = value.trim().toLowerCase();
    if (["trigger", "keyword", "keywords", "selective", "manual", "触发"].some((item) => normalized.includes(item))) {
        return "trigger";
    }
    return "always";
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function downloadJsonFile(fileName: string, value: unknown): void {
    const blob = new Blob([JSON.stringify(value, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = sanitizeFileName(fileName);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function sanitizeFileName(fileName: string): string {
    return fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_") || "context-preset.json";
}
</script>

<template>
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--editor-canvas-bg)]">
        <div class="min-h-0 flex-1 overflow-auto custom-scrollbar">
            <div class="mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-6 py-6">
                <header class="flex min-w-0 items-center justify-between gap-4 border-b border-[var(--border-color)] pb-4">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                            <span class="i-lucide-brain-circuit h-3.5 w-3.5"></span>
                            <span>文生图 LLM</span>
                        </div>
                        <h1 class="mt-1 truncate text-2xl font-semibold text-[var(--text-main)]">LLM 大模型详细配置</h1>
                    </div>
                    <div class="flex shrink-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <span class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-1">{{ activeLlmApiConfig?.name || "默认" }}</span>
                        <span class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-1">{{ activeLlmContextPreset?.name || "默认上下文" }}</span>
                    </div>
                </header>

                <section class="space-y-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/45 p-4">
                    <div class="flex items-center justify-between gap-3">
                        <h2 class="flex items-center gap-2 text-lg font-semibold text-[var(--accent-text)]">
                            <span class="i-lucide-plug h-5 w-5"></span>
                            API 和模型配置
                        </h2>
                        <div class="flex shrink-0 items-center gap-2">
                            <button type="button" class="toolbar-button" @click="addApiConfig"><span class="i-lucide-plus h-4 w-4"></span>新建</button>
                            <button type="button" class="toolbar-button" @click="saveApiConfig"><span class="i-lucide-save h-4 w-4"></span>保存</button>
                            <button type="button" class="toolbar-button-danger" :disabled="llm.apiConfigs.length <= 1" @click="deleteActiveApiConfig"><span class="i-lucide-trash-2 h-4 w-4"></span>删除</button>
                        </div>
                    </div>

                    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <div class="space-y-4">
                            <div class="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
                                <label class="block">
                                    <span class="field-label">API 配置</span>
                                    <FormSelect :model-value="llm.activeApiConfigId" :options="apiConfigOptions" dropdown-direction="down" @update:model-value="selectApiConfig" />
                                </label>
                                <label class="block">
                                    <span class="field-label">配置名称</span>
                                    <FormInput :model-value="activeLlmApiConfig?.name ?? ''" placeholder="例如：默认 / Gemini 代理 / 本地模型" @update:model-value="updateActiveApiName" />
                                </label>
                            </div>
                            <label class="block">
                                <span class="field-label">API 连接</span>
                                <FormTextarea :model-value="llm.apiBaseUrl" :rows="2" placeholder="例如：https://api.openai.com/v1" @update:model-value="updateLlmApiBaseUrl" />
                            </label>
                            <label class="block">
                                <span class="field-label">API Key</span>
                                <FormInput :model-value="llm.apiKey" type="password" placeholder="sk-..." @update:model-value="updateLlmApiKey" />
                            </label>
                            <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                                <label class="block min-w-0">
                                    <span class="field-label">模型选择</span>
                                    <FormSelect v-if="llmModelOptions.length > 0" :model-value="llm.model" :options="llmModelOptions" dropdown-direction="down" @update:model-value="store.updateLlmSettings({model: $event})" />
                                    <FormInput v-else :model-value="llm.model" placeholder="连接后可从模型列表选择，也可以手动输入" @update:model-value="store.updateLlmSettings({model: $event})" />
                                </label>
                                <button type="button" class="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-sm text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60" :disabled="connectingLlm || !llm.apiBaseUrl.trim()" @click="connectLlm">
                                    <span class="h-4 w-4" :class="connectingLlm ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-plug'"></span>
                                    <span>{{ connectingLlm ? "连接中" : "连接并获取模型" }}</span>
                                </button>
                            </div>
                            <p v-if="llmConnectionMessage" class="m-0 text-xs" :class="llmConnectionStatus === 'failed' ? 'text-[var(--danger-text)]' : 'text-[var(--text-muted)]'">{{ llmConnectionMessage }}</p>
                        </div>

                        <div class="space-y-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3">
                            <button type="button" class="toggle-row" :aria-pressed="llm.stream" @click="toggleLlmBoolean('stream')">
                                <span>流式生成</span>
                                <span class="toggle" :class="llm.stream ? 'toggle-on' : ''"><span></span></span>
                            </button>
                            <button type="button" class="toggle-row" :aria-pressed="llm.sendImages" @click="toggleLlmBoolean('sendImages')">
                                <span>发送图片</span>
                                <span class="toggle" :class="llm.sendImages ? 'toggle-on' : ''"><span></span></span>
                            </button>
                            <div class="space-y-3 border-t border-[var(--border-color)] pt-3">
                                <div v-for="control in llmParameterControls" :key="control.key" class="space-y-1.5">
                                    <div class="flex items-center justify-between gap-2">
                                        <span class="text-sm text-[var(--text-secondary)]">{{ control.label }}</span>
                                        <span class="text-xs tabular-nums text-[var(--text-muted)]">{{ formatLlmParameter(control.key) }}</span>
                                    </div>
                                    <div class="grid grid-cols-[1fr_96px] items-center gap-2">
                                        <input class="h-7 w-full accent-[var(--accent-main)]" type="range" :min="control.min" :max="control.max" :step="control.step" :value="llm.parameters[control.key]" @input="updateLlmParameter(control.key, ($event.target as HTMLInputElement).value)">
                                        <FormInput :model-value="String(llm.parameters[control.key])" type="number" :min="String(control.min)" :max="String(control.max)" :step="String(control.step)" @update:model-value="updateLlmParameter(control.key, $event)" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="space-y-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/45 p-4">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <h2 class="flex items-center gap-2 text-lg font-semibold text-[var(--accent-text)]">
                            <span class="i-lucide-list-tree h-5 w-5"></span>
                            上下文预设配置
                        </h2>
                        <div class="flex flex-wrap items-center gap-2">
                            <button type="button" class="toolbar-button" @click="addContextPreset"><span class="i-lucide-plus h-4 w-4"></span>新建</button>
                            <button type="button" class="toolbar-button" @click="saveContextPreset"><span class="i-lucide-save h-4 w-4"></span>保存</button>
                            <button type="button" class="toolbar-button" @click="openContextImportDialog"><span class="i-lucide-upload h-4 w-4"></span>导入</button>
                            <button type="button" class="toolbar-button" @click="exportActiveContextPreset"><span class="i-lucide-file-output h-4 w-4"></span>导出</button>
                            <button type="button" class="toolbar-button" @click="exportAllContextPresets"><span class="i-lucide-files h-4 w-4"></span>导出全部</button>
                            <button type="button" class="toolbar-button-danger" :disabled="llmContextPresets.length <= 1" @click="deleteActiveContextPreset"><span class="i-lucide-trash-2 h-4 w-4"></span>删除</button>
                            <input ref="contextFileInputRef" type="file" accept=".json,.jsonc,application/json" class="hidden" @change="importContextJson">
                        </div>
                    </div>

                    <div class="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
                        <label class="block">
                            <span class="field-label">上下文预设</span>
                            <FormSelect :model-value="activeLlmContextPresetId" :options="contextPresetOptions" dropdown-direction="down" @update:model-value="store.activateLlmContextPreset($event)" />
                        </label>
                        <label class="block">
                            <span class="field-label">预设名称</span>
                            <FormInput :model-value="activeLlmContextPreset?.name ?? ''" placeholder="例如：llm无敌修改版" @update:model-value="updateContextPresetName" />
                        </label>
                    </div>

                    <div class="grid min-h-[360px] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                        <div class="min-h-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/35 p-3">
                            <button type="button" class="mb-3 flex h-10 w-full items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-sm text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)]" @click="addContextEntry">
                                <span class="i-lucide-plus h-4 w-4"></span>
                                添加条目
                            </button>
                            <div v-if="!activeLlmContextPreset?.entries.length" class="rounded-md border border-dashed border-[var(--border-color)] px-3 py-8 text-center text-sm text-[var(--text-muted)]">
                                暂无上下文条目，可新建或导入 JSON。
                            </div>
                            <div v-else class="max-h-[520px] space-y-2 overflow-auto pr-1 custom-scrollbar">
                                <button
                                    v-for="entry in activeLlmContextPreset.entries"
                                    :key="entry.id"
                                    type="button"
                                    class="grid w-full grid-cols-[1rem_64px_72px_minmax(120px,220px)_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors"
                                    :class="entry.id === selectedContextEntryId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]'"
                                    @click="selectedContextEntryId = entry.id"
                                >
                                    <span class="i-lucide-grip-vertical h-4 w-4 text-[var(--text-muted)]"></span>
                                    <span class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-center text-xs font-semibold text-[var(--accent-text)]">{{ entry.role.toUpperCase().slice(0, 3) }}</span>
                                    <span class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-center text-xs font-semibold" :class="entry.triggerMode === 'trigger' ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'">{{ entry.triggerMode === "trigger" ? "触发" : "常开" }}</span>
                                    <span class="min-w-0 truncate rounded-md bg-[var(--bg-input)] px-2 py-1 text-sm text-[var(--accent-text)]">{{ entry.name }}</span>
                                    <span class="min-w-0 truncate text-sm text-[var(--text-secondary)]">{{ entry.content || "空内容" }}</span>
                                    <button type="button" class="toggle compact-toggle" :class="entry.enabled ? 'toggle-on' : ''" :aria-pressed="entry.enabled" @click.stop="updateContextEntry(entry.id, {enabled: !entry.enabled})"><span></span></button>
                                    <button type="button" class="icon-danger" title="删除条目" @click.stop="deleteContextEntry(entry.id)"><span class="i-lucide-trash-2 h-4 w-4"></span></button>
                                </button>
                            </div>
                        </div>

                        <aside class="min-h-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/35 p-3">
                            <div v-if="!selectedContextEntry" class="flex h-full min-h-[300px] items-center justify-center text-center text-sm text-[var(--text-muted)]">
                                点击左侧条目后在这里修改。
                            </div>
                            <div v-else class="space-y-3">
                                <div class="flex items-center justify-between gap-2">
                                    <h3 class="truncate text-base font-semibold text-[var(--accent-text)]">{{ selectedContextEntry.name }}</h3>
                                    <button type="button" class="toggle" :class="selectedContextEntry.enabled ? 'toggle-on' : ''" :aria-pressed="selectedContextEntry.enabled" @click="updateContextEntry(selectedContextEntry.id, {enabled: !selectedContextEntry.enabled})"><span></span></button>
                                </div>
                                <label class="block">
                                    <span class="field-label">条目名称</span>
                                    <FormInput :model-value="selectedContextEntry.name" @update:model-value="updateContextEntry(selectedContextEntry.id, {name: $event})" />
                                </label>
                                <label class="block">
                                    <span class="field-label">角色</span>
                                    <FormSelect :model-value="selectedContextEntry.role" :options="roleOptions" dropdown-direction="down" @update:model-value="updateContextEntry(selectedContextEntry.id, {role: $event as TextToImageLlmContextRole})" />
                                </label>
                                <label class="block">
                                    <span class="field-label">触发模式</span>
                                    <FormSelect :model-value="selectedContextEntry.triggerMode" :options="triggerModeOptions" dropdown-direction="down" @update:model-value="updateContextEntry(selectedContextEntry.id, {triggerMode: $event as TextToImageLlmContextTriggerMode})" />
                                </label>
                                <label class="block">
                                    <span class="field-label">内容</span>
                                    <FormTextarea :model-value="selectedContextEntry.content" :rows="14" placeholder="输入该上下文条目的内容" @update:model-value="updateContextEntry(selectedContextEntry.id, {content: $event})" />
                                </label>
                            </div>
                        </aside>
                    </div>
                </section>

                <section class="space-y-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/45 p-4">
                    <h2 class="flex items-center gap-2 text-lg font-semibold text-[var(--accent-text)]">
                        <span class="i-lucide-workflow h-5 w-5"></span>
                        请求类型配置
                    </h2>
                    <p class="m-0 text-sm text-[var(--text-secondary)]">为不同文生图任务分别选择 API 配置和上下文预设。</p>
                    <div class="grid gap-3 xl:grid-cols-3">
                        <div v-for="task in TEXT_TO_IMAGE_PROMPT_TASKS" :key="task.key" class="space-y-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/35 p-3">
                            <h3 class="flex items-center gap-2 text-base font-semibold text-[var(--accent-text)]">
                                <span :class="task.key === 'bodyImage' ? 'i-lucide-image' : task.key === 'characterDesign' ? 'i-lucide-palette' : 'i-lucide-square-pen'" class="h-4 w-4"></span>
                                {{ task.label }}
                            </h3>
                            <label class="block">
                                <span class="field-label">API 配置</span>
                                <FormSelect :model-value="taskBinding(task.key).apiConfigId" :options="apiConfigOptions" dropdown-direction="down" @update:model-value="updateTaskBinding(task.key, {apiConfigId: $event})" />
                            </label>
                            <label class="block">
                                <span class="field-label">上下文预设</span>
                                <FormSelect :model-value="taskBinding(task.key).contextPresetId" :options="contextPresetOptions" dropdown-direction="down" @update:model-value="updateTaskBinding(task.key, {contextPresetId: $event})" />
                            </label>
                        </div>
                    </div>
                </section>

                <section class="space-y-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/45 p-4">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <h2 class="flex items-center gap-2 text-lg font-semibold text-[var(--accent-text)]">
                            <span class="i-lucide-flask-conical h-5 w-5"></span>
                            测试工具
                        </h2>
                        <div class="flex items-center gap-2">
                            <FormSelect :model-value="selectedTestTask" :options="promptTaskOptions" dropdown-direction="down" @update:model-value="selectedTestTask = $event as TextToImagePromptTask" />
                            <button type="button" class="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-sm text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60" :disabled="testBusy" @click="sendTestRequest">
                                <span class="h-4 w-4" :class="testBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-send'"></span>
                                发送测试请求
                            </button>
                        </div>
                    </div>
                    <label class="block">
                        <span class="field-label">外部测试请求</span>
                        <FormTextarea :model-value="testUserPrompt" :rows="3" placeholder="输入本次测试的 user 请求" @update:model-value="testUserPrompt = $event" />
                    </label>
                    <label class="block">
                        <span class="field-label">组合提示词</span>
                        <FormTextarea :model-value="lastSentPromptPreview" :rows="8" readonly placeholder="发送任意 LLM 请求后，这里会显示本次实际发送给大模型的提示词..." />
                    </label>
                    <label class="block">
                        <span class="field-label">AI 回复</span>
                        <FormTextarea :model-value="testResponse" :rows="10" readonly placeholder="点击上方按钮后，AI 的回复将显示在这里..." />
                    </label>
                    <p v-if="testError" class="m-0 text-sm text-[var(--danger-text)]">{{ testError }}</p>
                </section>
            </div>
        </div>
    </section>
</template>

<style scoped>
.field-label {
    margin-bottom: 0.375rem;
    display: block;
    font-size: 0.8125rem;
    color: var(--text-secondary);
}

.toolbar-button,
.toolbar-button-danger {
    display: inline-flex;
    height: 2.25rem;
    align-items: center;
    gap: 0.375rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
    padding: 0 0.75rem;
    font-size: 0.875rem;
    color: var(--accent-text);
    transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}

.toolbar-button:hover {
    background: var(--bg-hover);
}

.toolbar-button-danger {
    color: var(--danger-text);
}

.toolbar-button-danger:hover {
    background: color-mix(in srgb, var(--danger-text) 12%, transparent);
}

.toolbar-button:disabled,
.toolbar-button-danger:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.toggle-row {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
    background: var(--bg-panel);
    padding: 0.75rem;
    font-size: 0.9375rem;
    color: var(--accent-text);
    text-align: left;
}

.toggle {
    display: inline-flex;
    height: 1.5rem;
    width: 2.75rem;
    flex-shrink: 0;
    align-items: center;
    border-radius: 999px;
    background: var(--bg-hover);
    padding: 0.1875rem;
    transition: background-color 0.15s ease;
}

.toggle span {
    display: block;
    height: 1.125rem;
    width: 1.125rem;
    border-radius: 999px;
    background: var(--text-muted);
    transition: transform 0.15s ease, background-color 0.15s ease;
}

.toggle-on {
    background: color-mix(in srgb, var(--accent-main) 40%, var(--bg-hover));
}

.toggle-on span {
    transform: translateX(1.25rem);
    background: var(--accent-main);
}

.compact-toggle {
    height: 1.375rem;
    width: 2.5rem;
}

.compact-toggle span {
    height: 1rem;
    width: 1rem;
}

.compact-toggle.toggle-on span {
    transform: translateX(1.125rem);
}

.icon-danger {
    display: inline-flex;
    height: 2rem;
    width: 2rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    color: var(--danger-text);
    transition: background-color 0.15s ease;
}

.icon-danger:hover {
    background: color-mix(in srgb, var(--danger-text) 12%, transparent);
}
</style>
