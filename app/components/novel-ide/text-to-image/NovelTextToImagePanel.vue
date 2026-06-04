<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import IconButton from "nbook/app/components/common/IconButton.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    MAX_TEXT_TO_IMAGE_LLM_TOKENS,
    TEXT_TO_IMAGE_NEGATIVE_QUALITY_PRESETS,
    TEXT_TO_IMAGE_NOVELAI_NOISE_SCHEDULES,
    TEXT_TO_IMAGE_NOVELAI_SAMPLERS,
    TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS,
    TEXT_TO_IMAGE_PROMPT_TASKS,
    useTextToImageStore,
    type NovelAiApiSettings,
    type TextToImageCharacter,
    type TextToImageCharacterTagKey,
    type TextToImageGenerationResult,
    type TextToImageLlmParameters,
    type TextToImagePromptTask,
    type TextToImageStylePreset,
    type TextToImageVibeReference,
} from "nbook/app/stores/text-to-image";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {WorkspaceTreeSnapshotDto} from "nbook/shared/dto/workspace-tree.dto";

type StyleTextFieldKey = "positivePrefix" | "positiveSuffix" | "negativePrefix" | "negativeSuffix";
type StyleBooleanKey = "useFurryDataset" | "positiveQualityPreset";
type LlmParameterKey = keyof TextToImageLlmParameters;
type NovelAiNumberKey = "promptGuidance" | "promptGuidanceRescale" | "width" | "height" | "steps" | "seed";
type NovelAiBooleanKey = "aiDefaultCharacterPosition" | "variety";
type NovelAiDimensionKey = "width" | "height";
type VibeNumberKey = "strength" | "infoExtracted";
type VibeSourceType = TextToImageVibeReference["sourceType"];
type CharacterAddMode = "manual" | "project";
type CharacterPromptDialogMode = "photoPrompt" | "revision";
type TextToImagePanelSection = "generation" | "novelAi" | "style" | "llm" | "characters";

type WorkspaceReadResponse = {
    path: string;
    absolutePath: string;
    entryType: string | null;
    editable: boolean;
    mtimeMs: number;
    content: string;
};

type SourceCharacterOption = {
    path: string;
    title: string;
    summary: string;
    indexPath: string;
    statePath: string | null;
};

type SourceCharacterDetail = SourceCharacterOption & {
    projectPath: string;
    novelTitle: string;
    content: string;
    stateContent: string;
};

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

type ChatCompletionContentPart = {
    type: "text";
    text: string;
} | {
    type: "image_url";
    image_url: {
        url: string;
    };
};

type ChatCompletionMessage = {
    role: "system" | "user";
    content: string | ChatCompletionContentPart[];
};

type ModelListEntry = string | {
    id?: string;
    model?: string;
    name?: string;
};

type ModelListResponse = ModelListEntry[] | {
    data?: ModelListEntry[];
    models?: ModelListEntry[];
};

type SelectOutputDirectoryResponse = {
    path: string | null;
};

type TextToImageGenerateResponse = {
    images: TextToImageGenerationResult[];
    request: {
        model: string;
        requestedModel: string;
        action: "generate";
        prompt: string;
        negativePrompt: string;
        seed: number;
        width: number;
        height: number;
        steps: number;
        sampler: string;
        savedDirectory: string;
        parameters: Record<string, unknown>;
    };
    warnings: string[];
};

type CharacterPromptReferenceImage = {
    id: string;
    name: string;
    dataUrl: string;
};

const store = useTextToImageStore();
const novelIdeStore = useNovelIdeStore();
const notification = useNotification();
const {
    activeCharacter,
    activeCharacterId,
    activeStyle,
    activeStyleId,
    characters,
    currentProjectPath,
    generationDraft,
    generationResults,
    llm,
    novelAi,
    output,
    stylePresets,
    taskPrompts,
} = storeToRefs(store);
const {currentNovelId, novels} = storeToRefs(novelIdeStore);

const selectedPromptTask = ref<TextToImagePromptTask>("bodyImage");
const promptFileInputRef = ref<HTMLInputElement | null>(null);
const characterPhotoInputRef = ref<HTMLInputElement | null>(null);
const characterPromptReferenceInputRef = ref<HTMLInputElement | null>(null);
const characterAddMode = ref<CharacterAddMode>("manual");
const sourceProjectPath = ref("");
const sourceCharacters = ref<SourceCharacterOption[]>([]);
const sourceCharacterPath = ref("");
const sourceLoading = ref(false);
const importingCharacter = ref(false);
const sourceError = ref("");
const importStatus = ref("");
const connectingLlm = ref(false);
const llmConnectionStatus = ref<"idle" | "success" | "failed">("idle");
const llmConnectionMessage = ref("");
const outputSettingsOpen = ref(false);
const selectingOutputPath = ref(false);
const generatingImage = ref(false);
const generationError = ref("");
const generationWarnings = ref<string[]>([]);
const lastGenerationRequest = ref<TextToImageGenerateResponse["request"] | null>(null);
const generatingCharacterImage = ref(false);
const characterPromptDialogOpen = ref(false);
const characterPromptDialogMode = ref<CharacterPromptDialogMode>("photoPrompt");
const characterPromptRequirement = ref("");
const characterPromptReferences = ref<CharacterPromptReferenceImage[]>([]);
const characterPromptBusy = ref(false);
const characterPromptError = ref("");
const collapsedSections = ref<Record<TextToImagePanelSection, boolean>>({
    generation: false,
    novelAi: false,
    style: false,
    llm: false,
    characters: false,
});

const novelAiModelOptions: SelectOption[] = [
    {value: "nai-diffusion-4-5-full", label: "NAI Diffusion V4.5 Full"},
    {value: "nai-diffusion-4-5-curated", label: "NAI Diffusion V4.5 Curated"},
    {value: "nai-diffusion-4-full", label: "NAI Diffusion V4 Full"},
    {value: "nai-diffusion-4-curated-preview", label: "NAI Diffusion V4 Curated"},
    {value: "nai-diffusion-3", label: "NAI Diffusion V3"},
    {value: "nai-diffusion-furry-3", label: "Furry Diffusion V3"},
];

const novelAiSamplerOptions: SelectOption[] = TEXT_TO_IMAGE_NOVELAI_SAMPLERS.map((sampler) => ({
    value: sampler.value,
    label: sampler.label,
    iconClass: "i-lucide-waves",
}));

const novelAiNoiseScheduleOptions: SelectOption[] = TEXT_TO_IMAGE_NOVELAI_NOISE_SCHEDULES.map((schedule) => ({
    value: schedule.value,
    label: schedule.label,
    iconClass: "i-lucide-activity",
}));

const novelAiSizePresetOptions: SelectOption[] = TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS.map((preset) => ({
    value: preset.value,
    label: preset.label,
    description: preset.value === "custom" ? "手动输入宽高" : `${preset.width} x ${preset.height}`,
    iconClass: "i-lucide-aspect-ratio",
}));

const vibeSourceTypeOptions: SelectOption[] = [
    {value: "rawImage", label: "Image", description: "原始图片或 Data URL", iconClass: "i-lucide-image"},
    {value: "png", label: "PNG", description: "带预编码 Vibe 的 PNG", iconClass: "i-lucide-file-image"},
    {value: "naiv4vibe", label: "V4 Vibe", description: ".naiv4vibe 预编码数据", iconClass: "i-lucide-file-code"},
    {value: "naiv4vibebundle", label: "Bundle", description: ".naiv4vibebundle 条目", iconClass: "i-lucide-package"},
];

const negativeQualityPresetOptions: SelectOption[] = TEXT_TO_IMAGE_NEGATIVE_QUALITY_PRESETS.map((preset) => ({
    value: preset.value,
    label: preset.label,
    description: preset.description,
    iconClass: "i-lucide-shield-minus",
}));

const novelAiGuidanceControls: Array<{key: Extract<NovelAiNumberKey, "promptGuidance" | "promptGuidanceRescale">; label: string; min: number; max: number; step: number}> = [
    {key: "promptGuidance", label: "Prompt Guidance", min: 0, max: 20, step: 0.1},
    {key: "promptGuidanceRescale", label: "Prompt Guidance Rescale", min: 0, max: 1, step: 0.01},
];

const styleFieldGroups: Array<{key: StyleTextFieldKey; label: string; placeholder: string}> = [
    {key: "positivePrefix", label: "固定正面 prompt 前缀", placeholder: "例如：masterpiece, best quality"},
    {key: "positiveSuffix", label: "固定正面 prompt 后缀", placeholder: "例如：cinematic lighting, detailed background"},
    {key: "negativePrefix", label: "固定负面 prompt 前缀", placeholder: "例如：lowres, bad anatomy"},
    {key: "negativeSuffix", label: "固定负面 prompt 后缀", placeholder: "例如：watermark, text, blurry"},
];

const characterTextFields: Array<{key: TextToImageCharacterTagKey; label: string; rows: number; placeholder: string}> = [
    {key: "profileTraits", label: "角色特征（描述性格和年龄）", rows: 3, placeholder: "例如：calm, clever, 18 years old"},
    {key: "facialAppearance", label: "五官外貌", rows: 3, placeholder: "正面五官、发色、瞳色、表情等"},
    {key: "facialBack", label: "五官外貌背面", rows: 2, placeholder: "背面视角可见的头发、轮廓等"},
    {key: "upperSfw", label: "上半身SFW", rows: 3, placeholder: "上半身服装、姿态、配饰"},
    {key: "upperBackSfw", label: "上半身背面SFW", rows: 3, placeholder: "背面上半身服装、发型、肩背细节"},
    {key: "lowerSfw", label: "下半身SFW", rows: 3, placeholder: "裙装、裤装、腿部、鞋袜等"},
    {key: "lowerBackSfw", label: "下半身背面SFW", rows: 3, placeholder: "背面下半身服装、鞋袜等"},
    {key: "upperNsfw", label: "上半身NSFW", rows: 3, placeholder: "上半身 NSFW tag"},
    {key: "upperBackNsfw", label: "上半身NSFW背面", rows: 3, placeholder: "背面上半身 NSFW tag"},
    {key: "lowerNsfw", label: "下半身NSFW", rows: 3, placeholder: "下半身 NSFW tag"},
    {key: "lowerBackNsfw", label: "下半身NSFW背面", rows: 3, placeholder: "背面下半身 NSFW tag"},
];

const characterDraftFields: Array<{label: string; apply: (draft: Partial<TextToImageCharacter>, value: string) => void}> = [
    {label: "角色中文名称", apply: (draft, value) => { draft.cnName = value; }},
    {label: "角色英文名称", apply: (draft, value) => { draft.enName = value; }},
    {label: "角色特征", apply: (draft, value) => { draft.profileTraits = value; }},
    {label: "五官外貌", apply: (draft, value) => { draft.facialAppearance = value; }},
    {label: "五官外貌背面", apply: (draft, value) => { draft.facialBack = value; }},
    {label: "上半身SFW", apply: (draft, value) => { draft.upperSfw = value; }},
    {label: "上半身背面SFW", apply: (draft, value) => { draft.upperBackSfw = value; }},
    {label: "下半身SFW", apply: (draft, value) => { draft.lowerSfw = value; }},
    {label: "下半身背面SFW", apply: (draft, value) => { draft.lowerBackSfw = value; }},
    {label: "上半身NSFW", apply: (draft, value) => { draft.upperNsfw = value; }},
    {label: "上半身NSFW背面", apply: (draft, value) => { draft.upperBackNsfw = value; }},
    {label: "下半身NSFW", apply: (draft, value) => { draft.lowerNsfw = value; }},
    {label: "下半身NSFW背面", apply: (draft, value) => { draft.lowerBackNsfw = value; }},
];

