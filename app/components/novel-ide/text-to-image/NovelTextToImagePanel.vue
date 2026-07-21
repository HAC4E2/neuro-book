<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import IconButton from "nbook/app/components/common/IconButton.vue";
import NovelAiProviderReconciliation from "nbook/app/components/novel-ide/text-to-image/NovelAiProviderReconciliation.vue";
import TextToImageCharacterMigrationPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageCharacterMigrationPanel.vue";
import TextToImageIllustrationWorkflowPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue";
import TextToImageProjectOverlayPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageProjectOverlayPanel.vue";
import TextToImageReferenceAssetsPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageReferenceAssetsPanel.vue";
import TextToImageStoryboardImportPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageStoryboardImportPanel.vue";
import TextToImageTagIndexSection from "nbook/app/components/novel-ide/text-to-image/TextToImageTagIndexSection.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNovelIdeStore, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    TEXT_TO_IMAGE_NEGATIVE_QUALITY_PRESETS,
    TEXT_TO_IMAGE_NOVELAI_NOISE_SCHEDULES,
    TEXT_TO_IMAGE_NOVELAI_SAMPLERS,
    TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS,
    useTextToImageStore,
    type NovelAiApiSettings,
    type TextToImageCharacter,
    type TextToImageCharacterTagKey,
    type TextToImageGenerationResult,
    type TextToImageOutfit,
    type TextToImageStylePreset,
} from "nbook/app/stores/text-to-image";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {IllustrationDirectorModelBindingDto} from "nbook/shared/dto/config.dto";
import type {
    TextToImageJobDto,
    TextToImageNovelAiReconciliationDto,
    TextToImageNovelAiReconciliationRequestDto,
} from "nbook/shared/dto/text-to-image.dto";
import type {WorkspaceTreeSnapshotDto} from "nbook/shared/dto/workspace-tree.dto";
import {
    NOVELAI_PROVIDER_MODEL_IDS,
    type NovelAiProviderModelId,
} from "nbook/shared/text-to-image-provider-registry";

type StyleTextFieldKey = "positivePrefix" | "positiveSuffix" | "negativePrefix" | "negativeSuffix";
type StyleBooleanKey = "useFurryDataset" | "positiveQualityPreset";
type NovelAiNumberKey = "promptGuidance" | "promptGuidanceRescale" | "width" | "height" | "steps" | "seed";
type NovelAiBooleanKey = "aiDefaultCharacterPosition" | "variety" | "smeaDyn" | "decrisper";
type NovelAiDimensionKey = "width" | "height";
type CharacterAddMode = "manual" | "project";
type TextToImagePanelSection = "generation" | "tagIndex" | "novelAi" | "style" | "characters" | "references";
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

const emit = defineEmits<{
    (e: "open-illustration-director-settings"): void;
}>();

const store = useTextToImageStore();
const novelIdeStore = useNovelIdeStore();
const configApi = useConfigApi();
const notification = useNotification();
const {
    activeCharacter,
    activeCharacterId,
    activeOutfit,
    activeOutfitId,
    activeStyle,
    activeNovelAiProviderId,
    characters,
    currentProjectPath,
    generationDraft,
    novelAi,
    novelAiProviderInspection,
    outfits,
    projectJobs,
    recipeDirty,
    recipeError,
    recipeExists,
    recipeLoading,
    recipeMigrationModelConflict,
    recipeMigrationPending,
    recipeSaving,
    recipeSnapshot,
} = storeToRefs(store);
const {configRevision, currentNovelId, novels} = storeToRefs(novelIdeStore);

