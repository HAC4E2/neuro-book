<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useNotification} from "nbook/app/composables/useNotification";
import {readSseStream} from "nbook/app/utils/http/read-sse";
import BooleanToggleButton from "nbook/app/components/common/form/BooleanToggleButton.vue";
import {normalizeImportedContextProfiles} from "nbook/app/utils/text-to-image-context-import";
import {
    exportTextToImageTailConfig,
    exportTextToImageToolConfig,
    parseTextToImageTailConfig,
    parseTextToImageToolConfig,
} from "nbook/app/utils/text-to-image-tool-config-import";
import {
    DEFAULT_WORD_REPLACEMENT_PROFILE,
    TextToImageGlobalConfigSchema,
    TextToImageLlmProviderSettingsSchema,
    TextToImageTailMessagesConfigSchema,
    TextToImageToolCallConfigSchema,
    type TextToImageContextEntry,
    type TextToImageContextProfile,
    type TextToImageGlobalConfig,
    type TextToImageProviderDto,
    type TextToImageRequestBinding,
    type TextToImageRequestType,
    type TextToImageTailMessagesConfig,
    type TextToImageToolCallConfig,
} from "nbook/shared/dto/text-to-image.dto";
import {
    DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG,
    DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG,
} from "nbook/shared/text-to-image-toolcall-defaults";

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
const modelOptions = ref<string[]>([]);
const modelListOpen = ref(false);
function cloneToolConfig(config: TextToImageToolCallConfig): TextToImageToolCallConfig {
    return {
        enabled: config.enabled,
        nameMode: config.nameMode,
        fixedName: config.fixedName,
        prefix: config.prefix,
        desc: config.desc,
        fields: config.fields.map((field) => ({...field})),
    };
}

function cloneTailConfig(config: TextToImageTailMessagesConfig): TextToImageTailMessagesConfig {
    return {
        enabled: config.enabled,
        messages: config.messages.map((message) => ({...message})),
    };
}