const llmParameterControls: Array<{key: LlmParameterKey; label: string; min: number; max: number; step: number}> = [
    {key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05},
    {key: "topP", label: "Top P", min: 0, max: 1, step: 0.05},
    {key: "maxTokens", label: "Max Tokens", min: 1, max: MAX_TEXT_TO_IMAGE_LLM_TOKENS, step: 100},
];

const promptTaskOptions = computed<SelectOption[]>(() => TEXT_TO_IMAGE_PROMPT_TASKS.map((task) => ({
    value: task.key,
    label: task.label,
    description: task.description,
    iconClass: "i-lucide-message-square-text",
})));

const activeTaskPrompt = computed(() => taskPrompts.value[selectedPromptTask.value]);

const activeStyleOptions = computed<SelectOption[]>(() => stylePresets.value.map((style) => ({
    value: style.id,
    label: style.name.trim() || "未命名画风串",
    description: style.id === activeStyleId.value ? "当前启用" : undefined,
    iconClass: "i-lucide-palette",
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
        {value: model, label: model, description: "当前模型未在连接返回列表中"},
        ...modelOptions,
    ];
});

const currentNovel = computed(() => novels.value.find((novel) => novel.id === currentNovelId.value || novel.projectPath === currentNovelId.value) ?? null);
const currentNovelTitle = computed(() => currentNovel.value?.title || currentNovelId.value || "未选择小说");
const sourceNovel = computed(() => novels.value.find((novel) => novel.id === sourceProjectPath.value || novel.projectPath === sourceProjectPath.value) ?? null);
const sourceProjectOptions = computed<SelectOption[]>(() => novels.value.map((novel) => ({
    value: novel.projectPath || novel.id,
    label: novel.title,
    description: novel.projectPath || novel.id,
    iconClass: "i-lucide-book-open",
})));
const sourceCharacterOptions = computed<SelectOption[]>(() => sourceCharacters.value.map((character) => ({
    value: character.path,
    label: character.title || character.path,
    description: character.summary || character.path,
    iconClass: "i-lucide-user-round",
})));
const selectedSourceCharacter = computed(() => sourceCharacters.value.find((character) => character.path === sourceCharacterPath.value) ?? null);
const generationCharacterName = computed(() => activeCharacter.value?.cnName.trim() || activeCharacter.value?.enName.trim() || "未选择角色");
const activeCharacterDisplayName = computed(() => activeCharacter.value ? formatCharacterName(activeCharacter.value) : "未选择角色");
const characterPromptDialogTitle = computed(() => characterPromptDialogMode.value === "photoPrompt" ? "生成图片提示词" : "修改角色提示词");
const characterPromptDialogDescription = computed(() => characterPromptDialogMode.value === "photoPrompt"
    ? "请输入角色照片的具体需求，AI 会结合当前角色 tag 生成可用于下方提示词框的图片 prompt。"
    : "请输入要修改角色 tag 的方向，AI 会重写下方角色详细参数中的 tag 字段。");
const generationPreviewPrompt = computed(() => mergePromptPreview(
    activeStyle.value?.positivePrefix,
    generationDraft.value.includeActiveCharacter ? buildGenerationCharacterPrompt(activeCharacter.value) : "",
    generationDraft.value.prompt,
    activeStyle.value?.positiveSuffix,
));
const generationPreviewNegativePrompt = computed(() => mergePromptPreview(
    activeStyle.value?.negativePrefix,
    generationDraft.value.negativePrompt,
    activeStyle.value?.negativeSuffix,
));
const canGenerateTextToImage = computed(() => {
    return !generatingImage.value && novelAi.value.token.trim().length > 0 && generationPreviewPrompt.value.trim().length > 0;
});

watch(currentNovelId, (projectPath) => {
    store.setCurrentProjectPath(projectPath);
    if (!sourceProjectPath.value && projectPath) {
        sourceProjectPath.value = projectPath;
    }
}, {immediate: true});

watch(novels, () => {
    if (!sourceProjectPath.value) {
        sourceProjectPath.value = currentNovelId.value || novels.value[0]?.projectPath || novels.value[0]?.id || "";
    }
});

onMounted(async () => {
    store.ensureDefaults();
    if (novels.value.length === 0) {
        try {
            await novelIdeStore.loadNovels();
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, "读取小说列表失败"));
        }
    }
    if (!sourceProjectPath.value) {
        sourceProjectPath.value = currentNovelId.value || novels.value[0]?.projectPath || novels.value[0]?.id || "";
    }
    if (sourceProjectPath.value) {
        await loadSourceCharacters(sourceProjectPath.value);
    }
});

/**
 * 判断面板区块是否折叠。
 */
function isSectionCollapsed(section: TextToImagePanelSection): boolean {
    return collapsedSections.value[section];
}

/**
 * 切换面板区块折叠状态。
 */
function toggleSection(section: TextToImagePanelSection): void {
    collapsedSections.value = {
        ...collapsedSections.value,
        [section]: !collapsedSections.value[section],
    };
}

/**
 * 调用服务端 NovelAI 文生图接口。
 */
async function generateTextToImage(): Promise<void> {
    if (generatingImage.value) {
        return;
    }
    generationError.value = "";
    generationWarnings.value = [];
    if (!novelAi.value.token.trim()) {
        generationError.value = "请先配置 NovelAI Persistent Token";
        notification.error(generationError.value);
        return;
    }
    if (!generationPreviewPrompt.value.trim()) {
        generationError.value = "请先填写本次正面 prompt";
        notification.error(generationError.value);
        return;
    }

    generatingImage.value = true;
    try {
        const result = await $fetch<TextToImageGenerateResponse>("/api/text-to-image/generate", {
            method: "POST",
            body: {
                novelAi: novelAi.value,
                style: activeStyle.value,
                character: generationDraft.value.includeActiveCharacter ? activeCharacter.value : null,
                prompt: generationDraft.value.prompt,
                negativePrompt: generationDraft.value.negativePrompt,
                output: output.value,
            },
        });
        store.prependGenerationResults(result.images);
        generationWarnings.value = result.warnings;
        lastGenerationRequest.value = result.request;
        notification.success(`生成完成，已保存 ${result.images.length} 张图片`);
    } catch (error) {
        generationError.value = resolveApiErrorMessage(error, "文生图生成失败");
        notification.error(generationError.value);
    } finally {
        generatingImage.value = false;
    }
}

/**
 * 使用当前角色照片 prompt 调用现有 NovelAI 生图接口，并把首张结果保存为角色头像。
 */
async function generateActiveCharacterImage(): Promise<void> {
    const character = activeCharacter.value;
    if (!character || generatingCharacterImage.value) {
        return;
    }
    const prompt = character.photoPrompt.trim();
    if (!novelAi.value.token.trim()) {
        notification.error("请先配置 NovelAI Persistent Token");
        return;
    }
    if (!prompt) {
        notification.error("请先填写或生成角色照片提示词");
        return;
    }

    generatingCharacterImage.value = true;
    try {
        const result = await $fetch<TextToImageGenerateResponse>("/api/text-to-image/generate", {
            method: "POST",
            body: {
                novelAi: novelAi.value,
                style: activeStyle.value,
                character,
                prompt,
                negativePrompt: generationDraft.value.negativePrompt,
                output: output.value,
            },
        });
        store.prependGenerationResults(result.images);
        generationWarnings.value = result.warnings;
        lastGenerationRequest.value = result.request;
        const portrait = result.images[0]?.dataUrl ?? "";
        if (portrait) {
            store.updateCharacter(character.id, {portraitDataUrl: portrait});
        }
        notification.success(`角色照片已生成并保存：${result.images[0]?.fileName ?? "图片"}`);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "角色照片生成失败"));
    } finally {
        generatingCharacterImage.value = false;
    }
}

/**
 * 打开角色头像本地上传选择器。
 */
function openCharacterPhotoDialog(): void {
    characterPhotoInputRef.value?.click();
}

/**
 * 将本地图片保存为当前角色头像。
 */
async function importCharacterPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file || !activeCharacter.value) {
        return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    store.updateCharacter(activeCharacter.value.id, {portraitDataUrl: dataUrl});
}

/**
 * 切换是否把角色照片作为后续请求上下文发送。
 */
function toggleActiveCharacterSendPhoto(): void {
    if (!activeCharacter.value) {
        return;
    }
    store.updateCharacter(activeCharacter.value.id, {sendPhoto: !activeCharacter.value.sendPhoto});
}

/**
 * 打开生成角色照片 prompt 的小窗口。
 */
function openCharacterPhotoPromptDialog(): void {
    openCharacterPromptDialog("photoPrompt");
}

/**
 * 打开修改角色详细 tag 的小窗口。
 */
function openCharacterRevisionDialog(): void {
    openCharacterPromptDialog("revision");
}

function openCharacterPromptDialog(mode: CharacterPromptDialogMode): void {
    if (!activeCharacter.value) {
        notification.error("请先选择角色");
        return;
    }
    characterPromptDialogMode.value = mode;
    characterPromptRequirement.value = "";
    characterPromptReferences.value = [];
    characterPromptError.value = "";
    characterPromptDialogOpen.value = true;
}

function openCharacterPromptReferenceDialog(): void {
    characterPromptReferenceInputRef.value?.click();
}

async function importCharacterPromptReferences(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) {
        return;
    }
    const references = await Promise.all(files.map(async (file) => ({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        dataUrl: await readFileAsDataUrl(file),
    })));
    characterPromptReferences.value = [
        ...characterPromptReferences.value,
        ...references,
    ].slice(0, 6);
}

function removeCharacterPromptReference(id: string): void {
    characterPromptReferences.value = characterPromptReferences.value.filter((reference) => reference.id !== id);
}

/**
 * 确认小窗口：生成照片 prompt 或修改角色 tag。
 */
async function submitCharacterPromptDialog(): Promise<void> {
    if (characterPromptBusy.value || !activeCharacter.value) {
        return;
    }
    if (!llm.value.apiBaseUrl.trim() || !llm.value.model.trim()) {
        characterPromptError.value = "请先在 LLM 大模型区连接并选择模型";
        return;
    }
    if (!characterPromptRequirement.value.trim()) {
        characterPromptError.value = "请填写具体需求";
        return;
    }

    characterPromptBusy.value = true;
    characterPromptError.value = "";
    try {
        if (characterPromptDialogMode.value === "photoPrompt") {
            const prompt = await requestCharacterPhotoPrompt(activeCharacter.value, characterPromptRequirement.value, characterPromptReferences.value);
            store.updateCharacter(activeCharacter.value.id, {photoPrompt: prompt});
            notification.success("角色照片提示词已生成");
        } else {
            const content = await requestCharacterRevision(activeCharacter.value, characterPromptRequirement.value);
            const draft = parseCharacterDraft(content);
            const patch = buildCharacterTagPatch(draft);
            if (Object.keys(patch).length === 0) {
                throw new Error("LLM 没有返回可用的角色 tag 字段");
            }
            store.updateCharacter(activeCharacter.value.id, patch);
            notification.success("角色详细 tag 已更新");
        }
        characterPromptDialogOpen.value = false;
    } catch (error) {
        characterPromptError.value = resolveApiErrorMessage(error, characterPromptDialogMode.value === "photoPrompt" ? "生成图片提示词失败" : "修改角色提示词失败");
    } finally {
        characterPromptBusy.value = false;
    }
}

