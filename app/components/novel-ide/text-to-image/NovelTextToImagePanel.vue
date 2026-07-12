<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import IconButton from "nbook/app/components/common/IconButton.vue";
import TextToImageTagVocabularyPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageTagVocabularyPanel.vue";
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
    type TextToImageCharacterReference,
    type TextToImageGenerationResult,
    type TextToImageLlmParameters,
    type TextToImageOutfit,
    type TextToImagePromptTask,
    type TextToImageStylePreset,
    type TextToImageVibeReference,
} from "nbook/app/stores/text-to-image";
import type {TextToImagePromptReplacementRule} from "nbook/app/utils/text-to-image-prompt-engine";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    buildTextToImageLlmMessages,
    formatTextToImageLlmMessages,
    requestTextToImageLlmCompletion,
    requestTextToImageLlmModels,
    type TextToImageLlmContentPart,
    type TextToImageLlmMessage,
} from "nbook/app/utils/text-to-image-llm";
import {
    buildTextToImageCharacterDesignRequestPayload,
    buildTextToImageCharacterRevisionRequestPayload,
    buildTextToImageCharacterTagPatch,
    createTextToImageCharacterRequestSlots,
    parseTextToImageCharacterDraft,
} from "nbook/app/utils/text-to-image-character-design";
import {parseStChatu8TextToImageSettings} from "nbook/app/utils/text-to-image-st-chatu8-import";
import type {TextToImageJobDto} from "nbook/shared/dto/text-to-image.dto";
import type {WorkspaceTreeSnapshotDto} from "nbook/shared/dto/workspace-tree.dto";

type StyleTextFieldKey = "positivePrefix" | "positiveSuffix" | "negativePrefix" | "negativeSuffix";
type StyleBooleanKey = "useFurryDataset" | "positiveQualityPreset";
type LlmParameterKey = keyof TextToImageLlmParameters;
type NovelAiNumberKey = "promptGuidance" | "promptGuidanceRescale" | "width" | "height" | "steps" | "seed";
type NovelAiBooleanKey = "aiDefaultCharacterPosition" | "variety" | "smeaDyn" | "decrisper";
type NovelAiDimensionKey = "width" | "height";
type VibeNumberKey = "strength" | "infoExtracted";
type CharacterReferenceNumberKey = "strength" | "infoExtracted";
type VibeSourceType = TextToImageVibeReference["sourceType"];
type CharacterAddMode = "manual" | "project";
type CharacterPromptDialogMode = "photoPrompt" | "revision";
type TextToImagePanelSection = "generation" | "tagVocabulary" | "novelAi" | "style" | "llm" | "characters";
type TextToImageTagInsertTarget = {
    value: string;
    label: string;
    description?: string;
    iconClass?: string;
};

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
    activeOutfit,
    activeOutfitId,
    activeStyle,
    activeStyleId,
    activeNovelAiProviderId,
    characters,
    currentProjectPath,
    generationDraft,
    lastNovelAiExchange,
    llm,
    novelAi,
    outfits,
    promptReplacementRules,
    projectJobs,
    providers,
    stylePresets,
    taskPrompts,
} = storeToRefs(store);
const {currentNovelId, novels} = storeToRefs(novelIdeStore);

