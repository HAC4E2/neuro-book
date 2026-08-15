<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import BooleanToggleButton from "nbook/app/components/common/form/BooleanToggleButton.vue";
import {
    TextToImageNovelAiSettingsSchema,
    type TextToImageNovelAiProfile,
    type TextToImageNovelAiGenerationRecipe,
    type TextToImageProviderDto,
} from "nbook/shared/dto/text-to-image.dto";
import {estimateNovelAiTokens} from "nbook/app/utils/novelai-token-counter";

const props = defineProps<{
    providers: TextToImageProviderDto[];
}>();

type ReferenceImageMeta = {
    relativePath: string;
    fileName: string;
    byteLength: number;
    mimeType: string;
};

const emit = defineEmits<{
    (e: "save-provider", input: Record<string, unknown>): void;
}>();

const novelAiProviders = computed(() => props.providers.filter((provider) => provider.kind === "novelai"));
const llmProviders = computed(() => props.providers.filter((provider) => provider.kind === "openai_compatible"));
const selectedProviderId = ref<number | null>(null);
const translateLlmProviderId = ref<number | null>(null);
const form = ref(TextToImageNovelAiSettingsSchema.parse({}));
const credential = ref("");
const error = ref("");
const vibeGroupName = ref("");
const characterGroupName = ref("");
const vibeGroupEntryDrafts = ref<Record<string, string>>({});
const characterGroupEntryDrafts = ref<Record<string, string>>({});
const tagInput = ref("");
const translating = ref(false);
const vibeImageInput = ref<HTMLInputElement | null>(null);
const vibePreviewUrl = ref<string | null>(null);
const generationRecipeName = ref("");
const referenceImages = ref<ReferenceImageMeta[]>([]);
const referenceLibraryLoading = ref(false);
const referenceUploadInput = ref<HTMLInputElement | null>(null);
const generationRecipeId = ref("");
const generationRecipeGroupId = ref("default");
const generationRecipeGroupName = ref("");

const vibeGroupNames = computed(() => Object.keys(form.value.vibeGroups ?? {}));
const characterGroupNames = computed(() => Object.keys(form.value.characterGroups ?? {}));
const requestIntervalSeconds = computed({
    get: () => Math.max(15, Math.round(form.value.requestIntervalMs / 1000)),
    set: (value: number) => {
        const seconds = Number.isFinite(value) ? Math.max(15, Math.trunc(value)) : 15;
        form.value.requestIntervalMs = seconds * 1000;
    },
});
const generationRecipeNames = computed(() => Object.keys(form.value.generationRecipes ?? {}));
const generationRecipeGroupNames = computed(() => Object.entries(form.value.generationRecipeGroups ?? {})
    .sort((left, right) => left[1].sortOrder - right[1].sortOrder || left[0].localeCompare(right[0]))
    .map(([id, group]) => ({id, name: group.name})));
const generationRecipeIdsInSelectedGroup = computed(() => generationRecipeNames.value.filter((id) => (
    (form.value.generationRecipeMeta[id]?.groupId ?? "default") === generationRecipeGroupId.value
)));
const generationRecipeDisplayName = (id: string): string => form.value.generationRecipeMeta[id]?.name ?? id;
const positiveTokenCount = ref<number | null>(null);
const negativeTokenCount = ref<number | null>(null);
const tokenCounterLoading = ref(false);
const tokenCounterError = ref(false);
let tokenCountRequestId = 0;
const commonTags = [
    "1girl",
    "solo",
    "long hair",
    "blue eyes",
    "school uniform",
    "soft lighting",
    "detailed background",
    "looking at viewer",
    "smile",
    "blush",
];
const sizePresets = [
    {label: "竖版 832x1216", width: 832, height: 1216},
    {label: "横版 1216x832", width: 1216, height: 832},
    {label: "方图 1024x1024", width: 1024, height: 1024},
    {label: "小图 512x768", width: 512, height: 768},
];

watch(() => props.providers, () => {
    if (selectedProviderId.value === null && novelAiProviders.value.length > 0) {
        selectProvider(novelAiProviders.value[0]!.id);
    } else if (selectedProviderId.value !== null && !props.providers.some((item) => item.id === selectedProviderId.value)) {
        selectedProviderId.value = null;
        form.value = TextToImageNovelAiSettingsSchema.parse({});
        credential.value = "";
    }
    if (translateLlmProviderId.value === null && llmProviders.value.length > 0) {
        translateLlmProviderId.value = llmProviders.value[0]!.id;
    }
    void loadReferenceImages();
}, {immediate: true});

watch(
    () => [form.value.fixedPositivePrompt, form.value.fixedPositivePromptEnd, form.value.fixedNegativePrompt],
    () => {
        void refreshTokenCounts();
    },
    {immediate: true},
);

