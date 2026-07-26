<script setup lang="ts">
/**
 * 文生图设置面板——Recipe、画风串、插图 Director、参考资产。
 * 供 NovelIdeSettingsDialog 内嵌使用，遵守 SettingsSavePanelExpose 契约。
 */
import {computed, onMounted, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import TextToImageReferenceAssetsPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageReferenceAssetsPanel.vue";
import TextToImageTagIndexSection from "nbook/app/components/novel-ide/text-to-image/TextToImageTagIndexSection.vue";
import {
    TEXT_TO_IMAGE_NEGATIVE_QUALITY_PRESETS,
    TEXT_TO_IMAGE_NOVELAI_NOISE_SCHEDULES,
    TEXT_TO_IMAGE_NOVELAI_SAMPLERS,
    TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS,
    useTextToImageStore,
    type NovelAiApiSettings,
    type TextToImageNegativeQualityPreset,
} from "nbook/app/stores/text-to-image";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import type {IllustrationDirectorModelBindingDto} from "nbook/shared/dto/config.dto";
import {NOVELAI_PROVIDER_MODEL_IDS, type NovelAiProviderModelId} from "nbook/shared/text-to-image-provider-registry";

const props = defineProps<{projectPath?: string}>();

const store = useTextToImageStore();
const novelIdeStore = useNovelIdeStore();
const notification = useNotification();
const configApi = useConfigApi();

const {currentNovelId} = storeToRefs(novelIdeStore);

const {
    activeStyle,
    activeStyleId,
    currentProjectPath,
    novelAi,
    novelAiProviderInspection,
    recipeDirty,
    recipeError,
    recipeLoading,
    recipeSaving,
    stylePresets,
} = storeToRefs(store);

// ══ Provider / API（合并进 Recipe 卡片）══
const novelAiProviderName = ref("NovelAI");
const novelAiProviderCredential = ref("");
const novelAiProviderIntervalMs = ref(15_000);
const novelAiProviderSaving = ref(false);
const novelAiProviderTesting = ref(false);
const novelAiProviderError = ref("");

// ══ Director ══
const directorBinding = ref<IllustrationDirectorModelBindingDto | null>(null);
const directorBindingLoading = ref(false);
const directorBindingError = ref("");

const directorHasModel = computed(() => directorBinding.value?.configured === true);
const directorSummary = computed(() => {
    const b = directorBinding.value;
    if (!b || !b.configured) return "未配置";
    return b.providerName + " / " + (b.modelName || b.modelId || "未知");
});

// ══ 选项 ══
const modelLabels: Record<NovelAiProviderModelId, string> = {
    "nai-diffusion-4-5-full": "NAI Diffusion V4.5 Full",
    "nai-diffusion-4-5-curated": "NAI Diffusion V4.5 Curated",
    "nai-diffusion-4-full": "NAI Diffusion V4 Full",
    "nai-diffusion-4-curated-preview": "NAI Diffusion V4 Curated",
    "nai-diffusion-3": "NAI Diffusion V3",
    "nai-diffusion-furry-3": "Furry Diffusion V3",
};
const modelOptions: SelectOption[] = NOVELAI_PROVIDER_MODEL_IDS.map((id) => ({value: id, label: modelLabels[id]}));
const samplerOptions: SelectOption[] = TEXT_TO_IMAGE_NOVELAI_SAMPLERS.map((s) => ({value: s.value, label: s.label}));
const noiseOptions: SelectOption[] = TEXT_TO_IMAGE_NOVELAI_NOISE_SCHEDULES.map((s) => ({value: s.value, label: s.label}));
const sizeOptions: SelectOption[] = TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS.map((p) => ({
    value: p.value,
    label: p.label,
    description: p.value === "custom" ? "手动输入" : p.width + " × " + p.height,
}));
const negQualityOptions: SelectOption[] = TEXT_TO_IMAGE_NEGATIVE_QUALITY_PRESETS.map((p) => ({
    value: p.value,
    label: p.label,
    description: p.description,
}));
const styleOptions = computed<SelectOption[]>(() => stylePresets.value.map((s) => ({value: s.id, label: s.name || s.id})));

// ══ 初始化 ══
watch(currentNovelId, (projectPath) => {
    if (projectPath) {
        store.setCurrentProjectPath(projectPath);
        void store.loadRecipe(projectPath).catch(() => undefined);
    }
}, {immediate: true});
watch(novelAiProviderInspection, (inspection) => {
    if (inspection.state === "configured" && inspection.provider) {
        novelAiProviderName.value = inspection.provider.name;
        novelAiProviderIntervalMs.value = inspection.provider.settings.requestIntervalMs;
    }
}, {immediate: true});

// ══ Recipe 绑定（通过 updateNovelAiSettings）══
function updateNovelAiField(key: keyof NovelAiApiSettings, value: unknown): void {
    store.updateNovelAiSettings({[key]: value});
}
function clamp(min: number, max: number, val: number): number { return Math.max(min, Math.min(max, Math.round(val))); }

/** NovelAI V4 系列只支持 SMEA auto/off，服务端会拒绝手动 SMEA on 与 SMEA Dyn。 */
const isV4Model = computed(() => /^nai-diffusion-4(?:-|$)/u.test(novelAi.value.model));
const recipeModel = computed({
    get: () => novelAi.value.model,
    set: (v) => {
        // 切到 V4 时同步清掉不兼容的 SMEA 配置，避免 Recipe 自动保存被服务端 422 拒绝
        const targetIsV4 = /^nai-diffusion-4(?:-|$)/u.test(String(v));
        store.updateNovelAiSettings({
            model: v,
            ...(targetIsV4 && novelAi.value.smeaDyn ? {smeaDyn: false} : {}),
            ...(targetIsV4 && novelAi.value.smeaMode === "on" ? {smeaMode: "auto" as const} : {}),
        });
    },
});
const recipeSampler = computed({get: () => novelAi.value.sampler, set: (v) => updateNovelAiField("sampler", v)});
const recipeNoise = computed({get: () => novelAi.value.noiseSchedule, set: (v) => updateNovelAiField("noiseSchedule", v)});
const recipeSteps = computed({get: () => String(novelAi.value.steps), set: (v) => updateNovelAiField("steps", clamp(1, 50, Number(v) || 28))});
const recipeGuidance = computed({get: () => String(novelAi.value.promptGuidance), set: (v) => updateNovelAiField("promptGuidance", clamp(0, 20, Number(v) || 5))});
const recipeRescale = computed({get: () => String(novelAi.value.promptGuidanceRescale), set: (v) => updateNovelAiField("promptGuidanceRescale", clamp(0, 1, Number(v) || 0))});
const recipeSizePreset = computed({get: () => novelAi.value.sizePreset, set: (v) => {
    updateNovelAiField("sizePreset", v);
    const preset = TEXT_TO_IMAGE_NOVELAI_SIZE_PRESETS.find((p) => p.value === v);
    if (preset && preset.value !== "custom") {
        store.updateNovelAiSettings({width: preset.width, height: preset.height});
    }
}});
const recipeWidth = computed({get: () => String(novelAi.value.width), set: (v) => updateNovelAiField("width", clamp(64, 4096, Number(v) || 832))});
const recipeHeight = computed({get: () => String(novelAi.value.height), set: (v) => updateNovelAiField("height", clamp(64, 4096, Number(v) || 1216))});

// Seed: store 中 seed 为 number（-1=random，>=0=fixed）；recipe 侧为结构化，但面板只操控 store 的 number
/** 种子策略选择：random / fixed，对接 FormSelect 的 string 发射。 */
function setRecipeSeedPolicy(value: string): void { updateNovelAiField("seed", value === "random" ? -1 : 0); }

const recipeSeedPolicy = computed({
    get: () => (novelAi.value.seed < 0 ? "random" : "fixed") as "random" | "fixed",
    set: (v: string) => updateNovelAiField("seed", v === "random" ? -1 : 0),
});
const recipeFixedSeed = computed({
    get: () => novelAi.value.seed < 0 ? "" : String(novelAi.value.seed),
    set: (v) => {
        const n = Math.max(0, Math.round(Number(v) || 0));
        updateNovelAiField("seed", n);
    },
});

// ══ Provider 保存/测试 ══
const activeNovelAiProviderId = computed(() =>
    novelAiProviderInspection.value.state === "configured"
        && novelAiProviderInspection.value.provider?.hasCredential
        ? novelAiProviderInspection.value.provider.id
        : null,
);

async function saveNovelAiProvider(): Promise<void> {
    if (novelAiProviderSaving.value) return;
    if (activeNovelAiProviderId.value === null && !novelAiProviderCredential.value.trim()) {
        novelAiProviderError.value = "请填写 API token";
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
        novelAiProviderError.value = resolveApiErrorMessage(error, "保存失败");
    } finally {
        novelAiProviderCredential.value = "";
        novelAiProviderSaving.value = false;
    }
}

async function testNovelAiProvider(): Promise<void> {
    if (novelAiProviderTesting.value || activeNovelAiProviderId.value === null) return;
    novelAiProviderTesting.value = true;
    novelAiProviderError.value = "";
    try {
        await $fetch("/api/text-to-image/providers/novelai/test", {method: "POST"});
        notification.success("NovelAI 连接正常");
    } catch (error) {
        novelAiProviderError.value = resolveApiErrorMessage(error, "连接测试失败");
    } finally {
        novelAiProviderTesting.value = false;
    }
}

// ══ Director ══
async function loadIllustrationDirectorBinding(): Promise<void> {
    directorBindingLoading.value = true;
    directorBindingError.value = "";
    try {
        const snapshot = await configApi.editorSnapshot(configApi.globalQuery());
        directorBinding.value = snapshot.modelSettings.illustrationDirector;
    } catch (error) {
        directorBinding.value = null;
        directorBindingError.value = resolveApiErrorMessage(error, "读取插图 Director 绑定失败");
    } finally {
        directorBindingLoading.value = false;
    }
}

onMounted(async () => {
    store.ensureDefaults();
    await loadIllustrationDirectorBinding();
    await store.refreshProviders().catch((error) => {
        notification.error(resolveApiErrorMessage(error, "读取文生图 Provider 失败"));
    });
});

/** 更新当前画风串的负面质量预设。 */
function updateActiveNegQuality(value: string): void {
    store.updateStylePreset(activeStyleId.value, {negativeQualityPreset: value as TextToImageNegativeQualityPreset});
}

// ══ 暴露给设置对话框的契约 ══
const dirty = computed(() => recipeDirty.value);
const loading = computed(() => recipeLoading.value);
const saving = computed(() => recipeSaving.value);
async function saveSettings(): Promise<void> { if (currentProjectPath.value) await store.saveRecipe(currentProjectPath.value); }
async function restoreSettings(): Promise<void> { if (currentProjectPath.value) await store.loadRecipe(currentProjectPath.value); }
defineExpose({dirty, loading, saving, saveSettings, restoreSettings});
</script>

<template>
    <div class="space-y-4">
        <!-- NovelAI Recipe（含 API token） -->
        <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
            <div class="mb-3 flex items-center gap-2">
                <span class="i-lucide-chef-hat h-4 w-4 text-[var(--accent-main)]"></span>
                <h3 class="text-[13px] font-medium text-[var(--text-main)]">NovelAI Recipe</h3>
                <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="activeNovelAiProviderId !== null ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                    {{ activeNovelAiProviderId !== null ? "已配置" : "未配置" }}
                </span>
            </div>

            <!-- API Token 行 -->
            <div class="mb-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[12px]">
                <label class="text-[var(--text-secondary)]">API Token</label>
                <FormInput :model-value="novelAiProviderCredential" type="password" :placeholder="novelAiProviderInspection.provider?.hasCredential ? '留空保留现有 token' : '请输入 API token'" @update:model-value="novelAiProviderCredential = $event" />

                <label class="text-[var(--text-secondary)]">名称</label>
                <FormInput :model-value="novelAiProviderName" @update:model-value="novelAiProviderName = $event" />

                <label class="text-[var(--text-secondary)]">请求间隔 (ms)</label>
                <FormInput :model-value="String(novelAiProviderIntervalMs)" type="number" min="15000" max="3600000" step="1000" @update:model-value="novelAiProviderIntervalMs = Math.max(15000, Math.round(Number($event) || 15000))" />
            </div>

            <p v-if="novelAiProviderError" class="m-0 mb-2 text-[11px] text-[var(--status-danger)]">{{ novelAiProviderError }}</p>
            <div class="flex items-center gap-2">
                <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="novelAiProviderTesting || activeNovelAiProviderId === null" @click="void testNovelAiProvider()">
                    <span class="h-3 w-3" :class="novelAiProviderTesting ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-plug-zap'"></span>
                    测试连接
                </button>
                <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="novelAiProviderSaving || (!novelAiProviderInspection.provider?.hasCredential && !novelAiProviderCredential.trim())" @click="void saveNovelAiProvider()">
                    <span class="h-3 w-3" :class="novelAiProviderSaving ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-save'"></span>
                    保存
                </button>
            </div>

            <!-- Recipe 模型参数 -->
            <div class="mt-4 border-t border-[var(--border-color)] pt-3">
                <div class="mb-1 text-[11px] text-[var(--text-muted)]">模型与采样参数</div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                    <label class="text-[var(--text-secondary)]">模型</label>
                    <FormSelect :model-value="recipeModel" :options="modelOptions" @update:model-value="recipeModel = $event" />

                    <label class="text-[var(--text-secondary)]">采样器</label>
                    <FormSelect :model-value="recipeSampler" :options="samplerOptions" @update:model-value="recipeSampler = $event" />

                    <label class="text-[var(--text-secondary)]">噪声调度</label>
                    <FormSelect :model-value="recipeNoise" :options="noiseOptions" @update:model-value="recipeNoise = $event" />

                    <label class="text-[var(--text-secondary)]">尺寸</label>
                    <FormSelect :model-value="recipeSizePreset" :options="sizeOptions" @update:model-value="recipeSizePreset = $event" />

                    <template v-if="recipeSizePreset === 'custom'">
                        <label class="text-[var(--text-secondary)]">宽度</label>
                        <FormInput :model-value="recipeWidth" type="number" min="64" max="4096" @update:model-value="recipeWidth = $event" />
                        <label class="text-[var(--text-secondary)]">高度</label>
                        <FormInput :model-value="recipeHeight" type="number" min="64" max="4096" @update:model-value="recipeHeight = $event" />
                    </template>

                    <label class="text-[var(--text-secondary)]">步数</label>
                    <FormInput :model-value="recipeSteps" type="number" min="1" max="50" @update:model-value="recipeSteps = $event" />

                    <label class="text-[var(--text-secondary)]">Guidance</label>
                    <FormInput :model-value="recipeGuidance" type="number" min="0" max="20" step="0.5" @update:model-value="recipeGuidance = $event" />

                    <label class="text-[var(--text-secondary)]">Rescale</label>
                    <FormInput :model-value="recipeRescale" type="number" min="0" max="1" step="0.05" @update:model-value="recipeRescale = $event" />
                </div>
            </div>

            <!-- Seed -->
            <div class="mt-3 border-t border-[var(--border-color)] pt-3">
                <div class="mb-1 text-[11px] text-[var(--text-muted)]">种子</div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                    <label class="text-[var(--text-secondary)]">策略</label>
                    <FormSelect :model-value="recipeSeedPolicy" :options="[{value:'random',label:'随机'},{value:'fixed',label:'固定'}]" @update:model-value="setRecipeSeedPolicy($event)" />
                    <template v-if="recipeSeedPolicy === 'fixed'">
                        <label class="text-[var(--text-secondary)]">种子值</label>
                        <FormInput :model-value="recipeFixedSeed" type="number" min="0" max="4294967295" @update:model-value="recipeFixedSeed = $event" />
                    </template>
                </div>
            </div>

            <!-- 高级开关：选中态用 accent 边框/底色整体高亮，避免只靠原生小方框难以辨认 -->
            <div class="mt-3 border-t border-[var(--border-color)] pt-3">
                <div class="mb-1.5 text-[11px] text-[var(--text-muted)]">高级</div>
                <div class="flex flex-wrap gap-2">
                    <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors" :class="novelAi.smeaMode !== 'off' ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'">
                        <input type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent-main)]" :checked="novelAi.smeaMode !== 'off'" @change="updateNovelAiField('smeaMode', novelAi.smeaMode === 'off' ? 'auto' : 'off')">
                        SMEA
                    </label>
                    <label class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors" :class="[isV4Model ? 'cursor-not-allowed opacity-45' : 'cursor-pointer', novelAi.smeaDyn && !isV4Model ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)]', !isV4Model && !novelAi.smeaDyn ? 'hover:bg-[var(--bg-hover)]' : '']" :title="isV4Model ? 'NovelAI V4 系列不支持 SMEA Dyn' : ''">
                        <input type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent-main)]" :checked="novelAi.smeaDyn && !isV4Model" :disabled="isV4Model" @change="updateNovelAiField('smeaDyn', !novelAi.smeaDyn)">
                        SMEA Dyn
                    </label>
                    <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors" :class="novelAi.variety ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'">
                        <input type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent-main)]" :checked="novelAi.variety" @change="updateNovelAiField('variety', !novelAi.variety)">
                        Variety
                    </label>
                    <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors" :class="novelAi.decrisper ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'">
                        <input type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent-main)]" :checked="novelAi.decrisper" @change="updateNovelAiField('decrisper', !novelAi.decrisper)">
                        Decrisper
                    </label>
                    <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors" :class="novelAi.aiDefaultCharacterPosition ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'">
                        <input type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent-main)]" :checked="novelAi.aiDefaultCharacterPosition" @change="updateNovelAiField('aiDefaultCharacterPosition', !novelAi.aiDefaultCharacterPosition)">
                        AI 默认角色位置
                    </label>
                </div>
                <p v-if="isV4Model" class="m-0 mt-1.5 text-[10px] text-[var(--text-muted)]">当前为 NovelAI V4 系列模型，仅支持 SMEA 自动/关闭，SMEA Dyn 不可用。</p>
            </div>
        </section>

        <!-- 画风串 -->
        <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
            <div class="mb-3 flex items-center gap-2">
                <span class="i-lucide-palette h-4 w-4 text-[var(--accent-main)]"></span>
                <h3 class="text-[13px] font-medium text-[var(--text-main)]">画风串</h3>
            </div>

            <!-- 画风串选择器 + 操作按钮 -->
            <div class="mb-3 flex items-center gap-2">
                <FormSelect :model-value="activeStyleId" :options="styleOptions" class="flex-1" @update:model-value="store.activateStylePreset($event)" />
                <button type="button" title="新建" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="store.addStylePreset()">
                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                </button>
                <button type="button" title="复制" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="store.duplicateStylePreset(activeStyleId)">
                    <span class="i-lucide-copy h-3.5 w-3.5"></span>
                </button>
                <button type="button" title="删除" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--status-danger-border)] text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] disabled:opacity-40" :disabled="stylePresets.length <= 1" @click="store.deleteStylePreset(activeStyleId)">
                    <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                </button>
            </div>

            <!-- 画风串内容：仅当有选中画风串时显示 -->
            <template v-if="activeStyle">
                <div class="mb-2">
                    <label class="mb-1 block text-[11px] text-[var(--text-secondary)]">名称</label>
                    <FormInput :model-value="activeStyle.name" @update:model-value="store.updateStylePreset(activeStyle.id, {name: $event})" />
                </div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                    <div>
                        <label class="mb-1 block text-[11px] text-[var(--text-secondary)]">正面前缀</label>
                        <FormInput :model-value="activeStyle.positivePrefix" @update:model-value="store.updateStylePreset(activeStyle.id, {positivePrefix: $event})" />
                    </div>
                    <div>
                        <label class="mb-1 block text-[11px] text-[var(--text-secondary)]">正面后缀</label>
                        <FormInput :model-value="activeStyle.positiveSuffix" @update:model-value="store.updateStylePreset(activeStyle.id, {positiveSuffix: $event})" />
                    </div>
                    <div>
                        <label class="mb-1 block text-[11px] text-[var(--text-secondary)]">负面前缀</label>
                        <FormInput :model-value="activeStyle.negativePrefix" @update:model-value="store.updateStylePreset(activeStyle.id, {negativePrefix: $event})" />
                    </div>
                    <div>
                        <label class="mb-1 block text-[11px] text-[var(--text-secondary)]">负面后缀</label>
                        <FormInput :model-value="activeStyle.negativeSuffix" @update:model-value="store.updateStylePreset(activeStyle.id, {negativeSuffix: $event})" />
                    </div>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-3">
                    <label class="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                        <input type="checkbox" class="h-3 w-3" :checked="activeStyle.positiveQualityPreset" @change="store.updateStylePreset(activeStyle.id, {positiveQualityPreset: !activeStyle.positiveQualityPreset})">
                        正面质量预设
                    </label>
                    <label class="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                        <input type="checkbox" class="h-3 w-3" :checked="activeStyle.useFurryDataset" @change="store.updateStylePreset(activeStyle.id, {useFurryDataset: !activeStyle.useFurryDataset})">
                        Furry 数据集
                    </label>
                    <div class="flex items-center gap-1.5">
                        <label class="text-[11px] text-[var(--text-secondary)]">负面质量</label>
                        <FormSelect :model-value="activeStyle.negativeQualityPreset" :options="negQualityOptions" class="w-32" @update:model-value="updateActiveNegQuality($event)" />
                    </div>
                </div>
            </template>
        </section>

        <!-- 插图 Director -->
        <section class="rounded-2xl border border-[var(--border-accent)] bg-[var(--accent-bg)] px-5 py-4 shadow-sm">
            <div class="mb-3 flex items-center gap-2">
                <span class="i-lucide-clapperboard h-4 w-4 text-[var(--accent-main)]"></span>
                <h3 class="text-[13px] font-medium text-[var(--text-main)]">插图 Director</h3>
                <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium" :class="directorHasModel ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                    {{ directorBindingLoading ? "读取中" : directorHasModel ? "已配置" : "未配置" }}
                </span>
            </div>
            <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2.5">
                <div class="text-[11px] text-[var(--text-secondary)]">Agent Runtime provider / model binding</div>
                <div class="mt-0.5 text-[12px] font-medium text-[var(--text-main)]">{{ directorSummary }}</div>
            </div>
            <p v-if="directorBindingError" class="m-0 mt-2 text-[11px] text-[var(--status-danger)]">{{ directorBindingError }}</p>
            <div class="mt-2 flex items-center justify-end gap-2">
                <button v-if="directorBindingError" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" :disabled="directorBindingLoading" @click="void loadIllustrationDirectorBinding()">
                    <span class="i-lucide-refresh-cw h-3 w-3"></span>
                    重试
                </button>
            </div>
        </section>

        <!-- Tag 词库 -->
        <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
            <div class="mb-3 flex items-center gap-2">
                <span class="i-lucide-book-marked h-4 w-4 text-[var(--accent-main)]"></span>
                <h3 class="text-[13px] font-medium text-[var(--text-main)]">Tag 词库</h3>
            </div>
            <TextToImageTagIndexSection />
        </section>

        <!-- 参考资产 -->
        <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
            <div class="mb-3 flex items-center gap-2">
                <span class="i-lucide-images h-4 w-4 text-[var(--accent-main)]"></span>
                <h3 class="text-[13px] font-medium text-[var(--text-main)]">参考资产</h3>
            </div>
            <TextToImageReferenceAssetsPanel :project-path="currentProjectPath" />
        </section>
    </div>
</template>
