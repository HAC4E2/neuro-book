export type NovelAiApiSettings = {
    token: string;
    apiBaseUrl: string;
    imageBaseUrl: string;
    model: string;
    sampler: string;
    noiseSchedule: string;
    promptGuidance: number;
    promptGuidanceRescale: number;
    aiDefaultCharacterPosition: boolean;
    variety: boolean;
    sizePreset: string;
    width: number;
    height: number;
    steps: number;
    seed: number;
};

export type TextToImageLlmParameters = {
    temperature: number;
    topP: number;
    maxTokens: number;
};

export type TextToImageLlmSettings = {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    availableModels: string[];
    parameters: TextToImageLlmParameters;
    stream: boolean;
    sendImages: boolean;
    activeApiConfigId: string;
    apiConfigs: TextToImageLlmApiConfig[];
};

export type TextToImageLlmApiConfig = {
    id: string;
    name: string;
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    availableModels: string[];
    parameters: TextToImageLlmParameters;
    stream: boolean;
    sendImages: boolean;
};

export type TextToImageLlmContextRole = "system" | "user" | "assistant";

export type TextToImageLlmContextEntry = {
    id: string;
    name: string;
    role: TextToImageLlmContextRole;
    content: string;
    enabled: boolean;
};

export type TextToImageLlmContextPreset = {
    id: string;
    name: string;
    entries: TextToImageLlmContextEntry[];
    updatedAt: string | null;
};

export type TextToImageLlmTaskBinding = {
    task: TextToImagePromptTask;
    apiConfigId: string;
    contextPresetId: string;
};

export type TextToImageOutputSettings = {
    imageSavePath: string;
};

export type TextToImageGenerationDraft = {
    prompt: string;
    negativePrompt: string;
    includeActiveCharacter: boolean;
};

export type TextToImageGenerationResult = {
    id: string;
    createdAt: string;
    fileName: string;
    savedPath: string;
    metadataPath: string;
    dataUrl: string;
    mimeType: string;
    byteLength: number;
    seed: number;
    width: number;
    height: number;
    model: string;
    prompt: string;
    negativePrompt: string;
};

export type TextToImagePromptTask = "bodyImage" | "characterDesign" | "characterRevision";

export type TextToImageTaskPrompt = {
    task: TextToImagePromptTask;
    prompt: string;
    importedName: string;
    updatedAt: string | null;
};

export type TextToImageVibeReference = {
    id: string;
    enabled: boolean;
    displayName: string;
    vibeEncoding: string;
    imageDataUrl: string;
    sourceType: "png" | "naiv4vibe" | "naiv4vibebundle" | "rawImage";
    strength: number;
    infoExtracted: number;
};

export type TextToImageNegativeQualityPreset = "none" | "heavy" | "light" | "humanFocus" | "furryFocus";

export type TextToImageStylePreset = {
    id: string;
    name: string;
    positivePrefix: string;
    positiveSuffix: string;
    negativePrefix: string;
    negativeSuffix: string;
    useFurryDataset: boolean;
    positiveQualityPreset: boolean;
    negativeQualityPreset: TextToImageNegativeQualityPreset;
    vibeReferences: TextToImageVibeReference[];
};

export type TextToImageCharacter = {
    id: string;
    cnName: string;
    enName: string;
    portraitDataUrl: string;
    photoPrompt: string;
    sendPhoto: boolean;
    profileTraits: string;
    facialAppearance: string;
    facialBack: string;
    upperSfw: string;
    upperBackSfw: string;
    lowerSfw: string;
    lowerBackSfw: string;
    upperNsfw: string;
    upperBackNsfw: string;
    lowerNsfw: string;
    lowerBackNsfw: string;
    sourceProjectPath: string;
    sourceNovelTitle: string;
    sourceCharacterPath: string;
};

export type TextToImageCharacterTagKey = Exclude<keyof TextToImageCharacter, "id" | "cnName" | "enName" | "portraitDataUrl" | "photoPrompt" | "sendPhoto" | "sourceProjectPath" | "sourceNovelTitle" | "sourceCharacterPath">;

export type TextToImageProjectCharacterGroup = {
    projectPath: string;
    characters: TextToImageCharacter[];
    activeCharacterId: string | null;
};

export const MAX_TEXT_TO_IMAGE_LLM_TOKENS = 30000;

export const TEXT_TO_IMAGE_NOVELAI_SAMPLERS: Array<{value: string; label: string}> = [
    {value: "k_euler", label: "Euler"},
    {value: "k_euler_ancestral", label: "Euler Ancestral"},
    {value: "k_dpmpp_2m", label: "DPM++ 2M"},
    {value: "k_dpmpp_2m_sde", label: "DPM++ 2M SDE"},
    {value: "k_dpmpp_2s_ancestral", label: "DPM++ 2S Ancestral"},
    {value: "k_dpmpp_sde", label: "DPM++ SDE"},
    {value: "ddim", label: "DDIM"},
    {value: "ddim_v3", label: "DDIM V3"},
];

export const TEXT_TO_IMAGE_NOVELAI_NOISE_SCHEDULES: Array<{value: string; label: string}> = [
    {value: "native", label: "Native"},
    {value: "karras", label: "Karras"},
    {value: "exponential", label: "Exponential"},
    {value: "polyexponential", label: "Polyexponential"},
];

export const TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS: Array<{value: string; label: string; width: number; height: number}> = [
    {value: "normal_portrait", label: "Normal Portrait (832x1216)", width: 832, height: 1216},
    {value: "normal_landscape", label: "Normal Landscape (1216x832)", width: 1216, height: 832},
    {value: "normal_square", label: "Normal Square (1024x1024)", width: 1024, height: 1024},
    {value: "large_portrait", label: "Large Portrait (1024x1536)", width: 1024, height: 1536},
    {value: "large_landscape", label: "Large Landscape (1536x1024)", width: 1536, height: 1024},
    {value: "large_square", label: "Large Square (1472x1472)", width: 1472, height: 1472},
    {value: "wallpaper_portrait", label: "Wallpaper Portrait (1088x1920)", width: 1088, height: 1920},
    {value: "wallpaper_landscape", label: "Wallpaper Landscape (1920x1088)", width: 1920, height: 1088},
    {value: "small_portrait", label: "Small Portrait (512x768)", width: 512, height: 768},
    {value: "small_landscape", label: "Small Landscape (768x512)", width: 768, height: 512},
    {value: "small_square", label: "Small Square (640x640)", width: 640, height: 640},
    {value: "custom", label: "Custom", width: 0, height: 0},
];

