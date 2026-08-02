import type {TextToImagePromptReplacementRule} from "nbook/app/utils/text-to-image-prompt-engine";

import type {
    TextToImageJobDto,
    TextToImageJobPageDto,
    TextToImageNovelAiInspectionDto,
} from "nbook/shared/dto/text-to-image.dto";
import {
    createDefaultTextToImageRecipeSource,
    TextToImageRecipeSourceSchema,
    type TextToImageRecipeSnapshot,
    type TextToImageRecipeSource,
} from "nbook/shared/text-to-image-recipe";
import {
    inspectTextToImageRecipeMigration,
    removeTextToImageRecipeMigrationKeys,
    type TextToImageRecipeMigrationInspection,
} from "nbook/app/utils/text-to-image-recipe-migration";
import {useNotification} from "nbook/app/composables/useNotification";

export type NovelAiSmeaMode = "auto" | "off" | "on";

export type NovelAiApiSettings = {
    model: string;
    sampler: string;
    noiseSchedule: string;
    promptGuidance: number;
    promptGuidanceRescale: number;
    aiDefaultCharacterPosition: boolean;
    variety: boolean;
    smeaMode: NovelAiSmeaMode;
    smeaDyn: boolean;
    decrisper: boolean;
    sizePreset: string;
    width: number;
    height: number;
    steps: number;
    seed: number;
};

export type TextToImageOutputSettings = {
    imageSavePath: string;
};

export type TextToImageGenerationDraft = {
    prompt: string;
    negativePrompt: string;
    includeActiveCharacter: boolean;
    batchSize: number;
};

export type TextToImageGenerationResult = {
    id: string;
    createdAt: string;
    fileName: string;
    savedPath: string;
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
};

export type TextToImageCharacter = {
    id: string;
    cnName: string;
    enName: string;
    portraitDataUrl: string;
    portraitHistory: TextToImageGenerationResult[];
    activePortraitIndex: number;
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

export type TextToImageCharacterTagKey = Exclude<keyof TextToImageCharacter, "id" | "cnName" | "enName" | "portraitDataUrl" | "portraitHistory" | "activePortraitIndex" | "photoPrompt" | "sendPhoto" | "sourceProjectPath" | "sourceNovelTitle" | "sourceCharacterPath">;

export type TextToImageProjectCharacterGroup = {
    projectPath: string;
    characters: TextToImageCharacter[];
    activeCharacterId: string | null;
};

export type TextToImageOutfit = {
    id: string;
    nameCn: string;
    nameEn: string;
    aliases: string;
    enabled: boolean;
    upperFront: string;
    upperBack: string;
    lowerFront: string;
    lowerBack: string;
    fullPrompt: string;
    negativePrompt: string;
};

export type TextToImageProjectOutfitGroup = {
    projectPath: string;
    outfits: TextToImageOutfit[];
    activeOutfitId: string | null;
};

export type TextToImageLastNovelAiExchange = {
    request: Record<string, unknown> | null;
    warnings: string[];
    imageCount: number;
    updatedAt: string | null;
};

export type TextToImageRecipeDocument = {
    exists: boolean;
    source: TextToImageRecipeSource;
    /** 服务端文档始终非空；仅本地无效文件修复草稿为空。 */
    snapshot: TextToImageRecipeSnapshot | null;
};

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

const DEFAULT_PROJECT_KEY = "__unbound__";

const DEFAULT_OUTPUT_SETTINGS: TextToImageOutputSettings = {
    imageSavePath: "",
};

const DEFAULT_GENERATION_DRAFT: TextToImageGenerationDraft = {
    prompt: "",
    negativePrompt: "",
    includeActiveCharacter: true,
    batchSize: 1,
};

const DEFAULT_LAST_NOVEL_AI_EXCHANGE: TextToImageLastNovelAiExchange = {
    request: null,
    warnings: [],
    imageCount: 0,
    updatedAt: null,
};

const DEFAULT_NOVEL_AI_SETTINGS: NovelAiApiSettings = {
    model: "nai-diffusion-4-5-full",
    sampler: "k_euler_ancestral",
    noiseSchedule: "karras",
    promptGuidance: 5,
    promptGuidanceRescale: 0,
    aiDefaultCharacterPosition: true,
    variety: false,
    smeaMode: "auto",
    smeaDyn: false,
    decrisper: false,
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
 * 将当前小说路径归一化为角色分组 key。
 */
function normalizeProjectPath(projectPath: string): string {
    const normalized = projectPath.trim();
    return normalized || DEFAULT_PROJECT_KEY;
}

function buildImportedCharacterKey(character: Partial<Pick<TextToImageCharacter, "sourceProjectPath" | "sourceCharacterPath">>): string {
    const sourceProjectPath = character.sourceProjectPath?.trim() ?? "";
    const sourceCharacterPath = character.sourceCharacterPath?.trim() ?? "";
    return sourceProjectPath && sourceCharacterPath ? `${sourceProjectPath}\n${sourceCharacterPath}` : "";
}

function normalizeGenerationResultForStorage(result: TextToImageGenerationResult): TextToImageGenerationResult {
    return {
        ...result,
        dataUrl: result.savedPath.trim() ? "" : result.dataUrl,
    };
}

function dedupeImportedCharacters(characters: TextToImageCharacter[]): TextToImageCharacter[] {
    const nextCharacters: TextToImageCharacter[] = [];
    const indexByKey = new Map<string, number>();
    for (const character of characters) {
        const key = buildImportedCharacterKey(character);
        if (!key) {
            nextCharacters.push(character);
            continue;
        }
        const existingIndex = indexByKey.get(key);
        if (existingIndex === undefined) {
            indexByKey.set(key, nextCharacters.length);
            nextCharacters.push(character);
            continue;
        }
        const existing = nextCharacters[existingIndex];
        nextCharacters[existingIndex] = createCharacter(character.cnName || character.enName || existing?.cnName || "角色", {
            ...existing,
            ...character,
            id: existing?.id ?? character.id,
        });
    }
    return nextCharacters;
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
        model: settings.model ?? DEFAULT_NOVEL_AI_SETTINGS.model,
        sampler: settings.sampler ?? DEFAULT_NOVEL_AI_SETTINGS.sampler,
        noiseSchedule: settings.noiseSchedule ?? DEFAULT_NOVEL_AI_SETTINGS.noiseSchedule,
        promptGuidance: clampNumber(Number(settings.promptGuidance ?? DEFAULT_NOVEL_AI_SETTINGS.promptGuidance), 0, 20, DEFAULT_NOVEL_AI_SETTINGS.promptGuidance),
        promptGuidanceRescale: clampNumber(Number(settings.promptGuidanceRescale ?? DEFAULT_NOVEL_AI_SETTINGS.promptGuidanceRescale), 0, 1, DEFAULT_NOVEL_AI_SETTINGS.promptGuidanceRescale),
        aiDefaultCharacterPosition: settings.aiDefaultCharacterPosition ?? DEFAULT_NOVEL_AI_SETTINGS.aiDefaultCharacterPosition,
        variety: settings.variety ?? DEFAULT_NOVEL_AI_SETTINGS.variety,
        smeaMode: settings.smeaMode === "off" || settings.smeaMode === "on" ? settings.smeaMode : "auto",
        smeaDyn: settings.smeaDyn ?? DEFAULT_NOVEL_AI_SETTINGS.smeaDyn,
        decrisper: settings.decrisper ?? DEFAULT_NOVEL_AI_SETTINGS.decrisper,
        sizePreset,
        width,
        height,
        steps: Math.round(clampNumber(Number(settings.steps ?? DEFAULT_NOVEL_AI_SETTINGS.steps), 1, 50, DEFAULT_NOVEL_AI_SETTINGS.steps)),
        seed: Math.round(clampNumber(Number(settings.seed ?? DEFAULT_NOVEL_AI_SETTINGS.seed), -1, 4294967295, DEFAULT_NOVEL_AI_SETTINGS.seed)),
    };
}

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
    };
}

