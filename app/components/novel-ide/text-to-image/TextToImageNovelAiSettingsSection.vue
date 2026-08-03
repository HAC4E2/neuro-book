<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {
    TextToImageNovelAiSettingsSchema,
    type TextToImageProviderDto,
} from "nbook/shared/dto/text-to-image.dto";

const props = defineProps<{
    providers: TextToImageProviderDto[];
}>();

const emit = defineEmits<{
    (e: "save-provider", input: Record<string, unknown>): void;
    (e: "delete-provider", id: number): void;
}>();

const novelAiProviders = computed(() => props.providers.filter((provider) => provider.kind === "novelai"));
const selectedProviderId = ref<number | null>(null);
const form = ref(TextToImageNovelAiSettingsSchema.parse({}));
const name = ref("");
const credential = ref("");
const error = ref("");

watch(() => props.providers, () => {
    if (selectedProviderId.value === null && novelAiProviders.value.length > 0) {
        selectProvider(novelAiProviders.value[0]!.id);
    }
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
            <label class="mt-3 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                提示词替换规则
                <textarea v-model="form.promptReplaceText" rows="3" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
            </label>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" @click="saveProvider">保存 Provider</button>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">Vibe / 角色参考</h3>
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