const selectedPromptTask = ref<TextToImagePromptTask>("bodyImage");
const selectedTagInsertTarget = ref("generationPrompt");
const promptFileInputRef = ref<HTMLInputElement | null>(null);
const stChatu8FileInputRef = ref<HTMLInputElement | null>(null);
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
const generatingImage = ref(false);
const imageGenerationStatus = ref<"idle" | "queued">("idle");
const generationError = ref("");
const generationWarnings = ref<string[]>([]);
const lastGenerationRequest = ref<TextToImageGenerateResponse["request"] | null>(null);
const characterPromptDialogOpen = ref(false);
const characterPromptDialogMode = ref<CharacterPromptDialogMode>("photoPrompt");
const characterPromptRequirement = ref("");
const characterPromptReferences = ref<CharacterPromptReferenceImage[]>([]);
const characterPromptBusy = ref(false);
const characterPromptError = ref("");
const collapsedSections = ref<Record<TextToImagePanelSection, boolean>>({
    generation: false,
    tagVocabulary: false,
    novelAi: false,
    style: false,
    llm: false,
    characters: false,
});
const generationButtonLabel = computed(() => imageGenerationStatus.value === "queued" ? "排队中" : "生成");
const visibleGenerationQueueJobs = computed(() => projectJobs.value.slice(0, 6));
const generationQueueSummary = computed(() => {
    const jobs = projectJobs.value;
    return `运行 ${jobs.filter((job) => job.status === "running").length} · 排队 ${jobs.filter((job) => job.status === "queued").length} · 完成 ${jobs.filter((job) => job.status === "succeeded").length}`;
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

const novelAiSmeaModeOptions: SelectOption[] = [
    {value: "auto", label: "SMEA 自动", description: "大尺寸时自动启用"},
    {value: "on", label: "SMEA 开启", description: "强制发送 sm=true"},
    {value: "off", label: "SMEA 关闭", description: "强制关闭 sm"},
];

const promptRuleTargetOptions: SelectOption[] = [
    {value: "positive", label: "正面 prompt"},
    {value: "negative", label: "负面 prompt"},
];

const promptRuleMatchModeOptions: SelectOption[] = [
    {value: "plain", label: "普通文本"},
    {value: "regex", label: "正则"},
];

const promptRuleModeOptions: SelectOption[] = [
    {value: "replace", label: "替换"},
    {value: "append", label: "追加"},
    {value: "prepend", label: "前置"},
    {value: "delete", label: "删除"},
];

const outfitTextFields: Array<{key: keyof Pick<TextToImageOutfit, "aliases" | "upperFront" | "upperBack" | "lowerFront" | "lowerBack" | "fullPrompt" | "negativePrompt">; label: string; rows: number}> = [
    {key: "aliases", label: "触发别名", rows: 2},
    {key: "upperFront", label: "上半身正面", rows: 3},
    {key: "upperBack", label: "上半身背面", rows: 3},
    {key: "lowerFront", label: "下半身正面", rows: 3},
    {key: "lowerBack", label: "下半身背面", rows: 3},
    {key: "fullPrompt", label: "全身组合", rows: 3},
    {key: "negativePrompt", label: "负面 tag", rows: 2},
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
const tagInsertTargets = computed<TextToImageTagInsertTarget[]>(() => {
    const targets: TextToImageTagInsertTarget[] = [
        {value: "generationPrompt", label: "本次正面 prompt", iconClass: "i-lucide-wand-sparkles"},
        {value: "generationNegativePrompt", label: "本次负面 prompt", iconClass: "i-lucide-shield-minus"},
    ];
    if (activeStyle.value) {
        targets.push(
            {value: "stylePositivePrefix", label: "画风正面前缀", description: activeStyle.value.name, iconClass: "i-lucide-palette"},
            {value: "stylePositiveSuffix", label: "画风正面后缀", description: activeStyle.value.name, iconClass: "i-lucide-palette"},
            {value: "styleNegativePrefix", label: "画风负面前缀", description: activeStyle.value.name, iconClass: "i-lucide-palette"},
            {value: "styleNegativeSuffix", label: "画风负面后缀", description: activeStyle.value.name, iconClass: "i-lucide-palette"},
        );
    }
    return targets;
});

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
const novelAiProviderOptions = computed<SelectOption[]>(() => providers.value
    .filter((provider) => provider.kind === "novelai")
    .map((provider) => ({value: String(provider.id), label: `${provider.name} · ${provider.model}`})));
const canGenerateTextToImage = computed(() => {
    return !generatingImage.value && activeNovelAiProviderId.value !== null && generationPreviewPrompt.value.trim().length > 0;
});

watch(currentNovelId, (projectPath) => {
    store.setCurrentProjectPath(projectPath);
    if (projectPath) {
        void store.refreshProjectJobs(projectPath).catch(() => undefined);
    }
    if (!sourceProjectPath.value && projectPath) {
        sourceProjectPath.value = projectPath;
    }
}, {immediate: true});

watch(novels, () => {
    if (!sourceProjectPath.value) {
        sourceProjectPath.value = currentNovelId.value || novels.value[0]?.projectPath || novels.value[0]?.id || "";
    }
});

watch(tagInsertTargets, (targets) => {
    if (!targets.some((target) => target.value === selectedTagInsertTarget.value)) {
        selectedTagInsertTarget.value = targets[0]?.value ?? "";
    }
}, {immediate: true});

onMounted(async () => {
    store.ensureDefaults();
    await store.refreshProviders().catch((error) => {
        notification.error(resolveApiErrorMessage(error, "读取文生图 Provider 失败"));
    });
    if (currentProjectPath.value) {
        await store.refreshProjectJobs(currentProjectPath.value).catch((error) => {
            notification.error(resolveApiErrorMessage(error, "读取文生图任务失败"));
        });
    }
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
    if (activeNovelAiProviderId.value === null) {
        generationError.value = "请先选择 NovelAI Provider";
        notification.error(generationError.value);
        return;
    }
    if (!generationPreviewPrompt.value.trim()) {
        generationError.value = "请先填写本次正面 prompt";
        notification.error(generationError.value);
        return;
    }

    generatingImage.value = true;
    imageGenerationStatus.value = "queued";
    try {
        const job = await $fetch<{id: string}>("/api/text-to-image/jobs", {
            method: "POST",
            body: {
                projectPath: currentProjectPath.value,
                providerId: activeNovelAiProviderId.value,
                kind: "manual",
                prompt: generationPreviewPrompt.value,
                negativePrompt: generationPreviewNegativePrompt.value,
                novelAi: {
                    model: novelAi.value.model,
                    sampler: novelAi.value.sampler,
                    noiseSchedule: novelAi.value.noiseSchedule,
                    promptGuidance: novelAi.value.promptGuidance,
                    promptGuidanceRescale: novelAi.value.promptGuidanceRescale,
                    width: novelAi.value.width,
                    height: novelAi.value.height,
                    steps: novelAi.value.steps,
                    seed: novelAi.value.seed,
                    count: generationDraft.value.batchSize,
                },
            },
        });
        notification.success(`文生图任务已加入队列：${job.id}`);
        await store.refreshProjectJobs(currentProjectPath.value);
    } catch (error) {
        generationError.value = resolveApiErrorMessage(error, "文生图生成失败");
        notification.error(generationError.value);
    } finally {
        generatingImage.value = false;
        imageGenerationStatus.value = "idle";
    }
}

/**
 * 打开角色头像本地上传选择器。
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
function updateNovelAiSmeaMode(value: string): void {
    const smeaMode = novelAiSmeaModeOptions.some((option) => option.value === value)
        ? value as NovelAiApiSettings["smeaMode"]
        : "auto";
    store.updateNovelAiSettings({smeaMode});
}

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
function addActiveStyleCharacterReference(): void {
    if (!activeStyle.value) {
        return;
    }
    store.addStyleCharacterReference(activeStyle.value.id);
}

function updateActiveStyleCharacterReference(referenceId: string, patch: Partial<TextToImageCharacterReference>): void {
    if (!activeStyle.value) {
        return;
    }
    store.updateStyleCharacterReference(activeStyle.value.id, referenceId, patch);
}

function updateCharacterReferenceNumber(referenceId: string, key: CharacterReferenceNumberKey, value: string | number): void {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
        return;
    }
    updateActiveStyleCharacterReference(referenceId, {[key]: nextValue});
}

function deleteActiveStyleCharacterReference(referenceId: string): void {
    if (!activeStyle.value) {
        return;
    }
    store.deleteStyleCharacterReference(activeStyle.value.id, referenceId);
}

function addOutfit(): void {
    store.addOutfit();
}

function deleteActiveOutfit(): void {
    if (activeOutfit.value) {
        store.deleteOutfit(activeOutfit.value.id);
    }
}

function updateActiveOutfit(patch: Partial<TextToImageOutfit>): void {
    if (activeOutfit.value) {
        store.updateOutfit(activeOutfit.value.id, patch);
    }
}

function formatOutfitName(outfit: TextToImageOutfit): string {
    return outfit.nameCn.trim() || outfit.nameEn.trim() || "未命名服装";
}

function addPromptReplacementRule(): void {
    store.addPromptReplacementRule();
}

function updatePromptReplacementRule(ruleId: string, patch: Partial<TextToImagePromptReplacementRule>): void {
    store.updatePromptReplacementRule(ruleId, patch);
}

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

function updateGenerationBatchSize(value: string): void {
    store.updateGenerationDraft({batchSize: Number(value)});
}

function formatGenerationQueueStatus(status: TextToImageJobDto["status"]): string {
    const labels: Record<TextToImageJobDto["status"], string> = {
        queued: "排队",
        running: "生成中",
        succeeded: "完成",
        failed: "失败",
        canceled: "已取消",
        interrupted: "已中断",
    };
    return labels[status];
}

function generationQueueJobIconClass(status: TextToImageJobDto["status"]): string {
    const icons: Record<TextToImageJobDto["status"], string> = {
        queued: "i-lucide-clock-3 text-[var(--status-warning)]",
        running: "i-lucide-loader-2 animate-spin text-[var(--status-info)]",
        succeeded: "i-lucide-check text-[var(--status-success)]",
        failed: "i-lucide-circle-alert text-[var(--status-danger)]",
        canceled: "i-lucide-ban text-[var(--text-muted)]",
        interrupted: "i-lucide-circle-pause text-[var(--status-warning)]",
    };
    return icons[status];
}

function formatGenerationQueueJobKind(kind: TextToImageJobDto["kind"]): string {
    const labels: Record<TextToImageJobDto["kind"], string> = {
        manual: "手动生成",
        body: "正文插图",
        character: "角色图",
        reroll: "重新生成",
    };
    return labels[kind];
}

function reuseGenerationResult(result: TextToImageGenerationResult): void {
    store.updateGenerationDraft({
        prompt: result.prompt,
        negativePrompt: result.negativePrompt,
    });
    notification.success("已套用生成结果 prompt");
}

async function copyGenerationResultPath(result: TextToImageGenerationResult): Promise<void> {
    const value = result.savedPath || result.fileName;
    if (!value) {
        notification.warning("没有可复制的图片路径");
        return;
    }
    try {
        await navigator.clipboard.writeText(value);
        notification.success("图片路径已复制");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "复制图片路径失败"));
    }
}

function removeGenerationResult(result: TextToImageGenerationResult): void {
    store.removeGenerationResult(result.id);
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
 * 将本地 tag 词库选中的 tag 追加到当前目标字段。
 */
function insertVocabularyTag(tag: string): void {
    const target = selectedTagInsertTarget.value;
    if (target === "generationPrompt") {
        store.updateGenerationDraft({prompt: appendTagText(generationDraft.value.prompt, tag)});
        return;
    }
    if (target === "generationNegativePrompt") {
        store.updateGenerationDraft({negativePrompt: appendTagText(generationDraft.value.negativePrompt, tag)});
        return;
    }
    if (target.startsWith("style") && activeStyle.value) {
        const styleTargetMap: Record<string, StyleTextFieldKey> = {
            stylePositivePrefix: "positivePrefix",
            stylePositiveSuffix: "positiveSuffix",
            styleNegativePrefix: "negativePrefix",
            styleNegativeSuffix: "negativeSuffix",
        };
        const key = styleTargetMap[target];
        if (key) {
            store.updateStylePreset(activeStyle.value.id, {
                [key]: appendTagText(activeStyle.value[key], tag),
            } as Partial<TextToImageStylePreset>);
        }
        return;
    }
    if (!activeCharacter.value) {
        return;
    }
    if (target === "characterPhotoPrompt") {
        store.updateCharacter(activeCharacter.value.id, {
            photoPrompt: appendTagText(activeCharacter.value.photoPrompt, tag),
        });
        return;
    }
    if (target.startsWith("character:")) {
        const key = target.slice("character:".length) as TextToImageCharacterTagKey;
        if (characterTextFields.some((field) => field.key === key)) {
            store.updateCharacter(activeCharacter.value.id, {
                [key]: appendTagText(activeCharacter.value[key], tag),
            } as Partial<TextToImageCharacter>);
        }
    }
}

function appendTagText(current: string, tag: string): string {
    const normalizedTag = tag.trim();
    if (!normalizedTag) {
        return current;
    }
    const trimmed = current.trim().replace(/[,，]\s*$/u, "");
    if (!trimmed) {
        return normalizedTag;
    }
    return `${trimmed}, ${normalizedTag}`;
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

/** 角色 tag 已迁移到 Project Workspace 的 image-tags.md，不再打开旧角色分页。 */
function openCharacterWorkspace(character: TextToImageCharacter): void {
    store.selectCharacter(character.id);
    notification.info("角色 tag 已迁移到角色目录中的 image-tags.md");
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
    const {providerId} = store.resolveLlmTaskBinding(selectedPromptTask.value);
    if (providerId === null) {
        throw new Error("请先为当前任务选择 OpenAI-compatible Provider。");
    }
    return await requestTextToImageLlmModels(providerId);
}

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
function openStChatu8ImportDialog(): void {
    stChatu8FileInputRef.value?.click();
}

async function importStChatu8Settings(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) {
        return;
    }

    try {
        const parsed = parseStChatu8TextToImageSettings(await file.text());
        for (const character of parsed.characters) {
            store.addCharacterFromDraft(character);
        }
        for (const outfit of parsed.outfits) {
            store.addOutfitFromDraft(outfit);
        }
        if (parsed.promptRules.length > 0) {
            store.importPromptReplacementRules(parsed.promptRules);
        }
        notification.success(`已导入 ${parsed.characters.length} 个角色、${parsed.outfits.length} 套服装、${parsed.promptRules.length} 条规则`);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "导入 st-chatu8 配置失败"));
    }
}

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
        const nextCharacters = dedupeSourceCharacters(snapshot.nodes
            .filter((node) => node.entryType === "character" && node.contentNode)
            .map((node) => ({
                path: node.path,
                title: node.title || node.path,
                summary: node.summary,
                indexPath: resolveContentIndexPath(node.path),
                statePath: node.state?.exists ? node.state.path : null,
            })))
            .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
        sourceCharacters.value = nextCharacters;
        sourceCharacterPath.value = nextCharacters.some((character) => character.path === sourceCharacterPath.value) ? sourceCharacterPath.value : nextCharacters[0]?.path ?? "";
    } catch (error) {
        sourceError.value = resolveApiErrorMessage(error, "读取小说角色失败");
    } finally {
        sourceLoading.value = false;
    }
}