/**
 * 通过本机目录选择器设置返回图片保存路径。
 */
async function selectOutputDirectory(): Promise<void> {
    if (selectingOutputPath.value) {
        return;
    }
    selectingOutputPath.value = true;
    try {
        const result = await $fetch<SelectOutputDirectoryResponse>("/api/text-to-image/select-output-directory", {
            method: "POST",
            body: {
                currentPath: output.value.imageSavePath,
            },
        });
        if (result.path) {
            store.updateOutputSettings({imageSavePath: result.path});
            notification.success("已设置返回图片保存路径");
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "选择保存路径失败"));
    } finally {
        selectingOutputPath.value = false;
    }
}

/**
 * 更新当前画风串的字段。
 */
function updateActiveStyleField(key: StyleTextFieldKey, value: string): void {
    if (!activeStyle.value) {
        return;
    }
    const patch: Partial<TextToImageStylePreset> = {[key]: value};
    store.updateStylePreset(activeStyle.value.id, patch);
}

/**
 * 切换当前画风串的布尔配置。
 */
function toggleActiveStyleBoolean(key: StyleBooleanKey): void {
    if (!activeStyle.value) {
        return;
    }
    store.updateStylePreset(activeStyle.value.id, {
        [key]: !activeStyle.value[key],
    } as Partial<TextToImageStylePreset>);
}

/**
 * 更新当前画风串的负面质量预设。
 */
function updateActiveStyleNegativeQualityPreset(value: string): void {
    if (!activeStyle.value) {
        return;
    }
    const preset = TEXT_TO_IMAGE_NEGATIVE_QUALITY_PRESETS.find((item) => item.value === value);
    store.updateStylePreset(activeStyle.value.id, {
        negativeQualityPreset: preset?.value ?? "none",
    });
}

/**
 * 更新 NovelAI 数值参数。
 */
function updateNovelAiNumber(key: NovelAiNumberKey, value: string | number): void {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
        return;
    }
    store.updateNovelAiSettings({[key]: nextValue} as Partial<NovelAiApiSettings>);
}

/**
 * 更新 NovelAI 尺寸预设，并同步官方宽高。
 */
function updateNovelAiSizePreset(value: string): void {
    const preset = TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS.find((item) => item.value === value);
    if (!preset || preset.value === "custom") {
        store.updateNovelAiSettings({sizePreset: "custom"});
        return;
    }
    store.updateNovelAiSettings({
        sizePreset: preset.value,
        width: preset.width,
        height: preset.height,
    });
}

/**
 * 手动修改宽高时切换为 Custom 预设。
 */
function updateNovelAiDimension(key: NovelAiDimensionKey, value: string | number): void {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
        return;
    }
    store.updateNovelAiSettings({
        [key]: nextValue,
        sizePreset: "custom",
    } as Partial<NovelAiApiSettings>);
}

/**
 * 格式化 NovelAI 参数显示。
 */
function formatNovelAiNumber(key: NovelAiNumberKey): string {
    const value = novelAi.value[key];
    if (key === "width" || key === "height" || key === "steps" || key === "seed") {
        return String(Math.round(value));
    }
    return value.toFixed(2);
}

/**
 * 切换 NovelAI 布尔参数。
 */
function toggleNovelAiBoolean(key: NovelAiBooleanKey): void {
    store.updateNovelAiSettings({[key]: !novelAi.value[key]} as Partial<NovelAiApiSettings>);
}

/**
 * 新增当前画风串的 Vibe 参考。
 */
function addActiveStyleVibeReference(): void {
    if (!activeStyle.value) {
        return;
    }
    store.addStyleVibeReference(activeStyle.value.id);
}

/**
 * 更新当前画风串的 Vibe 参考。
 */
function updateActiveStyleVibeReference(vibeId: string, patch: Partial<TextToImageVibeReference>): void {
    if (!activeStyle.value) {
        return;
    }
    store.updateStyleVibeReference(activeStyle.value.id, vibeId, patch);
}

/**
 * 更新 Vibe 来源类型。
 */
function updateVibeSourceType(vibeId: string, value: string): void {
    const sourceType = vibeSourceTypeOptions.some((option) => option.value === value) ? value as VibeSourceType : "rawImage";
    updateActiveStyleVibeReference(vibeId, {sourceType});
}

/**
 * 更新当前画风串的 Vibe 数值参数。
 */
function updateVibeNumber(vibeId: string, key: VibeNumberKey, value: string | number): void {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
        return;
    }
    updateActiveStyleVibeReference(vibeId, {[key]: nextValue});
}

/**
 * 删除当前画风串的 Vibe 参考。
 */
function deleteActiveStyleVibeReference(vibeId: string): void {
    if (!activeStyle.value) {
        return;
    }
    store.deleteStyleVibeReference(activeStyle.value.id, vibeId);
}

/**
 * 百分比参数显示。
 */
function formatRatio(value: number): string {
    return `${Math.round(value * 100)}%`;
}

/**
 * 拼接生成预览 prompt。
 */
function mergePromptPreview(...parts: Array<string | null | undefined>): string {
    return parts
        .map((part) => (part ?? "").trim().replace(/^,+|,+$/gu, ""))
        .filter((part) => part.length > 0)
        .join(", ");
}

/**
 * 生成当前角色的 SFW 正面 tag 片段。
 */
/**
 * 角色列表和详情页签使用的稳定显示名。
 */
function formatCharacterName(character: TextToImageCharacter): string {
    return character.cnName.trim() || character.enName.trim() || "未命名角色";
}

function buildGenerationCharacterPrompt(character: TextToImageCharacter | null): string {
    if (!character) {
        return "";
    }
    return mergePromptPreview(
        character.enName,
        character.profileTraits,
        character.facialAppearance,
        character.upperSfw,
        character.lowerSfw,
    );
}

/**
 * 格式化生成图片大小。
 */