async function refreshTokenCounts(): Promise<void> {
    const requestId = ++tokenCountRequestId;
    const positive = `${form.value.fixedPositivePrompt}, ${form.value.fixedPositivePromptEnd}`;
    const negative = form.value.fixedNegativePrompt;
    if (positive.trim() === "" && negative.trim() === "") {
        positiveTokenCount.value = 0;
        negativeTokenCount.value = 0;
        tokenCounterLoading.value = false;
        tokenCounterError.value = false;
        return;
    }
    tokenCounterLoading.value = true;
    tokenCounterError.value = false;
    try {
        const [positiveCount, negativeCount] = await Promise.all([
            estimateNovelAiTokens(positive),
            estimateNovelAiTokens(negative),
        ]);
        if (requestId !== tokenCountRequestId) return;
        positiveTokenCount.value = positiveCount;
        negativeTokenCount.value = negativeCount;
    } catch {
        if (requestId !== tokenCountRequestId) return;
        positiveTokenCount.value = null;
        negativeTokenCount.value = null;
        tokenCounterError.value = true;
    } finally {
        if (requestId === tokenCountRequestId) {
            tokenCounterLoading.value = false;
        }
    }
}

function selectProvider(id: number): void {
    selectedProviderId.value = id;
    const provider = props.providers.find((item) => item.id === id);
    form.value = provider
        ? TextToImageNovelAiSettingsSchema.parse(provider.settings)
        : TextToImageNovelAiSettingsSchema.parse({});
    ensureGenerationRecipeMetadata();
    vibePreviewUrl.value = form.value.vibe.imageId
        ? referenceImageUrl(form.value.vibe.imageId)
        : null;
    generationRecipeId.value = form.value.activeGenerationRecipeId;
    generationRecipeName.value = generationRecipeId.value
        ? form.value.generationRecipeMeta[generationRecipeId.value]?.name ?? generationRecipeId.value
        : "";
    generationRecipeGroupId.value = generationRecipeId.value
        ? form.value.generationRecipeMeta[generationRecipeId.value]?.groupId ?? "default"
        : "default";
    generationRecipeGroupName.value = form.value.generationRecipeGroups[generationRecipeGroupId.value]?.name ?? generationRecipeGroupId.value;
    credential.value = "";
}

function ensureGenerationRecipeMetadata(): void {
    form.value.generationRecipeGroups = {
        default: {name: "默认", sortOrder: 0},
        ...form.value.generationRecipeGroups,
    };
    const originalMeta = form.value.generationRecipeMeta;
    const ids = Object.keys(form.value.generationRecipes);
    if (ids.some((id) => !originalMeta[id])) {
        const recipes: typeof form.value.generationRecipes = {};
        const meta: typeof form.value.generationRecipeMeta = {};
        const used = new Set<string>();
        const idMap = new Map<string, string>();
        for (const id of ids) {
            const nextId = originalMeta[id] ? uniqueGenerationRecipeId(id, used) : uniqueGenerationRecipeId(`style-${slugifyGenerationRecipeName(id)}`, used);
            used.add(nextId);
            idMap.set(id, nextId);
            recipes[nextId] = form.value.generationRecipes[id]!;
            meta[nextId] = originalMeta[id] ?? {name: id, groupId: "default"};
        }
        form.value.generationRecipes = recipes;
        form.value.generationRecipeMeta = meta;
        form.value.activeGenerationRecipeId = idMap.get(form.value.activeGenerationRecipeId) ?? Object.keys(recipes)[0] ?? "";
    } else {
        form.value.generationRecipeMeta = {...originalMeta};
    }
    if (!form.value.activeGenerationRecipeId || !form.value.generationRecipes[form.value.activeGenerationRecipeId]) {
        form.value.activeGenerationRecipeId = Object.keys(form.value.generationRecipes)[0] ?? "";
    }
}

function slugifyGenerationRecipeName(value: string): string {
    return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "style";
}

function uniqueGenerationRecipeId(candidate: string, used: Set<string>): string {
    let id = candidate || "style";
    let index = 2;
    while (used.has(id)) id = `${candidate}-${index++}`;
    return id;
}

function saveConnection(): void {
    if (!form.value.baseUrl.trim()) {
        error.value = "站点地址不能为空";
        return;
    }
    error.value = "";
    emit("save-provider", {
        id: selectedProviderId.value ?? undefined,
        kind: "novelai",
        name: "NovelAI",
        baseUrl: form.value.baseUrl,
        settings: form.value,
        credential: credential.value || undefined,
    });
}

function saveStyle(): void {
    if (!form.value.baseUrl.trim()) {
        error.value = "站点地址不能为空";
        return;
    }
    if (Object.keys(form.value.generationRecipes).length === 0) {
        const id = createGenerationRecipeId("default");
        form.value.generationRecipes = {[id]: snapshotGenerationRecipe()};
        form.value.generationRecipeGroups = {
            ...form.value.generationRecipeGroups,
            default: form.value.generationRecipeGroups.default ?? {name: "默认", sortOrder: 0},
        };
        form.value.generationRecipeMeta = {
            ...form.value.generationRecipeMeta,
            [id]: {name: "默认", groupId: "default"},
        };
        form.value.activeGenerationRecipeId = id;
        generationRecipeId.value = id;
        generationRecipeName.value = "默认";
        generationRecipeGroupId.value = "default";
    }
    const activeRecipeId = form.value.activeGenerationRecipeId.trim();
    if (activeRecipeId) {
        form.value.generationRecipes = {
            ...form.value.generationRecipes,
            [activeRecipeId]: snapshotGenerationRecipe(),
        };
        form.value.generationRecipeMeta = {
            ...form.value.generationRecipeMeta,
            [activeRecipeId]: form.value.generationRecipeMeta[activeRecipeId] ?? {
                name: generationRecipeName.value.trim() || activeRecipeId,
                groupId: generationRecipeGroupId.value || "default",
            },
        };
    }
    error.value = "";
    emit("save-provider", {
        id: selectedProviderId.value ?? undefined,
        kind: "novelai",
        name: "NovelAI",
        baseUrl: form.value.baseUrl,
        settings: form.value,
    });
}

