<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useNotification} from "nbook/app/composables/useNotification";
import BooleanToggleButton from "nbook/app/components/common/form/BooleanToggleButton.vue";
import {normalizeImportedContextProfiles} from "nbook/app/utils/text-to-image-context-import";
import {
    TextToImageGlobalConfigSchema,
    TextToImageLlmProviderSettingsSchema,
    type TextToImageContextEntry,
    type TextToImageContextProfile,
    type TextToImageGlobalConfig,
    type TextToImageProviderDto,
    type TextToImageRequestBinding,
    type TextToImageRequestType,
} from "nbook/shared/dto/text-to-image.dto";

const props = defineProps<{
    providers: TextToImageProviderDto[];
    config: TextToImageGlobalConfig;
}>();

const emit = defineEmits<{
    (e: "save-provider", input: Record<string, unknown>): void;
    (e: "delete-provider", id: number): void;
    (e: "save-config", patch: Partial<TextToImageGlobalConfig>): void;
}>();

const requestTypeOptions: Array<{value: TextToImageRequestType; label: string}> = [
    {value: "image_gen", label: "正文生图"},
    {value: "char_design", label: "角色设计"},
    {value: "char_display", label: "角色展示"},
    {value: "char_modify", label: "角色服装修改"},
    {value: "tag_modify", label: "Tag 修改"},
];

const llmProviders = computed(() => props.providers.filter((provider) => provider.kind === "openai_compatible"));
const selectedProviderId = ref<number | null>(null);
const form = ref({
    name: "",
    baseUrl: "",
    model: "",
    credential: "",
    temperature: 0.7,
    topP: 1,
    maxTokens: 512,
    stream: false,
    sendImages: false,
    mergeSystemUser: false,
    retryCount: 0,
    historyDepth: 0,
    tagthinkEcho: false,
    historyKeepImageTag: false,
});

const contextProfiles = ref<TextToImageGlobalConfig["contextProfiles"]>({});
const requestBindings = ref<Record<TextToImageRequestType, TextToImageRequestBinding>>({
    image_gen: {providerId: null, contextProfileId: "default"},
    char_design: {providerId: null, contextProfileId: "default"},
    char_display: {providerId: null, contextProfileId: "default"},
    char_modify: {providerId: null, contextProfileId: "default"},
    tag_modify: {providerId: null, contextProfileId: "default"},
});
const wordReplacementProfiles = ref<TextToImageGlobalConfig["wordReplacementProfiles"]>({});
const wordReplacementText = ref("{}");
const wordReplacementDirty = ref(false);
const currentWordReplacementProfile = ref("default");

const contextProfileKeys = computed(() => Object.keys(contextProfiles.value).sort());
const selectedContextProfileId = ref("");
const contextProfileDraft = ref<TextToImageContextProfile>(emptyContextProfile());
const isNewContextProfile = ref(false);

let entryIdCounter = 0;

function nextEntryId(): string {
    entryIdCounter += 1;
    return `entry-${Date.now()}-${entryIdCounter}`;
}

function emptyContextEntry(): TextToImageContextEntry {
    return {
        id: nextEntryId(),
        name: "",
        role: "user",
        content: "",
        enabled: true,
        triggerMode: "always",
        triggerWords: "",
        andTriggerWords: "",
    };
}

function emptyContextProfile(): TextToImageContextProfile {
    return {id: "", name: "", entries: []};
}

function cloneContextProfile(profile: TextToImageContextProfile): TextToImageContextProfile {
    return {
        id: profile.id,
        name: profile.name,
        entries: profile.entries.map((entry) => ({...entry})),
    };
}

function contextProfileLabel(id: string): string {
    return contextProfiles.value[id]?.name || id;
}

const testPrompt = ref("");
const testResult = ref("");
const testPreview = ref("");
const testRequestType = ref<TextToImageRequestType>("image_gen");
const testStatus = ref<"idle" | "success" | "failure">("idle");
const modelOptions = ref<string[]>([]);
const fetchingModels = ref(false);
const error = ref("");
const saving = ref(false);
const contextProfileImportInput = ref<HTMLInputElement | null>(null);
const globalConfigImportInput = ref<HTMLInputElement | null>(null);
const notification = useNotification();

