<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    TextToImageNovelAiSettingsSchema,
    type TextToImageNovelAiProfile,
    type TextToImageProviderDto,
} from "nbook/shared/dto/text-to-image.dto";

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
    (e: "delete-provider", id: number): void;
}>();

const novelAiProviders = computed(() => props.providers.filter((provider) => provider.kind === "novelai"));
const llmProviders = computed(() => props.providers.filter((provider) => provider.kind === "openai_compatible"));
const selectedProviderId = ref<number | null>(null);
const translateLlmProviderId = ref<number | null>(null);
const form = ref(TextToImageNovelAiSettingsSchema.parse({}));
const name = ref("");
const credential = ref("");
const error = ref("");
const fixedPromptPresetName = ref("");
const vibeGroupName = ref("");
const characterGroupName = ref("");
const vibeGroupEntryDrafts = ref<Record<string, string>>({});
const tagInput = ref("");
const translating = ref(false);
const vibeImageInput = ref<HTMLInputElement | null>(null);
const vibePreviewUrl = ref<string | null>(null);
const profileName = ref("");
const referenceImages = ref<ReferenceImageMeta[]>([]);
const referenceLibraryLoading = ref(false);
const referenceUploadInput = ref<HTMLInputElement | null>(null);

const fixedPromptPresetNames = computed(() => Object.keys(form.value.fixedPromptPresets ?? {}));
const vibeGroupNames = computed(() => Object.keys(form.value.vibeGroups ?? {}));
const characterGroupNames = computed(() => Object.keys(form.value.characterGroups ?? {}));
const profileNames = computed(() => Object.keys(form.value.profiles ?? {}));
const positiveTokenCount = computed(() => form.value.fixedPositivePrompt.length + form.value.fixedPositivePromptEnd.length);
const negativeTokenCount = computed(() => form.value.fixedNegativePrompt.length);
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
    }
    if (translateLlmProviderId.value === null && llmProviders.value.length > 0) {
        translateLlmProviderId.value = llmProviders.value[0]!.id;
    }
    void loadReferenceImages();
}, {immediate: true});

function selectProvider(id: number): void {
    selectedProviderId.value = id;
    const provider = props.providers.find((item) => item.id === id);
    form.value = provider
        ? TextToImageNovelAiSettingsSchema.parse(provider.settings)
        : TextToImageNovelAiSettingsSchema.parse({});
    name.value = provider?.name ?? "";
    credential.value = "";
}

function newProvider(): void {
    selectedProviderId.value = null;
    form.value = TextToImageNovelAiSettingsSchema.parse({});
    name.value = "";
    credential.value = "";
}

function saveProvider(): void {
    if (!name.value.trim() || !form.value.baseUrl.trim()) {
        error.value = "名称和站点地址不能为空";
        return;
    }
    error.value = "";
    emit("save-provider", {
        id: selectedProviderId.value ?? undefined,
        kind: "novelai",
        name: name.value,
        baseUrl: form.value.baseUrl,
        credential: credential.value || undefined,
        settings: form.value,
    });
}

function deleteProvider(): void {
    if (selectedProviderId.value !== null) {
        emit("delete-provider", selectedProviderId.value);
        newProvider();
    }
}

function saveFixedPromptPreset(): void {
    const presetName = fixedPromptPresetName.value.trim();
    if (!presetName) return;
    form.value.fixedPromptPresets = {
        ...form.value.fixedPromptPresets,
        [presetName]: {
            positive: form.value.fixedPositivePrompt,
            positiveEnd: form.value.fixedPositivePromptEnd,
            negative: form.value.fixedNegativePrompt,
        },
    };
}

function applyFixedPromptPreset(presetName: string): void {
    const preset = form.value.fixedPromptPresets[presetName];
    if (!preset) return;
    form.value.fixedPositivePrompt = preset.positive;
    form.value.fixedPositivePromptEnd = preset.positiveEnd;
    form.value.fixedNegativePrompt = preset.negative;
}

