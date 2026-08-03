<script setup lang="ts">
import {ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import TextToImageLlmSettingsSection from "nbook/app/components/novel-ide/text-to-image/TextToImageLlmSettingsSection.vue";
import TextToImageNovelAiSettingsSection from "nbook/app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue";
import {
    TextToImageGlobalConfigSchema,
    type TextToImageGlobalConfig,
    type TextToImageProviderDto,
} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

type WorkbenchSnapshot = {
    config: TextToImageGlobalConfig;
    providers: TextToImageProviderDto[];
};

const activeSection = ref<"llm" | "novelai">("llm");
const snapshot = ref<WorkbenchSnapshot>({
    config: TextToImageGlobalConfigSchema.parse({}),
    providers: [],
});
const loading = ref(false);
const error = ref("");

watch(() => props.modelValue, (open) => {
    if (open) {
        void load();
    }
}, {immediate: true});

async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
        snapshot.value = await $fetch<WorkbenchSnapshot>("/api/text-to-image/workbench/config");
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "加载文生图配置失败");
    } finally {
        loading.value = false;
    }
}

async function saveProvider(input: Record<string, unknown>): Promise<void> {
    error.value = "";
    try {
        if (input.id !== undefined) {
            await $fetch(`/api/text-to-image/providers/${String(input.id)}`, {
                method: "PUT",
                body: input,
            });
        } else {
            await $fetch("/api/text-to-image/providers", {
                method: "POST",
                body: input,
            });
        }
        await load();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存 Provider 失败");
    }
}

async function deleteProvider(id: number): Promise<void> {
    error.value = "";
    try {
        await $fetch(`/api/text-to-image/providers/${String(id)}`, {method: "DELETE"});
        await load();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "删除 Provider 失败");
    }
}

async function saveConfig(patch: Partial<TextToImageGlobalConfig>): Promise<void> {
    error.value = "";
    try {
        snapshot.value = await $fetch<WorkbenchSnapshot>("/api/text-to-image/workbench/config", {
            method: "PUT",
            body: patch,
        });
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存全局配置失败");
    }
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        size="xl"
        title="文生图工作台"
        overlay-type="blur"
        :body-class="'custom-scrollbar flex min-h-0 flex-1 flex-col overflow-hidden p-0'"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div class="flex h-full min-h-0 flex-1">
            <!-- 左侧导航 -->
            <nav class="flex w-36 shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] p-2">
                <button
                    class="mb-1 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[12px]"
                    :class="activeSection === 'llm' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    @click="activeSection = 'llm'"
                >
                    <span class="i-lucide-bot h-4 w-4"></span>
                    LLM
                </button>
                <button
                    class="mb-1 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[12px]"
                    :class="activeSection === 'novelai' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    @click="activeSection = 'novelai'"
                >
                    <span class="i-lucide-image h-4 w-4"></span>
                    NovelAI
                </button>
            </nav>

            <!-- 右侧内容 -->
            <div class="min-w-0 flex-1">
                <TextToImageLlmSettingsSection
                    v-if="activeSection === 'llm'"
                    :providers="snapshot.providers"
                    :config="snapshot.config"
                    @save-provider="saveProvider"
                    @delete-provider="deleteProvider"
                    @save-config="saveConfig"
                />
                <TextToImageNovelAiSettingsSection
                    v-else
                    :providers="snapshot.providers"
                    @save-provider="saveProvider"
                    @delete-provider="deleteProvider"
                />
            </div>
        </div>
        <p v-if="error" class="border-t border-[var(--border-color)] px-4 py-2 text-[12px] text-[var(--danger-text)]">{{ error }}</p>
        <p v-if="loading" class="border-t border-[var(--border-color)] px-4 py-2 text-[12px] text-[var(--text-muted)]">加载中...</p>
    </Dialog>
</template>