watch(() => props.providers, () => {
    if (selectedProviderId.value === null && llmProviders.value.length > 0) {
        selectProvider(llmProviders.value[0]!.id);
    }
}, {immediate: true});

watch(() => props.config, (config) => {
    syncConfigState(config);
}, {immediate: true});

function syncConfigState(config: TextToImageGlobalConfig): void {
    contextProfiles.value = {...(config.contextProfiles ?? {})};
    for (const option of requestTypeOptions) {
        const binding = config.requestTypeBindings?.[option.value];
        requestBindings.value[option.value] = binding
            ? {...binding}
            : {providerId: null, contextProfileId: contextProfileKeys.value[0] ?? "default"};
    }
    wordReplacementProfiles.value = {...(config.wordReplacementProfiles ?? {})};
    currentWordReplacementProfile.value = config.currentWordReplacementProfile ?? "default";
    if (!wordReplacementDirty.value) {
        wordReplacementText.value = JSON.stringify(wordReplacementProfiles.value, null, 2);
    }
    if (selectedContextProfileId.value && !contextProfiles.value[selectedContextProfileId.value]) {
        selectedContextProfileId.value = "";
        contextProfileDraft.value = emptyContextProfile();
        isNewContextProfile.value = false;
    } else if (!selectedContextProfileId.value && !isNewContextProfile.value && contextProfileKeys.value.length > 0) {
        selectContextProfile(contextProfileKeys.value[0]!);
    }
}

function selectProvider(id: number): void {
    selectedProviderId.value = id;
    const provider = props.providers.find((item) => item.id === id);
    const settings = provider ? TextToImageLlmProviderSettingsSchema.parse(provider.settings) : TextToImageLlmProviderSettingsSchema.parse({});
    const rawSettings = provider?.settings ?? {};
    form.value = {
        name: provider?.name ?? "",
        baseUrl: settings.baseUrl,
        model: settings.model,
        credential: "",
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
        stream: settings.stream,
        sendImages: settings.sendImages,
        mergeSystemUser: settings.mergeSystemUser,
        retryCount: settings.retryCount,
        historyDepth: typeof rawSettings.historyDepth === "number" ? rawSettings.historyDepth : 0,
        tagthinkEcho: rawSettings.tagthinkEcho === true,
        historyKeepImageTag: rawSettings.historyKeepImageTag === true,
    };
}

function newProvider(): void {
    selectedProviderId.value = null;
    form.value = {
        name: "",
        baseUrl: "",
        model: "",
        credential: "",
        temperature: 0.7,
        topP: 1,
        maxTokens: 512,
        stream: false,
        sendImages: false,
        mergeSystemUser: false,
        retryCount: 0,
        historyDepth: 0,
        tagthinkEcho: false,
        historyKeepImageTag: false,
    };
}

function saveProvider(): void {
    if (!form.value.name.trim() || !form.value.baseUrl.trim() || !form.value.model.trim()) {
        error.value = "名称、Base URL 和模型不能为空";
        return;
    }
    error.value = "";
    const baseSettings = TextToImageLlmProviderSettingsSchema.parse({
        baseUrl: form.value.baseUrl,
        model: form.value.model,
        temperature: form.value.temperature,
        topP: form.value.topP,
        maxTokens: form.value.maxTokens,
        stream: form.value.stream,
        sendImages: form.value.sendImages,
        mergeSystemUser: form.value.mergeSystemUser,
        retryCount: form.value.retryCount,
    });
    const settings: Record<string, unknown> = {
        ...baseSettings,
        historyDepth: form.value.historyDepth,
        tagthinkEcho: form.value.tagthinkEcho,
        historyKeepImageTag: form.value.historyKeepImageTag,
    };
    emit("save-provider", {
        id: selectedProviderId.value ?? undefined,
        kind: "openai_compatible",
        name: form.value.name,
        baseUrl: form.value.baseUrl,
        model: form.value.model,
        credential: form.value.credential || undefined,
        settings,
    });
}

