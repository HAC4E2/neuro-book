<script setup lang="ts">
import {ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import TextToImageLlmSettingsSection from "nbook/app/components/novel-ide/text-to-image/TextToImageLlmSettingsSection.vue";
import TextToImageNovelAiSettingsSection from "nbook/app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue";
import TextToImageCharacterSection from "nbook/app/components/novel-ide/text-to-image/TextToImageCharacterSection.vue";
import TextToImageHistorySection from "nbook/app/components/novel-ide/text-to-image/TextToImageHistorySection.vue";
import TextToImageSendDataSection from "nbook/app/components/novel-ide/text-to-image/TextToImageSendDataSection.vue";
import type {CharacterGenerationContext} from "nbook/app/components/novel-ide/text-to-image/character-context";
import {
    TextToImageGlobalConfigSchema,
    type TextToImageGlobalConfig,
    type TextToImageProviderDto,
} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const props = defineProps<{
    modelValue: boolean;
    projectRoot: string;
    initialSection?: "llm" | "novelai" | "character" | "send-data" | "history";
    initialCharacter?: CharacterGenerationContext | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

type SectionGuard = {
    guard: (message: string) => Promise<boolean>;
};

const characterSection = ref<SectionGuard | null>(null);
const sendDataSection = ref<SectionGuard | null>(null);

type WorkbenchSnapshot = {
    config: TextToImageGlobalConfig;
    providers: TextToImageProviderDto[];
};

const activeSection = ref<"llm" | "novelai" | "character" | "send-data" | "history">("llm");
const snapshot = ref<WorkbenchSnapshot>({
    config: TextToImageGlobalConfigSchema.parse({}),
    providers: [],
});
const loading = ref(false);
const error = ref("");
/** 实际传给子页面的 Project 根：父级 prop 先变时先询问当前分区，确认后才提交给子组件。 */
const boundProjectRoot = ref(props.projectRoot);

watch(() => props.modelValue, (open) => {
    if (open) {
        boundProjectRoot.value = props.projectRoot;
        activeSection.value = props.initialSection ?? "llm";
        void load();
    }
}, {immediate: true});

watch(() => props.projectRoot, async (next, previous) => {
    if (!previous || next === previous || next === boundProjectRoot.value) return;
    if (!props.modelValue) {
        boundProjectRoot.value = next;
        return;
    }
    if (await guardActiveSection()) {
        boundProjectRoot.value = next;
        return;
    }
    error.value = "Project 切换已取消，工作台不会把旧页面写入新 Project";
    emit("update:modelValue", false);
});

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

/** 页面切换与工作台关闭复用各分区的“保存、放弃、取消”保护。 */
async function guardActiveSection(): Promise<boolean> {
    const guard = activeSection.value === "character"
        ? characterSection.value
        : activeSection.value === "send-data"
            ? sendDataSection.value
            : null;
    if (!guard) return true;
    return guard.guard("离开前请先处理未保存修改");
}

async function switchSection(section: typeof activeSection.value): Promise<void> {
    if (section === activeSection.value) return;
    if (await guardActiveSection()) activeSection.value = section;
}

async function handleRequestClose(): Promise<void> {
    if (await guardActiveSection()) emit("update:modelValue", false);
}

async function saveConfig(patch: Partial<TextToImageGlobalConfig>): Promise<void> {
    error.value = "";
    try {
        snapshot.value = await $fetch<WorkbenchSnapshot>("/api/text-to-image/workbench/config", {
            method: "PUT",
            body: {
                patch,
                expectedTextToImageJson: JSON.stringify(snapshot.value.config),
            },
        });
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存全局配置失败");
    }
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        width="min(86vw, 1440px)"
        height="min(82vh, 1080px)"
        max-height="calc(100vh - 20px)"
        title="文生图工作台"
        overlay-type="opaque"
        :body-class="'custom-scrollbar flex min-h-0 flex-1 flex-col overflow-hidden p-0'"
        @update:model-value="emit('update:modelValue', $event)"
        @request-close="handleRequestClose"
    >
        <div class="flex h-full min-h-0 flex-1">
            <!-- 左侧导航 -->
            <nav class="flex w-36 shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] p-2">
                <button
                    class="mb-1 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[15px]"
                    :class="activeSection === 'llm' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    @click="switchSection('llm')"
                >
                    <span class="i-lucide-bot h-4 w-4"></span>
                    LLM
                </button>
                <button
                    class="mb-1 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[15px]"
                    :class="activeSection === 'novelai' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    @click="switchSection('novelai')"
                >
                    <span class="i-lucide-image h-4 w-4"></span>
                    NovelAI
                </button>
                <button
                    class="mb-1 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[15px]"
                    :class="activeSection === 'character' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    @click="switchSection('character')"
                >
                    <span class="i-lucide-users-round h-4 w-4"></span>
                    角色管理
                </button>
                <button
                    class="mb-1 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[15px]"
                    :class="activeSection === 'history' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    @click="switchSection('history')"
                >
                    <span class="i-lucide-images h-4 w-4"></span>
                    历史图片
                </button>
                <button
                    class="mb-1 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[15px]"
                    :class="activeSection === 'send-data' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    @click="switchSection('send-data')"
                >
                    <span class="i-lucide-send h-4 w-4"></span>
                    发送数据
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
                    v-else-if="activeSection === 'novelai'"
                    :providers="snapshot.providers"
                    @save-provider="saveProvider"
                    @refresh-providers="load"
                />
                <TextToImageCharacterSection
                    v-else-if="activeSection === 'character'"
                    ref="characterSection"
                    :project-root="boundProjectRoot"
                    :initial-character="props.initialCharacter"
                />
                <TextToImageSendDataSection
                    v-else-if="activeSection === 'send-data'"
                    ref="sendDataSection"
                    :project-root="boundProjectRoot"
                />
                <TextToImageHistorySection v-else :project-root="boundProjectRoot" />
            </div>
        </div>
        <p v-if="error" class="border-t border-[var(--border-color)] px-4 py-2 text-[13px] text-[var(--danger-text)]">{{ error }}</p>
        <p v-if="loading" class="border-t border-[var(--border-color)] px-4 py-2 text-[13px] text-[var(--text-muted)]">加载中...</p>
    </Dialog>
</template>