function toggleFieldClass(enabled: boolean): string {
    return enabled
        ? "rounded-md border border-[var(--accent-main)] bg-[var(--accent-bg)] px-2 py-1 shadow-[0_0_0_1px_var(--accent-main)]"
        : "rounded-md border border-transparent px-2 py-1";
}

function addVibeGroup(): void {
    const groupName = vibeGroupName.value.trim();
    if (!groupName) return;
    form.value.vibeGroups = {
        ...form.value.vibeGroups,
        [groupName]: form.value.vibeGroups[groupName] ?? [],
    };
    vibeGroupEntryDrafts.value[groupName] = "";
    vibeGroupName.value = "";
}

function deleteVibeGroup(groupName: string): void {
    const next = {...form.value.vibeGroups};
    delete next[groupName];
    form.value.vibeGroups = next;
    delete vibeGroupEntryDrafts.value[groupName];
    if (form.value.vibeGroup.groupId === groupName) {
        form.value.vibeGroup.groupId = null;
    }
}

function addVibeGroupItem(groupName: string): void {
    const item = (vibeGroupEntryDrafts.value[groupName] ?? "").trim();
    if (!item) return;
    const current = form.value.vibeGroups[groupName] ?? [];
    if (current.length >= 4) {
        error.value = "每个 Vibe 组最多 4 个 Vibe";
        return;
    }
    if (current.includes(item)) {
        return;
    }
    form.value.vibeGroups = {
        ...form.value.vibeGroups,
        [groupName]: [...current, item],
    };
    vibeGroupEntryDrafts.value[groupName] = "";
}

function removeVibeGroupItem(groupName: string, item: string): void {
    form.value.vibeGroups = {
        ...form.value.vibeGroups,
        [groupName]: (form.value.vibeGroups[groupName] ?? []).filter((value) => value !== item),
    };
}

async function loadReferenceImages(): Promise<void> {
    referenceLibraryLoading.value = true;
    try {
        const result = await $fetch<{items: typeof referenceImages.value}>("/api/text-to-image/reference-images");
        referenceImages.value = result.items;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "读取参考图库失败");
    } finally {
        referenceLibraryLoading.value = false;
    }
}

async function uploadReferenceImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
        const dataBase64 = await readFileAsBase64(file);
        const meta = await $fetch<ReferenceImageMeta>("/api/text-to-image/reference-images", {
            method: "POST",
            body: {
                fileName: file.name,
                dataBase64,
            },
        });
        await loadReferenceImages();
        if (!form.value.characterReference.imageIds.includes(meta.relativePath)) {
            form.value.characterReference.imageIds = [
                ...form.value.characterReference.imageIds,
                meta.relativePath,
            ];
        }
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "上传参考图失败");
    } finally {
        input.value = "";
    }
}

function toggleReferenceImage(relativePath: string): void {
    const current = form.value.characterReference.imageIds;
    form.value.characterReference.imageIds = current.includes(relativePath)
        ? current.filter((item) => item !== relativePath)
        : [...current, relativePath];
}

async function deleteReferenceImage(relativePath: string): Promise<void> {
    try {
        await $fetch("/api/text-to-image/reference-images/delete", {
            method: "POST",
            body: {relativePath},
        });
        if (form.value.vibe.imageId === relativePath) {
            form.value.vibe.imageId = null;
            vibePreviewUrl.value = null;
        }
        form.value.characterReference.imageIds = form.value.characterReference.imageIds
            .filter((item) => item !== relativePath);
        form.value.vibeGroups = Object.fromEntries(
            Object.entries(form.value.vibeGroups).map(([groupName, items]) => [
                groupName,
                items.filter((item) => item !== relativePath),
            ]),
        );
        form.value.characterGroups = Object.fromEntries(
            Object.entries(form.value.characterGroups).map(([groupName, items]) => [
                groupName,
                items.filter((item) => item !== relativePath),
            ]),
        );
        for (const groupName of Object.keys(vibeGroupEntryDrafts.value)) {
            if (vibeGroupEntryDrafts.value[groupName] === relativePath) {
                vibeGroupEntryDrafts.value[groupName] = "";
            }
        }
        for (const groupName of Object.keys(characterGroupEntryDrafts.value)) {
            if (characterGroupEntryDrafts.value[groupName] === relativePath) {
                characterGroupEntryDrafts.value[groupName] = "";
            }
        }
        await loadReferenceImages();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "删除参考图失败");
    }
}

function openReferenceUpload(): void {
    referenceUploadInput.value?.click();
}

function referenceImageUrl(relativePath: string): string {
    return `/api/text-to-image/reference-images/content?path=${encodeURIComponent(relativePath)}`;
}

function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = typeof reader.result === "string" ? reader.result : "";
            const commaIndex = dataUrl.indexOf(",");
            resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl);
        };
        reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
        reader.readAsDataURL(file);
    });
}