function deleteProvider(): void {
    if (selectedProviderId.value !== null) {
        emit("delete-provider", selectedProviderId.value);
        newProvider();
    }
}

function selectContextProfile(id: string): void {
    const profile = contextProfiles.value[id];
    if (!profile) {
        return;
    }
    selectedContextProfileId.value = id;
    contextProfileDraft.value = cloneContextProfile(profile);
    isNewContextProfile.value = false;
}

function newContextProfile(): void {
    selectedContextProfileId.value = "";
    contextProfileDraft.value = {id: "", name: "", entries: [emptyContextEntry()]};
    isNewContextProfile.value = true;
}

function addContextEntry(): void {
    contextProfileDraft.value.entries.push(emptyContextEntry());
}

function removeContextEntry(index: number): void {
    contextProfileDraft.value.entries.splice(index, 1);
}

function saveContextProfile(): void {
    const id = selectedContextProfileId.value || contextProfileDraft.value.id.trim();
    const name = contextProfileDraft.value.name.trim();
    if (!id || !name) {
        error.value = "上下文预设 ID 和名称不能为空";
        return;
    }
    error.value = "";
    const profile: TextToImageContextProfile = {
        id,
        name,
        entries: contextProfileDraft.value.entries.map((entry) => ({
            ...entry,
            id: entry.id.trim() || nextEntryId(),
        })),
    };
    const next = {...contextProfiles.value, [id]: profile};
    contextProfiles.value = next;
    selectedContextProfileId.value = id;
    contextProfileDraft.value = cloneContextProfile(profile);
    isNewContextProfile.value = false;
    persistGlobal({contextProfiles: next});
}

function deleteContextProfile(): void {
    const id = selectedContextProfileId.value;
    if (!id || !contextProfiles.value[id]) {
        return;
    }
    const next = {...contextProfiles.value};
    delete next[id];
    contextProfiles.value = next;
    selectedContextProfileId.value = "";
    contextProfileDraft.value = emptyContextProfile();
    isNewContextProfile.value = false;
    persistGlobal({contextProfiles: next});
}

function contextProfileOptions(binding: TextToImageRequestBinding): string[] {
    const options = [...contextProfileKeys.value];
    if (binding.contextProfileId && !options.includes(binding.contextProfileId)) {
        options.push(binding.contextProfileId);
    }
    return options;
}

function saveRequestBindings(): void {
    error.value = "";
    persistGlobal({requestTypeBindings: {...requestBindings.value}});
}

function saveWordReplacement(): void {
    try {
        const parsed = JSON.parse(wordReplacementText.value) as TextToImageGlobalConfig["wordReplacementProfiles"];
        wordReplacementProfiles.value = parsed;
        error.value = "";
        wordReplacementDirty.value = false;
        persistGlobal({wordReplacementProfiles: parsed});
    } catch {
        error.value = "敏感词替换 JSON 不合法";
    }
}

