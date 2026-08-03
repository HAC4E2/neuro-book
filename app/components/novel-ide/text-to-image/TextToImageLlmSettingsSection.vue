<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {
    TextToImageLlmProviderSettingsSchema,
    type TextToImageGlobalConfig,
    type TextToImageProviderDto,
} from "nbook/shared/dto/text-to-image.dto";

const props = defineProps<{
    providers: TextToImageProviderDto[];
    config: TextToImageGlobalConfig;
}>();

const emit = defineEmits<{
    (e: "save-provider", input: Record<string, unknown>): void;
    (e: "delete-provider", id: number): void;
    (e: "save-config", patch: Partial<TextToImageGlobalConfig>): void;
}>();

const llmProviders = computed(() => props.providers.filter((provider) => provider.kind === "openai_compatible"));
const selectedProviderId = ref<number | null>(null);
const form = ref({
    name: "",
    baseUrl: "",
    model: "",
    credential: "",
    temperature: 0.7,
    topP: 1,
    maxTokens: 512,
    stream: false,
    sendImages: false,
    mergeSystemUser: false,
    retryCount: 0,
});
const contextProfilesText = ref("{}");
const requestBindingsText = ref("{}");
const wordReplacementText = ref("{}");
const testPrompt = ref("");
const testResult = ref("");
const error = ref("");
const saving = ref(false);

watch(() => props.providers, () => {
    if (selectedProviderId.value === null && llmProviders.value.length > 0) {
        selectProvider(llmProviders.value[0]!.id);
    }
}, {immediate: true});

watch(() => props.config, (config) => {
    contextProfilesText.value = JSON.stringify(config.contextProfiles ?? {}, null, 2);
    requestBindingsText.value = JSON.stringify(config.requestTypeBindings ?? {}, null, 2);
    wordReplacementText.value = JSON.stringify(config.wordReplacementProfiles ?? {}, null, 2);
}, {immediate: true});

function selectProvider(id: number): void {
    selectedProviderId.value = id;
    const provider = props.providers.find((item) => item.id === id);
    const settings = provider ? TextToImageLlmProviderSettingsSchema.parse(provider.settings) : TextToImageLlmProviderSettingsSchema.parse({});
    form.value = {
        name: provider?.name ?? "",
        baseUrl: settings.baseUrl,
        model: settings.model,
        credential: "",
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
        stream: settings.stream,
        sendImages: settings.sendImages,
        mergeSystemUser: settings.mergeSystemUser,
        retryCount: settings.retryCount,
    };
}

function newProvider(): void {
    selectedProviderId.value = null;
    form.value = {
        name: "",
        baseUrl: "",
        model: "",
        credential: "",
        temperature: 0.7,
        topP: 1,
        maxTokens: 512,
        stream: false,
        sendImages: false,
        mergeSystemUser: false,
        retryCount: 0,
    };
}

function saveProvider(): void {
    if (!form.value.name.trim() || !form.value.baseUrl.trim() || !form.value.model.trim()) {
        error.value = "名称、Base URL 和模型不能为空";
        return;
    }
    error.value = "";
    const settings = TextToImageLlmProviderSettingsSchema.parse({
        baseUrl: form.value.baseUrl,
        model: form.value.model,
        temperature: form.value.temperature,
        topP: form.value.topP,
        maxTokens: form.value.maxTokens,
        stream: form.value.stream,
        sendImages: form.value.sendImages,
        mergeSystemUser: form.value.mergeSystemUser,
        retryCount: form.value.retryCount,
    });
    emit("save-provider", {
        id: selectedProviderId.value ?? undefined,
        kind: "openai_compatible",
        name: form.value.name,
        baseUrl: form.value.baseUrl,
        model: form.value.model,
        credential: form.value.credential || undefined,
        settings,
    });
}

function deleteProvider(): void {
    if (selectedProviderId.value !== null) {
        emit("delete-provider", selectedProviderId.value);
        newProvider();
    }
}

function saveConfig(): void {
    try {
        emit("save-config", {
            contextProfiles: JSON.parse(contextProfilesText.value) as TextToImageGlobalConfig["contextProfiles"],
            requestTypeBindings: JSON.parse(requestBindingsText.value) as TextToImageGlobalConfig["requestTypeBindings"],
            wordReplacementProfiles: JSON.parse(wordReplacementText.value) as TextToImageGlobalConfig["wordReplacementProfiles"],
        });
        error.value = "";
    } catch {
        error.value = "全局配置 JSON 不合法";
    }
}

async function runTest(): Promise<void> {
    if (selectedProviderId.value === null || !testPrompt.value.trim()) return;
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{content: string}>("/api/text-to-image/llm/test", {
            method: "POST",
            body: {
                providerId: selectedProviderId.value,
                prompt: testPrompt.value,
                stream: form.value.stream,
            },
        });
        testResult.value = result.content;
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "测试请求失败";
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-[13px] font-semibold text-[var(--text-main)]">LLM Provider</h3>
                <div class="flex items-center gap-2">
                    <select v-model.number="selectedProviderId" class="h-8 max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" @change="selectedProviderId !== null && selectProvider(selectedProviderId)">
                        <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="newProvider">新建</button>
                    <button class="h-8 rounded-md border border-[var(--danger-border)] px-2 text-[12px] text-[var(--danger-text)] hover:bg-[var(--bg-hover)]" :disabled="selectedProviderId === null" @click="deleteProvider">删除</button>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    名称
                    <input v-model="form.name" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Base URL（含 /v1）
                    <input v-model="form.baseUrl" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    模型
                    <input v-model="form.model" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    API Key（留空表示保留）
                    <input v-model="form.credential" type="password" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Temperature
                    <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.01" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Top P
                    <input v-model.number="form.topP" type="number" min="0" max="1" step="0.01" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Max Tokens
                    <input v-model.number="form.maxTokens" type="number" min="1" max="30000" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    重试次数
                    <input v-model.number="form.retryCount" type="number" min="0" max="5" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-3">
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.stream" type="checkbox" class="accent-[var(--accent-main)]" />
                    流式生成
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.sendImages" type="checkbox" class="accent-[var(--accent-main)]" />
                    发送图片
                </label>
                <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input v-model="form.mergeSystemUser" type="checkbox" class="accent-[var(--accent-main)]" />
                    合并 System/User
                </label>
            </div>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" @click="saveProvider">保存 Provider</button>
            </div>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">全局配置</h3>
            <div class="grid grid-cols-3 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    上下文预设 JSON
                    <textarea v-model="contextProfilesText" rows="8" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[12px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    请求类型绑定 JSON
                    <textarea v-model="requestBindingsText" rows="8" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[12px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    敏感词替换 JSON
                    <textarea v-model="wordReplacementText" rows="8" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[12px] text-[var(--text-main)]" />
                </label>
            </div>
            <button class="mt-3 h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" @click="saveConfig">保存全局配置</button>
        </div>

        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">测试工具</h3>
            <textarea v-model="testPrompt" rows="4" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" placeholder="输入测试提示词" />
            <button class="mt-2 h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" :disabled="saving" @click="runTest">发送测试请求</button>
            <textarea v-model="testResult" readonly rows="6" class="mt-2 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" placeholder="AI 回复将显示在这里" />
        </div>

        <p v-if="error" class="text-[12px] text-[var(--danger-text)]">{{ error }}</p>
    </div>
</template>