/**
 * 创建一条空角色 tag 配置。
 */
function createCharacter(name = "新角色", patch: Partial<TextToImageCharacter> = {}): TextToImageCharacter {
    const id = patch.id ?? createLocalId("character");
    const portraitHistory = Array.isArray(patch.portraitHistory)
        ? patch.portraitHistory
            .filter((item): item is TextToImageGenerationResult => Boolean(item && typeof item === "object"))
            .map(normalizeGenerationResultForStorage)
        : [];
    const activePortraitIndex = Math.min(
        Math.max(0, portraitHistory.length - 1),
        Math.max(0, Math.round(Number(patch.activePortraitIndex ?? Math.max(0, portraitHistory.length - 1)))),
    );
    return {
        cnName: name,
        enName: "",
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
        portraitDataUrl: patch.portraitDataUrl ?? portraitHistory[activePortraitIndex]?.dataUrl ?? "",
        portraitHistory,
        activePortraitIndex,
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
function createOutfit(name = "新服装", patch: Partial<TextToImageOutfit> = {}): TextToImageOutfit {
    return {
        id: patch.id ?? createLocalId("outfit"),
        nameCn: patch.nameCn ?? name,
        nameEn: patch.nameEn ?? "",
        aliases: patch.aliases ?? "",
        enabled: patch.enabled ?? true,
        upperFront: patch.upperFront ?? "",
        upperBack: patch.upperBack ?? "",
        lowerFront: patch.lowerFront ?? "",
        lowerBack: patch.lowerBack ?? "",
        fullPrompt: patch.fullPrompt ?? "",
        negativePrompt: patch.negativePrompt ?? "",
    };
}

function createOutfitGroup(projectPath: string): TextToImageProjectOutfitGroup {
    return {
        projectPath,
        outfits: [],
        activeOutfitId: null,
    };
}

function createPromptReplacementRule(name = "替换规则", patch: Partial<TextToImagePromptReplacementRule> = {}): TextToImagePromptReplacementRule {
    const target = patch.target === "negative" ? "negative" : "positive";
    const matchMode = patch.matchMode === "regex" ? "regex" : "plain";
    const mode = patch.mode === "append" || patch.mode === "prepend" || patch.mode === "delete" ? patch.mode : "replace";
    return {
        id: patch.id ?? createLocalId("prompt_rule"),
        name: patch.name?.trim() || name,
        enabled: patch.enabled ?? true,
        target,
        matchMode,
        mode,
        trigger: patch.trigger ?? "",
        replacement: patch.replacement ?? "",
    };
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
        batchSize: Math.round(clampNumber(Number(settings.batchSize ?? DEFAULT_GENERATION_DRAFT.batchSize), 1, 4, DEFAULT_GENERATION_DRAFT.batchSize)),
    };
}

/**
 * 文生图配置工作台的本地状态。
 */
function normalizeLastNovelAiExchange(exchange: Partial<TextToImageLastNovelAiExchange> = {}): TextToImageLastNovelAiExchange {
    return {
        request: exchange.request && typeof exchange.request === "object"
            ? sanitizeNovelAiExchangeValue(exchange.request) as Record<string, unknown>
            : null,
        warnings: Array.isArray(exchange.warnings) ? exchange.warnings.map((warning) => String(warning)) : [],
        imageCount: Math.max(0, Math.round(Number(exchange.imageCount ?? 0))),
        updatedAt: exchange.updatedAt ?? null,
    };
}

function sanitizeNovelAiExchangeValue(value: unknown, key = "", depth = 0): unknown {
    if (depth > 8) {
        return "[omitted nested payload]";
    }
    if (typeof value === "string") {
        return shouldOmitNovelAiExchangeString(key, value)
            ? `[omitted image payload: ${value.length} chars]`
            : value;
    }
    if (Array.isArray(value)) {
        if (isNovelAiImagePayloadKey(key)) {
            return value.map((item) => typeof item === "string"
                ? `[omitted image payload: ${item.length} chars]`
                : sanitizeNovelAiExchangeValue(item, key, depth + 1));
        }
        return value.map((item) => sanitizeNovelAiExchangeValue(item, key, depth + 1));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
            entryKey,
            sanitizeNovelAiExchangeValue(entryValue, entryKey, depth + 1),
        ]));
    }
    return value;
}