function downloadJson(fileName: string, value: unknown): void {
    const blob = new Blob([JSON.stringify(value, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

const selectedProviderId = ref<number | null>(null);
const form = ref({
    name: "",
    baseUrl: "",
    model: "",
    credential: "",
    temperature: 1,
    topP: 1,
    maxTokens: 30000,
    stream: false,
    sendImages: false,
    mergeSystemUser: false,
    retryCount: 0,
    tagthinkEcho: false,
    toolMode: "inherit" as "inherit" | "override",
    toolCallConfig: cloneToolConfig(DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG),
    tailMode: "inherit" as "inherit" | "override",
    tailMessagesConfig: cloneTailConfig(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG),
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
const currentWordReplacementProfile = ref("default");
const historyPrefillDepth = ref(1);
const toolCallConfig = ref(cloneToolConfig(DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG));
const tailMessagesConfig = ref(cloneTailConfig(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG));

const contextProfileKeys = computed(() => Object.keys(contextProfiles.value).sort());
const selectedContextProfileId = ref("");
const contextProfileDraft = ref<TextToImageContextProfile>(emptyContextProfile());
const isNewContextProfile = ref(false);
const contextProfilesExpanded = ref(false);

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
    return {id: "", name: "", promptMode: "augment", entries: []};
}

function cloneContextProfile(profile: TextToImageContextProfile): TextToImageContextProfile {
    return {
        id: profile.id,
        name: profile.name,
        promptMode: profile.promptMode,
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
const previewing = ref(false);
const fetchingModels = ref(false);
const error = ref("");
const modelError = ref("");
const saving = ref(false);
const contextProfileImportInput = ref<HTMLInputElement | null>(null);
const globalConfigImportInput = ref<HTMLInputElement | null>(null);
const globalToolImportInput = ref<HTMLInputElement | null>(null);
const globalTailImportInput = ref<HTMLInputElement | null>(null);
const providerToolImportInput = ref<HTMLInputElement | null>(null);
const providerTailImportInput = ref<HTMLInputElement | null>(null);
const notification = useNotification();
type LlmTraceEvent = {
    traceId: string;
    seq: number;
    kind: "started" | "delta" | "retrying" | "completed" | "failed";
    requestType: TextToImageRequestType | null;
    profileId: string | null;
    model: string;
    attempt: number;
    at: string;
    delta?: string;
    content?: string;
    error?: string;
    truncated?: boolean;
};
const latestTrace = ref<LlmTraceEvent | null>(null);
let traceAbortController: AbortController | null = null;

watch(() => props.providers, () => {
    if (selectedProviderId.value === null && llmProviders.value.length > 0) {
        selectProvider(llmProviders.value[0]!.id);
    }
    if (props.config) {
        syncConfigState(props.config);
    }
}, {immediate: true});

watch(() => props.config, (config) => {
    syncConfigState(config);
}, {immediate: true});

onMounted(() => {
    void startTraceFeed();
});

onBeforeUnmount(() => {
    traceAbortController?.abort();
    traceAbortController = null;
});

async function startTraceFeed(): Promise<void> {
    try {
        const latest = await $fetch<{trace: LlmTraceEvent | null}>("/api/text-to-image/llm/latest-response");
        latestTrace.value = latest.trace;
        traceAbortController?.abort();
        const controller = new AbortController();
        traceAbortController = controller;
        const response = await fetch("/api/text-to-image/llm/response-events", {signal: controller.signal});
        await readSseStream<{traceId?: string; seq?: number; kind?: LlmTraceEvent["kind"]} & Partial<LlmTraceEvent>>(response, (event) => {
            if (typeof event.traceId !== "string" || typeof event.seq !== "number" || typeof event.kind !== "string") return;
            latestTrace.value = event as LlmTraceEvent;
            if (event.content !== undefined) testResult.value = event.content;
        });
    } catch (cause) {
        if (!traceAbortController?.signal.aborted) {
            // 调试面板断开不应覆盖当前业务错误；下一次打开页面会重新订阅。
            console.warn("文生图 LLM 回复流断开", cause);
        }
    }
}

function syncConfigState(config: TextToImageGlobalConfig): void {
    contextProfiles.value = {...(config.contextProfiles ?? {})};
    for (const option of requestTypeOptions) {
        const binding = config.requestTypeBindings?.[option.value];
        requestBindings.value[option.value] = binding
            ? normalizeRequestBinding(binding)
            : {providerId: null, contextProfileId: contextProfileKeys.value[0] ?? "default"};
    }
    wordReplacementProfiles.value = ensureDefaultWordReplacementProfile(config.wordReplacementProfiles);
    currentWordReplacementProfile.value = config.currentWordReplacementProfile ?? "default";
    historyPrefillDepth.value = config.historyPrefillDepth ?? 1;
    toolCallConfig.value = cloneToolConfig(TextToImageToolCallConfigSchema.parse(config.toolCallConfig ?? DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG));
    tailMessagesConfig.value = cloneTailConfig(TextToImageTailMessagesConfigSchema.parse(config.tailMessagesConfig ?? DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG));
    if (selectedContextProfileId.value && !contextProfiles.value[selectedContextProfileId.value]) {
        selectedContextProfileId.value = "";
        contextProfileDraft.value = emptyContextProfile();
        isNewContextProfile.value = false;
    } else if (!selectedContextProfileId.value && !isNewContextProfile.value && contextProfileKeys.value.length > 0) {
        selectContextProfile(contextProfileKeys.value[0]!, {expand: false});
    }
}

function normalizeRequestBinding(binding: TextToImageRequestBinding): TextToImageRequestBinding {
    return {
        ...binding,
        providerId: binding.providerId !== null
            && llmProviders.value.some((provider) => provider.id === binding.providerId)
            ? binding.providerId
            : null,
    };
}

function ensureDefaultWordReplacementProfile(
    profiles: TextToImageGlobalConfig["wordReplacementProfiles"],
): TextToImageGlobalConfig["wordReplacementProfiles"] {
    const next = {...(profiles ?? {})};
    const current = next.default;
    if (!current || ((current.textReplacement ?? "").trim() === "" && (current.aiReplacement ?? "").trim() === "")) {
        next.default = {...DEFAULT_WORD_REPLACEMENT_PROFILE};
    }
    return next;
}

function selectProvider(id: number): void {
    modelListOpen.value = false;
    modelError.value = "";
    selectedProviderId.value = id;
    const provider = props.providers.find((item) => item.id === id);
    const settings = provider ? TextToImageLlmProviderSettingsSchema.parse(provider.settings) : TextToImageLlmProviderSettingsSchema.parse({});
    const rawSettings = provider?.settings ?? {};
    const hasToolOverride = Object.prototype.hasOwnProperty.call(rawSettings, "toolCallConfig");
    const hasTailOverride = Object.prototype.hasOwnProperty.call(rawSettings, "tailMessagesConfig");
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
        tagthinkEcho: rawSettings.tagthinkEcho === true,
        toolMode: hasToolOverride ? "override" : "inherit",
        toolCallConfig: hasToolOverride ? TextToImageToolCallConfigSchema.parse(rawSettings.toolCallConfig) : cloneToolConfig(toolCallConfig.value),
        tailMode: hasTailOverride ? "override" : "inherit",
        tailMessagesConfig: hasTailOverride ? TextToImageTailMessagesConfigSchema.parse(rawSettings.tailMessagesConfig) : cloneTailConfig(tailMessagesConfig.value),
    };
}

function newProvider(): void {
    modelListOpen.value = false;
    modelError.value = "";
    selectedProviderId.value = null;
    form.value = {
        name: "",
        baseUrl: "",
        model: "",
        credential: "",
        temperature: 1,
        topP: 1,
        maxTokens: 30000,
        stream: false,
        sendImages: false,
        mergeSystemUser: false,
        retryCount: 0,
        tagthinkEcho: false,
        toolMode: "inherit",
        toolCallConfig: cloneToolConfig(toolCallConfig.value),
        tailMode: "inherit",
        tailMessagesConfig: cloneTailConfig(tailMessagesConfig.value),
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
        tagthinkEcho: form.value.tagthinkEcho,
    };
    if (form.value.toolMode === "override") {
        settings.toolCallConfig = TextToImageToolCallConfigSchema.parse(form.value.toolCallConfig);
    }
    if (form.value.tailMode === "override") {
        settings.tailMessagesConfig = TextToImageTailMessagesConfigSchema.parse(form.value.tailMessagesConfig);
    }
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

function moveListItem<T>(items: T[], index: number, delta: number): void {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    const current = items[index]!;
    items[index] = items[nextIndex]!;
    items[nextIndex] = current;
}

function addToolField(target: "global" | "provider"): void {
    const config = target === "global" ? toolCallConfig.value : form.value.toolCallConfig;
    config.fields.push({name: `field_${config.fields.length + 1}`, description: "", required: true, wrapTag: ""});
}
function removeToolField(target: "global" | "provider", index: number): void {
    const config = target === "global" ? toolCallConfig.value : form.value.toolCallConfig;
    if (config.fields.length <= 1) return;
    config.fields.splice(index, 1);
}
function moveToolField(target: "global" | "provider", index: number, delta: number): void {
    const config = target === "global" ? toolCallConfig.value : form.value.toolCallConfig;
    moveListItem(config.fields, index, delta);
}
function addTailMessage(target: "global" | "provider"): void {
    const config = target === "global" ? tailMessagesConfig.value : form.value.tailMessagesConfig;
    config.messages.push({role: "user", content: ""});
}
function removeTailMessage(target: "global" | "provider", index: number): void {
    const config = target === "global" ? tailMessagesConfig.value : form.value.tailMessagesConfig;
    config.messages.splice(index, 1);
}
function moveTailMessage(target: "global" | "provider", index: number, delta: number): void {
    const config = target === "global" ? tailMessagesConfig.value : form.value.tailMessagesConfig;
    moveListItem(config.messages, index, delta);
}
function resetToolConfig(target: "global" | "provider"): void {
    if (target === "global") {
        toolCallConfig.value = cloneToolConfig(DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG);
        persistGlobal({toolCallConfig: toolCallConfig.value});
    } else {
        form.value.toolCallConfig = cloneToolConfig(DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG);
        form.value.toolMode = "override";
    }
}
function resetTailConfig(target: "global" | "provider"): void {
    if (target === "global") {
        tailMessagesConfig.value = cloneTailConfig(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG);
        persistGlobal({tailMessagesConfig: tailMessagesConfig.value});
    } else {
        form.value.tailMessagesConfig = cloneTailConfig(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG);
        form.value.tailMode = "override";
    }
}

function saveGlobalToolConfig(): void {
    try {
        toolCallConfig.value = TextToImageToolCallConfigSchema.parse(toolCallConfig.value);
        persistGlobal({toolCallConfig: toolCallConfig.value});
        error.value = "";
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "Tool 配置校验失败");
    }
}
function saveGlobalTailConfig(): void {
    try {
        tailMessagesConfig.value = TextToImageTailMessagesConfigSchema.parse(tailMessagesConfig.value);
        persistGlobal({tailMessagesConfig: tailMessagesConfig.value});
        error.value = "";
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "Tail 配置校验失败");
    }
}
function exportToolConfig(target: "global" | "provider"): void {
    const config = target === "global" ? toolCallConfig.value : form.value.toolCallConfig;
    downloadJson(`${target}-tool-config.json`, exportTextToImageToolConfig(config));
}
function exportTailConfig(target: "global" | "provider"): void {
    const config = target === "global" ? tailMessagesConfig.value : form.value.tailMessagesConfig;
    downloadJson(`${target}-tail-config.json`, exportTextToImageTailConfig(config));
}
function openToolImport(target: "global" | "provider"): void {
    (target === "global" ? globalToolImportInput : providerToolImportInput).value?.click();
}
function openTailImport(target: "global" | "provider"): void {
    (target === "global" ? globalTailImportInput : providerTailImportInput).value?.click();
}
async function importToolConfig(event: Event, target: "global" | "provider"): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
        const parsed = parseTextToImageToolConfig(JSON.parse(await file.text()));
        if (target === "global") {
            toolCallConfig.value = parsed;
            persistGlobal({toolCallConfig: parsed});
        } else {
            form.value.toolCallConfig = parsed;
            form.value.toolMode = "override";
        }
        error.value = "";
        notification.success(`${target === "global" ? "全局" : "Provider"} Tool 配置导入成功`);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "导入 Tool 配置失败");
        notification.error(error.value, {title: "导入 Tool 配置失败"});
    } finally {
        input.value = "";
    }
}
async function importTailConfig(event: Event, target: "global" | "provider"): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
        const parsed = parseTextToImageTailConfig(JSON.parse(await file.text()));
        if (target === "global") {
            tailMessagesConfig.value = parsed;
            persistGlobal({tailMessagesConfig: parsed});
        } else {
            form.value.tailMessagesConfig = parsed;
            form.value.tailMode = "override";
        }
        error.value = "";
        notification.success(`${target === "global" ? "全局" : "Provider"} Tail 配置导入成功`);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "导入 Tail 配置失败");
        notification.error(error.value, {title: "导入 Tail 配置失败"});
    } finally {
        input.value = "";
    }
}

