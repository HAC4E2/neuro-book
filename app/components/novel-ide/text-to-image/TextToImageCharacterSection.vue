<script setup lang="ts">
import {computed, ref} from "vue";
import type {TextToImageProviderDto} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const props = defineProps<{
    providers: TextToImageProviderDto[];
}>();

type CharacterVisual = {
    schema: "nbook.character-visual/v1";
    characterId: string;
    character: Record<string, string>;
    outfits: Array<Record<string, string>>;
    photos: string[];
};

const defaultCharacterFields = {
    cnName: "",
    enName: "",
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
    negativePrompt: "",
};

type CharacterFieldKey = keyof typeof defaultCharacterFields;

const characterFieldLabels: Record<CharacterFieldKey, string> = {
    cnName: "中文名",
    enName: "英文名",
    profileTraits: "角色特征",
    facialAppearance: "五官正面",
    facialBack: "五官背面",
    upperSfw: "上半身 SFW",
    upperBackSfw: "上半身 SFW 背面",
    lowerSfw: "下半身 SFW",
    lowerBackSfw: "下半身 SFW 背面",
    upperNsfw: "上半身 NSFW",
    upperBackNsfw: "上半身 NSFW 背面",
    lowerNsfw: "下半身 NSFW",
    lowerBackNsfw: "下半身 NSFW 背面",
    negativePrompt: "负面",
};

const llmProviders = computed(() => props.providers.filter((provider) => provider.kind === "openai_compatible"));
const novelAiProviders = computed(() => props.providers.filter((provider) => provider.kind === "novelai"));
const characterFields = computed(() => (
    Object.keys(defaultCharacterFields) as CharacterFieldKey[]
).map((key) => ({
    key,
    label: characterFieldLabels[key],
})));

const projectRoot = ref("demo");
const characterId = ref("char-1");
const characterPage = ref("");
const llmProviderId = ref<number | null>(null);
const novelAiProviderId = ref<number | null>(null);
const userRequirement = ref("");
const character = ref({...defaultCharacterFields});
const outfitsText = ref("[]");
const photos = ref<string[]>([]);
const photoPrompt = ref("");
const error = ref("");
const loading = ref(false);

async function loadVisual(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
        const result = await $fetch<{visual: CharacterVisual | null}>("/api/text-to-image/character-visual", {
            query: {projectRoot: projectRoot.value, characterId: characterId.value},
        });
        if (result.visual) {
            character.value = {...defaultCharacterFields, ...result.visual.character};
            outfitsText.value = JSON.stringify(result.visual.outfits, null, 2);
            photos.value = result.visual.photos ?? [];
        } else {
            character.value = {...defaultCharacterFields};
            outfitsText.value = "[]";
            photos.value = [];
            photoPrompt.value = "";
        }
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "读取角色视觉失败");
    } finally {
        loading.value = false;
    }
}

async function saveVisual(): Promise<void> {
    error.value = "";
    try {
        const visual = buildVisual();
        await $fetch("/api/text-to-image/character-visual", {
            method: "PUT",
            body: {
                projectRoot: projectRoot.value,
                characterId: characterId.value,
                visual,
            },
        });
        await loadVisual();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存角色视觉失败");
    }
}

async function generateVisual(): Promise<void> {
    if (llmProviderId.value === null) {
        error.value = "请先选择 LLM Provider";
        return;
    }
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-visual.generate", {
            method: "POST",
            body: {
                providerId: llmProviderId.value,
                projectRoot: projectRoot.value,
                characterId: characterId.value,
                characterPage: characterPage.value,
                mode: "fill_empty",
            },
        });
        await loadVisual();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成角色视觉失败");
    }
}

async function generatePhotoPrompt(): Promise<void> {
    if (llmProviderId.value === null) return;
    error.value = "";
    try {
        const result = await $fetch<{prompt: string}>("/api/text-to-image/character-photo.generate-prompt", {
            method: "POST",
            body: {
                providerId: llmProviderId.value,
                characterText: JSON.stringify(character.value),
                outfitText: outfitsText.value,
                userRequirement: userRequirement.value,
            },
        });
        photoPrompt.value = result.prompt;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成照片 prompt 失败");
    }
}

async function generateAvatar(): Promise<void> {
    if (llmProviderId.value === null || novelAiProviderId.value === null) return;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-photo.generate", {
            method: "POST",
            body: {
                llmProviderId: llmProviderId.value,
                novelAiProviderId: novelAiProviderId.value,
                projectRoot: projectRoot.value,
                characterId: characterId.value,
                characterText: JSON.stringify(character.value),
                outfitText: outfitsText.value,
                userRequirement: userRequirement.value,
            },
        });
        await loadVisual();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成头像失败");
    }
}

function buildVisual(): CharacterVisual {
    const parsed = character.value;
    const outfits = JSON.parse(outfitsText.value) as Array<Record<string, string>>;
    return {
        schema: "nbook.character-visual/v1",
        characterId: characterId.value,
        character: parsed,
        outfits,
        photos: photos.value,
    };
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">角色视觉</h3>
            <div class="grid grid-cols-3 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Project Root
                    <input v-model="projectRoot" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Character ID
                    <input v-model="characterId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    LLM Provider
                    <select v-model.number="llmProviderId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                        <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                </label>
            </div>
            <label class="mt-3 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                角色页 Markdown
                <textarea v-model="characterPage" rows="5" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
            </label>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" @click="loadVisual">读取</button>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="llmProviderId === null" @click="generateVisual">生成角色视觉</button>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="saveVisual">保存</button>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">12 字段</h3>
            <div class="grid grid-cols-3 gap-3">
                <label v-for="field in characterFields" :key="field.key" class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    {{ field.label }}
                    <input v-model="character[field.key]" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
            </div>
            <label class="mt-3 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                服装 JSON
                <textarea v-model="outfitsText" rows="4" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[12px] text-[var(--text-main)]" />
            </label>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">角色照片</h3>
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    NovelAI Provider
                    <select v-model.number="novelAiProviderId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                        <option v-for="provider in novelAiProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    用户需求
                    <input v-model="userRequirement" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
            </div>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="llmProviderId === null" @click="generatePhotoPrompt">生成照片 prompt</button>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="llmProviderId === null || novelAiProviderId === null" @click="generateAvatar">生成头像</button>
            </div>
            <textarea v-model="photoPrompt" readonly rows="3" class="mt-3 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
            <ul v-if="photos.length > 0" class="mt-3 space-y-1">
                <li v-for="photo in photos" :key="photo" class="truncate text-[12px] text-[var(--text-secondary)]">{{ photo }}</li>
            </ul>
        </div>

        <p v-if="error" class="text-[12px] text-[var(--danger-text)]">{{ error }}</p>
    </div>
</template>