function addCharacterGroup(): void {
    const groupName = characterGroupName.value.trim();
    if (!groupName) return;
    form.value.characterGroups = {
        ...form.value.characterGroups,
        [groupName]: form.value.characterGroups[groupName] ?? [],
    };
    characterGroupEntryDrafts.value[groupName] = "";
    characterGroupName.value = "";
}

function deleteCharacterGroup(groupName: string): void {
    const next = {...form.value.characterGroups};
    delete next[groupName];
    form.value.characterGroups = next;
    delete characterGroupEntryDrafts.value[groupName];
    if (form.value.characterReference.groupId === groupName) {
        form.value.characterReference.groupId = null;
    }
}

function addCharacterGroupItem(groupName: string): void {
    const item = (characterGroupEntryDrafts.value[groupName] ?? "").trim();
    if (!item) return;
    const current = form.value.characterGroups[groupName] ?? [];
    if (current.includes(item)) {
        return;
    }
    form.value.characterGroups = {
        ...form.value.characterGroups,
        [groupName]: [...current, item],
    };
    characterGroupEntryDrafts.value[groupName] = "";
}

function removeCharacterGroupItem(groupName: string, item: string): void {
    form.value.characterGroups = {
        ...form.value.characterGroups,
        [groupName]: (form.value.characterGroups[groupName] ?? []).filter((value) => value !== item),
    };
}

function snapshotGenerationRecipe(): TextToImageNovelAiGenerationRecipe {
    return {
        ...snapshotProfile(),
        positive: form.value.fixedPositivePrompt,
        positiveEnd: form.value.fixedPositivePromptEnd,
        negative: form.value.fixedNegativePrompt,
        promptReplaceText: form.value.promptReplaceText,
        furryDataset: form.value.furryDataset,
        vibe: {...form.value.vibe},
        characterReference: {...form.value.characterReference},
        vibeGroup: {...form.value.vibeGroup},
    };
}

function applyProfileValues(profile: TextToImageNovelAiProfile): void {
    form.value.model = profile.model;
    form.value.sampler = profile.sampler;
    form.value.noiseSchedule = profile.noiseSchedule;
    form.value.promptGuidance = profile.promptGuidance;
    form.value.promptGuidanceRescale = profile.promptGuidanceRescale;
    form.value.aiDefaultCharacterPosition = profile.aiDefaultCharacterPosition;
    form.value.smea = profile.smea;
    form.value.smeaDyn = profile.smeaDyn;
    form.value.variety = profile.variety;
    form.value.decrisp = profile.decrisp;
    form.value.width = profile.width;
    form.value.height = profile.height;
    form.value.steps = profile.steps;
    form.value.seed = profile.seed;
    form.value.positiveQualityPreset = profile.positiveQualityPreset;
    form.value.negativeQualityPreset = profile.negativeQualityPreset;
}

function selectGenerationRecipe(id: string): void {
    if (!id) return;
    generationRecipeId.value = id;
    generationRecipeName.value = generationRecipeDisplayName(id);
    generationRecipeGroupId.value = form.value.generationRecipeMeta[id]?.groupId ?? "default";
    applyGenerationRecipe(id);
}

function applyGenerationRecipe(id: string): void {
    const recipe = form.value.generationRecipes[id];
    if (!recipe) return;
    applyProfileValues(recipe);
    form.value.fixedPositivePrompt = recipe.positive;
    form.value.fixedPositivePromptEnd = recipe.positiveEnd;
    form.value.fixedNegativePrompt = recipe.negative;
    form.value.promptReplaceText = recipe.promptReplaceText;
    form.value.furryDataset = recipe.furryDataset;
    form.value.vibe = {...recipe.vibe};
    form.value.characterReference = {...recipe.characterReference};
    form.value.vibeGroup = {...recipe.vibeGroup};
    form.value.activeGenerationRecipeId = id;
    saveStyle();
}

function saveGenerationRecipe(): void {
    const name = generationRecipeName.value.trim();
    if (!name) return;
    const id = generationRecipeId.value || createGenerationRecipeId(name);
    form.value.generationRecipes = {
        ...form.value.generationRecipes,
        [id]: snapshotGenerationRecipe(),
    };
    form.value.generationRecipeGroups = {
        ...form.value.generationRecipeGroups,
        [generationRecipeGroupId.value]: form.value.generationRecipeGroups[generationRecipeGroupId.value] ?? {
            name: generationRecipeGroupName.value.trim() || generationRecipeGroupId.value,
            sortOrder: Object.keys(form.value.generationRecipeGroups).length,
        },
    };
    form.value.generationRecipeMeta = {
        ...form.value.generationRecipeMeta,
        [id]: {name, groupId: generationRecipeGroupId.value || "default"},
    };
    generationRecipeId.value = id;
    form.value.activeGenerationRecipeId = id;
    saveStyle();
}

function renameGenerationRecipe(): void {
    const id = generationRecipeId.value;
    const name = generationRecipeName.value.trim();
    if (!id || !name || !form.value.generationRecipes[id]) return;
    form.value.generationRecipeMeta = {
        ...form.value.generationRecipeMeta,
        [id]: {name, groupId: form.value.generationRecipeMeta[id]?.groupId ?? (generationRecipeGroupId.value || "default")},
    };
    saveStyle();
}