function exportContextProfiles(): void {
    const blob = new Blob([JSON.stringify(contextProfiles.value, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "context-profiles.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function exportGlobalConfig(): void {
    const payload = {
        contextProfiles: contextProfiles.value,
        requestTypeBindings: requestBindings.value,
        wordReplacementProfiles: wordReplacementProfiles.value,
        currentWordReplacementProfile: currentWordReplacementProfile.value,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "text-to-image-global-config.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

async function importGlobalConfig(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
        const raw = JSON.parse(await file.text()) as unknown;
        const parsed = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "contextProfiles" in raw
            ? TextToImageGlobalConfigSchema.parse(raw)
            : TextToImageGlobalConfigSchema.parse({
                contextProfiles: normalizeImportedContextProfiles(raw),
            });
        contextProfiles.value = {...parsed.contextProfiles};
        requestBindings.value = {
            image_gen: parsed.requestTypeBindings?.image_gen ?? {providerId: null, contextProfileId: "default"},
            char_design: parsed.requestTypeBindings?.char_design ?? {providerId: null, contextProfileId: "default"},
            char_display: parsed.requestTypeBindings?.char_display ?? {providerId: null, contextProfileId: "default"},
            char_modify: parsed.requestTypeBindings?.char_modify ?? {providerId: null, contextProfileId: "default"},
            tag_modify: parsed.requestTypeBindings?.tag_modify ?? {providerId: null, contextProfileId: "default"},
        };
        wordReplacementProfiles.value = {...(parsed.wordReplacementProfiles ?? {})};
        currentWordReplacementProfile.value = parsed.currentWordReplacementProfile ?? "default";
        error.value = "";
        persistGlobal({
            contextProfiles: contextProfiles.value,
            requestTypeBindings: requestBindings.value,
            wordReplacementProfiles: wordReplacementProfiles.value,
            currentWordReplacementProfile: currentWordReplacementProfile.value,
        });
        notification.success("全局配置导入成功");
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "导入全局配置失败");
        notification.error(error.value, {title: "导入全局配置失败"});
    } finally {
        input.value = "";
    }
}

async function importContextProfiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const next = {...contextProfiles.value};
        Object.assign(next, normalizeImportedContextProfiles(parsed));
        contextProfiles.value = next;
        error.value = "";
        persistGlobal({contextProfiles: next});
        notification.success("上下文预设导入成功");
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "导入上下文预设失败");
        notification.error(error.value, {title: "导入上下文预设失败"});
    } finally {
        input.value = "";
    }
}

function openContextProfileImport(): void {
    contextProfileImportInput.value?.click();
}

function openGlobalConfigImport(): void {
    globalConfigImportInput.value?.click();
}

function persistGlobal(patch: Partial<TextToImageGlobalConfig>): void {
    emit("save-config", {
        contextProfiles: contextProfiles.value,
        requestTypeBindings: requestBindings.value,
        wordReplacementProfiles: wordReplacementProfiles.value,
        currentWordReplacementProfile: currentWordReplacementProfile.value,
        ...patch,
    });
}

async function runTest(): Promise<void> {
    if (selectedProviderId.value === null) {
        return;
    }
    saving.value = true;
    error.value = "";
    testStatus.value = "idle";
    try {
        const result = await $fetch<{content: string}>("/api/text-to-image/llm/test", {
            method: "POST",
            body: {
                providerId: selectedProviderId.value,
                prompt: testPrompt.value.trim() || "连接测试",
                stream: form.value.stream,
                requestType: testRequestType.value,
            },
        });
        testResult.value = result.content;
        testStatus.value = "success";
    } catch (cause) {
        testResult.value = "";
        testStatus.value = "failure";
        error.value = resolveApiErrorMessage(cause, "连接失败");
    } finally {
        saving.value = false;
    }
}

function buildTestPreview(): void {
    const binding = requestBindings.value[testRequestType.value];
    const profileId = binding?.contextProfileId ?? "default";
    const entries = (contextProfiles.value[profileId]?.entries ?? [])
        .filter((entry) => entry.enabled)
        .map((entry) => `[${entry.role}] ${entry.content}`)
        .join("\n");
    testPreview.value = [
        entries,
        "---",
        testPrompt.value.trim() || "连接测试",
    ].filter((part) => part !== "").join("\n");
}