function chooseModel(model: string): void {
    form.value.model = model;
    modelListOpen.value = false;
    modelError.value = "";
    if (selectedProviderId.value !== null) {
        saveProvider();
    }
}

function deleteProvider(): void {
    if (selectedProviderId.value !== null) {
        emit("delete-provider", selectedProviderId.value);
        newProvider();
    }
}

function selectContextProfile(id: string, options: {expand?: boolean} = {}): void {
    const profile = contextProfiles.value[id];
    if (!profile) {
        return;
    }
    selectedContextProfileId.value = id;
    contextProfileDraft.value = cloneContextProfile(profile);
    isNewContextProfile.value = false;
    if (options.expand !== false) {
        contextProfilesExpanded.value = true;
    }
}

function newContextProfile(): void {
    selectedContextProfileId.value = "";
    contextProfileDraft.value = {id: "", name: "", promptMode: "augment", entries: [emptyContextEntry()]};
    isNewContextProfile.value = true;
    contextProfilesExpanded.value = true;
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
        promptMode: contextProfileDraft.value.promptMode,
        entries: contextProfileDraft.value.entries.map((entry) => ({
            ...entry,
            id: entry.id.trim() || nextEntryId(),
            name: entry.name.trim(),
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
        historyPrefillDepth: historyPrefillDepth.value,
        toolCallConfig: toolCallConfig.value,
        tailMessagesConfig: tailMessagesConfig.value,
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
        if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
            const rawType = (raw as {type?: unknown}).type;
            if (rawType === "antigravity_tool_config" || rawType === "antigravity_tail_config") {
                throw new Error("该文件是 Tool/Tail 独立配置，请使用对应的独立导入按钮");
            }
        }
        const parsed = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "contextProfiles" in raw
            ? TextToImageGlobalConfigSchema.parse(raw)
            : TextToImageGlobalConfigSchema.parse({
                contextProfiles: normalizeImportedContextProfiles(raw),
            });
        contextProfiles.value = {...parsed.contextProfiles};
        requestBindings.value = {
            image_gen: parsed.requestTypeBindings?.image_gen
                ? normalizeRequestBinding(parsed.requestTypeBindings.image_gen)
                : {providerId: null, contextProfileId: "default"},
            char_design: parsed.requestTypeBindings?.char_design
                ? normalizeRequestBinding(parsed.requestTypeBindings.char_design)
                : {providerId: null, contextProfileId: "default"},
            char_display: parsed.requestTypeBindings?.char_display
                ? normalizeRequestBinding(parsed.requestTypeBindings.char_display)
                : {providerId: null, contextProfileId: "default"},
            char_modify: parsed.requestTypeBindings?.char_modify
                ? normalizeRequestBinding(parsed.requestTypeBindings.char_modify)
                : {providerId: null, contextProfileId: "default"},
            tag_modify: parsed.requestTypeBindings?.tag_modify
                ? normalizeRequestBinding(parsed.requestTypeBindings.tag_modify)
                : {providerId: null, contextProfileId: "default"},
        };
        wordReplacementProfiles.value = ensureDefaultWordReplacementProfile(parsed.wordReplacementProfiles);
        currentWordReplacementProfile.value = parsed.currentWordReplacementProfile ?? "default";
        historyPrefillDepth.value = parsed.historyPrefillDepth;
        toolCallConfig.value = TextToImageToolCallConfigSchema.parse(parsed.toolCallConfig);
        tailMessagesConfig.value = TextToImageTailMessagesConfigSchema.parse(parsed.tailMessagesConfig);
        error.value = "";
        persistGlobal({
            contextProfiles: contextProfiles.value,
            requestTypeBindings: requestBindings.value,
            wordReplacementProfiles: wordReplacementProfiles.value,
            currentWordReplacementProfile: currentWordReplacementProfile.value,
            historyPrefillDepth: historyPrefillDepth.value,
            toolCallConfig: toolCallConfig.value,
            tailMessagesConfig: tailMessagesConfig.value,
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
        const imported = normalizeImportedContextProfiles(parsed);
        const importedIds = Object.keys(imported).filter((id) => !(id in contextProfiles.value));
        const next = {...contextProfiles.value};
        Object.assign(next, imported);
        contextProfiles.value = next;
        error.value = "";
        persistGlobal({contextProfiles: next});
        notification.success("上下文预设导入成功");
        const firstImportedId = importedIds[0] ?? Object.keys(imported)[0];
        if (firstImportedId) {
            selectContextProfile(firstImportedId, {expand: false});
        }
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
        historyPrefillDepth: historyPrefillDepth.value,
        toolCallConfig: toolCallConfig.value,
        tailMessagesConfig: tailMessagesConfig.value,
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

async function buildTestPreview(): Promise<void> {
    if (selectedProviderId.value === null) {
        error.value = "请先选择 Provider";
        return;
    }
    previewing.value = true;
    error.value = "";
    try {
        const result = await $fetch<{messages: Array<{role: string; content: unknown}>; tools: unknown; tool_choice: unknown; promptMode: string; profileId: string}>("/api/text-to-image/llm/preview", {
            method: "POST",
            body: {
                providerId: selectedProviderId.value,
                requestType: testRequestType.value,
                prompt: testPrompt.value.trim() || "连接测试",
                runtime: {},
            },
        });
        testPreview.value = `[${result.promptMode}] ${result.profileId}\n\nTool: ${JSON.stringify(result.tools)}\nTool choice: ${JSON.stringify(result.tool_choice)}\n\n${result.messages.map((message) => `[${message.role}] ${typeof message.content === "string" ? message.content : JSON.stringify(message.content)}`).join("\n\n")}`;
    } catch (cause) {
        testPreview.value = "";
        error.value = resolveApiErrorMessage(cause, "组合提示词预览失败");
    } finally {
        previewing.value = false;
    }
}

async function fetchModels(): Promise<void> {
    modelError.value = "";
    if (selectedProviderId.value === null && form.value.baseUrl.trim() === "") {
        modelError.value = "请先填写 Base URL";
        return;
    }
    fetchingModels.value = true;
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
        modelListOpen.value = result.models.length > 0;
        if (result.models.length === 0) {
            modelError.value = "模型列表为空";
        } else {
            notification.success(`获取到 ${result.models.length} 个模型`);
        }
    } catch (cause) {
        modelError.value = resolveApiErrorMessage(cause, "获取模型列表失败");
        notification.error(modelError.value, {title: "获取模型列表失败"});
    } finally {
        fetchingModels.value = false;
    }
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-[17px] font-semibold text-[var(--text-main)]">LLM Provider</h3>
                <div class="flex items-center gap-2">
                    <select v-model.number="selectedProviderId" class="h-9 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" @change="selectedProviderId !== null && selectProvider(selectedProviderId)">
                        <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="newProvider">新建</button>
                    <button class="h-9 rounded-md border border-[var(--danger-border)] px-2 text-[16px] text-[var(--danger-text)] hover:bg-[var(--bg-hover)]" :disabled="selectedProviderId === null" @click="deleteProvider">删除</button>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    名称
                    <input v-model="form.name" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    Base URL（含 /v1）
                    <input v-model="form.baseUrl" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <div class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    模型
                    <div class="flex gap-2">
                        <input v-model="form.model" placeholder="请先获取模型" class="h-9 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                        <button type="button" class="h-9 shrink-0 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)]" :disabled="fetchingModels" @click.stop="fetchModels">{{ fetchingModels ? "获取中..." : "获取模型" }}</button>
                    </div>
                    <div v-if="modelListOpen" class="custom-scrollbar max-h-56 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-1 shadow">
                        <button v-for="model in modelOptions" :key="model" type="button" class="block w-full rounded-md px-2 py-1 text-left text-[17px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="chooseModel(model)">{{ model }}</button>
                    </div>
                    <p v-if="modelError" class="text-[16px] text-[var(--danger-text)]">{{ modelError }}</p>
                </div>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    API Key（留空表示保留）
                    <input v-model="form.credential" type="password" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    Temperature
                    <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.01" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    Top P
                    <input v-model.number="form.topP" type="number" min="0" max="1" step="0.01" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    Max Tokens
                    <input v-model.number="form.maxTokens" type="number" min="1" max="30000" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    重试次数
                    <input v-model.number="form.retryCount" type="number" min="0" max="5" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-3">
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]">
                    流式生成
                    <BooleanToggleButton v-model="form.stream" />
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]">
                    发送图片
                    <BooleanToggleButton v-model="form.sendImages" />
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]">
                    合并 System/User
                    <BooleanToggleButton v-model="form.mergeSystemUser" />
                </label>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-3">
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]">
                    Tagthink 回显
                    <BooleanToggleButton v-model="form.tagthinkEcho" />
                </label>
            </div>
            <div class="mt-3 rounded-md border border-[var(--border-color)] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                    <h4 class="text-[16px] font-semibold text-[var(--text-main)]">Provider Tool 配置</h4>
                    <div class="flex items-center gap-2">
                        <input ref="providerToolImportInput" type="file" accept="application/json" class="hidden" @change="importToolConfig($event, 'provider')" />
                        <button type="button" class="h-8 rounded border px-2 text-[14px]" @click="openToolImport('provider')">导入</button>
                        <button type="button" class="h-8 rounded border px-2 text-[14px]" @click="exportToolConfig('provider')">导出</button>
                        <button type="button" class="h-8 rounded border px-2 text-[14px]" @click="resetToolConfig('provider')">恢复默认并独立设置</button>
                    </div>
                </div>
                <label class="flex max-w-[260px] flex-col gap-1 text-[15px] text-[var(--text-secondary)]">配置来源
                    <select v-model="form.toolMode" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[15px]">
                        <option value="inherit">继承全局</option>
                        <option value="override">独立设置</option>
                    </select>
                </label>
                <template v-if="form.toolMode === 'override'">
                    <div class="mt-2 grid grid-cols-2 gap-2">
                        <label class="flex items-center gap-2 text-[15px] text-[var(--text-secondary)]">启用 <BooleanToggleButton v-model="form.toolCallConfig.enabled" /></label>
                        <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">命名方式
                            <select v-model="form.toolCallConfig.nameMode" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[15px]"><option value="dynamic">动态</option><option value="fixed">固定</option></select>
                        </label>
                        <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">固定名称 <input v-model="form.toolCallConfig.fixedName" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[15px]" /></label>
                        <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">动态名称前缀 <input v-model="form.toolCallConfig.prefix" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[15px]" /></label>
                    </div>
                    <label class="mt-2 flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">工具用途描述 <textarea v-model="form.toolCallConfig.desc" rows="3" class="rounded border bg-[var(--bg-input)] p-2 text-[15px]" /></label>
                    <div class="mt-2 flex items-center justify-between"><span class="text-[15px] font-medium">字段</span><button type="button" class="h-8 rounded border px-2 text-[14px]" @click="addToolField('provider')">添加字段</button></div>
                    <div v-for="(field, index) in form.toolCallConfig.fields" :key="'provider-tool-' + index" class="mt-2 rounded border p-2">
                        <div class="mb-1 flex items-center justify-between"><span class="text-[14px] text-[var(--text-muted)]">字段 {{ index + 1 }}</span><div class="flex gap-1"><button type="button" class="rounded border px-2 text-[13px]" @click="moveToolField('provider', index, -1)">上移</button><button type="button" class="rounded border px-2 text-[13px]" @click="moveToolField('provider', index, 1)">下移</button><button type="button" class="rounded border border-[var(--danger-border)] px-2 text-[13px]" :disabled="form.toolCallConfig.fields.length <= 1" @click="removeToolField('provider', index)">删除</button></div></div>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="flex flex-col gap-1 text-[14px]">名称 <input v-model="field.name" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[14px]" /></label>
                            <label class="flex items-center gap-2 text-[14px]">必填 <BooleanToggleButton v-model="field.required" /></label>
                            <label class="flex flex-col gap-1 text-[14px]">包裹标签 <input v-model="field.wrapTag" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[14px]" /></label>
                        </div>
                        <label class="mt-1 flex flex-col gap-1 text-[14px]">字段描述 <textarea v-model="field.description" rows="2" class="rounded border bg-[var(--bg-input)] p-2 text-[14px]" /></label>
                    </div>
                </template>
            </div>
            <div class="mt-3 rounded-md border border-[var(--border-color)] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                    <h4 class="text-[16px] font-semibold text-[var(--text-main)]">Provider Tail 消息</h4>
                    <div class="flex items-center gap-2">
                        <input ref="providerTailImportInput" type="file" accept="application/json" class="hidden" @change="importTailConfig($event, 'provider')" />
                        <button type="button" class="h-8 rounded border px-2 text-[14px]" @click="openTailImport('provider')">导入</button>
                        <button type="button" class="h-8 rounded border px-2 text-[14px]" @click="exportTailConfig('provider')">导出</button>
                        <button type="button" class="h-8 rounded border px-2 text-[14px]" @click="resetTailConfig('provider')">恢复默认并独立设置</button>
                    </div>
                </div>
                <label class="flex max-w-[260px] flex-col gap-1 text-[15px] text-[var(--text-secondary)]">配置来源
                    <select v-model="form.tailMode" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[15px]"><option value="inherit">继承全局</option><option value="override">独立设置</option></select>
                </label>
                <template v-if="form.tailMode === 'override'">
                    <label class="mt-2 flex items-center gap-2 text-[15px] text-[var(--text-secondary)]">启用（Tool 开启时生效） <BooleanToggleButton v-model="form.tailMessagesConfig.enabled" /></label>
                    <button type="button" class="mt-2 h-8 rounded border px-2 text-[14px]" @click="addTailMessage('provider')">添加消息</button>
                    <div v-for="(message, index) in form.tailMessagesConfig.messages" :key="'provider-tail-' + index" class="mt-2 rounded border p-2">
                        <div class="mb-1 flex items-center justify-between"><span class="text-[14px] text-[var(--text-muted)]">消息 {{ index + 1 }}</span><div class="flex gap-1"><button type="button" class="rounded border px-2 text-[13px]" @click="moveTailMessage('provider', index, -1)">上移</button><button type="button" class="rounded border px-2 text-[13px]" @click="moveTailMessage('provider', index, 1)">下移</button><button type="button" class="rounded border border-[var(--danger-border)] px-2 text-[13px]" @click="removeTailMessage('provider', index)">删除</button></div></div>
                        <label class="flex flex-col gap-1 text-[14px]">role <select v-model="message.role" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[14px]"><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></label>
                        <label class="mt-1 flex flex-col gap-1 text-[14px]">content <textarea v-model="message.content" rows="4" class="rounded border bg-[var(--bg-input)] p-2 text-[14px]" /></label>
                    </div>
                </template>
            </div>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-9 rounded-md bg-[var(--accent-main)] px-3 text-[16px] font-medium text-[var(--text-inverse)]" @click="saveProvider">保存 Provider</button>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-[17px] font-semibold text-[var(--text-main)]">全局配置</h3>
                <div class="flex items-center gap-2">
                    <input ref="globalConfigImportInput" type="file" accept="application/json" class="hidden" @change="importGlobalConfig" />
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="openGlobalConfigImport">导入</button>
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="exportGlobalConfig">导出全部</button>
                </div>
            </div>
            <div class="grid grid-cols-1 gap-3">
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <label class="flex max-w-[360px] flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                        历史前文回填深度（同卷）
                        <input
                            v-model.number="historyPrefillDepth"
                            type="number"
                            min="0"
                            max="20"
                            step="1"
                            class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]"
                            @change="persistGlobal({historyPrefillDepth})"
                        />
                        <span class="text-[14px] text-[var(--text-muted)]">默认回填上一章；本卷第一章不会回填。0 表示关闭。</span>
                    </label>
                </div>
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <h4 class="text-[16px] font-semibold text-[var(--text-main)]">全局 Tool 配置</h4>
                        <div class="flex items-center gap-2">
                            <input ref="globalToolImportInput" type="file" accept="application/json" class="hidden" @change="importToolConfig($event, 'global')" />
                            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[14px] text-[var(--text-secondary)]" @click="openToolImport('global')">导入</button>
                            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[14px] text-[var(--text-secondary)]" @click="exportToolConfig('global')">导出</button>
                            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[14px] text-[var(--text-secondary)]" @click="resetToolConfig('global')">恢复默认</button>
                            <button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-2 text-[14px] text-[var(--text-inverse)]" @click="saveGlobalToolConfig">保存</button>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <label class="flex items-center gap-2 text-[15px] text-[var(--text-secondary)]">启用 <BooleanToggleButton v-model="toolCallConfig.enabled" /></label>
                        <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">命名方式
                            <select v-model="toolCallConfig.nameMode" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[15px] text-[var(--text-main)]">
                                <option value="dynamic">动态</option>
                                <option value="fixed">固定</option>
                            </select>
                        </label>
                        <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">固定名称
                            <input v-model="toolCallConfig.fixedName" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[15px] text-[var(--text-main)]" />
                        </label>
                        <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">动态名称前缀
                            <input v-model="toolCallConfig.prefix" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[15px] text-[var(--text-main)]" />
                        </label>
                    </div>
                    <label class="mt-2 flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">工具用途描述
                        <textarea v-model="toolCallConfig.desc" rows="3" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[15px] text-[var(--text-main)]" />
                    </label>
                    <div class="mt-2 flex items-center justify-between">
                        <span class="text-[15px] font-medium text-[var(--text-main)]">字段</span>
                        <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[14px] text-[var(--text-secondary)]" @click="addToolField('global')">添加字段</button>
                    </div>
                    <div v-for="(field, index) in toolCallConfig.fields" :key="'global-tool-' + index" class="mt-2 rounded-md border border-[var(--border-color)] p-2">
                        <div class="mb-1 flex items-center justify-between">
                            <span class="text-[14px] text-[var(--text-muted)]">字段 {{ index + 1 }}</span>
                            <div class="flex gap-1">
                                <button type="button" class="rounded border px-2 text-[13px]" @click="moveToolField('global', index, -1)">上移</button>
                                <button type="button" class="rounded border px-2 text-[13px]" @click="moveToolField('global', index, 1)">下移</button>
                                <button type="button" class="rounded border border-[var(--danger-border)] px-2 text-[13px] text-[var(--danger-text)]" :disabled="toolCallConfig.fields.length <= 1" @click="removeToolField('global', index)">删除</button>
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="flex flex-col gap-1 text-[14px] text-[var(--text-secondary)]">名称 <input v-model="field.name" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[14px]" /></label>
                            <label class="flex items-center gap-2 text-[14px] text-[var(--text-secondary)]">必填 <BooleanToggleButton v-model="field.required" /></label>
                            <label class="flex flex-col gap-1 text-[14px] text-[var(--text-secondary)]">包裹标签 <input v-model="field.wrapTag" placeholder="可选，例如 thinking" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[14px]" /></label>
                        </div>
                        <label class="mt-1 flex flex-col gap-1 text-[14px] text-[var(--text-secondary)]">字段描述 <textarea v-model="field.description" rows="2" class="rounded border bg-[var(--bg-input)] p-2 text-[14px]" /></label>
                    </div>
                </div>
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <h4 class="text-[16px] font-semibold text-[var(--text-main)]">全局 Tail 消息</h4>
                        <div class="flex items-center gap-2">
                            <input ref="globalTailImportInput" type="file" accept="application/json" class="hidden" @change="importTailConfig($event, 'global')" />
                            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[14px] text-[var(--text-secondary)]" @click="openTailImport('global')">导入</button>
                            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[14px] text-[var(--text-secondary)]" @click="exportTailConfig('global')">导出</button>
                            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[14px] text-[var(--text-secondary)]" @click="resetTailConfig('global')">恢复默认</button>
                            <button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-2 text-[14px] text-[var(--text-inverse)]" @click="saveGlobalTailConfig">保存</button>
                        </div>
                    </div>
                    <label class="mb-2 flex items-center gap-2 text-[15px] text-[var(--text-secondary)]">启用（Tool 开启时生效） <BooleanToggleButton v-model="tailMessagesConfig.enabled" /></label>
                    <button type="button" class="mb-1 h-8 rounded-md border border-[var(--border-color)] px-2 text-[14px] text-[var(--text-secondary)]" @click="addTailMessage('global')">添加消息</button>
                    <div v-for="(message, index) in tailMessagesConfig.messages" :key="'global-tail-' + index" class="mt-2 rounded-md border border-[var(--border-color)] p-2">
                        <div class="mb-1 flex items-center justify-between">
                            <span class="text-[14px] text-[var(--text-muted)]">消息 {{ index + 1 }}</span>
                            <div class="flex gap-1">
                                <button type="button" class="rounded border px-2 text-[13px]" @click="moveTailMessage('global', index, -1)">上移</button>
                                <button type="button" class="rounded border px-2 text-[13px]" @click="moveTailMessage('global', index, 1)">下移</button>
                                <button type="button" class="rounded border border-[var(--danger-border)] px-2 text-[13px] text-[var(--danger-text)]" @click="removeTailMessage('global', index)">删除</button>
                            </div>
                        </div>
                        <label class="flex flex-col gap-1 text-[14px] text-[var(--text-secondary)]">role
                            <select v-model="message.role" class="h-8 rounded border bg-[var(--bg-input)] px-2 text-[14px]">
                                <option value="system">system</option>
                                <option value="user">user</option>
                                <option value="assistant">assistant</option>
                            </select>
                        </label>
                        <label class="mt-1 flex flex-col gap-1 text-[14px] text-[var(--text-secondary)]">content
                            <textarea v-model="message.content" rows="4" class="rounded border bg-[var(--bg-input)] p-2 text-[14px]" />
                        </label>
                    </div>
                </div>
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                            <button
                                type="button"
                                class="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                :aria-expanded="contextProfilesExpanded"
                                :title="contextProfilesExpanded ? '折叠上下文预设' : '展开上下文预设'"
                                @click="contextProfilesExpanded = !contextProfilesExpanded"
                            >
                                <span :class="contextProfilesExpanded ? 'i-lucide-chevron-down h-4 w-4' : 'i-lucide-chevron-right h-4 w-4'"></span>
                            </button>
                            <h4 class="text-[16px] font-semibold text-[var(--text-main)]">上下文预设</h4>
                            <span class="text-[15px] text-[var(--text-muted)]">{{ contextProfileKeys.length }} 个</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <select v-model="selectedContextProfileId" class="h-9 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" @change="selectContextProfile(selectedContextProfileId)">
                                <option value="" disabled>选择预设</option>
                                <option v-for="id in contextProfileKeys" :key="id" :value="id">{{ contextProfileLabel(id) }}</option>
                            </select>
                            <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="newContextProfile">新建</button>
                            <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="saveContextProfile">保存</button>
                            <input ref="contextProfileImportInput" type="file" accept="application/json" class="hidden" @change="importContextProfiles" />
                            <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="openContextProfileImport">导入</button>
                            <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="exportContextProfiles">导出全部</button>
                            <button class="h-9 rounded-md border border-[var(--danger-border)] px-2 text-[16px] text-[var(--danger-text)] hover:bg-[var(--bg-hover)]" :disabled="!selectedContextProfileId" @click="deleteContextProfile">删除</button>
                        </div>
                    </div>
                    <template v-if="contextProfilesExpanded">
                    <div class="grid grid-cols-2 gap-3">
                        <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                            预设 ID
                            <input v-model="contextProfileDraft.id" :disabled="selectedContextProfileId !== ''" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)] disabled:opacity-60" />
                        </label>
                        <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                            预设名称
                            <input v-model="contextProfileDraft.name" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                        </label>
                        <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                            消息模式
                            <select v-model="contextProfileDraft.promptMode" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                                <option value="complete">完整预设（不追加内置提示词）</option>
                                <option value="augment">增补预设（追加内置任务提示词）</option>
                            </select>
                        </label>
                    </div>
                    <button class="mt-2 h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="addContextEntry">添加条目</button>
                    <div class="custom-scrollbar max-h-[400px] min-h-[220px] overflow-y-auto rounded-md border border-[var(--border-color)] p-2">
                    <div v-for="(entry, index) in contextProfileDraft.entries" :key="entry.id" class="mt-2 rounded-md border border-[var(--border-color)] p-2">
                        <div class="mb-1 flex items-center justify-between">
                            <span class="text-[15px] text-[var(--text-muted)]">{{ entry.name.trim() || `条目 ${index + 1}` }}</span>
                            <button class="rounded-md border border-[var(--danger-border)] px-2 text-[15px] text-[var(--danger-text)] hover:bg-[var(--bg-hover)]" @click="removeContextEntry(index)">删除</button>
                        </div>
                        <div class="grid grid-cols-3 gap-2">
                            <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">
                                条目名称
                                <input v-model="entry.name" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[16px] text-[var(--text-main)]" />
                            </label>
                            <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">
                                role
                                <select v-model="entry.role" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[16px] text-[var(--text-main)]">
                                    <option value="system">system</option>
                                    <option value="user">user</option>
                                    <option value="assistant">assistant</option>
                                </select>
                            </label>
                            <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">
                                triggerMode
                                <select v-model="entry.triggerMode" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[16px] text-[var(--text-main)]">
                                    <option value="always">always</option>
                                    <option value="trigger">trigger</option>
                                </select>
                            </label>
                            <label class="flex items-end gap-2 pb-1 text-[15px] text-[var(--text-secondary)]">
                                enabled
                                <BooleanToggleButton v-model="entry.enabled" />
                            </label>
                            <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">
                                triggerWords
                                <input v-model="entry.triggerWords" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[16px] text-[var(--text-main)]" />
                            </label>
                            <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">
                                andTriggerWords
                                <input v-model="entry.andTriggerWords" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[16px] text-[var(--text-main)]" />
                            </label>
                        </div>
                        <label class="mt-2 flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">
                            content
                            <textarea v-model="entry.content" rows="2" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[16px] text-[var(--text-main)]" />
                        </label>
                    </div>
                    </div>
                    </template>
                </div>

                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <h4 class="mb-2 text-[16px] font-semibold text-[var(--text-main)]">请求类型</h4>
                    <div class="grid grid-cols-2 gap-2">
                        <div v-for="option in requestTypeOptions" :key="option.value" class="rounded-md border border-[var(--border-color)] p-2">
                            <p class="mb-1 text-[16px] font-medium text-[var(--text-main)]">{{ option.label }}</p>
                            <div class="grid grid-cols-2 gap-2">
                                <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">
                                    providerId
                                    <select v-model="requestBindings[option.value].providerId" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[16px] text-[var(--text-main)]" @change="saveRequestBindings">
                                        <option :value="null">未绑定</option>
                                        <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                                    </select>
                                </label>
                                <label class="flex flex-col gap-1 text-[15px] text-[var(--text-secondary)]">
                                    contextProfileId
                                    <select v-model="requestBindings[option.value].contextProfileId" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[16px] text-[var(--text-main)]" @change="saveRequestBindings">
                                        <option v-for="id in contextProfileOptions(requestBindings[option.value])" :key="id" :value="id">{{ contextProfileLabel(id) }}</option>
                                    </select>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <h4 class="mb-2 text-[16px] font-semibold text-[var(--text-main)]">敏感词替换（内置规则）</h4>
                    <p class="mb-1 text-[15px] text-[var(--text-muted)]">正文发送前替换</p>
                    <pre class="mb-2 whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[16px] text-[var(--text-main)]">{{ DEFAULT_WORD_REPLACEMENT_PROFILE.textReplacement }}</pre>
                    <p class="mb-1 text-[15px] text-[var(--text-muted)]">AI 回复解析前替换</p>
                    <pre class="whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[16px] text-[var(--text-main)]">{{ DEFAULT_WORD_REPLACEMENT_PROFILE.aiReplacement }}</pre>
                </div>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-[17px] font-semibold text-[var(--text-main)]">测试工具</h3>
                <span v-if="testStatus === 'success'" class="text-[16px] text-[var(--status-success)]">连接成功</span>
                <span v-else-if="testStatus === 'failure'" class="text-[16px] text-[var(--danger-text)]">连接失败</span>
            </div>
            <div class="mb-2 flex flex-wrap items-center gap-2">
                <select v-model="testRequestType" class="h-9 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                    <option v-for="option in requestTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <button class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[16px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="previewing || selectedProviderId === null" @click="buildTestPreview"><span v-if="previewing" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>{{ previewing ? "正在准备消息…" : "组合提示词预览" }}</button>
            </div>
            <textarea v-model="testPrompt" rows="4" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[17px] text-[var(--text-main)]" placeholder="输入测试提示词（可选，留空则发送连接测试）" />
            <button class="mt-2 inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[16px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving || selectedProviderId === null" @click="runTest"><span v-if="saving" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>{{ saving ? "正在等待 LLM 回复…" : "连接测试" }}</button>
            <textarea v-if="testPreview" v-model="testPreview" readonly rows="6" class="mt-2 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[17px] text-[var(--text-main)]" placeholder="组合提示词预览" />
            <textarea v-model="testResult" readonly rows="6" class="mt-2 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[17px] text-[var(--text-main)]" placeholder="AI 回复将显示在这里" />
            <section class="mt-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                <div class="flex items-center justify-between gap-2">
                    <h4 class="text-[15px] font-medium text-[var(--text-main)]">最近一次 LLM 原生回复</h4>
                    <span v-if="latestTrace" class="text-[12px] text-[var(--text-muted)]">{{ latestTrace.kind }} · 第 {{ latestTrace.attempt }} 次尝试</span>
                </div>
                <p v-if="latestTrace" class="mt-1 text-[12px] text-[var(--text-muted)]">{{ latestTrace.requestType || "未知请求" }} · {{ latestTrace.model }} · {{ latestTrace.truncated ? "显示已截断" : "完整显示" }}</p>
                <pre v-if="latestTrace?.content" class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-[14px] leading-5 text-[var(--text-main)]">{{ latestTrace.content }}</pre>
                <p v-else class="mt-2 text-[13px] text-[var(--text-muted)]">尚未收到 LLM 回复；点击连接测试后会实时显示流式内容。</p>
                <p v-if="latestTrace?.error" class="mt-2 text-[13px] text-[var(--danger-text)]">{{ latestTrace.error }}</p>
            </section>
        </div>

        <p v-if="error" class="text-[16px] text-[var(--danger-text)]">{{ error }}</p>
    </div>
</template>
