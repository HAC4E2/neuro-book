<script setup lang="ts">
import {computed, ref} from "vue";
import type {TextToImageProviderDto} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const props = defineProps<{
    providers: TextToImageProviderDto[];
}>();

type BodyBlock = {
    regex: string;
    title: string;
    tagThink: string;
    size: string;
    prompts: string;
};

type BodyPromptResult = {
    blocks: BodyBlock[];
    content: string;
    placeholders: Array<{
        id: string;
        prompt: string;
        anchor: string;
        title: string;
        size: string;
        tagThink: string;
    }>;
};

const llmProviders = computed(() => props.providers.filter((provider) => provider.kind === "openai_compatible"));
const novelAiProviders = computed(() => props.providers.filter((provider) => provider.kind === "novelai"));

const llmProviderId = ref<number | null>(null);
const novelAiProviderId = ref<number | null>(null);
const projectPath = ref("workspace/demo");
const chapterPath = ref("manuscript/chapter-1.md");
const chapterContent = ref("");
const characterSummary = ref("");
const result = ref<BodyPromptResult | null>(null);
const jobs = ref<Array<{id: string}>>([]);
const error = ref("");
const loading = ref(false);

async function generate(): Promise<void> {
    if (llmProviderId.value === null) {
        error.value = "请先选择 LLM Provider";
        return;
    }
    loading.value = true;
    error.value = "";
    try {
        result.value = await $fetch<BodyPromptResult>("/api/text-to-image/body-prompts", {
            method: "POST",
            body: {
                providerId: llmProviderId.value,
                chapterContent: chapterContent.value,
                characterSummary: characterSummary.value,
            },
        });
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成正文插图失败");
    } finally {
        loading.value = false;
    }
}

async function writeChapter(): Promise<void> {
    if (!result.value) return;
    error.value = "";
    try {
        await $fetch("/api/workspace-files/write", {
            method: "PUT",
            body: {
                projectRoot: projectPath.value.replace(/^workspace\//u, ""),
                path: chapterPath.value,
                content: result.value.content,
                force: true,
            },
        });
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "写入章节失败");
    }
}

async function enqueue(): Promise<void> {
    if (!result.value || novelAiProviderId.value === null) return;
    error.value = "";
    jobs.value = [];
    try {
        for (const placeholder of result.value.placeholders) {
            const job = await $fetch<{id: string}>("/api/text-to-image/jobs", {
                method: "POST",
                body: {
                    projectPath: projectPath.value,
                    providerId: novelAiProviderId.value,
                    kind: "body",
                    requestJson: JSON.stringify({
                        prompt: placeholder.prompt,
                        negativePrompt: "",
                        novelAi: {},
                    }),
                    sourcePath: chapterPath.value,
                    sourceAnchorId: placeholder.anchor,
                },
            });
            jobs.value.push(job);
        }
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "入队失败");
    }
}

async function processQueue(): Promise<void> {
    error.value = "";
    try {
        const result = await $fetch<{processed: number}>("/api/text-to-image/queue/process", {
            method: "POST",
            body: {projectPath: projectPath.value},
        });
        jobs.value = [];
        error.value = `已处理 ${result.processed} 个任务`;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "处理队列失败");
    }
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">正文生图会话</h3>
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    LLM Provider
                    <select v-model.number="llmProviderId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                        <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    NovelAI Provider
                    <select v-model.number="novelAiProviderId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]">
                        <option v-for="provider in novelAiProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    Project Path
                    <input v-model="projectPath" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                    章节路径
                    <input v-model="chapterPath" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" />
                </label>
            </div>
            <label class="mt-3 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                章节正文
                <textarea v-model="chapterContent" rows="8" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
            </label>
            <label class="mt-3 flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
                角色摘要（visual.json 内容）
                <textarea v-model="characterSummary" rows="4" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
            </label>
            <div class="mt-3 flex items-center gap-2">
                <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" :disabled="loading" @click="generate">生成 L1 块</button>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="!result" @click="writeChapter">写入章节</button>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="!result || novelAiProviderId === null" @click="enqueue">入队</button>
                <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="processQueue">处理队列</button>
            </div>
        </div>

        <div v-if="result" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <h3 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">L1 块预览</h3>
            <div class="space-y-2">
                <div v-for="(block, index) in result.blocks" :key="index" class="rounded-md border border-[var(--border-color)] p-2">
                    <p class="text-[12px] text-[var(--text-secondary)]">锚点：{{ block.regex }}</p>
                    <p class="text-[12px] text-[var(--text-secondary)]">标题：{{ block.title }}</p>
                    <p class="text-[12px] text-[var(--text-secondary)]">Prompt：{{ block.prompts }}</p>
                </div>
            </div>
            <h3 class="mb-2 mt-3 text-[13px] font-semibold text-[var(--text-main)]">写入后的正文预览</h3>
            <pre class="max-h-64 overflow-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[12px] text-[var(--text-main)]">{{ result.content }}</pre>
            <p v-if="jobs.length > 0" class="mt-2 text-[12px] text-[var(--text-success)]">已入队 {{ jobs.length }} 个任务</p>
        </div>

        <p v-if="error" class="text-[12px] text-[var(--danger-text)]">{{ error }}</p>
    </div>
</template>