function formatImageBytes(byteLength: number): string {
    if (byteLength < 1024) {
        return `${byteLength} B`;
    }
    if (byteLength < 1024 * 1024) {
        return `${(byteLength / 1024).toFixed(1)} KB`;
    }
    return `${(byteLength / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 格式化生成时间。
 */
function formatGenerationTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString("zh-CN", {hour12: false});
}

/**
 * 更新当前角色的 tag 字段。
 */
function updateActiveCharacterField(key: TextToImageCharacterTagKey, value: string): void {
    if (!activeCharacter.value) {
        return;
    }
    const patch: Partial<TextToImageCharacter> = {[key]: value};
    store.updateCharacter(activeCharacter.value.id, patch);
}

/**
 * 新增并启用一条画风串。
 */
function addStylePreset(): void {
    store.addStylePreset();
}

/**
 * 复制当前启用的画风串。
 */
function duplicateActiveStyle(): void {
    if (activeStyle.value) {
        store.duplicateStylePreset(activeStyle.value.id);
    }
}

/**
 * 删除当前启用的画风串。
 */
function deleteActiveStyle(): void {
    if (!activeStyle.value || stylePresets.value.length <= 1) {
        return;
    }
    store.deleteStylePreset(activeStyle.value.id);
}

/**
 * 在中间主工作区打开 LLM 详细配置分页。
 */
function openLlmWorkspace(): void {
    novelIdeStore.openTextToImageLlmTab();
}

/**
 * 新建角色并进入编辑状态。
 */
function addCharacter(): void {
    const character = store.addCharacter();
    openCharacterWorkspace(character);
}

/**
 * 在中间主工作区打开文生图角色详情分页。
 */
function openCharacterWorkspace(character: TextToImageCharacter): void {
    store.selectCharacter(character.id);
    novelIdeStore.openTextToImageCharacterTab({
        projectPath: currentProjectPath.value,
        characterId: character.id,
        title: formatCharacterName(character),
    });
}

/**
 * 删除当前选中的角色。
 */
function deleteActiveCharacter(): void {
    if (!activeCharacter.value) {
        return;
    }
    store.deleteCharacter(activeCharacter.value.id);
}

/**
 * 更新 LLM 参数。
 */
function updateLlmParameter(key: LlmParameterKey, value: string | number): void {
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

/**
 * 格式化参数显示。
 */
function formatLlmParameter(key: LlmParameterKey): string {
    const value = llm.value.parameters[key];
    return key === "maxTokens" ? String(Math.round(value)) : value.toFixed(2);
}

/**
 * 更新 LLM API 地址，并清空旧连接结果。
 */
function updateLlmApiBaseUrl(apiBaseUrl: string): void {
    store.updateLlmSettings({
        apiBaseUrl,
        availableModels: [],
        model: "",
    });
    llmConnectionStatus.value = "idle";
    llmConnectionMessage.value = "";
}

/**
 * 更新 LLM API Key，并清空旧连接结果。
 */
function updateLlmApiKey(apiKey: string): void {
    store.updateLlmSettings({
        apiKey,
        availableModels: [],
        model: "",
    });
    llmConnectionStatus.value = "idle";
    llmConnectionMessage.value = "";
}

/**
 * 连接 LLM 服务并读取可用模型列表。
 */
async function connectLlm(): Promise<void> {
    if (connectingLlm.value) {
        return;
    }
    if (!llm.value.apiBaseUrl.trim()) {
        llmConnectionStatus.value = "failed";
        llmConnectionMessage.value = "连接失败";
        return;
    }
    connectingLlm.value = true;
    llmConnectionStatus.value = "idle";
    llmConnectionMessage.value = "";
    try {
        const models = await requestAvailableModels();
        if (models.length === 0) {
            throw new Error("模型列表为空");
        }
        const nextModel = models.includes(llm.value.model.trim()) ? llm.value.model.trim() : models[0] ?? "";
        store.updateLlmSettings({
            availableModels: models,
            model: nextModel,
        });
        llmConnectionStatus.value = "success";
        llmConnectionMessage.value = `连接成功，已读取 ${models.length} 个模型`;
    } catch {
        store.updateLlmSettings({
            availableModels: [],
            model: "",
        });
        llmConnectionStatus.value = "failed";
        llmConnectionMessage.value = "连接失败";
    } finally {
        connectingLlm.value = false;
    }
}

/**
 * 请求 OpenAI-compatible 模型列表接口。
 */
async function requestAvailableModels(): Promise<string[]> {
    const apiBaseUrl = llm.value.apiBaseUrl.trim().replace(/\/+$/, "");
    const headers: HeadersInit = {};
    if (llm.value.apiKey.trim()) {
        headers.Authorization = `Bearer ${llm.value.apiKey.trim()}`;
    }
    const response = await fetch(`${apiBaseUrl}/models`, {
        method: "GET",
        headers,
    });
    if (!response.ok) {
        throw new Error("连接失败");
    }
    const data = await response.json() as ModelListResponse;
    const entries = Array.isArray(data) ? data : [
        ...(data.data ?? []),
        ...(data.models ?? []),
    ];
    const models = entries
        .map((entry) => readModelId(entry))
        .filter((model): model is string => model.length > 0);
    return Array.from(new Set(models)).sort((left, right) => left.localeCompare(right));
}

/**
 * 从不同 provider 的模型条目中提取模型 ID。
 */
function readModelId(entry: ModelListEntry): string {
    if (typeof entry === "string") {
        return entry.trim();
    }
    return entry.id?.trim() || entry.model?.trim() || entry.name?.trim() || "";
}

/**
 * 切换任务提示词。
 */
function selectPromptTask(value: string): void {
    const matched = TEXT_TO_IMAGE_PROMPT_TASKS.find((task) => task.key === value);
    if (matched) {
        selectedPromptTask.value = matched.key;
    }
}

/**
 * 更新当前任务提示词文本。
 */
function updateSelectedTaskPrompt(prompt: string): void {
    store.updateTaskPrompt(selectedPromptTask.value, {
        prompt,
        importedName: activeTaskPrompt.value.importedName || "手动配置",
    });
}

/**
 * 打开提示词文件选择器。
 */
function openPromptFileDialog(): void {
    promptFileInputRef.value?.click();
}

/**
 * 从本地文本文件导入当前任务提示词。
 */
async function importPromptFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) {
        return;
    }
    const prompt = await file.text();
    store.importTaskPrompt(selectedPromptTask.value, prompt, file.name);
    notification.success(`已导入提示词：${file.name}`);
}

/**
 * 选择导入来源小说并刷新角色列表。
 */
async function selectSourceProject(projectPath: string): Promise<void> {
    sourceProjectPath.value = projectPath;
    sourceCharacterPath.value = "";
    sourceCharacters.value = [];
    await loadSourceCharacters(projectPath);
}

/**
 * 读取指定小说的角色内容节点。
 */
async function loadSourceCharacters(projectPath = sourceProjectPath.value): Promise<void> {
    if (!projectPath || sourceLoading.value) {
        return;
    }
    sourceLoading.value = true;
    sourceError.value = "";
    importStatus.value = "";
    try {
        const snapshot = await $fetch<WorkspaceTreeSnapshotDto<WorkspaceFileNode>>("/api/workspace-files/tree", {
            query: {projectPath},
        });
        const nextCharacters = snapshot.nodes
            .filter((node) => node.entryType === "character" && node.contentNode)
            .map((node) => ({
                path: node.path,
                title: node.title || node.path,
                summary: node.summary,
                indexPath: resolveContentIndexPath(node.path),
                statePath: node.state?.exists ? node.state.path : null,
            }))
            .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
        sourceCharacters.value = nextCharacters;
        sourceCharacterPath.value = nextCharacters.some((character) => character.path === sourceCharacterPath.value) ? sourceCharacterPath.value : nextCharacters[0]?.path ?? "";
    } catch (error) {
        sourceError.value = resolveApiErrorMessage(error, "读取小说角色失败");
    } finally {
        sourceLoading.value = false;
    }
}

/**
 * 从来源小说导入角色，并在可用时调用 LLM 生成 tag 草稿。
 */
async function importCharacterFromProject(): Promise<void> {
    const sourceCharacter = selectedSourceCharacter.value;
    if (!sourceProjectPath.value || !sourceCharacter || importingCharacter.value) {
        return;
    }
    importingCharacter.value = true;
    sourceError.value = "";
    importStatus.value = "";
    try {
        const [content, stateContent] = await Promise.all([
            readWorkspaceText(sourceProjectPath.value, sourceCharacter.indexPath),
            sourceCharacter.statePath ? readWorkspaceText(sourceProjectPath.value, sourceCharacter.statePath) : Promise.resolve(""),
        ]);
        const detail: SourceCharacterDetail = {
            ...sourceCharacter,
            projectPath: sourceProjectPath.value,
            novelTitle: sourceNovel.value?.title || sourceProjectPath.value,
            content,
            stateContent,
        };
        let generatedContent = "";
        let statusSuffix = "LLM 未配置，已先导入原始设定。";
        if (llm.value.apiBaseUrl.trim() && llm.value.model.trim()) {
            try {
                generatedContent = await requestCharacterDesign(detail);
                statusSuffix = "已调用 LLM 生成 tag 草稿。";
            } catch (error) {
                sourceError.value = resolveApiErrorMessage(error, "LLM 角色 tag 设计失败，已保留原始设定导入");
                statusSuffix = "LLM 调用失败，已导入原始设定。";
            }
        }
        const parsedDraft = generatedContent ? parseCharacterDraft(generatedContent) : {};
        const draftHasTag = Object.values(parsedDraft).some((value) => typeof value === "string" && value.trim().length > 0);
        const fallbackText = trimLongText([detail.summary, detail.content, detail.stateContent].filter((item) => item.trim()).join("\n\n"), 1200);
        const draft: Partial<TextToImageCharacter> = {
            ...parsedDraft,
            cnName: parsedDraft.cnName?.trim() || detail.title,
            profileTraits: parsedDraft.profileTraits?.trim() || detail.summary || fallbackText,
            facialAppearance: parsedDraft.facialAppearance?.trim() || (draftHasTag ? "" : generatedContent.trim()),
            sourceProjectPath: detail.projectPath,
            sourceNovelTitle: detail.novelTitle,
            sourceCharacterPath: detail.path,
        };
        const importedCharacter = store.addCharacterFromDraft(draft);
        openCharacterWorkspace(importedCharacter);
        importStatus.value = `已从《${detail.novelTitle}》导入「${detail.title}」。${statusSuffix}`;
        notification.success(`已导入角色：${detail.title}`);
    } catch (error) {
        sourceError.value = resolveApiErrorMessage(error, "导入角色失败");
    } finally {
        importingCharacter.value = false;
    }
}

/**
 * 调用 OpenAI-compatible chat completions 接口生成角色 tag。
 */
async function requestCharacterDesign(detail: SourceCharacterDetail): Promise<string> {
    const apiBaseUrl = llm.value.apiBaseUrl.trim().replace(/\/+$/, "");
    const headers: HeadersInit = {"Content-Type": "application/json"};
    if (llm.value.apiKey.trim()) {
        headers.Authorization = `Bearer ${llm.value.apiKey.trim()}`;
    }
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: llm.value.model.trim(),
            temperature: llm.value.parameters.temperature,
            top_p: llm.value.parameters.topP,
            max_tokens: llm.value.parameters.maxTokens,
            messages: [
                {
                    role: "system",
                    content: taskPrompts.value.characterDesign.prompt.trim() || "你是 NovelAI 角色与服装 tag 设计助手。",
                },
                {
                    role: "user",
                    content: buildCharacterDesignMessage(detail),
                },
            ],
        }),
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `LLM 请求失败：${response.status}`);
    }
    const data = await response.json() as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
        throw new Error("LLM 没有返回可用内容");
    }
    return content;
}

/**
 * 构造角色设计任务的用户消息。
 */
/**
 * 调用 LLM 生成当前角色照片的生图 prompt。
 */
async function requestCharacterPhotoPrompt(character: TextToImageCharacter, requirement: string, references: CharacterPromptReferenceImage[]): Promise<string> {
    const userContent: ChatCompletionContentPart[] = [
        {
            type: "text",
            text: buildCharacterPhotoPromptMessage(character, requirement, references.length),
        },
        ...references.map((reference) => ({
            type: "image_url" as const,
            image_url: {
                url: reference.dataUrl,
            },
        })),
    ];
    const content = await requestLlmChatCompletion([
        {
            role: "system",
            content: taskPrompts.value.characterDesign.prompt.trim() || "你是 NovelAI 角色照片 prompt 设计助手。",
        },
        {
            role: "user",
            content: userContent,
        },
    ]);
    return content.replace(/^```(?:text|txt|markdown)?/iu, "").replace(/```$/u, "").trim();
}

/**
 * 调用 LLM 按用户方向修改当前角色 tag。
 */
async function requestCharacterRevision(character: TextToImageCharacter, direction: string): Promise<string> {
    return await requestLlmChatCompletion([
        {
            role: "system",
            content: taskPrompts.value.characterRevision.prompt.trim() || "你是 NovelAI 角色 tag 修改助手。",
        },
        {
            role: "user",
            content: buildCharacterRevisionMessage(character, direction),
        },
    ]);
}

/**
 * 统一调用 OpenAI-compatible chat completions 接口。
 */
async function requestLlmChatCompletion(messages: ChatCompletionMessage[]): Promise<string> {
    const apiBaseUrl = llm.value.apiBaseUrl.trim().replace(/\/+$/, "");
    const headers: HeadersInit = {"Content-Type": "application/json"};
    if (llm.value.apiKey.trim()) {
        headers.Authorization = `Bearer ${llm.value.apiKey.trim()}`;
    }
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: llm.value.model.trim(),
            temperature: llm.value.parameters.temperature,
            top_p: llm.value.parameters.topP,
            max_tokens: llm.value.parameters.maxTokens,
            messages,
        }),
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `LLM 请求失败：${response.status}`);
    }
    const data = await response.json() as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
        throw new Error("LLM 没有返回可用内容");
    }
    return content;
}

function buildCharacterDesignMessage(detail: SourceCharacterDetail): string {
    const fieldList = characterDraftFields.map((field) => `${field.label}:`).join("\n");
    return [
        "请根据以下小说角色设定，输出用于 NovelAI 文生图的英文 tag 草稿。",
        "只输出下列字段，字段名必须保持一致；每个字段后填写逗号分隔的英文 tag 或短句。",
        "",
        fieldList,
        "",
        `来源小说：${detail.novelTitle}`,
        `角色标题：${detail.title}`,
        `角色摘要：${detail.summary || "无"}`,
        "",
        "角色设定正文：",
        detail.content,
        detail.stateContent ? ["", "角色状态补充：", detail.stateContent].join("\n") : "",
    ].filter((item) => item.length > 0).join("\n");
}

/**
 * 解析 LLM 按字段返回的角色 tag 草稿。
 */
/**
 * 构造角色照片 prompt 生成任务。
 */
function buildCharacterPhotoPromptMessage(character: TextToImageCharacter, requirement: string, referenceCount: number): string {
    return [
        "请根据当前角色 tag 和用户需求，生成一段可直接用于 NovelAI 的英文图片 prompt。",
        "只输出 prompt 本文，不要解释，不要 Markdown。",
        "prompt 应包含角色身份、外貌、服装、镜头、构图、背景和氛围；用英文逗号分隔 tag。",
        referenceCount > 0 ? `用户添加了 ${referenceCount} 张参考图片；如果模型可读取图片，请吸收其构图、姿势、服装或氛围，但不要改变角色核心设定。` : "",
        "",
        `角色名称：${formatCharacterName(character)}`,
        `英文名：${character.enName || "无"}`,
        `角色特征：${character.profileTraits || "无"}`,
        `五官外貌：${character.facialAppearance || "无"}`,
        `上半身SFW：${character.upperSfw || "无"}`,
        `下半身SFW：${character.lowerSfw || "无"}`,
        "",
        "用户关于角色照片的具体需求：",
        requirement,
    ].filter((item) => item.length > 0).join("\n");
}

/**
 * 构造角色 tag 修改任务。
 */
function buildCharacterRevisionMessage(character: TextToImageCharacter, direction: string): string {
    const fieldList = characterDraftFields
        .filter((field) => field.label !== "角色中文名称" && field.label !== "角色英文名称")
        .map((field) => `${field.label}:`)
        .join("\n");
    return [
        "请根据用户修改方向，重写当前角色的 NovelAI 英文 tag 字段。",
        "只输出下列字段，字段名必须完全一致；不要输出解释。",
        "没有变化的字段也可以保留原值。",
        "",
        fieldList,
        "",
        `角色中文名称: ${character.cnName}`,
        `角色英文名称: ${character.enName}`,
        `角色特征: ${character.profileTraits}`,
        `五官外貌: ${character.facialAppearance}`,
        `五官外貌背面: ${character.facialBack}`,
        `上半身SFW: ${character.upperSfw}`,
        `上半身背面SFW: ${character.upperBackSfw}`,
        `下半身SFW: ${character.lowerSfw}`,
        `下半身背面SFW: ${character.lowerBackSfw}`,
        `上半身NSFW: ${character.upperNsfw}`,
        `上半身NSFW背面: ${character.upperBackNsfw}`,
        `下半身NSFW: ${character.lowerNsfw}`,
        `下半身NSFW背面: ${character.lowerBackNsfw}`,
        "",
        "用户修改方向：",
        direction,
    ].join("\n");
}

/**
 * 只把 LLM 返回内容写回角色详细 tag 字段。
 */
function buildCharacterTagPatch(draft: Partial<TextToImageCharacter>): Partial<TextToImageCharacter> {
    const patch: Partial<TextToImageCharacter> = {};
    for (const field of characterTextFields) {
        const value = draft[field.key];
        if (typeof value === "string" && value.trim()) {
            patch[field.key] = value;
        }
    }
    return patch;
}

function parseCharacterDraft(content: string): Partial<TextToImageCharacter> {
    const draft: Partial<TextToImageCharacter> = {};
    for (const field of characterDraftFields) {
        const value = readDraftField(content, field.label);
        if (value) {
            field.apply(draft, value);
        }
    }
    return draft;
}

/**
 * 从 LLM 文本中读取单个字段。
 */
function readDraftField(content: string, label: string): string {
    const labelPattern = characterDraftFields.map((field) => escapeRegExp(field.label)).join("|");
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${escapeRegExp(label)}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[:：]|$)`, "i");
    return content.match(pattern)?.[1]?.trim() ?? "";
}