function dedupeSourceCharacters(characters: SourceCharacterOption[]): SourceCharacterOption[] {
    const seen = new Set<string>();
    const nextCharacters: SourceCharacterOption[] = [];
    for (const character of characters) {
        const key = character.indexPath || character.path;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        nextCharacters.push(character);
    }
    return nextCharacters;
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
    const {contextPreset} = store.resolveLlmTaskBinding("characterDesign");
    const characterDesignRequestPayload = buildTextToImageCharacterDesignRequestPayload(detail);
    const characterDesignTaskPrompt = taskPrompts.value.characterDesign.prompt.trim() || [
        "你是 NovelAI 角色与服装 tag 设计助手。",
        "请读取请求体 JSON，根据其中的小说角色设定生成角色 tag。",
        "只返回 JSON，不要解释，不要 Markdown。JSON 结构必须是 {\"character\": {...}}，字段名使用 outputSchema.character 中列出的中文字段。",
    ].join("\n");
    const characterDesignMessages = buildTextToImageLlmMessages({
        task: "characterDesign",
        userRequest: characterDesignRequestPayload,
        taskPrompt: characterDesignTaskPrompt,
        contextPreset,
        extraDetectionText: [detail.title, detail.summary, detail.content, detail.stateContent].filter(Boolean).join("\n"),
        requestVariables: createTextToImageCharacterRequestSlots({
            userRequest: characterDesignRequestPayload,
        }),
    });
    const characterDesignReply = await requestLlmChatCompletion(characterDesignMessages, "characterDesign");
    if (!characterDesignReply) {
        throw new Error("LLM 没有返回可用内容");
    }
    store.recordLlmExchange({
        task: "characterDesign",
        prompt: formatTextToImageLlmMessages(characterDesignMessages),
        response: characterDesignReply,
    });
    return characterDesignReply;

}