function deleteGenerationRecipe(id: string): void {
    const next = {...form.value.generationRecipes};
    delete next[id];
    form.value.generationRecipes = next;
    const nextMeta = {...form.value.generationRecipeMeta};
    delete nextMeta[id];
    form.value.generationRecipeMeta = nextMeta;
    if (form.value.activeGenerationRecipeId === id) {
        const replacement = Object.keys(next)[0] ?? "";
        form.value.activeGenerationRecipeId = replacement;
        generationRecipeId.value = replacement;
        generationRecipeName.value = replacement ? generationRecipeDisplayName(replacement) : "";
    }
    saveStyle();
}

function addGenerationRecipeGroup(): void {
    const id = generationRecipeGroupId.value.trim();
    if (!id || form.value.generationRecipeGroups[id]) return;
    form.value.generationRecipeGroups = {
        ...form.value.generationRecipeGroups,
        [id]: {name: generationRecipeGroupName.value.trim() || id, sortOrder: Object.keys(form.value.generationRecipeGroups).length},
    };
    generationRecipeGroupName.value = generationRecipeGroupName.value.trim() || id;
    saveStyle();
}

function createGenerationRecipeId(name: string): string {
    const slug = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "style";
    let id = `style-${slug}`;
    let index = 2;
    while (form.value.generationRecipes[id]) id = `style-${slug}-${index++}`;
    return id;
}

function snapshotProfile(): TextToImageNovelAiProfile {
    return {
        model: form.value.model,
        sampler: form.value.sampler,
        noiseSchedule: form.value.noiseSchedule,
        promptGuidance: form.value.promptGuidance,
        promptGuidanceRescale: form.value.promptGuidanceRescale,
        aiDefaultCharacterPosition: form.value.aiDefaultCharacterPosition,
        smea: form.value.smea,
        smeaDyn: form.value.smeaDyn,
        variety: form.value.variety,
        decrisp: form.value.decrisp,
        width: form.value.width,
        height: form.value.height,
        steps: form.value.steps,
        seed: form.value.seed,
        positiveQualityPreset: form.value.positiveQualityPreset,
        negativeQualityPreset: form.value.negativeQualityPreset,
    };
}

async function translateFixedPrompts(): Promise<void> {
    if (translateLlmProviderId.value === null) {
        error.value = "请先选择翻译用的 LLM Provider";
        return;
    }
    const fields: Array<{
        key: "fixedPositivePrompt" | "fixedPositivePromptEnd" | "fixedNegativePrompt";
        value: string;
    }> = [
        {key: "fixedPositivePrompt", value: form.value.fixedPositivePrompt},
        {key: "fixedPositivePromptEnd", value: form.value.fixedPositivePromptEnd},
        {key: "fixedNegativePrompt", value: form.value.fixedNegativePrompt},
    ];
    translating.value = true;
    error.value = "";
    try {
        for (const field of fields) {
            if (!field.value.trim()) continue;
            const result = await $fetch<{content: string}>("/api/text-to-image/llm/test", {
                method: "POST",
                body: {
                    providerId: translateLlmProviderId.value,
                    prompt: `把下面的图片提示词翻译成英文 tag，保持逗号分隔格式，只输出翻译结果：\n\n${field.value}`,
                },
            });
            form.value[field.key] = result.content.trim();
        }
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "翻译固定提示词失败");
    } finally {
        translating.value = false;
    }
}

function appendTag(): void {
    const tag = tagInput.value.trim();
    if (!tag) return;
    const current = form.value.fixedPositivePrompt.trim();
    form.value.fixedPositivePrompt = current ? `${current}, ${tag}` : tag;
    tagInput.value = "";
}

function applySizePreset(width: number, height: number): void {
    form.value.width = width;
    form.value.height = height;
}

async function onVibeImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
        const dataBase64 = await readFileAsBase64(file);
        const meta = await $fetch<ReferenceImageMeta>("/api/text-to-image/reference-images", {
            method: "POST",
            body: {
                fileName: file.name,
                dataBase64,
            },
        });
        await loadReferenceImages();
        form.value.vibe.imageId = meta.relativePath;
        vibePreviewUrl.value = referenceImageUrl(meta.relativePath);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "上传 Vibe 参考图失败");
    } finally {
        input.value = "";
    }
}

function removeVibeImage(): void {
    form.value.vibe.imageId = null;
    vibePreviewUrl.value = null;
}

function openVibeImagePicker(): void {
    vibeImageInput.value?.click();
}