/**
 * 转义正则表达式特殊字符。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 读取工作区文本文件。
 */
async function readWorkspaceText(projectPath: string, path: string): Promise<string> {
    const result = await $fetch<WorkspaceReadResponse>("/api/workspace-files/read", {
        query: {projectPath, path},
    });
    return result.content;
}

/**
 * 将内容节点路径转换为 index.md 路径。
 */
function resolveContentIndexPath(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    if (normalized.endsWith(".md")) {
        return normalized;
    }
    return `${normalized.replace(/\/?$/, "/")}index.md`;
}

/**
 * 截断导入兜底文本。
 */
function trimLongText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}...`;
}

/**
 * 读取本地图片为 Data URL，用于头像和参考图预览。
 */
function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(typeof reader.result === "string" ? reader.result : "");
        };
        reader.onerror = () => {
            reject(reader.error ?? new Error("读取图片失败"));
        };
        reader.readAsDataURL(file);
    });
}
</script>

<template>
    <!-- 文生图配置面板 -->
    <div class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        <div class="shrink-0 border-b border-[var(--border-color)] px-3 py-2">
            <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <h2 class="truncate text-[13px] font-semibold text-[var(--text-main)]">文生图配置</h2>
                    <p class="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">当前小说：{{ currentNovelTitle }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <IconButton title="设置返回图片保存路径" size="sm" :class="outputSettingsOpen ? '!bg-[var(--accent-bg)] !text-[var(--accent-text)]' : ''" @click="outputSettingsOpen = !outputSettingsOpen">
                        <span class="i-lucide-settings h-3.5 w-3.5"></span>
                    </IconButton>
                    <span class="i-lucide-image h-5 w-5 text-[var(--accent-main)]"></span>
                </div>
            </div>
            <div v-if="outputSettingsOpen" class="mt-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/70 p-2">
                <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <label class="block min-w-0">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">返回图片保存路径</span>
                        <FormInput :model-value="output.imageSavePath" readonly placeholder="尚未选择本地文件夹" />
                    </label>
                    <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-60" :disabled="selectingOutputPath" @click="selectOutputDirectory">
                        <span class="h-3.5 w-3.5" :class="selectingOutputPath ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-folder-open'"></span>
                        <span>{{ selectingOutputPath ? "选择中" : "选择目录" }}</span>
                    </button>
                </div>
                <p class="mt-1 text-[10px] text-[var(--text-muted)]">
                    请选择本机文件夹；后续发送 NovelAI 请求并接收图片时会用这个本地路径保存结果。
                </p>
            </div>
        </div>

        <div class="custom-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-y-scroll px-3 py-3" style="scrollbar-gutter: stable;">
            <!-- 生成请求 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" :aria-expanded="!isSectionCollapsed('generation')" @click="toggleSection('generation')">
                        <span class="i-lucide-wand-sparkles h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">生成请求</h3>
                        <span class="h-3.5 w-3.5 text-[var(--text-muted)]" :class="isSectionCollapsed('generation') ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"></span>
                    </button>
                    <div class="flex w-[5.75rem] items-center justify-end">
                        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--accent-main)] px-2 text-[11px] text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)] disabled:cursor-not-allowed disabled:border-[var(--border-color)] disabled:text-[var(--text-muted)]" :disabled="!canGenerateTextToImage" @click.stop="generateTextToImage">
                            <span class="h-3.5 w-3.5" :class="generatingImage ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-send'"></span>
                            <span>{{ generatingImage ? "生成中" : "生成" }}</span>
                        </button>
                    </div>
                </div>

                <div v-if="!isSectionCollapsed('generation')" class="space-y-3 px-3 py-3">
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">本次正面 prompt</span>
                        <FormTextarea :model-value="generationDraft.prompt" :rows="5" placeholder="输入正文图片生成结果或直接输入 NovelAI tag" @update:model-value="store.updateGenerationDraft({prompt: $event})" />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">本次负面 prompt</span>
                        <FormTextarea :model-value="generationDraft.negativePrompt" :rows="3" placeholder="可留空，由画风串负面前后缀和负面预设补足" @update:model-value="store.updateGenerationDraft({negativePrompt: $event})" />
                    </label>

                    <button
                        type="button"
                        class="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                        :class="generationDraft.includeActiveCharacter ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)]/50 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                        :aria-pressed="generationDraft.includeActiveCharacter"
                        @click="store.updateGenerationDraft({includeActiveCharacter: !generationDraft.includeActiveCharacter})"
                    >
                        <span class="min-w-0">
                            <span class="block truncate">加入当前角色：{{ generationCharacterName }}</span>
                            <span class="mt-0.5 block text-[10px]" :class="generationDraft.includeActiveCharacter ? 'text-[var(--accent-text)] opacity-80' : 'text-[var(--text-muted)]'">{{ generationDraft.includeActiveCharacter ? "已开启" : "已关闭" }}</span>
                        </span>
                        <span class="relative h-4 w-8 rounded-full transition-colors" :class="generationDraft.includeActiveCharacter ? 'bg-[var(--accent-main)]' : 'bg-[var(--border-color)]'">
                            <span class="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-panel)] shadow transition-transform" :class="generationDraft.includeActiveCharacter ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
                        </span>
                    </button>

                    <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                        <div class="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-muted)]">
                            <span class="min-w-0 truncate">模型：{{ novelAi.model }}</span>
                            <span class="min-w-0 truncate text-right">{{ novelAi.width }} x {{ novelAi.height }} · {{ novelAi.steps }} steps</span>
                            <span class="min-w-0 truncate">画风：{{ activeStyle?.name || "未命名画风串" }}</span>
                            <span class="min-w-0 truncate text-right">保存：{{ output.imageSavePath || "默认图片目录" }}</span>
                        </div>
                        <div class="space-y-1 border-t border-[var(--border-color)] pt-2">
                            <p class="line-clamp-3 text-[11px] text-[var(--text-secondary)]">正面：{{ generationPreviewPrompt || "空" }}</p>
                            <p class="line-clamp-2 text-[11px] text-[var(--text-muted)]">负面：{{ generationPreviewNegativePrompt || "空" }}</p>
                        </div>
                    </div>

                    <p v-if="generationError" class="text-[11px] text-[var(--danger-text)]">{{ generationError }}</p>
                    <div v-if="generationWarnings.length > 0" class="space-y-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-2 py-1.5">
                        <p v-for="warning in generationWarnings" :key="warning" class="text-[11px] text-[var(--text-muted)]">{{ warning }}</p>
                    </div>

                    <div v-if="lastGenerationRequest" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                        上次请求：{{ lastGenerationRequest.model }} · seed {{ lastGenerationRequest.seed }} · {{ lastGenerationRequest.savedDirectory }}
                    </div>

                    <div class="space-y-2 border-t border-[var(--border-color)] pt-3">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-[11px] text-[var(--text-secondary)]">生成结果</span>
                            <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-60" :disabled="generationResults.length === 0" @click="store.clearGenerationResults">
                                <span class="i-lucide-eraser h-3.5 w-3.5"></span>
                                <span>清空</span>
                            </button>
                        </div>
                        <div v-if="generationResults.length === 0" class="rounded-md border border-dashed border-[var(--border-color)] px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                            暂无生成结果。
                        </div>
                        <div v-else class="space-y-3">
                            <div v-for="result in generationResults" :key="result.id" class="overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50">
                                <img :src="result.dataUrl" :alt="result.fileName" class="block aspect-[3/4] w-full bg-[var(--bg-input)] object-contain">
                                <div class="space-y-1.5 border-t border-[var(--border-color)] p-2">
                                    <div class="flex items-center justify-between gap-2">
                                        <span class="min-w-0 truncate text-[11px] font-medium text-[var(--text-main)]">{{ result.fileName }}</span>
                                        <span class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ formatImageBytes(result.byteLength) }}</span>
                                    </div>
                                    <p class="truncate text-[10px] text-[var(--text-muted)]">{{ formatGenerationTime(result.createdAt) }} · {{ result.model }} · seed {{ result.seed }}</p>
                                    <p class="truncate text-[10px] text-[var(--text-muted)]">{{ result.savedPath }}</p>
                                    <p class="line-clamp-2 text-[10px] text-[var(--text-secondary)]">{{ result.prompt }}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- NovelAI API 配置 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" :aria-expanded="!isSectionCollapsed('novelAi')" @click="toggleSection('novelAi')">
                        <span class="i-lucide-key-round h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">NovelAI API</h3>
                        <span class="h-3.5 w-3.5 text-[var(--text-muted)]" :class="isSectionCollapsed('novelAi') ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"></span>
                    </button>
                    <div class="w-[5.75rem]" aria-hidden="true"></div>
                </div>
                <div v-if="!isSectionCollapsed('novelAi')" class="space-y-2 px-3 py-3">
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">Persistent Token</span>
                        <FormInput :model-value="novelAi.token" type="password" placeholder="pst-..." @update:model-value="store.updateNovelAiSettings({token: $event})" />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">API Base URL</span>
                        <FormInput :model-value="novelAi.apiBaseUrl" placeholder="https://api.novelai.net" @update:model-value="store.updateNovelAiSettings({apiBaseUrl: $event})" />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">Image Base URL</span>
                        <FormInput :model-value="novelAi.imageBaseUrl" placeholder="https://image.novelai.net" @update:model-value="store.updateNovelAiSettings({imageBaseUrl: $event})" />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">默认模型</span>
                        <FormSelect :model-value="novelAi.model" :options="novelAiModelOptions" dropdown-direction="down" @update:model-value="store.updateNovelAiSettings({model: $event})" />
                    </label>

                    <div class="space-y-3 border-t border-[var(--border-color)] pt-3">
                        <div class="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                            <span class="i-lucide-sliders-horizontal h-3.5 w-3.5"></span>
                            <span>采样参数</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="block min-w-0">
                                <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">采样方法</span>
                                <FormSelect :model-value="novelAi.sampler" :options="novelAiSamplerOptions" dropdown-direction="down" @update:model-value="store.updateNovelAiSettings({sampler: $event})" />
                            </label>
                            <label class="block min-w-0">
                                <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">噪点表</span>
                                <FormSelect :model-value="novelAi.noiseSchedule" :options="novelAiNoiseScheduleOptions" dropdown-direction="down" @update:model-value="store.updateNovelAiSettings({noiseSchedule: $event})" />
                            </label>
                        </div>
                        <div v-for="control in novelAiGuidanceControls" :key="control.key" class="space-y-1.5">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-[11px] text-[var(--text-secondary)]">{{ control.label }}</span>
                                <span class="text-[11px] tabular-nums text-[var(--text-muted)]">{{ formatNovelAiNumber(control.key) }}</span>
                            </div>
                            <div class="grid grid-cols-[1fr_84px] items-center gap-2">
                                <input
                                    class="h-7 w-full accent-[var(--accent-main)]"
                                    type="range"
                                    :min="control.min"
                                    :max="control.max"
                                    :step="control.step"
                                    :value="novelAi[control.key]"
                                    @input="updateNovelAiNumber(control.key, ($event.target as HTMLInputElement).value)"
                                >
                                <FormInput
                                    :model-value="String(novelAi[control.key])"
                                    type="number"
                                    :min="String(control.min)"
                                    :max="String(control.max)"
                                    :step="String(control.step)"
                                    @update:model-value="updateNovelAiNumber(control.key, $event)"
                                />
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                class="grid min-h-10 grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                                :class="novelAi.aiDefaultCharacterPosition ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)]/50 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                :aria-pressed="novelAi.aiDefaultCharacterPosition"
                                @click="toggleNovelAiBoolean('aiDefaultCharacterPosition')"
                            >
                                <span class="min-w-0">
                                    <span class="block truncate">AI默认角色位置</span>
                                    <span class="mt-0.5 block text-[10px]" :class="novelAi.aiDefaultCharacterPosition ? 'text-[var(--accent-text)] opacity-80' : 'text-[var(--text-muted)]'">{{ novelAi.aiDefaultCharacterPosition ? "已开启" : "已关闭" }}</span>
                                </span>
                                <span class="relative h-4 w-8 rounded-full transition-colors" :class="novelAi.aiDefaultCharacterPosition ? 'bg-[var(--accent-main)]' : 'bg-[var(--border-color)]'">
                                    <span class="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-panel)] shadow transition-transform" :class="novelAi.aiDefaultCharacterPosition ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
                                </span>
                            </button>
                            <button
                                type="button"
                                class="grid min-h-10 grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                                :class="novelAi.variety ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)]/50 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                :aria-pressed="novelAi.variety"
                                @click="toggleNovelAiBoolean('variety')"
                            >
                                <span class="min-w-0">
                                    <span class="block truncate">多样性 Variety</span>
                                    <span class="mt-0.5 block text-[10px]" :class="novelAi.variety ? 'text-[var(--accent-text)] opacity-80' : 'text-[var(--text-muted)]'">{{ novelAi.variety ? "已开启" : "已关闭" }}</span>
                                </span>
                                <span class="relative h-4 w-8 rounded-full transition-colors" :class="novelAi.variety ? 'bg-[var(--accent-main)]' : 'bg-[var(--border-color)]'">
                                    <span class="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-panel)] shadow transition-transform" :class="novelAi.variety ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
                                </span>
                            </button>
                        </div>
                    </div>

                    <div class="space-y-3 border-t border-[var(--border-color)] pt-3">
                        <div class="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                            <span class="i-lucide-ruler h-3.5 w-3.5"></span>
                            <span>生成参数</span>
                        </div>
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">预设尺寸</span>
                            <FormSelect :model-value="novelAi.sizePreset" :options="novelAiSizePresetOptions" dropdown-direction="down" @update:model-value="updateNovelAiSizePreset" />
                        </label>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="block min-w-0">
                                <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">宽度 width</span>
                                <FormInput :model-value="String(novelAi.width)" type="number" min="64" max="4096" step="64" @update:model-value="updateNovelAiDimension('width', $event)" />
                            </label>
                            <label class="block min-w-0">
                                <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">高度 height</span>
                                <FormInput :model-value="String(novelAi.height)" type="number" min="64" max="4096" step="64" @update:model-value="updateNovelAiDimension('height', $event)" />
                            </label>
                        </div>
                        <div class="space-y-1.5">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-[11px] text-[var(--text-secondary)]">生成步数 steps</span>
                                <span class="text-[11px] tabular-nums text-[var(--text-muted)]">{{ formatNovelAiNumber('steps') }}</span>
                            </div>
                            <div class="grid grid-cols-[1fr_84px] items-center gap-2">
                                <input class="h-7 w-full accent-[var(--accent-main)]" type="range" min="1" max="50" step="1" :value="novelAi.steps" @input="updateNovelAiNumber('steps', ($event.target as HTMLInputElement).value)">
                                <FormInput :model-value="String(novelAi.steps)" type="number" min="1" max="50" step="1" @update:model-value="updateNovelAiNumber('steps', $event)" />
                            </div>
                        </div>
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">种子 seed（-1 为随机）</span>
                            <FormInput :model-value="String(novelAi.seed)" type="number" min="-1" max="4294967295" step="1" @update:model-value="updateNovelAiNumber('seed', $event)" />
                        </label>
                    </div>
                </div>
            </section>

            <!-- 画风串管理 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" :aria-expanded="!isSectionCollapsed('style')" @click="toggleSection('style')">
                        <span class="i-lucide-palette h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">画风串</h3>
                        <span class="h-3.5 w-3.5 text-[var(--text-muted)]" :class="isSectionCollapsed('style') ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"></span>
                    </button>
                    <div class="flex w-[5.75rem] items-center justify-end gap-1">
                        <IconButton title="新增画风串" size="sm" @click="addStylePreset">
                            <span class="i-lucide-plus h-3.5 w-3.5"></span>
                        </IconButton>
                        <IconButton title="复制当前画风串" size="sm" :disabled="!activeStyle" @click="duplicateActiveStyle">
                            <span class="i-lucide-copy h-3.5 w-3.5"></span>
                        </IconButton>
                        <IconButton title="删除当前画风串" size="sm" variant="danger" :disabled="stylePresets.length <= 1" @click="deleteActiveStyle">
                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                        </IconButton>
                    </div>
                </div>
                <div v-if="!isSectionCollapsed('style')" class="space-y-3 px-3 py-3">
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">当前启用</span>
                        <FormSelect :model-value="activeStyleId" :options="activeStyleOptions" dropdown-direction="down" @update:model-value="store.activateStylePreset($event)" />
                    </label>

                    <template v-if="activeStyle">
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">画风串名称</span>
                            <FormInput :model-value="activeStyle.name" placeholder="例如：水彩淡彩、厚涂赛璐璐" @update:model-value="store.updateStylePreset(activeStyle.id, {name: $event})" />
                        </label>

                        <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                            <div class="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                                <span class="i-lucide-badge-check h-3.5 w-3.5"></span>
                                <span>数据集与质量预设</span>
                            </div>
                            <div class="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    class="grid min-h-10 grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                                    :class="activeStyle.useFurryDataset ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]/70 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                    :aria-pressed="activeStyle.useFurryDataset"
                                    @click="toggleActiveStyleBoolean('useFurryDataset')"
                                >
                                    <span class="min-w-0">
                                        <span class="block truncate">添加Furry数据集</span>
                                        <span class="mt-0.5 block text-[10px]" :class="activeStyle.useFurryDataset ? 'text-[var(--accent-text)] opacity-80' : 'text-[var(--text-muted)]'">{{ activeStyle.useFurryDataset ? "已开启" : "已关闭" }}</span>
                                    </span>
                                    <span class="relative h-4 w-8 rounded-full transition-colors" :class="activeStyle.useFurryDataset ? 'bg-[var(--accent-main)]' : 'bg-[var(--border-color)]'">
                                        <span class="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-panel)] shadow transition-transform" :class="activeStyle.useFurryDataset ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    class="grid min-h-10 grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                                    :class="activeStyle.positiveQualityPreset ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]/70 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                    :aria-pressed="activeStyle.positiveQualityPreset"
                                    @click="toggleActiveStyleBoolean('positiveQualityPreset')"
                                >
                                    <span class="min-w-0">
                                        <span class="block truncate">正面质量预设</span>
                                        <span class="mt-0.5 block text-[10px]" :class="activeStyle.positiveQualityPreset ? 'text-[var(--accent-text)] opacity-80' : 'text-[var(--text-muted)]'">{{ activeStyle.positiveQualityPreset ? "已开启" : "已关闭" }}</span>
                                    </span>
                                    <span class="relative h-4 w-8 rounded-full transition-colors" :class="activeStyle.positiveQualityPreset ? 'bg-[var(--accent-main)]' : 'bg-[var(--border-color)]'">
                                        <span class="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-panel)] shadow transition-transform" :class="activeStyle.positiveQualityPreset ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
                                    </span>
                                </button>
                            </div>
                            <label class="block">
                                <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">负面质量预设</span>
                                <FormSelect :model-value="activeStyle.negativeQualityPreset" :options="negativeQualityPresetOptions" dropdown-direction="down" @update:model-value="updateActiveStyleNegativeQualityPreset" />
                            </label>
                        </div>

                        <label v-for="field in styleFieldGroups" :key="field.key" class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">{{ field.label }}</span>
                            <FormTextarea :model-value="activeStyle[field.key]" :rows="3" :placeholder="field.placeholder" @update:model-value="updateActiveStyleField(field.key, $event)" />
                        </label>

                        <div class="space-y-2 border-t border-[var(--border-color)] pt-3">
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                                    <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                                    <span class="truncate">Vibe组氛围转移</span>
                                    <span class="text-[10px] text-[var(--text-muted)]">{{ activeStyle.vibeReferences.length }}</span>
                                </div>
                                <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="addActiveStyleVibeReference">
                                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                    <span>新增 Vibe</span>
                                </button>
                            </div>

                            <div v-if="activeStyle.vibeReferences.length === 0" class="rounded-md border border-dashed border-[var(--border-color)] px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                                暂无 Vibe 参考。
                            </div>

                            <div v-else class="space-y-2">
                                <div v-for="vibe in activeStyle.vibeReferences" :key="vibe.id" class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                                    <div class="flex items-center justify-between gap-2">
                                        <label class="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                                            <input class="h-4 w-4 accent-[var(--accent-main)]" type="checkbox" :checked="vibe.enabled" @change="updateActiveStyleVibeReference(vibe.id, {enabled: ($event.target as HTMLInputElement).checked})">
                                            <span class="truncate">启用</span>
                                        </label>
                                        <IconButton title="删除 Vibe" size="sm" variant="danger" @click="deleteActiveStyleVibeReference(vibe.id)">
                                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                        </IconButton>
                                    </div>
                                    <label class="block">
                                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">名称</span>
                                        <FormInput :model-value="vibe.displayName" placeholder="例如：柔和水彩氛围" @update:model-value="updateActiveStyleVibeReference(vibe.id, {displayName: $event})" />
                                    </label>
                                    <label class="block">
                                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">来源类型</span>
                                        <FormSelect :model-value="vibe.sourceType" :options="vibeSourceTypeOptions" dropdown-direction="down" @update:model-value="updateVibeSourceType(vibe.id, $event)" />
                                    </label>
                                    <div class="space-y-1.5">
                                        <div class="flex items-center justify-between gap-2">
                                            <span class="text-[11px] text-[var(--text-secondary)]">Reference Strength</span>
                                            <span class="text-[11px] tabular-nums text-[var(--text-muted)]">{{ formatRatio(vibe.strength) }}</span>
                                        </div>
                                        <div class="grid grid-cols-[1fr_84px] items-center gap-2">
                                            <input class="h-7 w-full accent-[var(--accent-main)]" type="range" min="0" max="1" step="0.01" :value="vibe.strength" @input="updateVibeNumber(vibe.id, 'strength', ($event.target as HTMLInputElement).value)">
                                            <FormInput :model-value="String(vibe.strength)" type="number" min="0" max="1" step="0.01" @update:model-value="updateVibeNumber(vibe.id, 'strength', $event)" />
                                        </div>
                                    </div>
                                    <div class="space-y-1.5">
                                        <div class="flex items-center justify-between gap-2">
                                            <span class="text-[11px] text-[var(--text-secondary)]">Information Extracted</span>
                                            <span class="text-[11px] tabular-nums text-[var(--text-muted)]">{{ formatRatio(vibe.infoExtracted) }}</span>
                                        </div>
                                        <div class="grid grid-cols-[1fr_84px] items-center gap-2">
                                            <input class="h-7 w-full accent-[var(--accent-main)]" type="range" min="0" max="1" step="0.01" :value="vibe.infoExtracted" @input="updateVibeNumber(vibe.id, 'infoExtracted', ($event.target as HTMLInputElement).value)">
                                            <FormInput :model-value="String(vibe.infoExtracted)" type="number" min="0" max="1" step="0.01" @update:model-value="updateVibeNumber(vibe.id, 'infoExtracted', $event)" />
                                        </div>
                                    </div>
                                    <label class="block">
                                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">Vibe Encoding</span>
                                        <FormTextarea :model-value="vibe.vibeEncoding" :rows="3" placeholder="可粘贴 .naiv4vibe 或 PNG 中提取的预编码数据" @update:model-value="updateActiveStyleVibeReference(vibe.id, {vibeEncoding: $event})" />
                                    </label>
                                    <label class="block">
                                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">图片 Data URL</span>
                                        <FormTextarea :model-value="vibe.imageDataUrl" :rows="2" placeholder="原始参考图 Data URL，后续生成请求可用于服务端编码" @update:model-value="updateActiveStyleVibeReference(vibe.id, {imageDataUrl: $event})" />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            <!-- LLM 配置 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" @click="openLlmWorkspace">
                        <span class="i-lucide-brain-circuit h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">LLM 大模型</h3>
                        <span class="i-lucide-panel-top-open h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                    </button>
                    <div class="w-[5.75rem]" aria-hidden="true"></div>
                </div>
                <div class="space-y-3 px-3 py-3">
                    <button type="button" class="flex w-full items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]" @click="openLlmWorkspace">
                        <div class="min-w-0">
                            <div class="truncate text-[12px] font-medium text-[var(--accent-text)]">打开 LLM 详细配置</div>
                            <div class="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                                {{ llm.model || "未选择模型" }} · {{ llm.apiBaseUrl || "未配置 API" }}
                            </div>
                        </div>
                        <span class="i-lucide-arrow-right h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                    </button>
                </div>
                <div v-if="false" class="hidden">
                    <div class="grid grid-cols-[1fr_auto] items-end gap-2">
                        <label class="block min-w-0">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">API 连接</span>
                            <FormInput :model-value="llm.apiBaseUrl" placeholder="例如：https://api.openai.com/v1" @update:model-value="updateLlmApiBaseUrl" />
                        </label>
                        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-60" :disabled="connectingLlm || !llm.apiBaseUrl.trim()" @click="connectLlm">
                            <span class="h-3.5 w-3.5" :class="connectingLlm ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-plug'"></span>
                            <span>{{ connectingLlm ? "连接中" : "连接" }}</span>
                        </button>
                    </div>
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">API Key</span>
                        <FormInput :model-value="llm.apiKey" type="password" placeholder="sk-..." @update:model-value="updateLlmApiKey" />
                    </label>
                    <p v-if="llmConnectionMessage" class="text-[11px]" :class="llmConnectionStatus === 'failed' ? 'text-[var(--danger-text)]' : 'text-[var(--text-muted)]'">{{ llmConnectionMessage }}</p>
                    <label v-if="llmModelOptions.length > 0" class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">选择模型</span>
                        <FormSelect :model-value="llm.model" :options="llmModelOptions" placeholder="连接后选择模型" dropdown-direction="down" @update:model-value="store.updateLlmSettings({model: $event})" />
                    </label>
                    <div v-else class="rounded-md border border-dashed border-[var(--border-color)] px-2.5 py-2 text-[11px] text-[var(--text-muted)]">
                        连接后显示可用模型列表。
                    </div>

                    <div class="space-y-3 border-t border-[var(--border-color)] pt-3">
                        <div v-for="control in llmParameterControls" :key="control.key" class="space-y-1.5">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-[11px] text-[var(--text-secondary)]">{{ control.label }}</span>
                                <span class="text-[11px] tabular-nums text-[var(--text-muted)]">{{ formatLlmParameter(control.key) }}</span>
                            </div>
                            <div class="grid grid-cols-[1fr_84px] items-center gap-2">
                                <input
                                    class="h-7 w-full accent-[var(--accent-main)]"
                                    type="range"
                                    :min="control.min"
                                    :max="control.max"
                                    :step="control.step"
                                    :value="llm.parameters[control.key]"
                                    @input="updateLlmParameter(control.key, ($event.target as HTMLInputElement).value)"
                                >
                                <FormInput
                                    :model-value="String(llm.parameters[control.key])"
                                    type="number"
                                    :min="String(control.min)"
                                    :max="String(control.max)"
                                    :step="String(control.step)"
                                    @update:model-value="updateLlmParameter(control.key, $event)"
                                />
                            </div>
                        </div>
                    </div>

                    <div class="space-y-2 border-t border-[var(--border-color)] pt-3">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-[11px] text-[var(--text-secondary)]">任务提示词</span>
                            <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="openPromptFileDialog">
                                <span class="i-lucide-upload h-3.5 w-3.5"></span>
                                <span>导入</span>
                            </button>
                            <input ref="promptFileInputRef" type="file" accept=".txt,.md,text/plain,text/markdown" class="hidden" @change="importPromptFile">
                        </div>
                        <FormSelect :model-value="selectedPromptTask" :options="promptTaskOptions" dropdown-direction="down" @update:model-value="selectPromptTask" />
                        <FormTextarea :model-value="activeTaskPrompt.prompt" :rows="6" placeholder="粘贴或导入该任务使用的提示词" @update:model-value="updateSelectedTaskPrompt" />
                        <p v-if="activeTaskPrompt.importedName" class="truncate text-[10px] text-[var(--text-muted)]">
                            {{ activeTaskPrompt.importedName }}<span v-if="activeTaskPrompt.updatedAt"> · {{ activeTaskPrompt.updatedAt }}</span>
                        </p>
                    </div>
                </div>
            </section>

            <!-- 角色管理 -->
            <section class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" :aria-expanded="!isSectionCollapsed('characters')" @click="toggleSection('characters')">
                        <span class="i-lucide-user-round-cog h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">角色管理</h3>
                        <span class="h-3.5 w-3.5 text-[var(--text-muted)]" :class="isSectionCollapsed('characters') ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"></span>
                    </button>
                    <div class="flex w-[5.75rem] items-center justify-end">
                        <IconButton title="删除当前角色" size="sm" variant="danger" :disabled="!activeCharacter" @click="deleteActiveCharacter">
                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                        </IconButton>
                    </div>
                </div>

                <div v-if="!isSectionCollapsed('characters')" class="space-y-3 px-3 py-3">
                    <div class="flex items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-2 py-1.5">
                        <span class="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">绑定小说：{{ currentNovelTitle }}</span>
                        <span class="shrink-0 text-[11px] text-[var(--text-muted)]">{{ characters.length }} 个角色</span>
                    </div>

                    <div class="grid grid-cols-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-0.5">
                        <button type="button" class="h-7 rounded px-2 text-[11px] transition-colors" :class="characterAddMode === 'manual' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'" @click="characterAddMode = 'manual'">手动添加</button>
                        <button type="button" class="h-7 rounded px-2 text-[11px] transition-colors" :class="characterAddMode === 'project' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'" @click="characterAddMode = 'project'">从小说添加</button>
                    </div>

                    <div v-if="characterAddMode === 'manual'" class="flex justify-end">
                        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="addCharacter">
                            <span class="i-lucide-user-plus h-3.5 w-3.5"></span>
                            <span>新建空角色</span>
                        </button>
                    </div>

                    <div v-else class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">来源小说</span>
                            <FormSelect :model-value="sourceProjectPath" :options="sourceProjectOptions" placeholder="选择小说" dropdown-direction="down" @update:model-value="selectSourceProject" />
                        </label>
                        <div class="grid grid-cols-[1fr_auto] items-end gap-2">
                            <label class="block min-w-0">
                                <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">来源角色</span>
                                <FormSelect :model-value="sourceCharacterPath" :options="sourceCharacterOptions" placeholder="选择角色" dropdown-direction="down" @update:model-value="sourceCharacterPath = $event" />
                            </label>
                            <IconButton title="刷新来源角色" size="sm" :disabled="sourceLoading || !sourceProjectPath" @click="loadSourceCharacters()">
                                <span class="h-3.5 w-3.5" :class="sourceLoading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'"></span>
                            </IconButton>
                        </div>
                        <button type="button" class="inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--accent-main)] px-2 text-[11px] text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)] disabled:cursor-not-allowed disabled:border-[var(--border-color)] disabled:text-[var(--text-muted)]" :disabled="!selectedSourceCharacter || importingCharacter" @click="importCharacterFromProject">
                            <span class="h-3.5 w-3.5" :class="importingCharacter ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-user-plus'"></span>
                            <span>{{ importingCharacter ? "导入中" : "导入到当前小说" }}</span>
                        </button>
                        <p v-if="sourceError" class="text-[11px] text-[var(--danger-text)]">{{ sourceError }}</p>
                        <p v-else-if="importStatus" class="text-[11px] text-[var(--text-muted)]">{{ importStatus }}</p>
                    </div>

                    <!-- 角色列表 -->
                    <div class="space-y-2">
                        <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-[11px] font-medium text-[var(--text-secondary)]">角色分页</span>
                                <span class="text-[10px] text-[var(--text-muted)]">{{ characters.length }}</span>
                            </div>
                            <p class="m-0 text-[10px] leading-4 text-[var(--text-muted)]">点击角色名会在中间工作区打开详情分页。</p>
                            <div v-if="characters.length > 0" class="space-y-1">
                                <button
                                    v-for="character in characters"
                                    :key="character.id"
                                    type="button"
                                    class="grid h-8 w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                                    :class="character.id === activeCharacterId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                    @click="openCharacterWorkspace(character)"
                                >
                                    <span class="i-lucide-user h-3.5 w-3.5"></span>
                                    <span class="min-w-0 truncate">{{ formatCharacterName(character) }}</span>
                                </button>
                            </div>
                            <div v-else class="rounded-md border border-dashed border-[var(--border-color)] px-2 py-3 text-center text-[11px] text-[var(--text-muted)]">
                                暂无角色
                            </div>
                        </div>

                        <div v-if="!activeCharacter" class="hidden rounded-md border border-dashed border-[var(--border-color)] px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
                            请选择或新建一个角色。
                        </div>

                        <div v-else class="hidden min-w-0 overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50">
                            <div class="flex items-center gap-1 border-b border-[var(--border-color)] px-2 pt-2">
                                <button type="button" class="relative -mb-px inline-flex max-w-full items-center gap-1.5 rounded-t-md border border-[var(--border-color)] border-b-[var(--bg-panel)] bg-[var(--bg-panel)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--accent-text)]">
                                    <span class="i-lucide-id-card h-3.5 w-3.5"></span>
                                    <span class="min-w-0 truncate">{{ activeCharacterDisplayName }}</span>
                                </button>
                            </div>

                            <div class="space-y-4 p-3">
                                <div v-if="activeCharacter.sourceNovelTitle" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/60 px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                                    来源：{{ activeCharacter.sourceNovelTitle }} · {{ activeCharacter.sourceCharacterPath }}
                                </div>

                                <div class="space-y-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3">
                                    <div class="flex flex-col items-center gap-3">
                                        <div class="w-full max-w-[320px] overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]">
                                            <img v-if="activeCharacter.portraitDataUrl" :src="activeCharacter.portraitDataUrl" :alt="activeCharacterDisplayName" class="block aspect-[4/3] w-full object-cover">
                                            <div v-else class="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 text-[11px] text-[var(--text-muted)]">
                                                <span class="i-lucide-image h-8 w-8"></span>
                                                <span>暂无角色照片</span>
                                            </div>
                                        </div>
                                        <div class="flex flex-wrap items-center justify-center gap-2">
                                            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[12px] text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)]" @click="openCharacterPhotoDialog">
                                                <span class="i-lucide-upload h-4 w-4"></span>
                                                <span>上传照片</span>
                                            </button>
                                            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] transition-colors hover:bg-[var(--bg-hover)]" :class="activeCharacter.sendPhoto ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'bg-[var(--bg-panel)] text-[var(--text-secondary)]'" :aria-pressed="activeCharacter.sendPhoto" @click="toggleActiveCharacterSendPhoto">
                                                <span class="h-4 w-4" :class="activeCharacter.sendPhoto ? 'i-lucide-square-check' : 'i-lucide-square'"></span>
                                                <span>发送图片</span>
                                            </button>
                                            <input ref="characterPhotoInputRef" type="file" accept="image/*" class="hidden" @change="importCharacterPhoto">
                                        </div>
                                    </div>

                                    <label class="block">
                                        <span class="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">提示词</span>
                                        <FormTextarea :model-value="activeCharacter.photoPrompt" :rows="6" placeholder="这里保存角色照片设计时生成的 NovelAI tag" @update:model-value="store.updateCharacter(activeCharacter.id, {photoPrompt: $event})" />
                                    </label>

                                    <div class="grid gap-2 md:grid-cols-3">
                                        <button type="button" class="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--accent-main)] px-3 text-[12px] text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)] disabled:cursor-not-allowed disabled:border-[var(--border-color)] disabled:text-[var(--text-muted)]" :disabled="generatingCharacterImage || !activeCharacter.photoPrompt.trim()" @click="generateActiveCharacterImage">
                                            <span class="h-4 w-4" :class="generatingCharacterImage ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-wand-sparkles'"></span>
                                            <span>{{ generatingCharacterImage ? "生成中" : "生成图片" }}</span>
                                        </button>
                                        <button type="button" class="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="openCharacterPhotoPromptDialog">
                                            <span class="i-lucide-lightbulb h-4 w-4"></span>
                                            <span>生成图片提示词</span>
                                        </button>
                                        <button type="button" class="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="openCharacterRevisionDialog">
                                            <span class="i-lucide-square-pen h-4 w-4"></span>
                                            <span>修改角色提示词</span>
                                        </button>
                                    </div>
                                </div>

                                <div class="space-y-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3">
                                    <div class="flex items-center justify-between gap-2 border-b border-[var(--border-color)] pb-2">
                                        <h4 class="truncate text-[13px] font-semibold text-[var(--accent-text)]">角色详细参数</h4>
                                    </div>
                                    <label class="block">
                                        <span class="mb-1 block text-[12px] text-[var(--text-secondary)]">角色中文名称</span>
                                        <FormInput :model-value="activeCharacter.cnName" placeholder="例如：伊蕾娜" @update:model-value="store.updateCharacter(activeCharacter.id, {cnName: $event})" />
                                    </label>
                                    <label class="block">
                                        <span class="mb-1 block text-[12px] text-[var(--text-secondary)]">角色英文名称</span>
                                        <FormInput :model-value="activeCharacter.enName" placeholder="例如：Elaina" @update:model-value="store.updateCharacter(activeCharacter.id, {enName: $event})" />
                                    </label>
                                    <label v-for="field in characterTextFields" :key="field.key" class="block">
                                        <span class="mb-1 block text-[12px] text-[var(--text-secondary)]">{{ field.label }}</span>
                                        <FormTextarea :model-value="activeCharacter[field.key]" :rows="field.rows" :placeholder="field.placeholder" @update:model-value="updateActiveCharacterField(field.key, $event)" />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-if="characters.length > 0" class="hidden">
                        <button
                            v-for="character in characters"
                            :key="character.id"
                            type="button"
                            class="rounded-md border px-2 py-1 text-[11px] transition-colors"
                            :class="character.id === activeCharacterId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                            @click="store.selectCharacter(character.id)"
                        >
                            {{ character.cnName.trim() || character.enName.trim() || "未命名角色" }}
                        </button>
                    </div>

                    <div v-if="!activeCharacter" class="hidden rounded-md border border-dashed border-[var(--border-color)] px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
                        暂无角色。
                    </div>

                    <!-- 角色详情 -->
                    <div v-else class="hidden space-y-2">
                        <div v-if="activeCharacter.sourceNovelTitle" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                            来源：{{ activeCharacter.sourceNovelTitle }} · {{ activeCharacter.sourceCharacterPath }}
                        </div>
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">角色中文名称</span>
                            <FormInput :model-value="activeCharacter.cnName" placeholder="例如：伊蕾娜" @update:model-value="store.updateCharacter(activeCharacter.id, {cnName: $event})" />
                        </label>
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">角色英文名称</span>
                            <FormInput :model-value="activeCharacter.enName" placeholder="例如：Elaina" @update:model-value="store.updateCharacter(activeCharacter.id, {enName: $event})" />
                        </label>
                        <label v-for="field in characterTextFields" :key="field.key" class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">{{ field.label }}</span>
                            <FormTextarea :model-value="activeCharacter[field.key]" :rows="field.rows" :placeholder="field.placeholder" @update:model-value="updateActiveCharacterField(field.key, $event)" />
                        </label>
                    </div>
                </div>
            </section>
        </div>
    </div>

    <Dialog
        v-model="characterPromptDialogOpen"
        :title="characterPromptDialogTitle"
        width="640px"
        max-height="86vh"
        show-cancel
        :busy="characterPromptBusy"
        @confirm="submitCharacterPromptDialog"
    >
        <div class="space-y-4">
            <p class="m-0 text-[12px] text-[var(--text-secondary)]">{{ characterPromptDialogDescription }}</p>
            <label class="block">
                <span class="mb-1 block text-[12px] text-[var(--text-secondary)]">{{ characterPromptDialogMode === "photoPrompt" ? "角色照片具体需求" : "修改方向" }}</span>
                <FormTextarea
                    :model-value="characterPromptRequirement"
                    :rows="5"
                    :placeholder="characterPromptDialogMode === 'photoPrompt' ? '例如：角色站在花园中，日常服装，柔和室内光线，半身头像...' : '例如：改成夏季运动服，保留发色和眼睛，整体更活泼...'"
                    @update:model-value="characterPromptRequirement = $event"
                />
            </label>

            <div v-if="characterPromptDialogMode === 'photoPrompt'" class="space-y-2 rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                        <span class="i-lucide-paperclip h-4 w-4"></span>
                        <span class="truncate">参考图片（可选）</span>
                    </div>
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)]" @click="openCharacterPromptReferenceDialog">
                        <span class="i-lucide-plus h-4 w-4"></span>
                        <span>添加图片</span>
                    </button>
                    <input ref="characterPromptReferenceInputRef" type="file" accept="image/*" multiple class="hidden" @change="importCharacterPromptReferences">
                </div>

                <div v-if="characterPromptReferences.length === 0" class="flex min-h-20 items-center justify-center rounded-md text-[12px] text-[var(--text-muted)]">
                    点击上方按钮添加参考图片
                </div>
                <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div v-for="reference in characterPromptReferences" :key="reference.id" class="overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
                        <img :src="reference.dataUrl" :alt="reference.name" class="block aspect-square w-full object-cover">
                        <div class="flex items-center justify-between gap-2 border-t border-[var(--border-color)] px-2 py-1">
                            <span class="min-w-0 truncate text-[10px] text-[var(--text-muted)]">{{ reference.name }}</span>
                            <button type="button" class="shrink-0 text-[var(--text-muted)] transition-colors hover:text-[var(--danger-text)]" title="移除参考图" @click="removeCharacterPromptReference(reference.id)">
                                <span class="i-lucide-x h-3.5 w-3.5"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <p v-if="characterPromptError" class="m-0 text-[12px] text-[var(--danger-text)]">{{ characterPromptError }}</p>
        </div>
    </Dialog>
</template>