export const TEXT_TO_IMAGE_NEGATIVE_QUALITY_PRESETS: Array<{value: TextToImageNegativeQualityPreset; label: string; description: string}> = [
    {value: "none", label: "无 None", description: "不添加 NovelAI 负面质量预设"},
    {value: "heavy", label: "Heavy", description: "重度过滤，排除范围最强"},
    {value: "light", label: "Light", description: "轻度过滤，保留更多画面自由度"},
    {value: "humanFocus", label: "Human Focus", description: "人物聚焦，额外排除解剖问题"},
    {value: "furryFocus", label: "Furry Focus", description: "Furry 聚焦，适合 Furry 数据集/模型"},
];

export const TEXT_TO_IMAGE_PROMPT_TASKS: Array<{key: TextToImagePromptTask; label: string; description: string}> = [
    {key: "bodyImage", label: "正文图片生成", description: "把正文片段转换为画面 prompt"},
    {key: "characterDesign", label: "角色/服装设计", description: "从人物设定生成角色和服装 tag"},
    {key: "characterRevision", label: "角色/服装修改", description: "根据修改意见重写角色和服装 tag"},
];

const DEFAULT_PROJECT_KEY = "__unbound__";

const DEFAULT_LLM_PARAMETERS: TextToImageLlmParameters = {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 4096,
};

const DEFAULT_OUTPUT_SETTINGS: TextToImageOutputSettings = {
    imageSavePath: "",
};

const DEFAULT_GENERATION_DRAFT: TextToImageGenerationDraft = {
    prompt: "",
    negativePrompt: "",
    includeActiveCharacter: true,
};

const DEFAULT_NOVEL_AI_SETTINGS: NovelAiApiSettings = {
    token: "",
    apiBaseUrl: "https://api.novelai.net",
    imageBaseUrl: "https://image.novelai.net",
    model: "nai-diffusion-4-5-full",
    sampler: "k_euler_ancestral",
    noiseSchedule: "karras",
    promptGuidance: 5,
    promptGuidanceRescale: 0,
    aiDefaultCharacterPosition: true,
    variety: false,
    sizePreset: "normal_portrait",
    width: 832,
    height: 1216,
    steps: 28,
    seed: -1,
};

/**
 * 创建浏览器本地可用的轻量 ID。
 */
function createLocalId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 创建一条 LLM API 配置。
 */
function createLlmApiConfig(name = "默认", patch: Partial<TextToImageLlmApiConfig> = {}): TextToImageLlmApiConfig {
    return {
        id: patch.id ?? createLocalId("llm_api"),
        name: patch.name ?? name,
        apiBaseUrl: patch.apiBaseUrl ?? "",
        apiKey: patch.apiKey ?? "",
        model: patch.model ?? "",
        availableModels: patch.availableModels ?? [],
        parameters: normalizeLlmParameters(patch.parameters ?? DEFAULT_LLM_PARAMETERS),
        stream: patch.stream ?? false,
        sendImages: patch.sendImages ?? false,
    };
}

/**
 * 创建一条上下文条目。
 */
function createLlmContextEntry(name = "新条目", patch: Partial<TextToImageLlmContextEntry> = {}): TextToImageLlmContextEntry {
    const role = patch.role === "user" || patch.role === "assistant" || patch.role === "system" ? patch.role : "system";
    return {
        id: patch.id ?? createLocalId("llm_ctx_entry"),
        name: patch.name ?? name,
        role,
        content: patch.content ?? "",
        enabled: patch.enabled ?? true,
    };
}

/**
 * 创建一组上下文预设。
 */
function createLlmContextPreset(name = "默认上下文", patch: Partial<TextToImageLlmContextPreset> = {}): TextToImageLlmContextPreset {
    return {
        id: patch.id ?? createLocalId("llm_ctx"),
        name: patch.name ?? name,
        entries: (patch.entries ?? []).map((entry, index) => createLlmContextEntry(entry.name || `条目 ${index + 1}`, entry)),
        updatedAt: patch.updatedAt ?? null,
    };
}

/**
 * 将当前小说路径归一化为角色分组 key。
 */
function normalizeProjectPath(projectPath: string): string {
    const normalized = projectPath.trim();
    return normalized || DEFAULT_PROJECT_KEY;
}

/**
 * 限制数值范围，避免持久化恢复出非法参数。
 */
function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, value));
}

/**
 * 创建 NovelAI 默认配置。
 */
function createDefaultNovelAiSettings(): NovelAiApiSettings {
    return {...DEFAULT_NOVEL_AI_SETTINGS};
}

/**
 * 规整 NovelAI 配置，兼容旧版持久化数据。
 */