async function fetchModels(): Promise<void> {
    if (selectedProviderId.value === null && form.value.baseUrl.trim() === "") {
        error.value = "请先填写 Base URL";
        return;
    }
    fetchingModels.value = true;
    error.value = "";
    try {
        const result = await $fetch<{models: string[]}>("/api/text-to-image/llm/models", {
            method: "POST",
            body: selectedProviderId.value !== null
                ? {providerId: selectedProviderId.value}
                : {
                    baseUrl: form.value.baseUrl,
                    credential: form.value.credential,
                },
        });
        modelOptions.value = result.models;
        if (result.models.length === 0) {
            error.value = "模型列表为空";
        } else {
            if (!form.value.model) {
                form.value.model = result.models[0]!;
            }
            notification.success(`获取到 ${result.models.length} 个模型`);
        }
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "获取模型列表失败");
        notification.error(error.value, {title: "获取模型列表失败"});
    } finally {
        fetchingModels.value = false;
    }
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-[13px] font-semibold text-[var(--text-main)]">LLM Provider</h3>
                <div class="flex items-center gap-2">
                    <select v-model.number="selectedProviderId" class="h-8 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" @change="selectedProviderId !== null && selectProvider(selectedProviderId)">
                        <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="newProvider">新建</button>
                    <button class="h-8 rounded-md border border-[var(--danger-border)] px-2 text-[12px] text-[var(--danger-text)] hover:bg-[var(--bg-hover)]" :disabled="selectedProviderId === null" @click="deleteProvider">删除</button>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    名称
                    <input v-model="form.name" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Base URL（含 /v1）
                    <input v-model="form.baseUrl" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    模型
                    <div class="flex gap-2">
                        <input v-model="form.model" list="llm-model-options" class="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                        <datalist id="llm-model-options">
                            <option v-for="model in modelOptions" :key="model" :value="model" />
                        </datalist>
                        <button class="h-8 shrink-0 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)]" :disabled="fetchingModels" @click="fetchModels">{{ fetchingModels ? "获取中..." : "获取模型" }}</button>
                    </div>
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    API Key（留空表示保留）
                    <input v-model="form.credential" type="password" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Temperature
                    <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.01" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Top P
                    <input v-model.number="form.topP" type="number" min="0" max="1" step="0.01" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Max Tokens
                    <input v-model.number="form.maxTokens" type="number" min="1" max="30000" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    重试次数
                    <input v-model.number="form.retryCount" type="number" min="0" max="5" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-3">
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    流式生成
                    <BooleanToggleButton v-model="form.stream" />
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    发送图片
                    <BooleanToggleButton v-model="form.sendImages" />
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    合并 System/User
                    <BooleanToggleButton v-model="form.mergeSystemUser" />
                </label>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    上下文历史层数
                    <input v-model.number="form.historyDepth" type="number" min="0" max="20" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    Tagthink 回显
                    <BooleanToggleButton v-model="form.tagthinkEcho" />
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    历史保留 &lt;image&gt; 标签
                    <BooleanToggleButton v-model="form.historyKeepImageTag" />
                </label>
            </div>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" @click="saveProvider">保存 Provider</button>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-[13px] font-semibold text-[var(--text-main)]">全局配置</h3>
                <div class="flex items-center gap-2">
                    <input ref="globalConfigImportInput" type="file" accept="application/json" class="hidden" @change="importGlobalConfig" />
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="openGlobalConfigImport">导入</button>
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="exportGlobalConfig">导出全部</button>
                </div>
            </div>
            <div class="grid grid-cols-1 gap-3">
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <div class="mb-2 flex items-center justify-between">
                        <h4 class="text-[12px] font-semibold text-[var(--text-main)]">上下文预设</h4>
                        <div class="flex items-center gap-2">
                            <select v-model="selectedContextProfileId" class="h-8 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" @change="selectContextProfile(selectedContextProfileId)">
                                <option value="" disabled>选择预设</option>
                                <option v-for="id in contextProfileKeys" :key="id" :value="id">{{ contextProfileLabel(id) }}</option>
                            </select>
                            <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="newContextProfile">新建</button>
                            <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="saveContextProfile">保存</button>
                            <input ref="contextProfileImportInput" type="file" accept="application/json" class="hidden" @change="importContextProfiles" />
                            <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="openContextProfileImport">导入</button>
                            <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="exportContextProfiles">导出全部</button>
                            <button class="h-8 rounded-md border border-[var(--danger-border)] px-2 text-[12px] text-[var(--danger-text)] hover:bg-[var(--bg-hover)]" :disabled="!selectedContextProfileId" @click="deleteContextProfile">删除</button>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                            预设 ID
                            <input v-model="contextProfileDraft.id" :disabled="selectedContextProfileId !== ''" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)] disabled:opacity-60" />
                        </label>
                        <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                            预设名称
                            <input v-model="contextProfileDraft.name" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                        </label>
                    </div>
                    <div v-for="(entry, index) in contextProfileDraft.entries" :key="entry.id" class="mt-2 rounded-md border border-[var(--border-color)] p-2">
                        <div class="mb-1 flex items-center justify-between">
                            <span class="text-[11px] text-[var(--text-muted)]">条目 {{ index + 1 }}</span>
                            <button class="rounded-md border border-[var(--danger-border)] px-2 text-[11px] text-[var(--danger-text)] hover:bg-[var(--bg-hover)]" @click="removeContextEntry(index)">删除</button>
                        </div>
                        <div class="grid grid-cols-3 gap-2">
                            <label class="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
                                role
                                <select v-model="entry.role" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]">
                                    <option value="system">system</option>
                                    <option value="user">user</option>
                                    <option value="assistant">assistant</option>
                                </select>
                            </label>
                            <label class="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
                                triggerMode
                                <select v-model="entry.triggerMode" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]">
                                    <option value="always">always</option>
                                    <option value="trigger">trigger</option>
                                </select>
                            </label>
                            <label class="flex items-end gap-2 pb-1 text-[11px] text-[var(--text-secondary)]">
                                enabled
                                <BooleanToggleButton v-model="entry.enabled" />
                            </label>
                            <label class="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
                                triggerWords
                                <input v-model="entry.triggerWords" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" />
                            </label>
                            <label class="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
                                andTriggerWords
                                <input v-model="entry.andTriggerWords" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" />
                            </label>
                        </div>
                        <label class="mt-2 flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
                            content
                            <textarea v-model="entry.content" rows="3" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[12px] text-[var(--text-main)]" />
                        </label>
                    </div>
                    <button class="mt-2 h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="addContextEntry">添加条目</button>
                </div>

                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <h4 class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">请求类型</h4>
                    <div class="grid grid-cols-2 gap-2">
                        <div v-for="option in requestTypeOptions" :key="option.value" class="rounded-md border border-[var(--border-color)] p-2">
                            <p class="mb-1 text-[12px] font-medium text-[var(--text-main)]">{{ option.label }}</p>
                            <div class="grid grid-cols-2 gap-2">
                                <label class="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
                                    providerId
                                    <select v-model="requestBindings[option.value].providerId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" @change="saveRequestBindings">
                                        <option :value="null">未绑定</option>
                                        <option v-for="provider in props.providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                                    </select>
                                </label>
                                <label class="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
                                    contextProfileId
                                    <select v-model="requestBindings[option.value].contextProfileId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" @change="saveRequestBindings">
                                        <option v-for="id in contextProfileOptions(requestBindings[option.value])" :key="id" :value="id">{{ contextProfileLabel(id) }}</option>
                                    </select>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <div class="mb-2 flex items-center justify-between">
                        <h4 class="text-[12px] font-semibold text-[var(--text-main)]">敏感词替换 JSON</h4>
                        <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" @click="saveWordReplacement">保存敏感词替换</button>
                    </div>
                    <textarea v-model="wordReplacementText" rows="6" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[12px] text-[var(--text-main)]" @input="wordReplacementDirty = true" />
                </div>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-[13px] font-semibold text-[var(--text-main)]">测试工具</h3>
                <span v-if="testStatus === 'success'" class="text-[12px] text-[var(--status-success)]">连接成功</span>
                <span v-else-if="testStatus === 'failure'" class="text-[12px] text-[var(--danger-text)]">连接失败</span>
            </div>
            <div class="mb-2 flex flex-wrap items-center gap-2">
                <select v-model="testRequestType" class="h-8 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                    <option v-for="option in requestTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="buildTestPreview">组合提示词预览</button>
            </div>
            <textarea v-model="testPrompt" rows="4" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" placeholder="输入测试提示词（可选，留空则发送连接测试）" />
            <button class="mt-2 h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" :disabled="saving || selectedProviderId === null" @click="runTest">连接测试</button>
            <textarea v-if="testPreview" v-model="testPreview" readonly rows="6" class="mt-2 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" placeholder="组合提示词预览" />
            <textarea v-model="testResult" readonly rows="6" class="mt-2 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" placeholder="AI 回复将显示在这里" />
        </div>

        <p v-if="error" class="text-[12px] text-[var(--danger-text)]">{{ error }}</p>
    </div>
</template>