async function requestCharacterPhotoPrompt(character: TextToImageCharacter, requirement: string, references: CharacterPromptReferenceImage[]): Promise<string> {
    const userContent: TextToImageLlmContentPart[] = [
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
    ], "characterDesign");
    return content.replace(/^```(?:text|txt|markdown)?/iu, "").replace(/```$/u, "").trim();
}

/**
 * 调用 LLM 按用户方向修改当前角色 tag。
 */
async function requestCharacterRevision(character: TextToImageCharacter, direction: string): Promise<string> {
    const {contextPreset} = store.resolveLlmTaskBinding("characterRevision");
    const revisionRequestPayload = buildTextToImageCharacterRevisionRequestPayload(character, direction);
    const revisionTaskPrompt = taskPrompts.value.characterRevision.prompt.trim() || [
        "你是 NovelAI 角色 tag 修改助手。",
        "请读取请求体 JSON，根据 request.direction 修改 request.currentCharacter 中的 tag。",
        "只返回 JSON，不要解释，不要 Markdown。JSON 结构必须是 {\"character\": {...}}，只需要包含被修改后的角色字段。",
    ].join("\n");
    const revisionMessages = buildTextToImageLlmMessages({
        task: "characterRevision",
        userRequest: revisionRequestPayload,
        taskPrompt: revisionTaskPrompt,
        contextPreset,
        extraDetectionText: revisionRequestPayload,
        requestVariables: createTextToImageCharacterRequestSlots({
            userRequest: revisionRequestPayload,
            currentCharacter: character,
        }),
    });
    const revisionReply = await requestLlmChatCompletion(revisionMessages, "characterRevision");
    if (!revisionReply) {
        throw new Error("LLM 没有返回可用内容");
    }
    store.recordLlmExchange({
        task: "characterRevision",
        prompt: formatTextToImageLlmMessages(revisionMessages),
        response: revisionReply,
    });
    return revisionReply;

}