function downloadVibeFile(): void {
    const name = `vibe-${Date.now()}`;
    const payload = {
        identifier: "novelai-vibe-transfer",
        version: 1,
        type: "image",
        image: "",
        id: name,
        encodings: {},
        name,
        thumbnail: "",
        createdAt: Date.now(),
        importInfo: {
            model: form.value.model,
            information_extracted: form.value.vibe.informationExtracted,
            strength: form.value.vibe.referenceStrength,
        },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}.naiv4vibe`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[17px] font-semibold text-[var(--text-main)]">NovelAI 连接</h3>
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    站点
                    <input v-model="form.baseUrl" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" @change="saveConnection" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    API Key（留空表示保留）
                    <input v-model="credential" type="password" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" @change="saveConnection" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    生图间隔（秒，最低 15）
                    <input v-model.number="requestIntervalSeconds" type="number" min="15" step="1" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" @change="saveConnection" />
                </label>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[17px] font-semibold text-[var(--text-main)]">画风串和模型参数配置</h3>
            <p class="mb-3 text-[13px] text-[var(--text-muted)]">画风串会连同模型参数、固定提示词和参考图选择一起保存；改名不会影响已保存的稳定 ID。</p>
            <div class="mb-4 grid gap-2 rounded-md border border-[var(--border-color)] p-3 md:grid-cols-[180px_minmax(0,1fr)_180px]">
                <label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">画风串分组
                    <select v-model="generationRecipeGroupId" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[14px] text-[var(--text-main)]">
                        <option v-for="group in generationRecipeGroupNames" :key="group.id" :value="group.id">{{ group.name }}</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">画风串
                    <select v-model="generationRecipeId" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[14px] text-[var(--text-main)]" @change="selectGenerationRecipe(generationRecipeId)">
                        <option value="">新建画风串</option>
                        <option v-for="id in generationRecipeIdsInSelectedGroup" :key="id" :value="id">{{ generationRecipeDisplayName(id) }}</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">自定义名称
                    <input v-model="generationRecipeName" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[14px] text-[var(--text-main)]" placeholder="例如：柔和厚涂" />
                </label>
                <div class="flex flex-wrap items-center gap-2 md:col-span-3">
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="!generationRecipeId" @click="selectGenerationRecipe(generationRecipeId)">应用</button>
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="!generationRecipeName" @click="saveGenerationRecipe">保存画风串</button>
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="!generationRecipeId || !generationRecipeName" @click="renameGenerationRecipe">重命名</button>
                    <button class="h-8 rounded-md border border-[var(--danger-border)] px-3 text-[13px] text-[var(--danger-text)]" :disabled="!generationRecipeId" @click="deleteGenerationRecipe(generationRecipeId)">删除</button>
                    <span v-if="form.activeGenerationRecipeId" class="text-[12px] text-[var(--accent-text)]">当前：{{ generationRecipeDisplayName(form.activeGenerationRecipeId) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-2 md:col-span-3">
                    <input v-model="generationRecipeGroupId" class="h-8 w-40 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" placeholder="新分组 ID" />
                    <input v-model="generationRecipeGroupName" class="h-8 w-40 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" placeholder="分组显示名称" />
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" @click="addGenerationRecipeGroup">新建分组</button>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-3">
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    模型
                    <select v-model="form.model" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                        <option>nai-diffusion-3</option>
                        <option>nai-diffusion-4-full</option>
                        <option>nai-diffusion-4-curated-preview</option>
                        <option>nai-diffusion-4-5-curated</option>
                        <option>nai-diffusion-4-5-full</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    采样器
                    <select v-model="form.sampler" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                        <option>k_euler</option>
                        <option>ddim_v3</option>
                        <option>k_dpmpp_2s_ancestral</option>
                        <option>k_dpmpp_2m</option>
                        <option>k_euler_ancestral</option>
                        <option>k_dpmpp_2m_sde</option>
                        <option>k_dpmpp_sde</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    噪点表
                    <select v-model="form.noiseSchedule" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                        <option>native</option>
                        <option>exponential</option>
                        <option>polyexponential</option>
                        <option>karras</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    Prompt Guidance
                    <input v-model.number="form.promptGuidance" type="number" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    Guidance Rescale
                    <input v-model.number="form.promptGuidanceRescale" type="number" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    尺寸（宽 x 高）
                    <div class="flex gap-2">
                        <input v-model.number="form.width" type="number" class="h-9 w-1/2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                        <input v-model.number="form.height" type="number" class="h-9 w-1/2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                    </div>
                    <div class="mt-1 flex flex-wrap gap-1">
                        <button v-for="preset in sizePresets" :key="preset.label" type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1 text-[15px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="applySizePreset(preset.width, preset.height)">
                            {{ preset.label }}
                        </button>
                    </div>
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    Steps
                    <input v-model.number="form.steps" type="number" min="1" max="50" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    Seed
                    <input v-model.number="form.seed" type="number" min="-1" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                </label>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-3">
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.aiDefaultCharacterPosition)">
                    <BooleanToggleButton v-model="form.aiDefaultCharacterPosition" />
                    AI 默认角色位置
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.smea)">
                    <BooleanToggleButton v-model="form.smea" />
                    SMEA
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.smeaDyn)">
                    <BooleanToggleButton v-model="form.smeaDyn" />
                    SMEA DYN
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.variety)">
                    <BooleanToggleButton v-model="form.variety" />
                    Variety
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.decrisp)">
                    <BooleanToggleButton v-model="form.decrisp" />
                    Decrisp
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.furryDataset)">
                    <BooleanToggleButton v-model="form.furryDataset" />
                    福瑞数据集
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.positiveQualityPreset)">
                    <BooleanToggleButton v-model="form.positiveQualityPreset" />
                    正面质量预设
                </label>
                <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]">
                    负面质量预设
                    <select v-model="form.negativeQualityPreset" class="h-9 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                        <option value="none">无</option>
                        <option value="Heavy">Heavy</option>
                        <option value="Light">Light</option>
                        <option value="Human Focus">Human Focus</option>
                        <option value="Furry Focus">Furry Focus</option>
                    </select>
                </label>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-3">
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    固定正面提示词
                    <textarea v-model="form.fixedPositivePrompt" rows="4" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    后置固定正面提示词
                    <textarea v-model="form.fixedPositivePromptEnd" rows="4" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[17px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                    固定负面提示词
                    <textarea v-model="form.fixedNegativePrompt" rows="4" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[17px] text-[var(--text-main)]" />
                </label>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
                <select v-model.number="translateLlmProviderId" class="h-9 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                    <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                </select>
                <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[16px] text-[var(--text-secondary)]" :disabled="translating || translateLlmProviderId === null" @click="translateFixedPrompts">翻译固定提示词</button>
                <span v-if="translating" class="text-[16px] text-[var(--text-muted)]">翻译中...</span>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <input v-model="tagInput" list="novelai-common-tags" class="h-9 w-56 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" placeholder="输入 Tag" />
                <datalist id="novelai-common-tags">
                    <option v-for="tag in commonTags" :key="tag" :value="tag" />
                </datalist>
                <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[16px] text-[var(--text-secondary)]" @click="appendTag">追加 Tag</button>
            </div>
            <label class="mt-3 flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                提示词替换规则
                <textarea v-model="form.promptReplaceText" rows="3" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[17px] text-[var(--text-main)]" />
            </label>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-9 rounded-md bg-[var(--accent-main)] px-3 text-[16px] font-medium text-[var(--text-inverse)]" @click="saveStyle">保存画风串和模型参数</button>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[17px] font-semibold text-[var(--text-main)]">当前提示词 token 估算</h3>
            <p class="mt-2 text-[15px] text-[var(--text-muted)]">
                <template v-if="tokenCounterLoading">正在加载 T5 分词器…</template>
                <template v-else-if="tokenCounterError">token 估算不可用</template>
                <template v-else>正面估算 token：{{ positiveTokenCount ?? "—" }} · 负面估算 token：{{ negativeTokenCount ?? "—" }} · 参考上限：512</template>
            </p>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[17px] font-semibold text-[var(--text-main)]">Vibe / 角色参考</h3>
            <div class="mb-3 grid grid-cols-2 gap-3">
                <div>
                    <div class="flex items-center gap-2">
                        <input v-model="vibeGroupName" class="h-9 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" placeholder="Vibe 组名" />
                        <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[16px] text-[var(--text-secondary)]" @click="addVibeGroup">添加</button>
                    </div>
                    <ul class="mt-2 space-y-1">
                        <li v-for="groupName in vibeGroupNames" :key="groupName" class="rounded-md border border-[var(--border-color)] p-2 text-[16px] text-[var(--text-secondary)]">
                            <div class="flex items-center justify-between">
                                <span class="font-medium text-[var(--text-main)]">{{ groupName }}</span>
                                <button class="text-[var(--danger-text)]" @click="deleteVibeGroup(groupName)">删除</button>
                            </div>
                            <div class="mt-1 flex items-center gap-1">
                                <select v-model="vibeGroupEntryDrafts[groupName]" class="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-1 text-[15px] text-[var(--text-main)]">
                                    <option value="">选择参考图</option>
                                    <option v-for="image in referenceImages" :key="image.relativePath" :value="image.relativePath">{{ image.fileName }}</option>
                                </select>
                                <button class="h-7 shrink-0 rounded-md border border-[var(--border-color)] px-2 text-[15px] text-[var(--text-secondary)]" @click="addVibeGroupItem(groupName)">添加</button>
                            </div>
                            <ul class="mt-1 space-y-1">
                                <li v-for="item in form.vibeGroups[groupName]" :key="item" class="flex items-center gap-2 text-[15px]">
                                    <img :src="referenceImageUrl(item)" class="h-6 w-6 shrink-0 rounded object-cover" alt="" />
                                    <span class="min-w-0 flex-1 truncate">{{ item }}</span>
                                    <button class="text-[var(--danger-text)]" @click="removeVibeGroupItem(groupName, item)">移除</button>
                                </li>
                            </ul>
                        </li>
                    </ul>
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <input v-model="characterGroupName" class="h-9 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" placeholder="角色组名" />
                        <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[16px] text-[var(--text-secondary)]" @click="addCharacterGroup">添加</button>
                    </div>
                    <ul class="mt-2 space-y-1">
                        <li v-for="groupName in characterGroupNames" :key="groupName" class="rounded-md border border-[var(--border-color)] p-2 text-[16px] text-[var(--text-secondary)]">
                            <div class="flex items-center justify-between">
                                <span class="font-medium text-[var(--text-main)]">{{ groupName }}</span>
                                <button class="text-[var(--danger-text)]" @click="deleteCharacterGroup(groupName)">删除</button>
                            </div>
                            <div class="mt-1 flex items-center gap-1">
                                <select v-model="characterGroupEntryDrafts[groupName]" class="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-1 text-[15px] text-[var(--text-main)]">
                                    <option value="">选择参考图</option>
                                    <option v-for="image in referenceImages" :key="image.relativePath" :value="image.relativePath">{{ image.fileName }}</option>
                                </select>
                                <button class="h-7 shrink-0 rounded-md border border-[var(--border-color)] px-2 text-[15px] text-[var(--text-secondary)]" @click="addCharacterGroupItem(groupName)">添加</button>
                            </div>
                            <ul class="mt-1 space-y-1">
                                <li v-for="item in form.characterGroups[groupName]" :key="item" class="flex items-center gap-2 text-[15px]">
                                    <img :src="referenceImageUrl(item)" class="h-6 w-6 shrink-0 rounded object-cover" alt="" />
                                    <span class="min-w-0 flex-1 truncate">{{ item }}</span>
                                    <button class="text-[var(--danger-text)]" @click="removeCharacterGroupItem(groupName, item)">移除</button>
                                </li>
                            </ul>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.vibe.enabled)">
                        <BooleanToggleButton v-model="form.vibe.enabled" />
                        启用 Vibe Transfer
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                        信息提取量
                        <input v-model.number="form.vibe.informationExtracted" type="number" min="0" max="1" step="0.01" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                        氛围强度
                        <input v-model.number="form.vibe.referenceStrength" type="number" min="0" max="1" step="0.01" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]" />
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                        参考图
                        <div class="flex items-center gap-2">
                            <input ref="vibeImageInput" type="file" accept="image/*" class="hidden" @change="onVibeImageSelected" />
                            <button type="button" class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)]" @click="openVibeImagePicker">选择图片</button>
                            <span class="min-w-0 flex-1 truncate text-[16px] text-[var(--text-muted)]">{{ form.vibe.imageId ?? "未选择" }}</span>
                        </div>
                    </label>
                    <div v-if="vibePreviewUrl" class="mt-2 flex items-center gap-2">
                        <img :src="vibePreviewUrl" class="h-12 w-12 rounded-md object-cover" alt="Vibe 参考图预览" />
                        <button type="button" class="h-9 rounded-md border border-[var(--danger-border)] px-2 text-[16px] text-[var(--danger-text)]" @click="removeVibeImage">移除</button>
                    </div>
                    <button type="button" class="mt-3 h-9 rounded-md border border-[var(--border-color)] px-3 text-[16px] text-[var(--text-secondary)]" @click="downloadVibeFile">下载 Vibe 文件</button>
                </div>
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.characterReference.enabled)">
                        <BooleanToggleButton v-model="form.characterReference.enabled" />
                        启用角色参考
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                        角色组
                        <select v-model="form.characterReference.groupId" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                            <option :value="null">不启用角色组</option>
                            <option v-for="groupName in characterGroupNames" :key="groupName" :value="groupName">{{ groupName }}</option>
                        </select>
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                        参考图库
                        <div class="flex items-center gap-2">
                            <input ref="referenceUploadInput" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="uploadReferenceImage" />
                            <button type="button" class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[16px] text-[var(--text-secondary)]" @click="openReferenceUpload">上传</button>
                            <span v-if="referenceLibraryLoading" class="text-[15px] text-[var(--text-muted)]">读取中...</span>
                        </div>
                    </label>
                    <div v-if="referenceImages.length > 0" class="mt-2 grid grid-cols-3 gap-2">
                        <div
                            v-for="image in referenceImages"
                            :key="image.relativePath"
                            class="relative overflow-hidden rounded-md border"
                            :class="form.characterReference.imageIds.includes(image.relativePath) ? 'border-[var(--accent-main)]' : 'border-[var(--border-color)]'"
                        >
                            <button type="button" class="block w-full" :title="image.fileName" @click="toggleReferenceImage(image.relativePath)">
                                <img :src="referenceImageUrl(image.relativePath)" class="h-14 w-full object-cover" :alt="image.fileName" />
                            </button>
                            <button
                                type="button"
                                class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-[var(--bg-panel)] text-[var(--danger-text)]"
                                @click="deleteReferenceImage(image.relativePath)"
                            >
                                <span class="i-lucide-x h-3 w-3"></span>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.vibeGroup.enabled)">
                        <BooleanToggleButton v-model="form.vibeGroup.enabled" />
                        启用 Vibe 组
                    </label>
                    <div class="mt-2 flex items-center gap-3">
                        <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.vibeGroup.random)">
                            <BooleanToggleButton v-model="form.vibeGroup.random" />
                            随机组
                        </label>
                        <label class="flex items-center gap-2 text-[16px] text-[var(--text-secondary)]" :class="toggleFieldClass(form.vibeGroup.normalizeStrength)">
                            <BooleanToggleButton v-model="form.vibeGroup.normalizeStrength" />
                            归一化强度
                        </label>
                    </div>
                </div>
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <label class="flex flex-col gap-1 text-[16px] text-[var(--text-secondary)]">
                        Vibe 组
                        <select v-model="form.vibeGroup.groupId" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[17px] text-[var(--text-main)]">
                            <option :value="null">随机或未选择</option>
                            <option v-for="groupName in vibeGroupNames" :key="groupName" :value="groupName">{{ groupName }}</option>
                        </select>
                    </label>
                </div>
            </div>
        </div>

        <p v-if="error" class="text-[16px] text-[var(--danger-text)]">{{ error }}</p>
    </div>
</template>