const selectedTagInsertTarget = ref("generationPrompt");
const characterPhotoInputRef = ref<HTMLInputElement | null>(null);
const characterAddMode = ref<CharacterAddMode>("manual");
const sourceProjectPath = ref("");
const sourceCharacters = ref<SourceCharacterOption[]>([]);
const sourceCharacterPath = ref("");
const sourceLoading = ref(false);
const importingCharacter = ref(false);
const sourceError = ref("");
const illustrationDirectorBinding = ref<IllustrationDirectorModelBindingDto | null>(null);
const illustrationDirectorBindingLoading = ref(false);
const illustrationDirectorBindingError = ref("");
const projectOverlayRevision = ref(0);
const importStatus = ref("");
const generatingImage = ref(false);
const novelAiProviderName = ref("NovelAI");
const novelAiProviderCredential = ref("");
const novelAiProviderIntervalMs = ref(15_000);
const novelAiProviderSaving = ref(false);
const novelAiProviderTesting = ref(false);
const novelAiProviderReconciling = ref(false);
const novelAiProviderError = ref("");
const imageGenerationStatus = ref<"idle" | "queued">("idle");
const generationError = ref("");
const generationWarnings = ref<string[]>([]);
const collapsedSections = ref<Record<TextToImagePanelSection, boolean>>({
    generation: false,
    tagIndex: false,
    novelAi: false,
    style: false,
    characters: false,
    references: false,
});
const generationButtonLabel = computed(() => imageGenerationStatus.value === "queued" ? "排队中" : "生成");
const visibleGenerationQueueJobs = computed(() => projectJobs.value.slice(0, 6));
const generationQueueSummary = computed(() => {
    const jobs = projectJobs.value;
    return `运行 ${jobs.filter((job) => job.status === "running").length} · 排队 ${jobs.filter((job) => job.status === "queued").length} · 完成 ${jobs.filter((job) => job.status === "succeeded").length}`;
});

const novelAiModelLabels: Record<NovelAiProviderModelId, string> = {
    "nai-diffusion-4-5-full": "NAI Diffusion V4.5 Full",
    "nai-diffusion-4-5-curated": "NAI Diffusion V4.5 Curated",
    "nai-diffusion-4-full": "NAI Diffusion V4 Full",
    "nai-diffusion-4-curated-preview": "NAI Diffusion V4 Curated",
    "nai-diffusion-3": "NAI Diffusion V3",
    "nai-diffusion-furry-3": "Furry Diffusion V3",
};
const novelAiModelOptions: SelectOption[] = NOVELAI_PROVIDER_MODEL_IDS.map((modelId) => ({
    value: modelId,
    label: novelAiModelLabels[modelId],
}));

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

const isNovelAiV4Model = computed(() => /^nai-diffusion-4(?:-|$)/u.test(novelAi.value.model));
const novelAiSmeaModeOptions = computed<SelectOption[]>(() => isNovelAiV4Model.value ? [
    {value: "auto", label: "SMEA 自动", description: "V4 支持的自动模式"},
    {value: "off", label: "SMEA 关闭", description: "关闭 autoSmea"},
] : [
    {value: "auto", label: "SMEA 自动", description: "大尺寸时自动启用"},
    {value: "on", label: "SMEA 开启", description: "V3 发送 sm=true"},
    {value: "off", label: "SMEA 关闭", description: "强制关闭 sm"},
]);
const recipeMigrationModelChoices = computed(() => [...new Set([
    recipeMigrationModelConflict.value?.browserModel,
    ...(recipeMigrationModelConflict.value?.providerModels ?? []),
].filter((model): model is string => Boolean(model)))]);

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

const currentNovel = computed(() => novels.value.find((novel) => novel.id === currentNovelId.value || novel.projectPath === currentNovelId.value) ?? null);
const currentNovelTitle = computed(() => currentNovel.value?.title || currentNovelId.value || "未选择小说");

/** Director binding 的只读展示摘要，数据始终来自 Global Config。 */
const illustrationDirectorBindingSummary = computed(() => {
    const binding = illustrationDirectorBinding.value;
    if (!binding?.configured) {
        return binding?.modelKey ? `绑定已失效 · ${binding.modelKey}` : "尚未配置 Agent Runtime 模型";
    }
    return `${binding.providerName ?? binding.providerId} · ${binding.modelName ?? binding.modelId}`;
});
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
const userGenerationPrompt = computed(() => mergePromptPreview(
    generationDraft.value.includeActiveCharacter ? buildGenerationCharacterPrompt(activeCharacter.value) : "",
    generationDraft.value.prompt,
));
const generationPreviewPrompt = computed(() => mergePromptPreview(
    activeStyle.value?.positivePrefix,
    userGenerationPrompt.value,
    activeStyle.value?.positiveSuffix,
));
const generationPreviewNegativePrompt = computed(() => mergePromptPreview(
    activeStyle.value?.negativePrefix,
    generationDraft.value.negativePrompt,
    activeStyle.value?.negativeSuffix,
));
const canGenerateTextToImage = computed(() => {
    return !generatingImage.value
        && activeNovelAiProviderId.value !== null
        && recipeExists.value
        && !recipeDirty.value
        && recipeSnapshot.value !== null
        && userGenerationPrompt.value.trim().length > 0;
});