function normalizeNovelAiSettings(settings: Partial<NovelAiApiSettings> = {}): NovelAiApiSettings {
    const width = Math.round(clampNumber(Number(settings.width ?? DEFAULT_NOVEL_AI_SETTINGS.width), 64, 4096, DEFAULT_NOVEL_AI_SETTINGS.width));
    const height = Math.round(clampNumber(Number(settings.height ?? DEFAULT_NOVEL_AI_SETTINGS.height), 64, 4096, DEFAULT_NOVEL_AI_SETTINGS.height));
    const sizePreset = TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS.some((preset) => preset.value === settings.sizePreset)
        ? settings.sizePreset ?? DEFAULT_NOVEL_AI_SETTINGS.sizePreset
        : TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS.find((preset) => preset.width === width && preset.height === height)?.value ?? DEFAULT_NOVEL_AI_SETTINGS.sizePreset;

    return {
        ...DEFAULT_NOVEL_AI_SETTINGS,
        ...settings,
        token: settings.token ?? DEFAULT_NOVEL_AI_SETTINGS.token,
        apiBaseUrl: settings.apiBaseUrl ?? DEFAULT_NOVEL_AI_SETTINGS.apiBaseUrl,
        imageBaseUrl: settings.imageBaseUrl ?? DEFAULT_NOVEL_AI_SETTINGS.imageBaseUrl,
        model: settings.model ?? DEFAULT_NOVEL_AI_SETTINGS.model,
        sampler: settings.sampler ?? DEFAULT_NOVEL_AI_SETTINGS.sampler,
        noiseSchedule: settings.noiseSchedule ?? DEFAULT_NOVEL_AI_SETTINGS.noiseSchedule,
        promptGuidance: clampNumber(Number(settings.promptGuidance ?? DEFAULT_NOVEL_AI_SETTINGS.promptGuidance), 0, 20, DEFAULT_NOVEL_AI_SETTINGS.promptGuidance),
        promptGuidanceRescale: clampNumber(Number(settings.promptGuidanceRescale ?? DEFAULT_NOVEL_AI_SETTINGS.promptGuidanceRescale), 0, 1, DEFAULT_NOVEL_AI_SETTINGS.promptGuidanceRescale),
        aiDefaultCharacterPosition: settings.aiDefaultCharacterPosition ?? DEFAULT_NOVEL_AI_SETTINGS.aiDefaultCharacterPosition,
        variety: settings.variety ?? DEFAULT_NOVEL_AI_SETTINGS.variety,
        sizePreset,
        width,
        height,
        steps: Math.round(clampNumber(Number(settings.steps ?? DEFAULT_NOVEL_AI_SETTINGS.steps), 1, 50, DEFAULT_NOVEL_AI_SETTINGS.steps)),
        seed: Math.round(clampNumber(Number(settings.seed ?? DEFAULT_NOVEL_AI_SETTINGS.seed), -1, 4294967295, DEFAULT_NOVEL_AI_SETTINGS.seed)),
    };
}

/**
 * 创建一条 Vibe 氛围转移参考。
 */
function createVibeReference(name = "Vibe Reference", patch: Partial<TextToImageVibeReference> = {}): TextToImageVibeReference {
    const id = patch.id ?? createLocalId("vibe");
    return {
        id,
        enabled: patch.enabled ?? true,
        displayName: patch.displayName ?? name,
        vibeEncoding: patch.vibeEncoding ?? "",
        imageDataUrl: patch.imageDataUrl ?? "",
        sourceType: patch.sourceType ?? "rawImage",
        strength: clampNumber(Number(patch.strength ?? 0.6), 0, 1, 0.6),
        infoExtracted: clampNumber(Number(patch.infoExtracted ?? 0.7), 0, 1, 0.7),
    };
}

/**
 * 规整画风串，兼容没有 Vibe 字段的旧配置。
 */
function normalizeStylePreset(style: Partial<TextToImageStylePreset>, fallbackName: string): TextToImageStylePreset {
    const negativeQualityPreset = TEXT_TO_IMAGE_NEGATIVE_QUALITY_PRESETS.some((preset) => preset.value === style.negativeQualityPreset)
        ? style.negativeQualityPreset ?? "none"
        : "none";
    return {
        id: style.id ?? createLocalId("style"),
        name: style.name ?? fallbackName,
        positivePrefix: style.positivePrefix ?? "",
        positiveSuffix: style.positiveSuffix ?? "",
        negativePrefix: style.negativePrefix ?? "",
        negativeSuffix: style.negativeSuffix ?? "",
        useFurryDataset: style.useFurryDataset ?? false,
        positiveQualityPreset: style.positiveQualityPreset ?? true,
        negativeQualityPreset,
        vibeReferences: (style.vibeReferences ?? []).map((reference, index) => createVibeReference(reference.displayName || `Vibe ${index + 1}`, reference)),
    };
}

/**
 * 创建一条空画风串配置。
 */
function createStylePreset(name = "默认画风串"): TextToImageStylePreset {
    return {
        id: createLocalId("style"),
        name,
        positivePrefix: "",
        positiveSuffix: "",
        negativePrefix: "",
        negativeSuffix: "",
        useFurryDataset: false,
        positiveQualityPreset: true,
        negativeQualityPreset: "none",
        vibeReferences: [],
    };
}

/**
 * 创建一条空角色 tag 配置。
 */
function createCharacter(name = "新角色", patch: Partial<TextToImageCharacter> = {}): TextToImageCharacter {
    const id = patch.id ?? createLocalId("character");
    return {
        cnName: name,
        enName: "",
        portraitDataUrl: "",
        photoPrompt: "",
        sendPhoto: false,
        profileTraits: "",
        facialAppearance: "",
        facialBack: "",
        upperSfw: "",
        upperBackSfw: "",
        lowerSfw: "",
        lowerBackSfw: "",
        upperNsfw: "",
        upperBackNsfw: "",
        lowerNsfw: "",
        lowerBackNsfw: "",
        sourceProjectPath: "",
        sourceNovelTitle: "",
        sourceCharacterPath: "",
        ...patch,
        id,
    };
}

/**
 * 创建一组小说绑定的角色配置。
 */
function createCharacterGroup(projectPath: string): TextToImageProjectCharacterGroup {
    return {
        projectPath,
        characters: [],
        activeCharacterId: null,
    };
}

/**
 * 创建单个任务提示词配置。
 */
function createTaskPrompt(task: TextToImagePromptTask, prompt = ""): TextToImageTaskPrompt {
    return {
        task,
        prompt,
        importedName: "",
        updatedAt: null,
    };
}

/**
 * 创建任务提示词默认集合。
 */
function createDefaultTaskPrompts(): Record<TextToImagePromptTask, TextToImageTaskPrompt> {
    return {
        bodyImage: createTaskPrompt("bodyImage"),
        characterDesign: createTaskPrompt("characterDesign", [
            "你是 NovelAI 角色与服装 tag 设计助手。",
            "根据输入的人物设定，输出适合文生图使用的英文 tag。",
            "保持字段名不变，不要输出额外解释。",
        ].join("\n")),
        characterRevision: createTaskPrompt("characterRevision"),
    };
}

/**
 * 创建任务到 LLM API/上下文的默认绑定。
 */
function createDefaultLlmTaskBindings(apiConfigId = "", contextPresetId = ""): Record<TextToImagePromptTask, TextToImageLlmTaskBinding> {
    return {
        bodyImage: {task: "bodyImage", apiConfigId, contextPresetId},
        characterDesign: {task: "characterDesign", apiConfigId, contextPresetId},
        characterRevision: {task: "characterRevision", apiConfigId, contextPresetId},
    };
}