function shouldOmitNovelAiExchangeString(key: string, value: string): boolean {
    return isNovelAiImagePayloadKey(key) || value.startsWith("data:image/") || isLongBase64LikeString(value);
}

function isNovelAiImagePayloadKey(key: string): boolean {
    return /(?:^|_)(?:image|img)(?:_|$)|dataUrl|reference_image|character_reference/iu.test(key);
}

function isLongBase64LikeString(value: string): boolean {
    return value.length > 4096 && /^[A-Za-z0-9+/=\r\n]+$/u.test(value);
}

function readRecipeMigrationStorage(): string | null {
    const storage = typeof globalThis.localStorage === "object" ? globalThis.localStorage : null;
    return storage && typeof storage.getItem === "function" ? storage.getItem("text.to.image") : null;
}

function cleanupRecipeMigrationStorage(): void {
    const storage = typeof globalThis.localStorage === "object" ? globalThis.localStorage : null;
    if (!storage || typeof storage.getItem !== "function") {
        return;
    }
    const next = removeTextToImageRecipeMigrationKeys(storage.getItem("text.to.image"));
    if (next === null) {
        storage.removeItem("text.to.image");
        return;
    }
    storage.setItem("text.to.image", next);
}

/** ofetch/H3 错误是外部未知结构，只读取稳定 Recipe invalid code 与 64 位文件 hash。 */
function readRecipeInvalidSourceHash(error: unknown): string | null {
    type ApiErrorNode = {
        code?: string;
        fileContentHash?: string | null;
        data?: ApiErrorNode;
    };
    let node: ApiErrorNode | undefined = typeof error === "object" && error !== null ? error as ApiErrorNode : undefined;
    for (let depth = 0; node && depth < 3; depth += 1) {
        if (node.code === "TEXT_TO_IMAGE_RECIPE_INVALID"
            && typeof node.fileContentHash === "string"
            && /^[a-f0-9]{64}$/u.test(node.fileContentHash)) {
            return node.fileContentHash;
        }
        node = node.data;
    }
    return null;
}

/** Recipe 乐观锁冲突：expectedRecipeSourceHash 不匹配或修复无效文件时状态已变。 */
function isRecipeConflictError(error: unknown): boolean {
    type ConflictErrorNode = {statusCode?: number; code?: string; data?: ConflictErrorNode};
    let node: ConflictErrorNode | undefined = typeof error === "object" && error !== null ? error as ConflictErrorNode : undefined;
    for (let depth = 0; node && depth < 3; depth += 1) {
        // 只认乐观锁冲突 code；NOT_CONFIGURED 同为 409，误判会让"需要保存"被当成"需要重读"。
        if (node.code === "TEXT_TO_IMAGE_RECIPE_CONFLICT") {
            return true;
        }
        node = node.data;
    }
    return false;
}