watch(novelAiProviderInspection, (inspection) => {
    if (inspection.state === "configured" && inspection.provider) {
        novelAiProviderName.value = inspection.provider.name;
        novelAiProviderIntervalMs.value = inspection.provider.settings.requestIntervalMs;
    }
}, {immediate: true});

watch(currentNovelId, (projectPath) => {
    store.setCurrentProjectPath(projectPath);
    if (projectPath) {
        void store.refreshProjectJobs(projectPath).catch(() => undefined);
        void store.loadRecipe(projectPath).catch(() => undefined);
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

watch(configRevision, () => {
    void loadIllustrationDirectorBinding();
});

/** 从 Global Config editor snapshot 读取 Director binding，只维护页面加载态。 */
async function loadIllustrationDirectorBinding(): Promise<void> {
    illustrationDirectorBindingLoading.value = true;
    illustrationDirectorBindingError.value = "";
    try {
        const snapshot = await configApi.editorSnapshot(configApi.globalQuery());
        illustrationDirectorBinding.value = snapshot.modelSettings.illustrationDirector;
    } catch (error) {
        illustrationDirectorBinding.value = null;
        illustrationDirectorBindingError.value = resolveApiErrorMessage(error, "读取插图 Director 模型绑定失败");
    } finally {
        illustrationDirectorBindingLoading.value = false;
    }
}

onMounted(async () => {
    store.ensureDefaults();
    await loadIllustrationDirectorBinding();
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
    if (!recipeExists.value || recipeDirty.value || !recipeSnapshot.value) {
        generationError.value = "请先保存当前 Project Recipe";
        notification.warning(generationError.value);
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
                prompt: userGenerationPrompt.value,
                negativePrompt: generationDraft.value.negativePrompt,
                count: generationDraft.value.batchSize,
                recipeId: "default",
                expectedRecipeSourceHash: recipeSnapshot.value.recipeSourceHash,
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
    const smeaMode = novelAiSmeaModeOptions.value.some((option) => option.value === value)
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
        completing: "完成处理中",
        succeeded: "完成",
        failed: "失败",
        canceled: "已取消",
        interrupted: "已中断",
        configuration_stale: "配置过期",
        outcome_unknown: "结果未知",
    };
    return labels[status];
}

function generationQueueJobIconClass(status: TextToImageJobDto["status"]): string {
    const icons: Record<TextToImageJobDto["status"], string> = {
        queued: "i-lucide-clock-3 text-[var(--status-warning)]",
        running: "i-lucide-loader-2 animate-spin text-[var(--status-info)]",
        completing: "i-lucide-loader-2 animate-spin text-[var(--status-info)]",
        succeeded: "i-lucide-check text-[var(--status-success)]",
        failed: "i-lucide-circle-alert text-[var(--status-danger)]",
        canceled: "i-lucide-ban text-[var(--text-muted)]",
        interrupted: "i-lucide-circle-pause text-[var(--status-warning)]",
        configuration_stale: "i-lucide-shield-alert text-[var(--status-warning)]",
        outcome_unknown: "i-lucide-circle-help text-[var(--status-danger)]",
    };
    return icons[status];
}

function formatGenerationQueueJobKind(kind: TextToImageJobDto["kind"]): string {
    const labels: Record<TextToImageJobDto["kind"], string> = {
        manual: "手动生成",
        body: "正文插图",
        character: "角色图",
        reroll: "重新生成",
        illustration: "Agent 插图",
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

/** 请求宿主打开 Global Models 中的 Director binding 卡。 */
function openIllustrationDirectorSettings(): void {
    emit("open-illustration-director-settings");
}

/** 全局 companion 切换后重建 Project overlay 编辑快照，避免继续编辑旧 base hash。 */
function handleGlobalStoryboardPublished(): void {
    projectOverlayRevision.value += 1;
}

/** 保存当前 Project Recipe；表单错误留在本页，成功反馈使用全局通知。 */
async function saveCurrentRecipe(): Promise<void> {
    try {
        await store.saveRecipe(currentProjectPath.value);
        notification.success("文生图 Recipe 已保存");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "保存文生图 Recipe 失败"));
    }
}

/** 放弃未保存编辑并重新读取 Project Recipe。 */
async function reloadCurrentRecipe(): Promise<void> {
    try {
        await store.loadRecipe(currentProjectPath.value);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "重新读取文生图 Recipe 失败"));
    }
}

/** 首次创建、后续更新同一条 NovelAI Provider；token 不进入 Pinia。 */
async function saveNovelAiProvider(): Promise<void> {
    if (novelAiProviderSaving.value || novelAiProviderInspection.value.state === "selection_required") {
        return;
    }
    if (activeNovelAiProviderId.value === null && !novelAiProviderCredential.value.trim()) {
        novelAiProviderError.value = "当前 NovelAI Provider 缺少 API token，本次保存必须填写";
        return;
    }
    novelAiProviderSaving.value = true;
    novelAiProviderError.value = "";
    try {
        await $fetch("/api/text-to-image/providers/novelai", {
            method: "PUT",
            body: {
                name: novelAiProviderName.value.trim() || "NovelAI",
                requestIntervalMs: novelAiProviderIntervalMs.value,
                ...(novelAiProviderCredential.value.trim() ? {credential: novelAiProviderCredential.value.trim()} : {}),
            },
        });
        await store.refreshProviders();
        notification.success("NovelAI Provider 已保存");
    } catch (error) {
        novelAiProviderError.value = resolveApiErrorMessage(error, "保存 NovelAI Provider 失败");
    } finally {
        novelAiProviderCredential.value = "";
        novelAiProviderSaving.value = false;
    }
}

/** 用当前已保存 Recipe 模型运行无图片计费的连接测试。 */
async function testNovelAiProvider(): Promise<void> {
    if (novelAiProviderTesting.value || activeNovelAiProviderId.value === null) {
        return;
    }
    novelAiProviderTesting.value = true;
    novelAiProviderError.value = "";
    try {
        await $fetch("/api/text-to-image/providers/novelai/test", {
            method: "POST",
            body: {projectPath: currentProjectPath.value},
        });
        notification.success("NovelAI API 与当前 Recipe 模型连接正常");
    } catch (error) {
        novelAiProviderError.value = resolveApiErrorMessage(error, "NovelAI 连接测试失败");
    } finally {
        novelAiProviderTesting.value = false;
    }
}

/** 显式收敛旧 NovelAI Provider；选择 token 变化时服务端以 409 拒绝陈旧确认。 */
async function reconcileNovelAiProvider(input: TextToImageNovelAiReconciliationRequestDto): Promise<void> {
    if (novelAiProviderReconciling.value) {
        return;
    }
    novelAiProviderReconciling.value = true;
    novelAiProviderError.value = "";
    try {
        const result = await $fetch<TextToImageNovelAiReconciliationDto>("/api/text-to-image/providers/novelai/reconcile", {
            method: "POST",
            body: input,
        });
        await store.refreshProviders();
        const staleCount = result.impacts.reduce((total, impact) => total + impact.configurationStale, 0);
        const unknownCount = result.impacts.reduce((total, impact) => total + impact.outcomeUnknown, 0);
        notification.success(`已保留唯一 NovelAI Provider；${staleCount} 个排队任务已过期，${unknownCount} 个在途任务结果未知。`);
    } catch (error) {
        novelAiProviderError.value = resolveApiErrorMessage(error, "收敛 NovelAI Provider 失败");
        await store.refreshProviders().catch(() => undefined);
    } finally {
        novelAiProviderReconciling.value = false;
    }
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

/** 从来源 Project 导入角色事实；Tag proposal 只允许走 Director + migration 链。 */
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
        const fallbackText = trimLongText([detail.summary, detail.content, detail.stateContent].filter((item) => item.trim()).join("\n\n"), 1200);
        const draft: Partial<TextToImageCharacter> = {
            cnName: detail.title,
            profileTraits: detail.summary || fallbackText,
            sourceProjectPath: detail.projectPath,
            sourceNovelTitle: detail.novelTitle,
            sourceCharacterPath: detail.path,
        };
        const importedCharacter = store.addCharacterFromDraft(draft);
        openCharacterWorkspace(importedCharacter);
        importStatus.value = `已从《${detail.novelTitle}》导入「${detail.title}」的角色事实；视觉 Tag 请通过 Director proposal 审核。`;
        notification.success(`已导入角色：${detail.title}`);
    } catch (error) {
        sourceError.value = resolveApiErrorMessage(error, "导入角色失败");
    } finally {
        importingCharacter.value = false;
    }
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
                    <IconButton title="历史图片" size="sm" :disabled="!currentProjectPath" @click="novelIdeStore.openTextToImageHistoryTab(currentProjectPath)">
                        <span class="i-lucide-images h-3.5 w-3.5"></span>
                    </IconButton>
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
                    <!-- Provider 只读引用：唯一配置在下方 singleton 卡片维护。 -->
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-2 py-2 text-[11px] text-[var(--text-secondary)]">
                        NovelAI Provider：{{ novelAiProviderInspection.state === "configured" ? `${novelAiProviderInspection.provider?.name}${novelAiProviderInspection.provider?.hasCredential ? "" : "（API token 未配置）"}` : novelAiProviderInspection.state === "selection_required" ? "需要显式选择旧配置" : "未配置" }}
                    </div>
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

                </div>
            </section>

            <!-- Workspace Root Danbooru 3K+ Tag 索引 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" :aria-expanded="!isSectionCollapsed('tagIndex')" @click="toggleSection('tagIndex')">
                        <span class="i-lucide-tags h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">Danbooru 3K+ Tag 索引</h3>
                        <span class="h-3.5 w-3.5 text-[var(--text-muted)]" :class="isSectionCollapsed('tagIndex') ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"></span>
                    </button>
                    <div class="w-[5.75rem]" aria-hidden="true"></div>
                </div>
                <div v-if="!isSectionCollapsed('tagIndex')" class="px-3 py-3">
                    <TextToImageTagIndexSection
                        v-model:selected-target="selectedTagInsertTarget"
                        :targets="tagInsertTargets"
                        @insert="insertVocabularyTag"
                    />
                </div>
            </section>

            <!-- NovelAI singleton Provider/API：每用户唯一配置入口 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="flex min-h-9 items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="i-lucide-key-round h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="truncate text-[12px] font-medium text-[var(--text-main)]">NovelAI Provider / API</h3>
                    </div>
                    <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="activeNovelAiProviderId !== null ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                        {{ activeNovelAiProviderId !== null ? "已配置" : novelAiProviderInspection.state === "selection_required" ? "需选择" : novelAiProviderInspection.state === "configured" ? "缺少 token" : "未配置" }}
                    </span>
                </div>
                <div class="space-y-3 px-3 py-3">
                    <NovelAiProviderReconciliation v-if="novelAiProviderInspection.state === 'selection_required'" :inspection="novelAiProviderInspection" :busy="novelAiProviderReconciling" :error="novelAiProviderError" @confirm="reconcileNovelAiProvider" />
                    <template v-else>
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">名称</span>
                            <FormInput :model-value="novelAiProviderName" @update:model-value="novelAiProviderName = $event" />
                        </label>
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">API token</span>
                            <FormInput :model-value="novelAiProviderCredential" type="password" :placeholder="novelAiProviderInspection.provider?.hasCredential ? '留空保留现有 token' : novelAiProviderInspection.state === 'configured' ? '当前配置缺少 token，本次保存必填' : '首次保存必填'" @update:model-value="novelAiProviderCredential = $event" />
                        </label>
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">请求间隔（毫秒，最低 15000）</span>
                            <FormInput :model-value="String(novelAiProviderIntervalMs)" type="number" min="15000" max="3600000" step="1000" @update:model-value="novelAiProviderIntervalMs = Math.max(15000, Math.round(Number($event) || 15000))" />
                        </label>
                        <p v-if="novelAiProviderError" class="m-0 text-[11px] text-[var(--status-danger)]">{{ novelAiProviderError }}</p>
                        <div class="flex justify-end gap-2">
                            <button type="button" class="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-color)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="novelAiProviderTesting || activeNovelAiProviderId === null || !recipeExists || recipeDirty" @click="void testNovelAiProvider()">
                                <span class="h-3.5 w-3.5" :class="novelAiProviderTesting ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-plug-zap'"></span>
                                测试 API / 模型
                            </button>
                            <button type="button" class="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="novelAiProviderSaving || (!novelAiProviderInspection.provider?.hasCredential && !novelAiProviderCredential.trim())" @click="void saveNovelAiProvider()">
                                <span class="h-3.5 w-3.5" :class="novelAiProviderSaving ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-save'"></span>
                                {{ novelAiProviderSaving ? "保存中" : "保存唯一 Provider" }}
                            </button>
                        </div>
                    </template>
                </div>
            </section>

            <!-- Project Recipe：NovelAI 参数与画风的唯一编辑入口 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" :aria-expanded="!isSectionCollapsed('novelAi')" @click="toggleSection('novelAi')">
                        <span class="i-lucide-key-round h-4 w-4 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">NovelAI Recipe</h3>
                        <span class="h-3.5 w-3.5 text-[var(--text-muted)]" :class="isSectionCollapsed('novelAi') ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"></span>
                    </button>
                    <div class="w-[5.75rem]" aria-hidden="true"></div>
                </div>
                <div v-if="!isSectionCollapsed('novelAi')" class="space-y-2 px-3 py-3">
                    <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/50 p-2">
                        <div class="flex items-center justify-between gap-2">
                            <div class="min-w-0">
                                <div class="text-[11px] font-medium text-[var(--text-main)]">Project Workspace Recipe</div>
                                <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">模型、采样、尺寸、seed、高级参数与正负画风串均保存到 Recipe Markdown。</div>
                            </div>
                            <span class="shrink-0 rounded-full border px-2 py-0.5 text-[10px]" :class="recipeDirty ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]' : recipeExists ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                                {{ recipeLoading ? "读取中" : recipeDirty ? "未保存" : recipeExists ? "已同步" : "待保存" }}
                            </span>
                        </div>
                        <p v-if="recipeMigrationPending" class="m-0 text-[10px] text-[var(--status-warning)]">已读取上一版本地草稿；请检查后显式保存，成功后只清理已迁移字段。</p>
                        <div v-if="recipeMigrationModelConflict" class="space-y-1.5 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2 text-[10px] text-[var(--status-warning)]">
                            <p class="m-0">旧 Provider 实际模型与浏览器草稿不一致。请选择本 Project Recipe 要保留的模型，系统不会自动猜选。</p>
                            <div class="flex flex-wrap gap-1.5">
                                <button v-for="model in recipeMigrationModelChoices" :key="model" type="button" class="rounded border border-[var(--status-warning-border)] px-2 py-1 hover:bg-[var(--bg-hover)]" @click="store.confirmRecipeMigrationModel(model)">{{ model }}</button>
                            </div>
                        </div>
                        <p v-if="recipeError" class="m-0 text-[10px] text-[var(--status-danger)]">{{ recipeError }}</p>
                        <div class="flex justify-end gap-2">
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" :disabled="recipeLoading || recipeSaving" @click="void reloadCurrentRecipe()">
                                <span class="i-lucide-refresh-cw h-3 w-3"></span>
                                重新读取
                            </button>
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent-main)] px-2 text-[10px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="recipeLoading || recipeSaving || (!recipeDirty && recipeExists)" @click="void saveCurrentRecipe()">
                                <span class="i-lucide-save h-3 w-3"></span>
                                {{ recipeSaving ? "保存中" : "保存 Recipe" }}
                            </button>
                        </div>
                    </div>
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
                            <span v-if="isNovelAiV4Model" class="mt-1 block text-[10px] text-[var(--text-muted)]">V4 仅支持自动或关闭；手动 SMEA 与 SMEA Dyn 只适用于 V3。</span>
                        </label>
                        <div class="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                class="grid min-h-10 grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors"
                                :class="isNovelAiV4Model ? 'cursor-not-allowed border-[var(--border-color)] bg-[var(--bg-panel)]/50 text-[var(--text-muted)] opacity-60' : novelAi.smeaDyn ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)]/50 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                :aria-pressed="novelAi.smeaDyn"
                                :disabled="isNovelAiV4Model"
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
                    <div class="w-[5.75rem]" aria-hidden="true"></div>
                </div>
                <div v-if="!isSectionCollapsed('style')" class="space-y-3 px-3 py-3">
                    <template v-if="activeStyle">
                        <label class="block">
                            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">Recipe 名称</span>
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

                    </template>
                </div>
            </section>

            <!-- P5 参考资产：内容寻址上传 + Vibe/CharRef/Inpaint 槽位 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="flex min-h-9 items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-2">
                    <button type="button" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_0.875rem] items-center gap-2 text-left" :aria-expanded="!isSectionCollapsed('references')" @click="toggleSection('references')">
                        <span class="i-lucide-images h-4 w-4 shrink-0 text-[var(--text-secondary)]" :class="{'rotate-90': !isSectionCollapsed('references')}"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">参考资产</h3>
                    </button>
                </div>
                <div v-show="!isSectionCollapsed('references')" class="px-3 py-2.5">
                    <TextToImageReferenceAssetsPanel :project-path="currentProjectPath" />
                </div>
            </section>

            <!-- 插图 Director：只读 Global Config binding，不在文生图域保存模型配置 -->
            <section class="mb-4 w-full rounded-md border border-[var(--border-accent)] bg-[var(--accent-bg)]">
                <div class="flex min-h-9 items-center justify-between gap-2 border-b border-[var(--border-accent)] px-3 py-2">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="i-lucide-clapperboard h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                        <h3 class="min-w-0 truncate text-[12px] font-medium text-[var(--text-main)]">插图 Director</h3>
                    </div>
                    <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium" :class="illustrationDirectorBinding?.configured ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                        {{ illustrationDirectorBindingLoading ? "读取中" : illustrationDirectorBinding?.configured ? "已配置" : "未配置" }}
                    </span>
                </div>
                <div class="space-y-3 px-3 py-3">
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
                        <div class="text-[11px] text-[var(--text-secondary)]">Agent Runtime provider / model binding</div>
                        <div class="mt-1 text-[12px] font-medium text-[var(--text-main)]">{{ illustrationDirectorBindingSummary }}</div>
                        <div class="mt-1 text-[11px] text-[var(--text-muted)]">连通性：不在此页保存；请在模型配置中运行连接与模型测试。</div>
                    </div>
                    <p v-if="illustrationDirectorBindingError" class="m-0 text-[11px] text-[var(--status-danger)]">{{ illustrationDirectorBindingError }}</p>
                    <div class="flex items-center justify-end gap-2">
                        <button v-if="illustrationDirectorBindingError" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" :disabled="illustrationDirectorBindingLoading" @click="void loadIllustrationDirectorBinding()">
                            <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
                            重试
                        </button>
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90" @click="openIllustrationDirectorSettings">
                            <span class="i-lucide-settings-2 h-3.5 w-3.5"></span>
                            {{ illustrationDirectorBinding?.configured ? "查看 / 测试模型" : "前往配置模型" }}
                        </button>
                    </div>
                </div>
            </section>

            <TextToImageStoryboardImportPanel :project-path="currentProjectPath" :director-configured="illustrationDirectorBinding?.configured === true" @open-director-settings="openIllustrationDirectorSettings" @global-published="handleGlobalStoryboardPublished" />
            <TextToImageProjectOverlayPanel :key="`${currentProjectPath}:${projectOverlayRevision}`" :project-path="currentProjectPath" />
            <TextToImageIllustrationWorkflowPanel :project-path="currentProjectPath" />
            <TextToImageCharacterMigrationPanel :project-path="currentProjectPath" />
        </div>
    </div>
</template>