function deleteFixedPromptPreset(presetName: string): void {
    const next = {...form.value.fixedPromptPresets};
    delete next[presetName];
    form.value.fixedPromptPresets = next;
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
        form.value.characterReference.imageIds = form.value.characterReference.imageIds
            .filter((item) => item !== relativePath);
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
    characterGroupName.value = "";
}

function deleteCharacterGroup(groupName: string): void {
    const next = {...form.value.characterGroups};
    delete next[groupName];
    form.value.characterGroups = next;
}

function saveProfile(): void {
    const name = profileName.value.trim();
    if (!name) return;
    form.value.profiles = {
        ...form.value.profiles,
        [name]: snapshotProfile(),
    };
}

function applyProfile(name: string): void {
    const profile = form.value.profiles[name];
    if (!profile) return;
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

function deleteProfile(name: string): void {
    const next = {...form.value.profiles};
    delete next[name];
    form.value.profiles = next;
    if (profileName.value === name) {
        profileName.value = "";
    }
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

function onVibeImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    form.value.vibe.imageId = file.name;
    const reader = new FileReader();
    reader.onload = () => {
        vibePreviewUrl.value = typeof reader.result === "string" ? reader.result : null;
    };
    reader.readAsDataURL(file);
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
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-[13px] font-semibold text-[var(--text-main)]">NovelAI Provider</h3>
                <div class="flex items-center gap-2">
                    <select v-model.number="selectedProviderId" class="h-8 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" @change="selectedProviderId !== null && selectProvider(selectedProviderId)">
                        <option v-for="provider in novelAiProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="newProvider">新建</button>
                    <button class="h-8 rounded-md border border-[var(--danger-border)] px-2 text-[12px] text-[var(--danger-text)] hover:bg-[var(--bg-hover)]" :disabled="selectedProviderId === null" @click="deleteProvider">删除</button>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    名称
                    <input v-model="name" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    站点
                    <input v-model="form.baseUrl" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    API Key（留空表示保留）
                    <input v-model="credential" type="password" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    模型
                    <select v-model="form.model" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                        <option>nai-diffusion-3</option>
                        <option>nai-diffusion-4-full</option>
                        <option>nai-diffusion-4-curated-preview</option>
                        <option>nai-diffusion-4-5-curated</option>
                        <option>nai-diffusion-4-5-full</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    采样器
                    <select v-model="form.sampler" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                        <option>k_euler</option>
                        <option>ddim_v3</option>
                        <option>k_dpmpp_2s_ancestral</option>
                        <option>k_dpmpp_2m</option>
                        <option>k_euler_ancestral</option>
                        <option>k_dpmpp_2m_sde</option>
                        <option>k_dpmpp_sde</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    噪点表
                    <select v-model="form.noiseSchedule" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                        <option>native</option>
                        <option>exponential</option>
                        <option>polyexponential</option>
                        <option>karras</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Prompt Guidance
                    <input v-model.number="form.promptGuidance" type="number" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Guidance Rescale
                    <input v-model.number="form.promptGuidanceRescale" type="number" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    尺寸（宽 x 高）
                    <div class="flex gap-2">
                        <input v-model.number="form.width" type="number" class="h-8 w-1/2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                        <input v-model.number="form.height" type="number" class="h-8 w-1/2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                    </div>
                    <div class="mt-1 flex flex-wrap gap-1">
                        <button v-for="preset in sizePresets" :key="preset.label" type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="applySizePreset(preset.width, preset.height)">
                            {{ preset.label }}
                        </button>
                    </div>
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Steps
                    <input v-model.number="form.steps" type="number" min="1" max="50" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Seed
                    <input v-model.number="form.seed" type="number" min="-1" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-3">
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.aiDefaultCharacterPosition" type="checkbox" class="accent-[var(--accent-main)]" />
                    AI 默认角色位置
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.smea" type="checkbox" class="accent-[var(--accent-main)]" />
                    SMEA
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.smeaDyn" type="checkbox" class="accent-[var(--accent-main)]" />
                    SMEA DYN
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.variety" type="checkbox" class="accent-[var(--accent-main)]" />
                    Variety
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.decrisp" type="checkbox" class="accent-[var(--accent-main)]" />
                    Decrisp
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.furryDataset" type="checkbox" class="accent-[var(--accent-main)]" />
                    福瑞数据集
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.positiveQualityPreset" type="checkbox" class="accent-[var(--accent-main)]" />
                    正面质量预设
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    负面质量预设
                    <select v-model="form.negativeQualityPreset" class="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                        <option value="none">无</option>
                        <option value="Heavy">Heavy</option>
                        <option value="Light">Light</option>
                        <option value="Human Focus">Human Focus</option>
                        <option value="Furry Focus">Furry Focus</option>
                    </select>
                </label>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    固定正面提示词
                    <textarea v-model="form.fixedPositivePrompt" rows="4" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    后置固定正面提示词
                    <textarea v-model="form.fixedPositivePromptEnd" rows="4" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    固定负面提示词
                    <textarea v-model="form.fixedNegativePrompt" rows="4" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
                </label>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
                <select v-model.number="translateLlmProviderId" class="h-8 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                    <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                </select>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="translating || translateLlmProviderId === null" @click="translateFixedPrompts">翻译固定提示词</button>
                <span v-if="translating" class="text-[12px] text-[var(--text-muted)]">翻译中...</span>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <input v-model="tagInput" list="novelai-common-tags" class="h-8 w-56 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" placeholder="输入 Tag" />
                <datalist id="novelai-common-tags">
                    <option v-for="tag in commonTags" :key="tag" :value="tag" />
                </datalist>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="appendTag">追加 Tag</button>
            </div>
            <label class="mt-3 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                提示词替换规则
                <textarea v-model="form.promptReplaceText" rows="3" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
            </label>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" @click="saveProvider">保存 Provider</button>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">配置档案</h3>
            <div class="flex items-center gap-2">
                <input v-model="profileName" class="h-8 w-44 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" placeholder="档案名" />
                <select v-model="profileName" class="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                    <option v-for="name in profileNames" :key="name" :value="name">{{ name }}</option>
                </select>
            </div>
            <div class="mt-2 flex items-center gap-2">
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="!profileName" @click="profileName && applyProfile(profileName)">读取</button>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="saveProfile">另存为</button>
                <button class="h-8 rounded-md border border-[var(--danger-border)] px-3 text-[12px] text-[var(--danger-text)]" :disabled="!profileName" @click="profileName && deleteProfile(profileName)">删除</button>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">固定提示词预设</h3>
            <div class="flex items-center gap-2">
                <select v-model="fixedPromptPresetName" class="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                    <option v-for="presetName in fixedPromptPresetNames" :key="presetName" :value="presetName">{{ presetName }}</option>
                </select>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="fixedPromptPresetName && applyFixedPromptPreset(fixedPromptPresetName)">读取</button>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="saveFixedPromptPreset">另存为</button>
                <button class="h-8 rounded-md border border-[var(--danger-border)] px-3 text-[12px] text-[var(--danger-text)]" :disabled="!fixedPromptPresetName" @click="deleteFixedPromptPreset(fixedPromptPresetName)">删除</button>
            </div>
            <div v-if="fixedPromptPresetNames.length > 0" class="mt-2 flex flex-wrap gap-2">
                <button v-for="presetName in fixedPromptPresetNames" :key="presetName" type="button" class="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="applyFixedPromptPreset(presetName)">
                    {{ presetName }}
                </button>
            </div>
            <p class="mt-2 text-[11px] text-[var(--text-muted)]">正面 token：{{ positiveTokenCount }} · 负面 token：{{ negativeTokenCount }}</p>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">Vibe / 角色参考</h3>
            <div class="mb-3 grid grid-cols-2 gap-3">
                <div>
                    <div class="flex items-center gap-2">
                        <input v-model="vibeGroupName" class="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" placeholder="Vibe 组名" />
                        <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="addVibeGroup">添加</button>
                    </div>
                    <ul class="mt-2 space-y-1">
                        <li v-for="groupName in vibeGroupNames" :key="groupName" class="rounded-md border border-[var(--border-color)] p-2 text-[12px] text-[var(--text-secondary)]">
                            <div class="flex items-center justify-between">
                                <span class="font-medium text-[var(--text-main)]">{{ groupName }}</span>
                                <button class="text-[var(--danger-text)]" @click="deleteVibeGroup(groupName)">删除</button>
                            </div>
                            <div class="mt-1 flex items-center gap-1">
                                <input v-model="vibeGroupEntryDrafts[groupName]" class="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" placeholder="Vibe ID" @keydown.enter="addVibeGroupItem(groupName)" />
                                <button class="h-7 shrink-0 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)]" @click="addVibeGroupItem(groupName)">添加</button>
                            </div>
                            <ul class="mt-1 space-y-1">
                                <li v-for="item in form.vibeGroups[groupName]" :key="item" class="flex items-center justify-between text-[11px]">
                                    <span class="truncate">{{ item }}</span>
                                    <button class="text-[var(--danger-text)]" @click="removeVibeGroupItem(groupName, item)">移除</button>
                                </li>
                            </ul>
                        </li>
                    </ul>
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <input v-model="characterGroupName" class="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" placeholder="角色组名" />
                        <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="addCharacterGroup">添加</button>
                    </div>
                    <ul class="mt-2 space-y-1">
                        <li v-for="groupName in characterGroupNames" :key="groupName" class="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
                            <span>{{ groupName }}</span>
                            <button class="text-[var(--danger-text)]" @click="deleteCharacterGroup(groupName)">删除</button>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                        <input v-model="form.vibe.enabled" type="checkbox" class="accent-[var(--accent-main)]" />
                        启用 Vibe Transfer
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                        信息提取量
                        <input v-model.number="form.vibe.informationExtracted" type="number" min="0" max="1" step="0.01" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                        氛围强度
                        <input v-model.number="form.vibe.referenceStrength" type="number" min="0" max="1" step="0.01" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                        参考图
                        <div class="flex items-center gap-2">
                            <input ref="vibeImageInput" type="file" accept="image/*" class="hidden" @change="onVibeImageSelected" />
                            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)]" @click="openVibeImagePicker">选择图片</button>
                            <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--text-muted)]">{{ form.vibe.imageId ?? "未选择" }}</span>
                        </div>
                    </label>
                    <div v-if="vibePreviewUrl" class="mt-2 flex items-center gap-2">
                        <img :src="vibePreviewUrl" class="h-12 w-12 rounded-md object-cover" alt="Vibe 参考图预览" />
                        <button type="button" class="h-8 rounded-md border border-[var(--danger-border)] px-2 text-[12px] text-[var(--danger-text)]" @click="removeVibeImage">移除</button>
                    </div>
                    <button type="button" class="mt-3 h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="downloadVibeFile">下载 Vibe 文件</button>
                </div>
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                        <input v-model="form.characterReference.enabled" type="checkbox" class="accent-[var(--accent-main)]" />
                        启用角色参考
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                        角色组 ID
                        <input v-model="form.characterReference.groupId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                    </label>
                    <label class="mt-2 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                        参考图库
                        <div class="flex items-center gap-2">
                            <input ref="referenceUploadInput" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="uploadReferenceImage" />
                            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)]" @click="openReferenceUpload">上传</button>
                            <span v-if="referenceLibraryLoading" class="text-[11px] text-[var(--text-muted)]">读取中...</span>
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
                    <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                        <input v-model="form.vibeGroup.enabled" type="checkbox" class="accent-[var(--accent-main)]" />
                        启用 Vibe 组
                    </label>
                    <div class="mt-2 flex items-center gap-3">
                        <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                            <input v-model="form.vibeGroup.random" type="checkbox" class="accent-[var(--accent-main)]" />
                            随机组
                        </label>
                        <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                            <input v-model="form.vibeGroup.normalizeStrength" type="checkbox" class="accent-[var(--accent-main)]" />
                            归一化强度
                        </label>
                    </div>
                </div>
                <div class="rounded-md border border-[var(--border-color)] p-3">
                    <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                        Vibe 组 ID
                        <input v-model="form.vibeGroup.groupId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                    </label>
                </div>
            </div>
        </div>

        <p v-if="error" class="text-[12px] text-[var(--danger-text)]">{{ error }}</p>
    </div>
</template>