/**
 * 规整 LLM 参数。
 */
function normalizeLlmParameters(parameters: Partial<TextToImageLlmParameters>): TextToImageLlmParameters {
    return {
        temperature: clampNumber(parameters.temperature ?? DEFAULT_LLM_PARAMETERS.temperature, 0, 2, DEFAULT_LLM_PARAMETERS.temperature),
        topP: clampNumber(parameters.topP ?? DEFAULT_LLM_PARAMETERS.topP, 0, 1, DEFAULT_LLM_PARAMETERS.topP),
        maxTokens: Math.round(clampNumber(parameters.maxTokens ?? DEFAULT_LLM_PARAMETERS.maxTokens, 1, MAX_TEXT_TO_IMAGE_LLM_TOKENS, DEFAULT_LLM_PARAMETERS.maxTokens)),
    };
}

/**
 * 规整 LLM API 配置。
 */
function normalizeLlmApiConfig(config: Partial<TextToImageLlmApiConfig>, fallbackName: string): TextToImageLlmApiConfig {
    return createLlmApiConfig(fallbackName, {
        ...config,
        name: config.name?.trim() || fallbackName,
        apiBaseUrl: config.apiBaseUrl ?? "",
        apiKey: config.apiKey ?? "",
        model: config.model ?? "",
        availableModels: config.availableModels ?? [],
        parameters: normalizeLlmParameters(config.parameters ?? DEFAULT_LLM_PARAMETERS),
        stream: config.stream ?? false,
        sendImages: config.sendImages ?? false,
    });
}

/**
 * 规整 LLM 连接设置，兼容旧版只有单一 llm 配置的持久化数据。
 */
function normalizeLlmSettings(settings: Partial<TextToImageLlmSettings> = {}): TextToImageLlmSettings {
    const seededApiConfig = createLlmApiConfig("默认", {
        apiBaseUrl: settings.apiBaseUrl ?? "",
        apiKey: settings.apiKey ?? "",
        model: settings.model ?? "",
        availableModels: settings.availableModels ?? [],
        parameters: normalizeLlmParameters(settings.parameters ?? DEFAULT_LLM_PARAMETERS),
        stream: settings.stream ?? false,
        sendImages: settings.sendImages ?? false,
    });
    const apiConfigs = (settings.apiConfigs?.length ? settings.apiConfigs : [seededApiConfig])
        .map((config, index) => normalizeLlmApiConfig(config, index === 0 ? "默认" : `API 配置 ${index + 1}`));
    const activeApiConfigId = apiConfigs.some((config) => config.id === settings.activeApiConfigId)
        ? settings.activeApiConfigId ?? apiConfigs[0]?.id ?? ""
        : apiConfigs[0]?.id ?? "";
    const activeConfig = apiConfigs.find((config) => config.id === activeApiConfigId) ?? apiConfigs[0] ?? seededApiConfig;
    return {
        apiBaseUrl: settings.apiBaseUrl ?? activeConfig.apiBaseUrl,
        apiKey: settings.apiKey ?? activeConfig.apiKey,
        model: settings.model ?? activeConfig.model,
        availableModels: settings.availableModels ?? activeConfig.availableModels,
        parameters: normalizeLlmParameters(settings.parameters ?? activeConfig.parameters),
        stream: settings.stream ?? activeConfig.stream,
        sendImages: settings.sendImages ?? activeConfig.sendImages,
        activeApiConfigId,
        apiConfigs,
    };
}

/**
 * 规整上下文预设。
 */
function normalizeLlmContextPreset(preset: Partial<TextToImageLlmContextPreset>, fallbackName: string): TextToImageLlmContextPreset {
    return createLlmContextPreset(fallbackName, {
        ...preset,
        name: preset.name?.trim() || fallbackName,
        entries: (preset.entries ?? []).map((entry, index) => createLlmContextEntry(entry.name || `条目 ${index + 1}`, entry)),
        updatedAt: preset.updatedAt ?? null,
    });
}

/**
 * 规整文生图输出设置。
 */
function normalizeOutputSettings(settings: Partial<TextToImageOutputSettings> = {}): TextToImageOutputSettings {
    const imageSavePath = settings.imageSavePath?.trim() ?? DEFAULT_OUTPUT_SETTINGS.imageSavePath;
    return {
        imageSavePath: imageSavePath === "images/text-to-image" ? "" : imageSavePath,
    };
}

/**
 * 规整当前生成草稿。
 */
function normalizeGenerationDraft(settings: Partial<TextToImageGenerationDraft> = {}): TextToImageGenerationDraft {
    return {
        prompt: settings.prompt ?? DEFAULT_GENERATION_DRAFT.prompt,
        negativePrompt: settings.negativePrompt ?? DEFAULT_GENERATION_DRAFT.negativePrompt,
        includeActiveCharacter: settings.includeActiveCharacter ?? DEFAULT_GENERATION_DRAFT.includeActiveCharacter,
    };
}

/**
 * 文生图配置工作台的本地状态。
 */