async function requestLlmChatCompletion(messages: TextToImageLlmMessage[], task: TextToImagePromptTask): Promise<string> {
    const {providerId} = store.resolveLlmTaskBinding(task);
    const provider = providers.value.find((item) => item.id === providerId && item.kind === "openai_compatible");
    if (!provider || !provider.model.trim()) {
        throw new Error("请先为该任务选择并配置 OpenAI-compatible Provider。");
    }
    const content = await requestTextToImageLlmCompletion({
        providerId: provider.id,
        model: provider.model,
        parameters: llm.value.parameters,
        stream: llm.value.stream,
    }, messages);
    if (!content) {
        throw new Error("LLM 没有返回可用内容");
    }
    store.recordLlmExchange({
        task,
        prompt: formatTextToImageLlmMessages(messages),
        response: content,
    });
    return content;
}

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
    return buildTextToImageCharacterTagPatch(draft);
}

function parseCharacterDraft(content: string): Partial<TextToImageCharacter> {
    return parseTextToImageCharacterDraft(content);
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
                    <IconButton title="导入 st-chatu8 JSON" size="sm" @click="openStChatu8ImportDialog">
                        <span class="i-lucide-file-json h-3.5 w-3.5"></span>
                    </IconButton>
                    <IconButton title="历史图片" size="sm" :disabled="!currentProjectPath" @click="novelIdeStore.openTextToImageHistoryTab(currentProjectPath)">
                        <span class="i-lucide-images h-3.5 w-3.5"></span>
                    </IconButton>
                    <input ref="stChatu8FileInputRef" type="file" accept=".json,application/json" class="hidden" @change="importStChatu8Settings">
                    <span class="i-lucide-image h-5 w-5 text-[var(--accent-main)]"></span>
                </div>
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
                            <span>{{ generationButtonLabel }}</span>
                        </button>
                    </div>
                </div>

                <div v-if="!isSectionCollapsed('generation')" class="space-y-3 px-3 py-3">
                    <!-- Provider 选择：凭据仅由服务端持有，浏览器只保存 Provider ID。 -->
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">NovelAI Provider</span>
                        <FormSelect
                            :model-value="activeNovelAiProviderId === null ? '' : String(activeNovelAiProviderId)"
                            :options="novelAiProviderOptions"
                            placeholder="选择 NovelAI Provider"
                            dropdown-direction="down"
                            :disabled="novelAiProviderOptions.length === 0"
                            @update:model-value="store.selectNovelAiProvider($event ? Number($event) : null)"
                        />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">本次正面 prompt</span>
                        <FormTextarea :model-value="generationDraft.prompt" :rows="5" placeholder="输入正文图片生成结果或直接输入 NovelAI tag" @update:model-value="store.updateGenerationDraft({prompt: $event})" />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">本次负面 prompt</span>
                        <FormTextarea :model-value="generationDraft.negativePrompt" :rows="3" placeholder="可留空，由画风串负面前后缀和负面预设补足" @update:model-value="store.updateGenerationDraft({negativePrompt: $event})" />
                    </label>

                    <label class="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-2 py-2">
                        <span class="min-w-0 text-[11px] text-[var(--text-secondary)]">生成张数</span>
                        <FormInput :model-value="String(generationDraft.batchSize)" type="number" min="1" max="4" step="1" @update:model-value="updateGenerationBatchSize" />
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
                            <span class="min-w-0 truncate text-right">任务完成后保存至历史图片</span>
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

                    <div v-if="visibleGenerationQueueJobs.length > 0" class="space-y-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-2 py-1.5">
                        <div class="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                            <span>队列</span>
                            <span class="text-[10px] text-[var(--text-muted)]">{{ generationQueueSummary }}</span>
                        </div>
                        <div v-for="job in visibleGenerationQueueJobs" :key="job.id" class="grid grid-cols-[1rem_minmax(0,1fr)_3rem] items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                            <span class="h-3.5 w-3.5" :class="generationQueueJobIconClass(job.status)"></span>
                            <span class="min-w-0 truncate">{{ formatGenerationQueueJobKind(job.kind) }}</span>
                            <span class="text-right">{{ formatGenerationQueueStatus(job.status) }}</span>
                        </div>
                    </div>

                    <div v-if="lastGenerationRequest" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                        上次请求：{{ lastGenerationRequest.model }} · seed {{ lastGenerationRequest.seed }} · {{ lastGenerationRequest.savedDirectory }}
                    </div>

                    <div v-if="lastNovelAiExchange.request" class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                        <div class="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                            <span>NovelAI 调试</span>
                            <span class="text-[10px] text-[var(--text-muted)]">{{ lastNovelAiExchange.imageCount }} 张</span>
                        </div>
                        <FormTextarea :model-value="JSON.stringify(lastNovelAiExchange.request, null, 2)" :rows="6" readonly />
                        <p v-if="lastNovelAiExchange.warnings.length > 0" class="m-0 text-[10px] text-[var(--text-muted)]">{{ lastNovelAiExchange.warnings.join(' / ') }}</p>
                    </div>

                </div>
            </section>

            <!-- tagData 本地词库 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" :aria-expanded="!isSectionCollapsed('tagVocabulary')" @click="toggleSection('tagVocabulary')">
                        <span class="i-lucide-tags h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">标签词库</h3>
                        <span class="h-3.5 w-3.5 text-[var(--text-muted)]" :class="isSectionCollapsed('tagVocabulary') ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"></span>
                    </button>
                    <div class="w-[5.75rem]" aria-hidden="true"></div>
                </div>
                <div v-if="!isSectionCollapsed('tagVocabulary')" class="px-3 py-3">
                    <TextToImageTagVocabularyPanel
                        v-model:selected-target="selectedTagInsertTarget"
                        compact
                        :targets="tagInsertTargets"
                        @insert="insertVocabularyTag"
                    />
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
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">SMEA</span>
                            <FormSelect :model-value="novelAi.smeaMode" :options="novelAiSmeaModeOptions" dropdown-direction="down" @update:model-value="updateNovelAiSmeaMode" />
                        </label>
                        <div class="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                class="grid min-h-10 grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                                :class="novelAi.smeaDyn ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)]/50 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                :aria-pressed="novelAi.smeaDyn"
                                @click="toggleNovelAiBoolean('smeaDyn')"
                            >
                                <span class="min-w-0">
                                    <span class="block truncate">SMEA Dyn</span>
                                    <span class="mt-0.5 block text-[10px]" :class="novelAi.smeaDyn ? 'text-[var(--accent-text)] opacity-80' : 'text-[var(--text-muted)]'">{{ novelAi.smeaDyn ? "已开启" : "已关闭" }}</span>
                                </span>
                                <span class="relative h-4 w-8 rounded-full transition-colors" :class="novelAi.smeaDyn ? 'bg-[var(--accent-main)]' : 'bg-[var(--border-color)]'">
                                    <span class="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-panel)] shadow transition-transform" :class="novelAi.smeaDyn ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
                                </span>
                            </button>
                            <button
                                type="button"
                                class="grid min-h-10 grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                                :class="novelAi.decrisper ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)]/50 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                :aria-pressed="novelAi.decrisper"
                                @click="toggleNovelAiBoolean('decrisper')"
                            >
                                <span class="min-w-0">
                                    <span class="block truncate">Decrisper</span>
                                    <span class="mt-0.5 block text-[10px]" :class="novelAi.decrisper ? 'text-[var(--accent-text)] opacity-80' : 'text-[var(--text-muted)]'">{{ novelAi.decrisper ? "已开启" : "已关闭" }}</span>
                                </span>
                                <span class="relative h-4 w-8 rounded-full transition-colors" :class="novelAi.decrisper ? 'bg-[var(--accent-main)]' : 'bg-[var(--border-color)]'">
                                    <span class="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-panel)] shadow transition-transform" :class="novelAi.decrisper ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
                                </span>
                            </button>
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

                        <div class="space-y-2 border-t border-[var(--border-color)] pt-3">
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                                    <span class="i-lucide-id-card h-3.5 w-3.5"></span>
                                    <span class="truncate">Character Reference</span>
                                    <span class="text-[10px] text-[var(--text-muted)]">{{ activeStyle.characterReferences.length }}</span>
                                </div>
                                <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="addActiveStyleCharacterReference">
                                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                    <span>新增参考</span>
                                </button>
                            </div>
                            <div v-if="activeStyle.characterReferences.length === 0" class="rounded-md border border-dashed border-[var(--border-color)] px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                                暂无 Character Reference。
                            </div>
                            <div v-else class="space-y-2">
                                <div v-for="reference in activeStyle.characterReferences" :key="reference.id" class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                                    <div class="flex items-center justify-between gap-2">
                                        <label class="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                                            <input class="h-4 w-4 accent-[var(--accent-main)]" type="checkbox" :checked="reference.enabled" @change="updateActiveStyleCharacterReference(reference.id, {enabled: ($event.target as HTMLInputElement).checked})">
                                            <span class="truncate">启用</span>
                                        </label>
                                        <IconButton title="删除 Character Reference" size="sm" variant="danger" @click="deleteActiveStyleCharacterReference(reference.id)">
                                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                        </IconButton>
                                    </div>
                                    <label class="block">
                                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">名称</span>
                                        <FormInput :model-value="reference.displayName" placeholder="角色参考图" @update:model-value="updateActiveStyleCharacterReference(reference.id, {displayName: $event})" />
                                    </label>
                                    <div class="grid grid-cols-2 gap-2">
                                        <label class="block min-w-0">
                                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">Strength</span>
                                            <FormInput :model-value="String(reference.strength)" type="number" min="0" max="1" step="0.01" @update:model-value="updateCharacterReferenceNumber(reference.id, 'strength', $event)" />
                                        </label>
                                        <label class="block min-w-0">
                                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">Info Extracted</span>
                                            <FormInput :model-value="String(reference.infoExtracted)" type="number" min="0" max="1" step="0.01" @update:model-value="updateCharacterReferenceNumber(reference.id, 'infoExtracted', $event)" />
                                        </label>
                                    </div>
                                    <label class="block">
                                        <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">图片 Data URL / Base64</span>
                                        <FormTextarea :model-value="reference.imageDataUrl" :rows="3" placeholder="粘贴 data:image/png;base64,... 或原始 base64" @update:model-value="updateActiveStyleCharacterReference(reference.id, {imageDataUrl: $event})" />
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div class="space-y-2 border-t border-[var(--border-color)] pt-3">
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                                    <span class="i-lucide-repeat h-3.5 w-3.5"></span>
                                    <span class="truncate">Prompt 动态替换</span>
                                    <span class="text-[10px] text-[var(--text-muted)]">{{ promptReplacementRules.length }}</span>
                                </div>
                                <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="addPromptReplacementRule">
                                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                    <span>新增规则</span>
                                </button>
                            </div>
                            <div v-if="promptReplacementRules.length === 0" class="rounded-md border border-dashed border-[var(--border-color)] px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                                暂无替换规则。
                            </div>
                            <div v-else class="space-y-2">
                                <div v-for="rule in promptReplacementRules" :key="rule.id" class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                                    <div class="flex items-center justify-between gap-2">
                                        <label class="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                                            <input class="h-4 w-4 accent-[var(--accent-main)]" type="checkbox" :checked="rule.enabled" @change="updatePromptReplacementRule(rule.id, {enabled: ($event.target as HTMLInputElement).checked})">
                                            <span class="truncate">启用</span>
                                        </label>
                                        <IconButton title="删除规则" size="sm" variant="danger" @click="store.deletePromptReplacementRule(rule.id)">
                                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                        </IconButton>
                                    </div>
                                    <FormInput :model-value="rule.name" placeholder="规则名" @update:model-value="updatePromptReplacementRule(rule.id, {name: $event})" />
                                    <div class="grid grid-cols-2 gap-2">
                                        <FormSelect :model-value="rule.target" :options="promptRuleTargetOptions" dropdown-direction="down" @update:model-value="updatePromptReplacementRule(rule.id, {target: $event as TextToImagePromptReplacementRule['target']})" />
                                        <FormSelect :model-value="rule.mode" :options="promptRuleModeOptions" dropdown-direction="down" @update:model-value="updatePromptReplacementRule(rule.id, {mode: $event as TextToImagePromptReplacementRule['mode']})" />
                                        <FormSelect :model-value="rule.matchMode" :options="promptRuleMatchModeOptions" dropdown-direction="down" @update:model-value="updatePromptReplacementRule(rule.id, {matchMode: $event as TextToImagePromptReplacementRule['matchMode']})" />
                                    </div>
                                    <FormTextarea :model-value="rule.trigger" :rows="2" placeholder="匹配内容或正则；追加/前置时可留空" @update:model-value="updatePromptReplacementRule(rule.id, {trigger: $event})" />
                                    <FormTextarea :model-value="rule.replacement" :rows="2" placeholder="替换/追加/前置内容；删除时可留空" @update:model-value="updatePromptReplacementRule(rule.id, {replacement: $event})" />
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            <!-- LLM 配置 -->
</template>