export const useTextToImageStore = defineStore("textToImage", () => {
    const defaultStyle = createStylePreset();

    const novelAi = ref<NovelAiApiSettings>(createDefaultNovelAiSettings());
    const recipeExists = ref(false);
    const recipeSnapshot = ref<TextToImageRecipeSnapshot | null>(null);
    const recipeSavedSource = ref<TextToImageRecipeSource | null>(null);
    /** P5：当前 Recipe 参考资源只读投影；UI 读写经下方 actions。 */
    const recipeReferences = computed(() => recipeSavedSource.value?.references ?? {
        normalizeVibeStrengths: true,
        vibeReferences: [],
        characterReferences: [],
        inpaint: null,
    });
    const recipeLoading = ref(false);
    const recipeSaving = ref(false);
    const recipeDirty = ref(false);
    const recipeError = ref("");
    const recipeMigrationPending = ref(false);
    const recipeMigrationModelConflict = ref<TextToImageRecipeMigrationInspection["modelConflict"]>(null);
    const recipeInvalidSourceHash = ref<string | null>(null);
    /** 自动保存节流定时器；迁移、模型冲突或无效文件等需显式确认的边界态不自动落盘。 */
    let recipeAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    /** loadRecipe 的 latest-wins 票据：慢响应不得覆盖后续项目的表单与 hash 元数据。 */
    let recipeLoadTicket = 0;

    /** 冲突这类后台动作的跨入口提示；纯 store 单测没有 Nuxt 通知宿主时静默降级。 */
    function notifyRecipeWarning(message: string): void {
        try {
            useNotification().warning(message, {title: "Recipe 自动保存"});
        } catch {
            // 非 Nuxt 上下文（vitest 纯 store 环境）无 useState 宿主，提示不可用但不影响数据收敛。
        }
    }
    const novelAiProviderInspection = ref<TextToImageNovelAiInspectionDto>({state: "unconfigured", provider: null, candidates: [], recipeMigrationModels: [], selectionToken: null, reconciliationKeepProviderId: null});
    const activeNovelAiProviderId = computed(() => novelAiProviderInspection.value.state === "configured"
        && novelAiProviderInspection.value.provider?.hasCredential
        ? novelAiProviderInspection.value.provider.id
        : null);
    const projectJobs = ref<TextToImageJobDto[]>([]);
    const projectJobsProjectPath = ref("");
    const projectJobsLoading = ref(false);
    const projectJobsError = ref("");
    const output = ref<TextToImageOutputSettings>({...DEFAULT_OUTPUT_SETTINGS});
    const generationDraft = ref<TextToImageGenerationDraft>({...DEFAULT_GENERATION_DRAFT});
    const generationResults = ref<TextToImageGenerationResult[]>([]);
    const lastNovelAiExchange = ref<TextToImageLastNovelAiExchange>({...DEFAULT_LAST_NOVEL_AI_EXCHANGE});
    const stylePresets = ref<TextToImageStylePreset[]>([defaultStyle]);
    const activeStyleId = ref(defaultStyle.id);
    const currentProjectPath = ref(DEFAULT_PROJECT_KEY);
    const characterGroups = ref<Record<string, TextToImageProjectCharacterGroup>>({
        [DEFAULT_PROJECT_KEY]: createCharacterGroup(DEFAULT_PROJECT_KEY),
    });
    const outfitGroups = ref<Record<string, TextToImageProjectOutfitGroup>>({
        [DEFAULT_PROJECT_KEY]: createOutfitGroup(DEFAULT_PROJECT_KEY),
    });
    const promptReplacementRules = ref<TextToImagePromptReplacementRule[]>([]);
    const activeProjectKey = computed(() => normalizeProjectPath(currentProjectPath.value));
    const activeStyle = computed(() => stylePresets.value.find((item) => item.id === activeStyleId.value) ?? stylePresets.value[0] ?? null);
    const activeCharacterGroup = computed(() => characterGroups.value[activeProjectKey.value] ?? createCharacterGroup(activeProjectKey.value));
    const characters = computed(() => activeCharacterGroup.value.characters);
    const activeCharacterId = computed(() => activeCharacterGroup.value.activeCharacterId);
    const activeCharacter = computed(() => characters.value.find((item) => item.id === activeCharacterId.value) ?? characters.value[0] ?? null);
    const activeOutfitGroup = computed(() => outfitGroups.value[activeProjectKey.value] ?? createOutfitGroup(activeProjectKey.value));
    const outfits = computed(() => activeOutfitGroup.value.outfits);
    const activeOutfitId = computed(() => activeOutfitGroup.value.activeOutfitId);
    const activeOutfit = computed(() => outfits.value.find((item) => item.id === activeOutfitId.value) ?? outfits.value[0] ?? null);

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

    /** 从 NovelAI singleton inspection 刷新当前用户唯一图片 Provider；credential 永不进入 Pinia。 */
    async function refreshProviders(): Promise<void> {
        novelAiProviderInspection.value = await $fetch<TextToImageNovelAiInspectionDto>("/api/text-to-image/providers/novelai");
    }

    /** 读取当前 Project 的文生图任务摘要；任务与图片均由服务端持久化。 */
    async function refreshProjectJobs(projectPath = currentProjectPath.value): Promise<void> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        projectJobsLoading.value = true;
        projectJobsError.value = "";
        try {
            const response = await $fetch<TextToImageJobPageDto>(`/api/text-to-image/jobs?projectPath=${encodeURIComponent(normalizedProjectPath)}&pageSize=12`);
            projectJobs.value = response.items;
            projectJobsProjectPath.value = normalizedProjectPath;
        } catch (error) {
            projectJobsError.value = error instanceof Error ? error.message : "读取文生图任务失败";
            throw error;
        } finally {
            projectJobsLoading.value = false;
        }
    }

    /** 读取 Project Recipe 到内存草稿；GET 缺失时把默认草稿首开落盘（迁移候选除外）。 */
    async function loadRecipe(projectPath = currentProjectPath.value): Promise<void> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const ticket = ++recipeLoadTicket;
        recipeLoading.value = true;
        recipeError.value = "";
        if (recipeAutoSaveTimer !== null) {
            clearTimeout(recipeAutoSaveTimer);
            recipeAutoSaveTimer = null;
        }
        try {
            const inspection = await $fetch<TextToImageNovelAiInspectionDto>("/api/text-to-image/providers/novelai");
            if (ticket !== recipeLoadTicket) return;
            novelAiProviderInspection.value = inspection;
            const document = await $fetch<TextToImageRecipeDocument>(`/api/text-to-image/recipes/default?projectPath=${encodeURIComponent(normalizedProjectPath)}`);
            if (ticket !== recipeLoadTicket) return;
            const migrated = document.exists
                ? null
                : inspectTextToImageRecipeMigration(readRecipeMigrationStorage(), inspection.recipeMigrationModels);
            applyRecipeDocument(document, migrated?.source ?? null);
            recipeMigrationModelConflict.value = migrated?.modelConflict ?? null;
            recipeInvalidSourceHash.value = null;
            // 首开自动落盘：普通缺失（无迁移候选）直接把默认草稿持久化；并发首创冲突时重读一次收敛。
            if (!document.exists && !migrated && normalizedProjectPath !== DEFAULT_PROJECT_KEY) {
                try {
                    await saveRecipe(normalizedProjectPath);
                } catch (error) {
                    if (isRecipeConflictError(error) && ticket === recipeLoadTicket) {
                        recipeError.value = "";
                        const persisted = await $fetch<TextToImageRecipeDocument>(`/api/text-to-image/recipes/default?projectPath=${encodeURIComponent(normalizedProjectPath)}`);
                        if (ticket !== recipeLoadTicket) return;
                        applyRecipeDocument(persisted, null);
                    }
                }
            }
        } catch (error) {
            if (ticket !== recipeLoadTicket) return;
            recipeError.value = error instanceof Error ? error.message : "读取文生图 Recipe 失败";
            const invalidSourceHash = readRecipeInvalidSourceHash(error);
            if (invalidSourceHash) {
                const source = createDefaultTextToImageRecipeSource();
                applyRecipeDocument({exists: false, source, snapshot: null}, source);
                recipeMigrationModelConflict.value = null;
                recipeInvalidSourceHash.value = invalidSourceHash;
                return;
            }
            throw error;
        } finally {
            if (ticket === recipeLoadTicket) recipeLoading.value = false;
        }
    }

    /** 显式保存当前内存草稿；服务端成功后才更新 hash，并清理一次性迁移字段。 */
    async function saveRecipe(projectPath = currentProjectPath.value): Promise<void> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        recipeSaving.value = true;
        recipeError.value = "";
        try {
            if (recipeMigrationModelConflict.value) {
                throw new Error("旧 Provider 实际模型与浏览器草稿冲突，请先明确选择要写入 Recipe 的模型。");
            }
            const sentSource = buildRecipeSource();
            const document = await $fetch<TextToImageRecipeDocument>("/api/text-to-image/recipes/default", {
                method: "PUT",
                body: {
                    projectPath: normalizedProjectPath,
                    source: sentSource,
                    expectedRecipeSourceHash: recipeExists.value ? recipeSnapshot.value?.recipeSourceHash ?? null : null,
                    ...(recipeInvalidSourceHash.value ? {expectedInvalidSourceHash: recipeInvalidSourceHash.value} : {}),
                },
            });
            const shouldCleanupMigration = recipeMigrationPending.value;
            // 保存期间草稿漂移时只更新元数据并保留草稿重排自动保存，避免覆盖在途编辑；未漂移则照常回灌。
            if (JSON.stringify(buildRecipeSource()) === JSON.stringify(sentSource)) {
                applyRecipeDocument(document, null);
            } else {
                applyRecipeDocumentMetadata(document);
                recipeDirty.value = true;
                queueMicrotask(() => scheduleRecipeAutoSave());
            }
            recipeInvalidSourceHash.value = null;
            recipeMigrationModelConflict.value = null;
            if (shouldCleanupMigration) {
                cleanupRecipeMigrationStorage();
            }
        } catch (error) {
            recipeError.value = error instanceof Error ? error.message : "保存文生图 Recipe 失败";
            throw error;
        } finally {
            recipeSaving.value = false;
        }
    }

    /** 迁移草稿、模型冲突或无效文件需要用户显式确认后再保存，自动保存跳过这些边界态。 */
    const recipeNeedsExplicitSave = computed(() => recipeMigrationPending.value
        || recipeMigrationModelConflict.value !== null
        || recipeInvalidSourceHash.value !== null);

    /** 草稿变动后节流自动保存；边界态与加载/保存中不调度，避免覆盖需人工确认的改动。 */
    function scheduleRecipeAutoSave(): void {
        if (recipeNeedsExplicitSave.value || recipeLoading.value || recipeSaving.value || currentProjectPath.value === DEFAULT_PROJECT_KEY) {
            return;
        }
        if (recipeAutoSaveTimer !== null) {
            clearTimeout(recipeAutoSaveTimer);
        }
        recipeAutoSaveTimer = setTimeout(() => {
            recipeAutoSaveTimer = null;
            void saveRecipeAuto();
        }, 600);
    }

    /** 自动保存失败时：乐观锁冲突提示后重读同步，其余错误写入 recipeError 并保留草稿待下次改动重试。 */
    async function saveRecipeAuto(): Promise<void> {
        if (!recipeDirty.value || recipeSaving.value || recipeNeedsExplicitSave.value) {
            return;
        }
        try {
            await saveRecipe();
        } catch (error) {
            if (isRecipeConflictError(error)) {
                recipeError.value = "";
                // 冲突意味着 Recipe 已在其他入口（编辑器/另一面板）被改动；不能无声丢弃用户草稿。
                notifyRecipeWarning("文生图 Recipe 已在其他入口被修改，已重新加载最新内容；刚才未保存的改动被放弃。");
                await loadRecipe().catch(() => undefined);
            }
        }
    }

    /** 草稿任意字段变化都触发节流自动保存；加载与显式保存的边界态由 recipeDirty 与 recipeLoading 守门。 */
    watch([novelAi, stylePresets, activeStyleId, recipeSavedSource], () => {
        if (recipeDirty.value && !recipeNeedsExplicitSave.value && !recipeLoading.value && !recipeSaving.value && currentProjectPath.value !== DEFAULT_PROJECT_KEY) {
            scheduleRecipeAutoSave();
        }
    }, {deep: true});

    /** 将服务端 source 或迁移草稿投影到现有表单字段。 */
    function applyRecipeDocument(document: TextToImageRecipeDocument, migrated: TextToImageRecipeSource | null): void {
        const source = TextToImageRecipeSourceSchema.parse(migrated ?? document.source);
        recipeExists.value = migrated ? false : document.exists;
        recipeSnapshot.value = migrated ? null : document.snapshot;
        recipeSavedSource.value = source;
        recipeMigrationPending.value = migrated !== null;
        recipeDirty.value = migrated !== null;
        novelAi.value = normalizeNovelAiSettings({
            model: source.model,
            sampler: source.sampler,
            noiseSchedule: source.noiseSchedule,
            promptGuidance: source.promptGuidance,
            promptGuidanceRescale: source.promptGuidanceRescale,
            aiDefaultCharacterPosition: source.advanced.aiDefaultCharacterPosition,
            variety: source.advanced.variety,
            smeaMode: source.advanced.smeaMode,
            smeaDyn: source.advanced.smeaDyn,
            decrisper: source.advanced.decrisper,
            width: source.dimensions.fixed.width,
            height: source.dimensions.fixed.height,
            steps: source.steps,
            seed: source.seed.policy === "fixed" ? source.seed.fixed : -1,
        });
        stylePresets.value = source.styles.map((item) => normalizeStylePreset(item, item.name));
        activeStyleId.value = source.styles.some((item) => item.id === source.activeStyleId)
            ? source.activeStyleId
            : (source.styles[0]?.id ?? "");
    }

    /** 仅更新服务端元数据（exists/snapshot/savedSource），不覆盖草稿值；保存期间草稿漂移时避免丢失在途编辑。 */
    function applyRecipeDocumentMetadata(document: TextToImageRecipeDocument): void {
        const source = TextToImageRecipeSourceSchema.parse(document.source);
        recipeExists.value = document.exists;
        recipeSnapshot.value = document.snapshot;
        recipeSavedSource.value = source;
        recipeMigrationPending.value = false;
    }

    /** 用户显式选择迁移模型后解除冲突；候选之外的值必须通过普通模型字段编辑再保存。 */
    function confirmRecipeMigrationModel(model: string): void {
        const conflict = recipeMigrationModelConflict.value;
        const normalized = model.trim();
        const allowed = new Set([conflict?.browserModel, ...(conflict?.providerModels ?? [])].filter((value): value is string => Boolean(value)));
        if (!conflict || !allowed.has(normalized)) {
            throw new Error("所选模型不属于本次迁移冲突候选");
        }
        novelAi.value = {...novelAi.value, model: normalized};
        recipeMigrationModelConflict.value = null;
        recipeDirty.value = true;
    }

    /** 从表单草稿构造严格 Recipe source；未暴露的画幅意图槽位从最近一次服务端 source 保留。 */
    function buildRecipeSource(): TextToImageRecipeSource {
        const base = recipeSavedSource.value ?? createDefaultTextToImageRecipeSource();
        const presets = stylePresets.value.length > 0 ? stylePresets.value : [createStylePreset(base.title)];
        const firstPreset = presets[0];
        if (!firstPreset) {
            throw new Error("画风串草稿为空");
        }
        return TextToImageRecipeSourceSchema.parse({
            ...base,
            title: (activeStyle.value?.name?.trim() || firstPreset.name.trim() || base.title),
            model: novelAi.value.model,
            sampler: novelAi.value.sampler,
            noiseSchedule: novelAi.value.noiseSchedule,
            steps: novelAi.value.steps,
            promptGuidance: novelAi.value.promptGuidance,
            promptGuidanceRescale: novelAi.value.promptGuidanceRescale,
            dimensions: {
                ...base.dimensions,
                fixed: {width: novelAi.value.width, height: novelAi.value.height},
            },
            seed: novelAi.value.seed < 0
                ? {policy: "random", fixed: 0}
                : {policy: "fixed", fixed: novelAi.value.seed},
            advanced: {
                aiDefaultCharacterPosition: novelAi.value.aiDefaultCharacterPosition,
                variety: novelAi.value.variety,
                smeaMode: novelAi.value.smeaMode,
                smeaDyn: novelAi.value.smeaDyn,
                decrisper: novelAi.value.decrisper,
            },
            styles: presets.map((preset) => ({
                id: preset.id,
                name: preset.name,
                positivePrefix: preset.positivePrefix,
                positiveSuffix: preset.positiveSuffix,
                negativePrefix: preset.negativePrefix,
                negativeSuffix: preset.negativeSuffix,
                useFurryDataset: preset.useFurryDataset,
                positiveQualityPreset: preset.positiveQualityPreset,
                negativeQualityPreset: preset.negativeQualityPreset,
            })),
            activeStyleId: activeStyleId.value || firstPreset.id,
        });
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

    function ensureOutfitGroup(projectPath = currentProjectPath.value): TextToImageProjectOutfitGroup {
        const key = normalizeProjectPath(projectPath);
        const existing = outfitGroups.value[key];
        if (existing) {
            return existing;
        }
        const group = createOutfitGroup(key);
        outfitGroups.value = {
            ...outfitGroups.value,
            [key]: group,
        };
        return group;
    }

    function updateProjectOutfitGroup(projectPath: string, group: TextToImageProjectOutfitGroup): void {
        const key = normalizeProjectPath(projectPath);
        outfitGroups.value = {
            ...outfitGroups.value,
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
        ensureOutfitGroup(currentProjectPath.value);
        ensureDefaults();
    }

    /**
     * 修复持久化恢复后可能缺失的默认数据。
     */
    function ensureDefaults(): void {
        novelAi.value = normalizeNovelAiSettings(novelAi.value);
        output.value = normalizeOutputSettings(output.value);
        generationDraft.value = normalizeGenerationDraft(generationDraft.value);
        lastNovelAiExchange.value = normalizeLastNovelAiExchange(lastNovelAiExchange.value);
        promptReplacementRules.value = promptReplacementRules.value.map((rule, index) => createPromptReplacementRule(rule.name || `替换规则 ${index + 1}`, rule));
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
        ensureOutfitGroup(currentProjectPath.value);
        for (const [projectPath, group] of Object.entries(characterGroups.value)) {
            const charactersInGroup = dedupeImportedCharacters(group.characters.map((character) => createCharacter(character.cnName || "角色", character)));
            const activeId = charactersInGroup.some((item) => item.id === group.activeCharacterId) ? group.activeCharacterId : charactersInGroup[0]?.id ?? null;
            updateProjectGroup(projectPath, {
                ...group,
                characters: charactersInGroup,
                activeCharacterId: activeId,
            });
        }
        for (const [projectPath, group] of Object.entries(outfitGroups.value)) {
            const outfitsInGroup = group.outfits.map((outfit) => createOutfit(outfit.nameCn || outfit.nameEn || "服装", outfit));
            const activeId = outfitsInGroup.some((item) => item.id === group.activeOutfitId) ? group.activeOutfitId : outfitsInGroup[0]?.id ?? null;
            updateProjectOutfitGroup(projectPath, {
                ...group,
                outfits: outfitsInGroup,
                activeOutfitId: activeId,
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
        recipeDirty.value = true;
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
     * 从当前页结果历史中移除一张生成图片。
     */
    function removeGenerationResult(resultId: string): void {
        generationResults.value = generationResults.value.filter((result) => result.id !== resultId);
    }

    /**
     * 新增画风串并设为当前启用。
     */
    function addStylePreset(): TextToImageStylePreset {
        const style = createStylePreset(`画风串 ${stylePresets.value.length + 1}`);
        stylePresets.value = [...stylePresets.value, style];
        activeStyleId.value = style.id;
        recipeDirty.value = true;
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
        };
        stylePresets.value = [...stylePresets.value, style];
        activeStyleId.value = style.id;
        recipeDirty.value = true;
        return style;
    }

    /**
     * 启用指定画风串。
     */
    function activateStylePreset(styleId: string): void {
        if (stylePresets.value.some((item) => item.id === styleId)) {
            activeStyleId.value = styleId;
            recipeDirty.value = true;
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
        recipeDirty.value = true;
    }

    function deleteStylePreset(styleId: string): void {
        if (stylePresets.value.length <= 1) {
            return;
        }
        const nextStyles = stylePresets.value.filter((item) => item.id !== styleId);
        stylePresets.value = nextStyles;
        if (activeStyleId.value === styleId) {
            activeStyleId.value = nextStyles[0]?.id ?? "";
        }
        recipeDirty.value = true;
    }

    /** 取当前 Recipe references；未加载 Recipe 时返回默认空引用。 */
    function ensureRecipeReferences(): NonNullable<TextToImageRecipeSource["references"]> {
        if (!recipeSavedSource.value) {
            recipeSavedSource.value = createDefaultTextToImageRecipeSource();
        }
        return recipeSavedSource.value.references;
    }

    /** P5：新增 Vibe 引用（最多 16 条）。 */
    function addVibeReference(contentHash: string, strength: number, informationExtracted: number): void {
        const references = ensureRecipeReferences();
        if (references.vibeReferences.length >= 16) return;
        recipeSavedSource.value = {
            ...recipeSavedSource.value!,
            references: {
                ...references,
                vibeReferences: [...references.vibeReferences, {contentHash, strength, informationExtracted}],
            },
        };
        recipeDirty.value = true;
    }

    /** P5：更新指定下标 Vibe 引用的强度与 infoExtracted。 */
    function updateVibeReference(index: number, patch: {strength?: number; informationExtracted?: number | null}): void {
        const references = ensureRecipeReferences();
        const next = references.vibeReferences.map((item, i) => i === index ? {...item, ...patch} : item);
        recipeSavedSource.value = {
            ...recipeSavedSource.value!,
            references: {...references, vibeReferences: next},
        };
        recipeDirty.value = true;
    }

    /** P5：移除指定下标 Vibe 引用。 */
    function removeVibeReference(index: number): void {
        const references = ensureRecipeReferences();
        recipeSavedSource.value = {
            ...recipeSavedSource.value!,
            references: {...references, vibeReferences: references.vibeReferences.filter((_, i) => i !== index)},
        };
        recipeDirty.value = true;
    }

    /** P5：设置唯一的 Character Reference（最多 1 条；infoExtracted 不适用，置 null）。 */
    function setCharacterReference(contentHash: string, strength: number): void {
        const references = ensureRecipeReferences();
        recipeSavedSource.value = {
            ...recipeSavedSource.value!,
            references: {...references, characterReferences: [{contentHash, strength, informationExtracted: null}]},
        };
        recipeDirty.value = true;
    }

    /** P5：移除 Character Reference。 */
    function removeCharacterReference(): void {
        const references = ensureRecipeReferences();
        recipeSavedSource.value = {
            ...recipeSavedSource.value!,
            references: {...references, characterReferences: []},
        };
        recipeDirty.value = true;
    }

    /** P5：设置 Inpaint 双资产（base 图 + PNG 蒙版）；必须两图都有效才写入 Recipe。 */
    function setInpaint(input: {baseImageContentHash: string; maskContentHash: string}): void {
        const references = ensureRecipeReferences();
        recipeSavedSource.value = {
            ...recipeSavedSource.value!,
            references: {...references, inpaint: {baseImageContentHash: input.baseImageContentHash, maskContentHash: input.maskContentHash}},
        };
        recipeDirty.value = true;
    }

    /** P5：移除 Inpaint 引用。 */
    function removeInpaint(): void {
        const references = ensureRecipeReferences();
        recipeSavedSource.value = {
            ...recipeSavedSource.value!,
            references: {...references, inpaint: null},
        };
        recipeDirty.value = true;
    }

    /** P5：切换 Vibe 权重归一化开关。 */
    function setNormalizeVibeStrengths(value: boolean): void {
        const references = ensureRecipeReferences();
        recipeSavedSource.value = {
            ...recipeSavedSource.value!,
            references: {...references, normalizeVibeStrengths: value},
        };
        recipeDirty.value = true;
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
        const importedKey = buildImportedCharacterKey(draft);
        const existing = importedKey
            ? group.characters.find((character) => buildImportedCharacterKey(character) === importedKey)
            : null;
        if (existing) {
            const character = createCharacter(displayName, {
                ...existing,
                ...draft,
                id: existing.id,
            });
            updateProjectGroup(projectPath, {
                ...group,
                characters: group.characters.map((item) => item.id === existing.id ? character : item),
                activeCharacterId: character.id,
            });
            return character;
        }
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
            characters: group.characters.map((item) => item.id === characterId ? createCharacter(item.cnName || item.enName || "角色", {
                ...item,
                ...patch,
                id: item.id,
            }) : item),
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

    /** 新增当前 Project 的服装草稿。 */
    function addOutfit(projectPath = currentProjectPath.value): TextToImageOutfit {
        const group = ensureOutfitGroup(projectPath);
        const outfit = createOutfit(`服装 ${group.outfits.length + 1}`);
        updateProjectOutfitGroup(projectPath, {
            ...group,
            outfits: [...group.outfits, outfit],
            activeOutfitId: outfit.id,
        });
        return outfit;
    }

    function addOutfitFromDraft(draft: Partial<TextToImageOutfit>, projectPath = currentProjectPath.value): TextToImageOutfit {
        const group = ensureOutfitGroup(projectPath);
        const displayName = draft.nameCn?.trim() || draft.nameEn?.trim() || `服装 ${group.outfits.length + 1}`;
        const outfit = createOutfit(displayName, draft);
        updateProjectOutfitGroup(projectPath, {
            ...group,
            outfits: [...group.outfits, outfit],
            activeOutfitId: outfit.id,
        });
        return outfit;
    }

    function selectOutfit(outfitId: string, projectPath = currentProjectPath.value): void {
        const group = ensureOutfitGroup(projectPath);
        if (group.outfits.some((item) => item.id === outfitId)) {
            updateProjectOutfitGroup(projectPath, {
                ...group,
                activeOutfitId: outfitId,
            });
        }
    }

    function updateOutfit(outfitId: string, patch: Partial<TextToImageOutfit>, projectPath = currentProjectPath.value): void {
        const group = ensureOutfitGroup(projectPath);
        updateProjectOutfitGroup(projectPath, {
            ...group,
            outfits: group.outfits.map((item) => item.id === outfitId ? createOutfit(item.nameCn || item.nameEn || "服装", {
                ...item,
                ...patch,
                id: item.id,
            }) : item),
        });
    }

    function deleteOutfit(outfitId: string, projectPath = currentProjectPath.value): void {
        const group = ensureOutfitGroup(projectPath);
        const nextOutfits = group.outfits.filter((item) => item.id !== outfitId);
        updateProjectOutfitGroup(projectPath, {
            ...group,
            outfits: nextOutfits,
            activeOutfitId: group.activeOutfitId === outfitId ? nextOutfits[0]?.id ?? null : group.activeOutfitId,
        });
    }

    function addPromptReplacementRule(patch: Partial<TextToImagePromptReplacementRule> = {}): TextToImagePromptReplacementRule {
        const rule = createPromptReplacementRule(`替换规则 ${promptReplacementRules.value.length + 1}`, patch);
        promptReplacementRules.value = [...promptReplacementRules.value, rule];
        return rule;
    }

    function updatePromptReplacementRule(ruleId: string, patch: Partial<TextToImagePromptReplacementRule>): void {
        promptReplacementRules.value = promptReplacementRules.value.map((rule) => rule.id === ruleId ? createPromptReplacementRule(rule.name, {
            ...rule,
            ...patch,
            id: rule.id,
        }) : rule);
    }

    function deletePromptReplacementRule(ruleId: string): void {
        promptReplacementRules.value = promptReplacementRules.value.filter((rule) => rule.id !== ruleId);
    }

    function importPromptReplacementRules(rules: Partial<TextToImagePromptReplacementRule>[]): void {
        const nextRules = rules.map((rule, index) => createPromptReplacementRule(rule.name || `替换规则 ${index + 1}`, rule));
        promptReplacementRules.value = [...promptReplacementRules.value, ...nextRules];
    }

    function recordNovelAiExchange(exchange: {request: Record<string, unknown> | null; warnings?: string[]; imageCount?: number}): void {
        lastNovelAiExchange.value = normalizeLastNovelAiExchange({
            request: exchange.request,
            warnings: exchange.warnings ?? [],
            imageCount: exchange.imageCount ?? 0,
            updatedAt: new Date().toISOString(),
        });
    }

    return {
        activeCharacter,
        activeCharacterGroup,
        activeCharacterId,
        activeNovelAiProviderId,
        activeOutfit,
        activeOutfitGroup,
        activeOutfitId,
        activeStyle,
        activeStyleId,
        addCharacter,
        addCharacterFromDraft,
        addOutfit,
        addOutfitFromDraft,
        addPromptReplacementRule,
        addStylePreset,
        activateStylePreset,
        characterGroups,
        clearGenerationResults,
        removeGenerationResult,
        characters,
        currentProjectPath,
        deleteCharacter,
        deleteOutfit,
        deletePromptReplacementRule,
        deleteStylePreset,
        duplicateStylePreset,
        ensureDefaults,
        ensureProjectGroup,
        generationDraft,
        generationResults,
        importPromptReplacementRules,
        lastNovelAiExchange,
        novelAi,
        novelAiProviderInspection,
        output,
        outfitGroups,
        outfits,
        prependGenerationResults,
        promptReplacementRules,
        projectJobs,
        projectJobsError,
        projectJobsLoading,
        projectJobsProjectPath,
        recipeDirty,
        recipeError,
        recipeExists,
        recipeInvalidSourceHash,
        recipeLoading,
        recipeMigrationPending,
        recipeMigrationModelConflict,
        recipeNeedsExplicitSave,
        recipeSaving,
        recipeSnapshot,
        recipeReferences,
        addVibeReference,
        removeVibeReference,
        updateVibeReference,
        setCharacterReference,
        removeCharacterReference,
        setInpaint,
        removeInpaint,
        setNormalizeVibeStrengths,
        refreshProviders,
        refreshProjectJobs,
        recordNovelAiExchange,
        confirmRecipeMigrationModel,
        loadRecipe,
        saveRecipe,
        selectCharacter,
        selectOutfit,
        setCurrentProjectPath,
        stylePresets,
        updateCharacter,
        updateGenerationDraft,
        updateNovelAiSettings,
        updateOutputSettings,
        updateOutfit,
        updatePromptReplacementRule,
        updateStylePreset,
    };
}, {
    persist: {
        key: "text.to.image",
        storage: piniaPluginPersistedstate.localStorage(),
        pick: [
            "output",
            "generationDraft",
            "currentProjectPath",
            "characterGroups",
            "outfitGroups",
        ],
    },
});