export const useTextToImageStore = defineStore("textToImage", () => {
    const defaultStyle = createStylePreset();
    const defaultPrompts = createDefaultTaskPrompts();

    const novelAi = ref<NovelAiApiSettings>(createDefaultNovelAiSettings());
    const llm = ref<TextToImageLlmSettings>(normalizeLlmSettings());
    const output = ref<TextToImageOutputSettings>({...DEFAULT_OUTPUT_SETTINGS});
    const generationDraft = ref<TextToImageGenerationDraft>({...DEFAULT_GENERATION_DRAFT});
    const generationResults = ref<TextToImageGenerationResult[]>([]);
    const taskPrompts = ref<Record<TextToImagePromptTask, TextToImageTaskPrompt>>(defaultPrompts);
    const defaultContextPreset = createLlmContextPreset();
    const llmContextPresets = ref<TextToImageLlmContextPreset[]>([defaultContextPreset]);
    const activeLlmContextPresetId = ref(defaultContextPreset.id);
    const llmTaskBindings = ref<Record<TextToImagePromptTask, TextToImageLlmTaskBinding>>(createDefaultLlmTaskBindings(llm.value.activeApiConfigId, defaultContextPreset.id));
    const stylePresets = ref<TextToImageStylePreset[]>([defaultStyle]);
    const activeStyleId = ref(defaultStyle.id);
    const currentProjectPath = ref(DEFAULT_PROJECT_KEY);
    const characterGroups = ref<Record<string, TextToImageProjectCharacterGroup>>({
        [DEFAULT_PROJECT_KEY]: createCharacterGroup(DEFAULT_PROJECT_KEY),
    });

    const activeProjectKey = computed(() => normalizeProjectPath(currentProjectPath.value));
    const activeStyle = computed(() => stylePresets.value.find((item) => item.id === activeStyleId.value) ?? stylePresets.value[0] ?? null);
    const activeLlmApiConfig = computed(() => llm.value.apiConfigs.find((config) => config.id === llm.value.activeApiConfigId) ?? llm.value.apiConfigs[0] ?? null);
    const activeLlmContextPreset = computed(() => llmContextPresets.value.find((preset) => preset.id === activeLlmContextPresetId.value) ?? llmContextPresets.value[0] ?? null);
    const activeCharacterGroup = computed(() => characterGroups.value[activeProjectKey.value] ?? createCharacterGroup(activeProjectKey.value));
    const characters = computed(() => activeCharacterGroup.value.characters);
    const activeCharacterId = computed(() => activeCharacterGroup.value.activeCharacterId);
    const activeCharacter = computed(() => characters.value.find((item) => item.id === activeCharacterId.value) ?? characters.value[0] ?? null);

    /**
     * 确保指定小说存在角色分组。
     */
    function ensureProjectGroup(projectPath = currentProjectPath.value): TextToImageProjectCharacterGroup {
        const key = normalizeProjectPath(projectPath);
        const existing = characterGroups.value[key];
        if (existing) {
            return existing;
        }
        const group = createCharacterGroup(key);
        characterGroups.value = {
            ...characterGroups.value,
            [key]: group,
        };
        return group;
    }

    /**
     * 写回指定小说的角色分组。
     */
    function updateProjectGroup(projectPath: string, group: TextToImageProjectCharacterGroup): void {
        const key = normalizeProjectPath(projectPath);
        characterGroups.value = {
            ...characterGroups.value,
            [key]: {
                ...group,
                projectPath: key,
            },
        };
    }

    /**
     * 切换当前小说绑定的角色分组。
     */
    function setCurrentProjectPath(projectPath: string): void {
        currentProjectPath.value = normalizeProjectPath(projectPath);
        ensureProjectGroup(currentProjectPath.value);
        ensureDefaults();
    }

    /**
     * 修复持久化恢复后可能缺失的默认数据。
     */
    function ensureDefaults(): void {
        novelAi.value = normalizeNovelAiSettings(novelAi.value);
        output.value = normalizeOutputSettings(output.value);
        generationDraft.value = normalizeGenerationDraft(generationDraft.value);
        llm.value = normalizeLlmSettings(llm.value);
        if (llmContextPresets.value.length === 0) {
            const preset = createLlmContextPreset();
            llmContextPresets.value = [preset];
            activeLlmContextPresetId.value = preset.id;
        }
        llmContextPresets.value = llmContextPresets.value.map((preset, index) => normalizeLlmContextPreset(preset, index === 0 ? "默认上下文" : `上下文预设 ${index + 1}`));
        if (!llmContextPresets.value.some((preset) => preset.id === activeLlmContextPresetId.value)) {
            activeLlmContextPresetId.value = llmContextPresets.value[0]?.id ?? "";
        }
        const defaultApiConfigId = llm.value.activeApiConfigId || (llm.value.apiConfigs[0]?.id ?? "");
        const defaultContextPresetId = activeLlmContextPresetId.value || (llmContextPresets.value[0]?.id ?? "");
        const defaultBindings = createDefaultLlmTaskBindings(defaultApiConfigId, defaultContextPresetId);
        llmTaskBindings.value = {
            bodyImage: {
                ...defaultBindings.bodyImage,
                ...(llmTaskBindings.value.bodyImage ?? {}),
                task: "bodyImage",
            },
            characterDesign: {
                ...defaultBindings.characterDesign,
                ...(llmTaskBindings.value.characterDesign ?? {}),
                task: "characterDesign",
            },
            characterRevision: {
                ...defaultBindings.characterRevision,
                ...(llmTaskBindings.value.characterRevision ?? {}),
                task: "characterRevision",
            },
        };
        taskPrompts.value = {
            bodyImage: {
                ...defaultPrompts.bodyImage,
                ...(taskPrompts.value.bodyImage ?? {}),
            },
            characterDesign: {
                ...defaultPrompts.characterDesign,
                ...(taskPrompts.value.characterDesign ?? {}),
            },
            characterRevision: {
                ...defaultPrompts.characterRevision,
                ...(taskPrompts.value.characterRevision ?? {}),
            },
        };
        if (stylePresets.value.length === 0) {
            const style = createStylePreset();
            stylePresets.value = [style];
            activeStyleId.value = style.id;
        }
        stylePresets.value = stylePresets.value.map((style, index) => normalizeStylePreset(style, index === 0 ? "默认画风串" : `画风串 ${index + 1}`));
        if (!stylePresets.value.some((item) => item.id === activeStyleId.value)) {
            activeStyleId.value = stylePresets.value[0]?.id ?? "";
        }
        ensureProjectGroup(currentProjectPath.value);
        for (const [projectPath, group] of Object.entries(characterGroups.value)) {
            const charactersInGroup = group.characters.map((character) => createCharacter(character.cnName || "角色", character));
            const activeId = charactersInGroup.some((item) => item.id === group.activeCharacterId) ? group.activeCharacterId : charactersInGroup[0]?.id ?? null;
            updateProjectGroup(projectPath, {
                ...group,
                characters: charactersInGroup,
                activeCharacterId: activeId,
            });
        }
    }

    /**
     * 更新 NovelAI API 配置。
     */
    function updateNovelAiSettings(patch: Partial<NovelAiApiSettings>): void {
        novelAi.value = normalizeNovelAiSettings({
            ...novelAi.value,
            ...patch,
        });
    }

    /**
     * 更新返回图片的输出设置。
     */
    function updateOutputSettings(patch: Partial<TextToImageOutputSettings>): void {
        output.value = {
            ...output.value,
            ...patch,
        };
    }

    /**
     * 更新本次文生图生成草稿。
     */
    function updateGenerationDraft(patch: Partial<TextToImageGenerationDraft>): void {
        generationDraft.value = normalizeGenerationDraft({
            ...generationDraft.value,
            ...patch,
        });
    }

    /**
     * 追加最新生成结果，只保留最近 20 张，避免内存长期堆积。
     */
    function prependGenerationResults(results: TextToImageGenerationResult[]): void {
        generationResults.value = [
            ...results,
            ...generationResults.value,
        ].slice(0, 20);
    }

    /**
     * 清空当前页面的生成结果。
     */
    function clearGenerationResults(): void {
        generationResults.value = [];
    }

    /**
     * 更新文生图专用 LLM 连接配置。
     */
    function updateLlmSettings(patch: Partial<Omit<TextToImageLlmSettings, "parameters">>): void {
        const next = normalizeLlmSettings({
            ...llm.value,
            ...patch,
        });
        const activeId = next.activeApiConfigId;
        next.apiConfigs = next.apiConfigs.map((config) => config.id === activeId ? normalizeLlmApiConfig({
            ...config,
            apiBaseUrl: next.apiBaseUrl,
            apiKey: next.apiKey,
            model: next.model,
            availableModels: next.availableModels,
            parameters: next.parameters,
            stream: next.stream,
            sendImages: next.sendImages,
        }, config.name || "API 配置") : config);
        llm.value = next;
    }

    /**
     * 更新文生图专用 LLM 参数。
     */
    function updateLlmParameters(patch: Partial<TextToImageLlmParameters>): void {
        const parameters = normalizeLlmParameters({
            ...llm.value.parameters,
            ...patch,
        });
        llm.value = {
            ...llm.value,
            parameters,
            apiConfigs: llm.value.apiConfigs.map((config) => config.id === llm.value.activeApiConfigId ? {
                ...config,
                parameters,
            } : config),
        };
    }

    /**
     * 新增一条 LLM API 配置，并切换为当前配置。
     */
    function addLlmApiConfig(name = `API 配置 ${llm.value.apiConfigs.length + 1}`): TextToImageLlmApiConfig {
        const config = createLlmApiConfig(name, {
            apiBaseUrl: llm.value.apiBaseUrl,
            apiKey: llm.value.apiKey,
            model: llm.value.model,
            availableModels: llm.value.availableModels,
            parameters: llm.value.parameters,
            stream: llm.value.stream,
            sendImages: llm.value.sendImages,
        });
        llm.value = normalizeLlmSettings({
            ...llm.value,
            ...config,
            activeApiConfigId: config.id,
            apiConfigs: [...llm.value.apiConfigs, config],
        });
        return config;
    }

    /**
     * 切换当前 LLM API 配置。
     */
    function activateLlmApiConfig(configId: string): void {
        const config = llm.value.apiConfigs.find((item) => item.id === configId);
        if (!config) {
            return;
        }
        llm.value = normalizeLlmSettings({
            ...llm.value,
            ...config,
            activeApiConfigId: config.id,
            apiConfigs: llm.value.apiConfigs,
        });
    }

    /**
     * 更新指定 LLM API 配置。当前启用配置会同步到 llm 根字段。
     */
    function updateLlmApiConfig(configId: string, patch: Partial<TextToImageLlmApiConfig>): void {
        const apiConfigs = llm.value.apiConfigs.map((config) => config.id === configId ? normalizeLlmApiConfig({
            ...config,
            ...patch,
            id: config.id,
        }, config.name || "API 配置") : config);
        const activeConfig = apiConfigs.find((config) => config.id === llm.value.activeApiConfigId) ?? apiConfigs[0];
        llm.value = normalizeLlmSettings({
            ...llm.value,
            ...(activeConfig ?? {}),
            activeApiConfigId: activeConfig?.id ?? "",
            apiConfigs,
        });
    }

    /**
     * 把当前 llm 根字段保存回当前启用的 API 配置。
     */
    function saveActiveLlmApiConfig(): void {
        if (!llm.value.activeApiConfigId) {
            return;
        }
        updateLlmApiConfig(llm.value.activeApiConfigId, {
            apiBaseUrl: llm.value.apiBaseUrl,
            apiKey: llm.value.apiKey,
            model: llm.value.model,
            availableModels: llm.value.availableModels,
            parameters: llm.value.parameters,
            stream: llm.value.stream,
            sendImages: llm.value.sendImages,
        });
    }

    /**
     * 删除指定 LLM API 配置，至少保留一条。
     */
    function deleteLlmApiConfig(configId: string): void {
        if (llm.value.apiConfigs.length <= 1) {
            return;
        }
        const nextConfigs = llm.value.apiConfigs.filter((config) => config.id !== configId);
        const nextActive = nextConfigs.find((config) => config.id === llm.value.activeApiConfigId) ?? nextConfigs[0];
        llmTaskBindings.value = Object.fromEntries(Object.entries(llmTaskBindings.value).map(([task, binding]) => [
            task,
            {
                ...binding,
                apiConfigId: binding.apiConfigId === configId ? nextActive?.id ?? "" : binding.apiConfigId,
            },
        ])) as Record<TextToImagePromptTask, TextToImageLlmTaskBinding>;
        llm.value = normalizeLlmSettings({
            ...llm.value,
            ...(nextActive ?? {}),
            activeApiConfigId: nextActive?.id ?? "",
            apiConfigs: nextConfigs,
        });
    }

    /**
     * 更新指定任务的提示词。
     */
    function updateTaskPrompt(task: TextToImagePromptTask, patch: Partial<Omit<TextToImageTaskPrompt, "task">>): void {
        taskPrompts.value = {
            ...taskPrompts.value,
            [task]: {
                ...(taskPrompts.value[task] ?? createTaskPrompt(task)),
                ...patch,
                task,
                updatedAt: patch.updatedAt ?? new Date().toISOString(),
            },
        };
    }

    /**
     * 导入指定任务的提示词。
     */
    function importTaskPrompt(task: TextToImagePromptTask, prompt: string, importedName: string): void {
        updateTaskPrompt(task, {
            prompt,
            importedName,
            updatedAt: new Date().toISOString(),
        });
    }

    /**
     * 新增上下文预设并设为当前启用。
     */
    function addLlmContextPreset(name = `上下文预设 ${llmContextPresets.value.length + 1}`, entries: Partial<TextToImageLlmContextEntry>[] = []): TextToImageLlmContextPreset {
        const preset = createLlmContextPreset(name, {
            entries: entries.map((entry, index) => createLlmContextEntry(entry.name || `条目 ${index + 1}`, entry)),
            updatedAt: new Date().toISOString(),
        });
        llmContextPresets.value = [...llmContextPresets.value, preset];
        activeLlmContextPresetId.value = preset.id;
        return preset;
    }

    /**
     * 启用指定上下文预设。
     */
    function activateLlmContextPreset(presetId: string): void {
        if (llmContextPresets.value.some((preset) => preset.id === presetId)) {
            activeLlmContextPresetId.value = presetId;
        }
    }

    /**
     * 更新上下文预设基础字段。
     */
    function updateLlmContextPreset(presetId: string, patch: Partial<TextToImageLlmContextPreset>): void {
        llmContextPresets.value = llmContextPresets.value.map((preset) => preset.id === presetId ? normalizeLlmContextPreset({
            ...preset,
            ...patch,
            id: preset.id,
            updatedAt: new Date().toISOString(),
        }, preset.name || "上下文预设") : preset);
    }

    /**
     * 删除上下文预设，至少保留一条。
     */
    function deleteLlmContextPreset(presetId: string): void {
        if (llmContextPresets.value.length <= 1) {
            return;
        }
        const nextPresets = llmContextPresets.value.filter((preset) => preset.id !== presetId);
        const nextActive = nextPresets.find((preset) => preset.id === activeLlmContextPresetId.value) ?? nextPresets[0];
        llmTaskBindings.value = Object.fromEntries(Object.entries(llmTaskBindings.value).map(([task, binding]) => [
            task,
            {
                ...binding,
                contextPresetId: binding.contextPresetId === presetId ? nextActive?.id ?? "" : binding.contextPresetId,
            },
        ])) as Record<TextToImagePromptTask, TextToImageLlmTaskBinding>;
        llmContextPresets.value = nextPresets;
        activeLlmContextPresetId.value = nextActive?.id ?? "";
    }

    /**
     * 在上下文预设中新增条目。
     */
    function addLlmContextEntry(presetId: string, patch: Partial<TextToImageLlmContextEntry> = {}): TextToImageLlmContextEntry | null {
        const preset = llmContextPresets.value.find((item) => item.id === presetId);
        if (!preset) {
            return null;
        }
        const entry = createLlmContextEntry(patch.name || `条目 ${preset.entries.length + 1}`, patch);
        updateLlmContextPreset(presetId, {
            entries: [...preset.entries, entry],
        });
        return entry;
    }

    /**
     * 更新上下文条目。
     */
    function updateLlmContextEntry(presetId: string, entryId: string, patch: Partial<TextToImageLlmContextEntry>): void {
        const preset = llmContextPresets.value.find((item) => item.id === presetId);
        if (!preset) {
            return;
        }
        updateLlmContextPreset(presetId, {
            entries: preset.entries.map((entry) => entry.id === entryId ? createLlmContextEntry(entry.name, {
                ...entry,
                ...patch,
                id: entry.id,
            }) : entry),
        });
    }

    /**
     * 删除上下文条目。
     */
    function deleteLlmContextEntry(presetId: string, entryId: string): void {
        const preset = llmContextPresets.value.find((item) => item.id === presetId);
        if (!preset) {
            return;
        }
        updateLlmContextPreset(presetId, {
            entries: preset.entries.filter((entry) => entry.id !== entryId),
        });
    }

    /**
     * 配置某个任务使用的 API 配置与上下文预设。
     */
    function updateLlmTaskBinding(task: TextToImagePromptTask, patch: Partial<Omit<TextToImageLlmTaskBinding, "task">>): void {
        const fallback = createDefaultLlmTaskBindings(llm.value.activeApiConfigId, activeLlmContextPresetId.value)[task];
        llmTaskBindings.value = {
            ...llmTaskBindings.value,
            [task]: {
                ...fallback,
                ...(llmTaskBindings.value[task] ?? {}),
                ...patch,
                task,
            },
        };
    }

    /**
     * 解析任务运行时配置。
     */
    function resolveLlmTaskBinding(task: TextToImagePromptTask): {apiConfig: TextToImageLlmApiConfig; contextPreset: TextToImageLlmContextPreset | null} {
        const binding = llmTaskBindings.value[task];
        const apiConfig = llm.value.apiConfigs.find((config) => config.id === binding?.apiConfigId)
            ?? activeLlmApiConfig.value
            ?? createLlmApiConfig("默认", llm.value);
        const contextPreset = llmContextPresets.value.find((preset) => preset.id === binding?.contextPresetId)
            ?? activeLlmContextPreset.value;
        return {apiConfig, contextPreset};
    }

    /**
     * 新增画风串并设为当前启用。
     */
    function addStylePreset(): TextToImageStylePreset {
        const style = createStylePreset(`画风串 ${stylePresets.value.length + 1}`);
        stylePresets.value = [...stylePresets.value, style];
        activeStyleId.value = style.id;
        return style;
    }

    /**
     * 复制指定画风串并设为当前启用。
     */
    function duplicateStylePreset(styleId: string): TextToImageStylePreset | null {
        const source = stylePresets.value.find((item) => item.id === styleId);
        if (!source) {
            return null;
        }
        const style = {
            ...source,
            id: createLocalId("style"),
            name: `${source.name || "画风串"} 副本`,
            vibeReferences: source.vibeReferences.map((reference, index) => createVibeReference(reference.displayName || `Vibe ${index + 1}`, {
                ...reference,
                id: createLocalId("vibe"),
            })),
        };
        stylePresets.value = [...stylePresets.value, style];
        activeStyleId.value = style.id;
        return style;
    }

    /**
     * 启用指定画风串。
     */
    function activateStylePreset(styleId: string): void {
        if (stylePresets.value.some((item) => item.id === styleId)) {
            activeStyleId.value = styleId;
        }
    }

    /**
     * 更新画风串字段。
     */
    function updateStylePreset(styleId: string, patch: Partial<TextToImageStylePreset>): void {
        stylePresets.value = stylePresets.value.map((item) => item.id === styleId ? normalizeStylePreset({
            ...item,
            ...patch,
        }, item.name || "画风串") : item);
    }

    /**
     * 新增画风串 Vibe 参考。
     */
    function addStyleVibeReference(styleId: string): TextToImageVibeReference | null {
        const style = stylePresets.value.find((item) => item.id === styleId);
        if (!style) {
            return null;
        }
        const reference = createVibeReference(`Vibe ${style.vibeReferences.length + 1}`);
        updateStylePreset(styleId, {
            vibeReferences: [...style.vibeReferences, reference],
        });
        return reference;
    }

    /**
     * 更新画风串 Vibe 参考。
     */
    function updateStyleVibeReference(styleId: string, vibeId: string, patch: Partial<TextToImageVibeReference>): void {
        const style = stylePresets.value.find((item) => item.id === styleId);
        if (!style) {
            return;
        }
        updateStylePreset(styleId, {
            vibeReferences: style.vibeReferences.map((reference) => reference.id === vibeId ? createVibeReference(reference.displayName, {
                ...reference,
                ...patch,
                id: reference.id,
            }) : reference),
        });
    }

    /**
     * 删除画风串 Vibe 参考。
     */
    function deleteStyleVibeReference(styleId: string, vibeId: string): void {
        const style = stylePresets.value.find((item) => item.id === styleId);
        if (!style) {
            return;
        }
        updateStylePreset(styleId, {
            vibeReferences: style.vibeReferences.filter((reference) => reference.id !== vibeId),
        });
    }

    /**
     * 删除画风串；至少保留一条配置。
     */
    function deleteStylePreset(styleId: string): void {
        if (stylePresets.value.length <= 1) {
            return;
        }
        const nextStyles = stylePresets.value.filter((item) => item.id !== styleId);
        stylePresets.value = nextStyles;
        if (activeStyleId.value === styleId) {
            activeStyleId.value = nextStyles[0]?.id ?? "";
        }
    }

    /**
     * 新增角色并选中。
     */
    function addCharacter(projectPath = currentProjectPath.value): TextToImageCharacter {
        const group = ensureProjectGroup(projectPath);
        const character = createCharacter(`角色 ${group.characters.length + 1}`);
        updateProjectGroup(projectPath, {
            ...group,
            characters: [...group.characters, character],
            activeCharacterId: character.id,
        });
        return character;
    }

    /**
     * 从导入草稿新增角色并选中。
     */
    function addCharacterFromDraft(draft: Partial<TextToImageCharacter>, projectPath = currentProjectPath.value): TextToImageCharacter {
        const group = ensureProjectGroup(projectPath);
        const displayName = draft.cnName?.trim() || draft.enName?.trim() || `角色 ${group.characters.length + 1}`;
        const character = createCharacter(displayName, draft);
        updateProjectGroup(projectPath, {
            ...group,
            characters: [...group.characters, character],
            activeCharacterId: character.id,
        });
        return character;
    }

    /**
     * 选中角色详情。
     */
    function selectCharacter(characterId: string, projectPath = currentProjectPath.value): void {
        const group = ensureProjectGroup(projectPath);
        if (group.characters.some((item) => item.id === characterId)) {
            updateProjectGroup(projectPath, {
                ...group,
                activeCharacterId: characterId,
            });
        }
    }

    /**
     * 更新角色 tag 字段。
     */
    function updateCharacter(characterId: string, patch: Partial<TextToImageCharacter>, projectPath = currentProjectPath.value): void {
        const group = ensureProjectGroup(projectPath);
        updateProjectGroup(projectPath, {
            ...group,
            characters: group.characters.map((item) => item.id === characterId ? {
                ...item,
                ...patch,
            } : item),
        });
    }

    /**
     * 删除指定角色。
     */
    function deleteCharacter(characterId: string, projectPath = currentProjectPath.value): void {
        const group = ensureProjectGroup(projectPath);
        const nextCharacters = group.characters.filter((item) => item.id !== characterId);
        updateProjectGroup(projectPath, {
            ...group,
            characters: nextCharacters,
            activeCharacterId: group.activeCharacterId === characterId ? nextCharacters[0]?.id ?? null : group.activeCharacterId,
        });
    }

    return {
        activeCharacter,
        activeCharacterGroup,
        activeCharacterId,
        activeLlmApiConfig,
        activeLlmContextPreset,
        activeStyle,
        activeStyleId,
        addCharacter,
        addCharacterFromDraft,
        addLlmApiConfig,
        addLlmContextEntry,
        addLlmContextPreset,
        addStylePreset,
        addStyleVibeReference,
        activateLlmApiConfig,
        activateLlmContextPreset,
        activateStylePreset,
        activeLlmContextPresetId,
        characterGroups,
        clearGenerationResults,
        characters,
        currentProjectPath,
        deleteCharacter,
        deleteLlmApiConfig,
        deleteLlmContextEntry,
        deleteLlmContextPreset,
        deleteStylePreset,
        deleteStyleVibeReference,
        duplicateStylePreset,
        ensureDefaults,
        ensureProjectGroup,
        generationDraft,
        generationResults,
        importTaskPrompt,
        llm,
        llmContextPresets,
        llmTaskBindings,
        novelAi,
        output,
        prependGenerationResults,
        resolveLlmTaskBinding,
        saveActiveLlmApiConfig,
        selectCharacter,
        setCurrentProjectPath,
        stylePresets,
        taskPrompts,
        updateCharacter,
        updateGenerationDraft,
        updateLlmApiConfig,
        updateLlmContextEntry,
        updateLlmContextPreset,
        updateLlmParameters,
        updateLlmSettings,
        updateLlmTaskBinding,
        updateNovelAiSettings,
        updateOutputSettings,
        updateStylePreset,
        updateStyleVibeReference,
        updateTaskPrompt,
    };
}, {
    persist: {
        key: "text.to.image",
        storage: piniaPluginPersistedstate.localStorage(),
        pick: [
            "novelAi",
            "llm",
            "output",
            "generationDraft",
            "taskPrompts",
            "llmContextPresets",
            "activeLlmContextPresetId",
            "llmTaskBindings",
            "stylePresets",
            "activeStyleId",
            "currentProjectPath",
            "characterGroups",
        ],
    },
});
