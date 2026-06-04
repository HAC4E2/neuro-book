<script setup lang="ts">
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {
    useTextToImageStore,
    type TextToImageCharacter,
    type TextToImageCharacterTagKey,
    type TextToImageGenerationResult,
} from "nbook/app/stores/text-to-image";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

type CharacterPromptDialogMode = "photoPrompt" | "revision";

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

type ChatCompletionContentPart = {
    type: "text";
    text: string;
} | {
    type: "image_url";
    image_url: {
        url: string;
    };
};

type ChatCompletionMessage = {
    role: "system" | "user";
    content: string | ChatCompletionContentPart[];
};

type TextToImageGenerateResponse = {
    images: TextToImageGenerationResult[];
    request: {
        model: string;
        requestedModel: string;
        action: "generate";
        prompt: string;
        negativePrompt: string;
        seed: number;
        width: number;
        height: number;
        steps: number;
        sampler: string;
        savedDirectory: string;
        parameters: Record<string, unknown>;
    };
    warnings: string[];
};

type CharacterPromptReferenceImage = {
    id: string;
    name: string;
    dataUrl: string;
};

const props = defineProps<{
    projectPath: string;
    characterId: string;
}>();

const textToImageStore = useTextToImageStore();
const novelIdeStore = useNovelIdeStore();
const notification = useNotification();
const {
    activeStyle,
    characterGroups,
    generationDraft,
    llm,
    novelAi,
    output,
    taskPrompts,
} = storeToRefs(textToImageStore);

const characterPhotoInputRef = ref<HTMLInputElement | null>(null);
const characterPromptReferenceInputRef = ref<HTMLInputElement | null>(null);
const generatingCharacterImage = ref(false);
const generationWarnings = ref<string[]>([]);
const lastGenerationRequest = ref<TextToImageGenerateResponse["request"] | null>(null);
const characterPromptDialogOpen = ref(false);
const characterPromptDialogMode = ref<CharacterPromptDialogMode>("photoPrompt");
const characterPromptRequirement = ref("");
const characterPromptReferences = ref<CharacterPromptReferenceImage[]>([]);
const characterPromptBusy = ref(false);
const characterPromptError = ref("");

const characterTextFields: Array<{key: TextToImageCharacterTagKey; label: string; rows: number; placeholder: string}> = [
    {key: "profileTraits", label: "角色特征（描述性格和年龄）", rows: 3, placeholder: "例如：calm, clever, 18 years old"},
    {key: "facialAppearance", label: "五官外貌", rows: 3, placeholder: "正面五官、发色、瞳色、表情等"},
    {key: "facialBack", label: "五官外貌背面", rows: 2, placeholder: "背面视角可见的头发、轮廓等"},
    {key: "upperSfw", label: "上半身SFW", rows: 3, placeholder: "上半身服装、姿态、配饰"},
    {key: "upperBackSfw", label: "上半身背面SFW", rows: 3, placeholder: "背面上半身服装、发型、肩背细节"},
    {key: "lowerSfw", label: "下半身SFW", rows: 3, placeholder: "裙装、裤装、腿部、鞋袜等"},
    {key: "lowerBackSfw", label: "下半身背面SFW", rows: 3, placeholder: "背面下半身服装、鞋袜等"},
    {key: "upperNsfw", label: "上半身NSFW", rows: 3, placeholder: "上半身 NSFW tag"},
    {key: "upperBackNsfw", label: "上半身NSFW背面", rows: 3, placeholder: "背面上半身 NSFW tag"},
    {key: "lowerNsfw", label: "下半身NSFW", rows: 3, placeholder: "下半身 NSFW tag"},
    {key: "lowerBackNsfw", label: "下半身NSFW背面", rows: 3, placeholder: "背面下半身 NSFW tag"},
];

const characterDraftFields: Array<{label: string; apply: (draft: Partial<TextToImageCharacter>, value: string) => void}> = [
    {label: "角色中文名称", apply: (draft, value) => { draft.cnName = value; }},
    {label: "角色英文名称", apply: (draft, value) => { draft.enName = value; }},
    {label: "角色特征", apply: (draft, value) => { draft.profileTraits = value; }},
    {label: "五官外貌", apply: (draft, value) => { draft.facialAppearance = value; }},
    {label: "五官外貌背面", apply: (draft, value) => { draft.facialBack = value; }},
    {label: "上半身SFW", apply: (draft, value) => { draft.upperSfw = value; }},
    {label: "上半身背面SFW", apply: (draft, value) => { draft.upperBackSfw = value; }},
    {label: "下半身SFW", apply: (draft, value) => { draft.lowerSfw = value; }},
    {label: "下半身背面SFW", apply: (draft, value) => { draft.lowerBackSfw = value; }},
    {label: "上半身NSFW", apply: (draft, value) => { draft.upperNsfw = value; }},
    {label: "上半身NSFW背面", apply: (draft, value) => { draft.upperBackNsfw = value; }},
    {label: "下半身NSFW", apply: (draft, value) => { draft.lowerNsfw = value; }},
    {label: "下半身NSFW背面", apply: (draft, value) => { draft.lowerBackNsfw = value; }},
];

const character = computed(() => {
    const group = characterGroups.value[props.projectPath];
    return group?.characters.find((item) => item.id === props.characterId) ?? null;
});

const characterDisplayName = computed(() => character.value ? formatCharacterName(character.value) : "角色不存在");
const characterPromptDialogTitle = computed(() => characterPromptDialogMode.value === "photoPrompt" ? "生成图片提示词" : "修改角色提示词");
const characterPromptDialogDescription = computed(() => characterPromptDialogMode.value === "photoPrompt"
    ? "输入这张角色照片的具体需求，也可以添加参考图片。"
    : "输入你想修改角色 tag 的方向，LLM 会重写下方详细参数。");

watch(characterDisplayName, (title) => {
    if (character.value) {
        novelIdeStore.updateTextToImageCharacterTabTitle(props.projectPath, props.characterId, title);
    }
}, {immediate: true});

watch(() => props.characterId, () => {
    textToImageStore.selectCharacter(props.characterId, props.projectPath);
}, {immediate: true});

function formatCharacterName(item: TextToImageCharacter): string {
    return item.cnName.trim() || item.enName.trim() || "未命名角色";
}

function updateCharacter(patch: Partial<TextToImageCharacter>): void {
    textToImageStore.updateCharacter(props.characterId, patch, props.projectPath);
}

function updateCharacterTagField(key: TextToImageCharacterTagKey, value: string): void {
    updateCharacter({[key]: value} as Partial<TextToImageCharacter>);
}

async function generateCharacterImage(): Promise<void> {
    const currentCharacter = character.value;
    if (!currentCharacter || generatingCharacterImage.value) {
        return;
    }
    const prompt = currentCharacter.photoPrompt.trim();
    if (!novelAi.value.token.trim()) {
        notification.error("请先配置 NovelAI Persistent Token");
        return;
    }
    if (!prompt) {
        notification.error("请先填写或生成角色照片提示词");
        return;
    }

    generatingCharacterImage.value = true;
    try {
        const result = await $fetch<TextToImageGenerateResponse>("/api/text-to-image/generate", {
            method: "POST",
            body: {
                novelAi: novelAi.value,
                style: activeStyle.value,
                character: currentCharacter,
                prompt,
                negativePrompt: generationDraft.value.negativePrompt,
                output: output.value,
            },
        });
        textToImageStore.prependGenerationResults(result.images);
        generationWarnings.value = result.warnings;
        lastGenerationRequest.value = result.request;
        const portrait = result.images[0]?.dataUrl ?? "";
        if (portrait) {
            updateCharacter({portraitDataUrl: portrait});
        }
        notification.success(`角色照片已生成并保存：${result.images[0]?.fileName ?? "图片"}`);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "角色照片生成失败"));
    } finally {
        generatingCharacterImage.value = false;
    }
}

function openCharacterPhotoDialog(): void {
    characterPhotoInputRef.value?.click();
}

async function importCharacterPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file || !character.value) {
        return;
    }
    updateCharacter({portraitDataUrl: await readFileAsDataUrl(file)});
}

function toggleCharacterSendPhoto(): void {
    if (!character.value) {
        return;
    }
    updateCharacter({sendPhoto: !character.value.sendPhoto});
}

function openCharacterPhotoPromptDialog(): void {
    openCharacterPromptDialog("photoPrompt");
}

function openCharacterRevisionDialog(): void {
    openCharacterPromptDialog("revision");
}

function openCharacterPromptDialog(mode: CharacterPromptDialogMode): void {
    if (!character.value) {
        notification.error("请先选择角色");
        return;
    }
    characterPromptDialogMode.value = mode;
    characterPromptRequirement.value = "";
    characterPromptReferences.value = [];
    characterPromptError.value = "";
    characterPromptDialogOpen.value = true;
}

function openCharacterPromptReferenceDialog(): void {
    characterPromptReferenceInputRef.value?.click();
}

async function importCharacterPromptReferences(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) {
        return;
    }
    const references = await Promise.all(files.map(async (file) => ({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        dataUrl: await readFileAsDataUrl(file),
    })));
    characterPromptReferences.value = [
        ...characterPromptReferences.value,
        ...references,
    ].slice(0, 6);
}

function removeCharacterPromptReference(id: string): void {
    characterPromptReferences.value = characterPromptReferences.value.filter((reference) => reference.id !== id);
}

async function submitCharacterPromptDialog(): Promise<void> {
    const currentCharacter = character.value;
    if (characterPromptBusy.value || !currentCharacter) {
        return;
    }
    if (!llm.value.apiBaseUrl.trim() || !llm.value.model.trim()) {
        characterPromptError.value = "请先在 LLM 大模型区连接并选择模型";
        return;
    }
    if (!characterPromptRequirement.value.trim()) {
        characterPromptError.value = "请填写具体需求";
        return;
    }

    characterPromptBusy.value = true;
    characterPromptError.value = "";
    try {
        if (characterPromptDialogMode.value === "photoPrompt") {
            const prompt = await requestCharacterPhotoPrompt(currentCharacter, characterPromptRequirement.value, characterPromptReferences.value);
            updateCharacter({photoPrompt: prompt});
            notification.success("角色照片提示词已生成");
        } else {
            const content = await requestCharacterRevision(currentCharacter, characterPromptRequirement.value);
            const patch = buildCharacterTagPatch(parseCharacterDraft(content));
            if (Object.keys(patch).length === 0) {
                throw new Error("LLM 没有返回可用的角色 tag 字段");
            }
            updateCharacter(patch);
            notification.success("角色详细 tag 已更新");
        }
        characterPromptDialogOpen.value = false;
    } catch (error) {
        characterPromptError.value = resolveApiErrorMessage(error, characterPromptDialogMode.value === "photoPrompt" ? "生成图片提示词失败" : "修改角色提示词失败");
    } finally {
        characterPromptBusy.value = false;
    }
}

async function requestCharacterPhotoPrompt(item: TextToImageCharacter, requirement: string, references: CharacterPromptReferenceImage[]): Promise<string> {
    const userContent: ChatCompletionContentPart[] = [
        {
            type: "text",
            text: buildCharacterPhotoPromptMessage(item, requirement, references.length),
        },
        ...references.map((reference) => ({
            type: "image_url" as const,
            image_url: {
                url: reference.dataUrl,
            },
        })),
    ];
    const content = await requestLlmChatCompletion([
        {
            role: "system",
            content: taskPrompts.value.characterDesign.prompt.trim() || "你是 NovelAI 角色照片 prompt 设计助手。",
        },
        {
            role: "user",
            content: userContent,
        },
    ]);
    return content.replace(/^```(?:text|txt|markdown)?/iu, "").replace(/```$/u, "").trim();
}

async function requestCharacterRevision(item: TextToImageCharacter, direction: string): Promise<string> {
    return await requestLlmChatCompletion([
        {
            role: "system",
            content: taskPrompts.value.characterRevision.prompt.trim() || "你是 NovelAI 角色 tag 修改助手。",
        },
        {
            role: "user",
            content: buildCharacterRevisionMessage(item, direction),
        },
    ]);
}

async function requestLlmChatCompletion(messages: ChatCompletionMessage[]): Promise<string> {
    const apiBaseUrl = llm.value.apiBaseUrl.trim().replace(/\/+$/, "");
    const headers: HeadersInit = {"Content-Type": "application/json"};
    if (llm.value.apiKey.trim()) {
        headers.Authorization = `Bearer ${llm.value.apiKey.trim()}`;
    }
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: llm.value.model.trim(),
            temperature: llm.value.parameters.temperature,
            top_p: llm.value.parameters.topP,
            max_tokens: llm.value.parameters.maxTokens,
            messages,
        }),
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `LLM 请求失败：${response.status}`);
    }
    const data = await response.json() as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
        throw new Error("LLM 没有返回可用内容");
    }
    return content;
}

function buildCharacterPhotoPromptMessage(item: TextToImageCharacter, requirement: string, referenceCount: number): string {
    return [
        "请根据当前角色 tag 和用户需求，生成一段可直接用于 NovelAI 的英文图片 prompt。",
        "只输出 prompt 本文，不要解释，不要 Markdown。",
        "prompt 应包含角色身份、外貌、服装、镜头、构图、背景和氛围；用英文逗号分隔 tag。",
        referenceCount > 0 ? `用户添加了 ${referenceCount} 张参考图片；如果模型可读取图片，请吸收其构图、姿势、服装或氛围，但不要改变角色核心设定。` : "",
        "",
        `角色名称：${formatCharacterName(item)}`,
        `英文名：${item.enName || "无"}`,
        `角色特征：${item.profileTraits || "无"}`,
        `五官外貌：${item.facialAppearance || "无"}`,
        `上半身SFW：${item.upperSfw || "无"}`,
        `下半身SFW：${item.lowerSfw || "无"}`,
        "",
        "用户关于角色照片的具体需求：",
        requirement,
    ].filter((line) => line.length > 0).join("\n");
}

function buildCharacterRevisionMessage(item: TextToImageCharacter, direction: string): string {
    const fieldList = characterDraftFields
        .filter((field) => field.label !== "角色中文名称" && field.label !== "角色英文名称")
        .map((field) => `${field.label}:`)
        .join("\n");
    return [
        "请根据用户修改方向，重写当前角色的 NovelAI 英文 tag 字段。",
        "只输出下列字段，字段名必须完全一致；不要输出解释。",
        "没有变化的字段也可以保留原值。",
        "",
        fieldList,
        "",
        `角色中文名称: ${item.cnName}`,
        `角色英文名称: ${item.enName}`,
        `角色特征: ${item.profileTraits}`,
        `五官外貌: ${item.facialAppearance}`,
        `五官外貌背面: ${item.facialBack}`,
        `上半身SFW: ${item.upperSfw}`,
        `上半身背面SFW: ${item.upperBackSfw}`,
        `下半身SFW: ${item.lowerSfw}`,
        `下半身背面SFW: ${item.lowerBackSfw}`,
        `上半身NSFW: ${item.upperNsfw}`,
        `上半身NSFW背面: ${item.upperBackNsfw}`,
        `下半身NSFW: ${item.lowerNsfw}`,
        `下半身NSFW背面: ${item.lowerBackNsfw}`,
        "",
        "用户修改方向：",
        direction,
    ].join("\n");
}

function buildCharacterTagPatch(draft: Partial<TextToImageCharacter>): Partial<TextToImageCharacter> {
    const patch: Partial<Record<TextToImageCharacterTagKey, string>> = {};
    for (const field of characterTextFields) {
        const value = draft[field.key];
        if (typeof value === "string" && value.trim()) {
            patch[field.key] = value;
        }
    }
    return patch as Partial<TextToImageCharacter>;
}

function parseCharacterDraft(content: string): Partial<TextToImageCharacter> {
    const draft: Partial<TextToImageCharacter> = {};
    for (const field of characterDraftFields) {
        const value = readDraftField(content, field.label);
        if (value) {
            field.apply(draft, value);
        }
    }
    return draft;
}

function readDraftField(content: string, label: string): string {
    const labelPattern = characterDraftFields.map((field) => escapeRegExp(field.label)).join("|");
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${escapeRegExp(label)}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[:：]|$)`, "i");
    return content.match(pattern)?.[1]?.trim() ?? "";
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
}
</script>

<template>
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--editor-canvas-bg)]">
        <div v-if="!character" class="flex min-h-0 flex-1 items-center justify-center p-8">
            <div class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)]/60 px-8 py-7 text-center">
                <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]">
                    <span class="i-lucide-id-card h-6 w-6"></span>
                </div>
                <h2 class="mt-4 text-base font-semibold text-[var(--text-main)]">角色不存在</h2>
                <p class="mt-2 text-sm text-[var(--text-secondary)]">该文生图角色可能已经被删除，关闭这个分页后重新从左侧角色列表打开。</p>
            </div>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-auto custom-scrollbar">
            <div class="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-6 py-6">
                <header class="flex min-w-0 items-center justify-between gap-4 border-b border-[var(--border-color)] pb-4">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                            <span class="i-lucide-image h-3.5 w-3.5"></span>
                            <span>文生图角色</span>
                        </div>
                        <h1 class="mt-1 truncate text-2xl font-semibold text-[var(--text-main)]">{{ characterDisplayName }}</h1>
                        <p v-if="character.sourceNovelTitle" class="mt-1 truncate text-xs text-[var(--text-muted)]">来源：{{ character.sourceNovelTitle }} · {{ character.sourceCharacterPath }}</p>
                    </div>
                    <span class="shrink-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                        {{ character.sendPhoto ? "发送图片已开启" : "发送图片未开启" }}
                    </span>
                </header>

                <section class="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
                    <div class="space-y-3">
                        <div class="overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
                            <img v-if="character.portraitDataUrl" :src="character.portraitDataUrl" :alt="characterDisplayName" class="block aspect-[4/5] w-full object-cover">
                            <div v-else class="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                                <span class="i-lucide-image h-10 w-10"></span>
                                <span class="text-sm">暂无角色照片</span>
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <button type="button" class="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-sm text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)]" @click="openCharacterPhotoDialog">
                                <span class="i-lucide-upload h-4 w-4"></span>
                                <span>上传照片</span>
                            </button>
                            <button type="button" class="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-sm transition-colors hover:bg-[var(--bg-hover)]" :class="character.sendPhoto ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'bg-[var(--bg-panel)] text-[var(--text-secondary)]'" :aria-pressed="character.sendPhoto" @click="toggleCharacterSendPhoto">
                                <span class="h-4 w-4" :class="character.sendPhoto ? 'i-lucide-square-check' : 'i-lucide-square'"></span>
                                <span>发送图片</span>
                            </button>
                            <input ref="characterPhotoInputRef" type="file" accept="image/*" class="hidden" @change="importCharacterPhoto">
                        </div>
                    </div>

                    <div class="min-w-0 space-y-3">
                        <label class="block">
                            <span class="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">提示词</span>
                            <FormTextarea :model-value="character.photoPrompt" :rows="8" placeholder="这里保存角色照片设计时生成的 NovelAI tag" @update:model-value="updateCharacter({photoPrompt: $event})" />
                        </label>

                        <div class="grid gap-2 lg:grid-cols-3">
                            <button type="button" class="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-[var(--accent-main)] px-3 text-sm text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)] disabled:cursor-not-allowed disabled:border-[var(--border-color)] disabled:text-[var(--text-muted)]" :disabled="generatingCharacterImage || !character.photoPrompt.trim()" @click="generateCharacterImage">
                                <span class="h-4 w-4" :class="generatingCharacterImage ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-wand-sparkles'"></span>
                                <span>{{ generatingCharacterImage ? "生成中" : "生成图片" }}</span>
                            </button>
                            <button type="button" class="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="openCharacterPhotoPromptDialog">
                                <span class="i-lucide-lightbulb h-4 w-4"></span>
                                <span>生成图片提示词</span>
                            </button>
                            <button type="button" class="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="openCharacterRevisionDialog">
                                <span class="i-lucide-square-pen h-4 w-4"></span>
                                <span>修改角色提示词</span>
                            </button>
                        </div>

                        <div v-if="generationWarnings.length > 0" class="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-700">
                            <div v-for="warning in generationWarnings" :key="warning">{{ warning }}</div>
                        </div>
                        <div v-if="lastGenerationRequest" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 text-xs text-[var(--text-muted)]">
                            最近请求：{{ lastGenerationRequest.width }}x{{ lastGenerationRequest.height }} · {{ lastGenerationRequest.steps }} steps · {{ lastGenerationRequest.sampler }}
                        </div>
                    </div>
                </section>

                <section class="space-y-4 border-t border-[var(--border-color)] pt-5">
                    <div class="flex items-center justify-between gap-3">
                        <h2 class="text-lg font-semibold text-[var(--accent-text)]">角色详细参数</h2>
                    </div>
                    <div class="grid gap-4 lg:grid-cols-2">
                        <label class="block">
                            <span class="mb-1.5 block text-sm text-[var(--text-secondary)]">角色中文名称</span>
                            <FormInput :model-value="character.cnName" placeholder="例如：伊蕾娜" @update:model-value="updateCharacter({cnName: $event})" />
                        </label>
                        <label class="block">
                            <span class="mb-1.5 block text-sm text-[var(--text-secondary)]">角色英文名称</span>
                            <FormInput :model-value="character.enName" placeholder="例如：Elaina" @update:model-value="updateCharacter({enName: $event})" />
                        </label>
                    </div>
                    <label v-for="field in characterTextFields" :key="field.key" class="block">
                        <span class="mb-1.5 block text-sm text-[var(--text-secondary)]">{{ field.label }}</span>
                        <FormTextarea :model-value="character[field.key]" :rows="field.rows" :placeholder="field.placeholder" @update:model-value="updateCharacterTagField(field.key, $event)" />
                    </label>
                </section>
            </div>
        </div>

        <Dialog
            v-model="characterPromptDialogOpen"
            :title="characterPromptDialogTitle"
            width="640px"
            max-height="86vh"
            show-cancel
            :busy="characterPromptBusy"
            @confirm="submitCharacterPromptDialog"
        >
            <div class="space-y-4">
                <p class="m-0 text-sm text-[var(--text-secondary)]">{{ characterPromptDialogDescription }}</p>
                <label class="block">
                    <span class="mb-1 block text-sm text-[var(--text-secondary)]">{{ characterPromptDialogMode === "photoPrompt" ? "角色照片具体需求" : "修改方向" }}</span>
                    <FormTextarea
                        :model-value="characterPromptRequirement"
                        :rows="5"
                        :placeholder="characterPromptDialogMode === 'photoPrompt' ? '例如：角色站在花园中，日常服装，柔和室内光线，半身头像...' : '例如：改成夏季运动服，保留发色和眼睛，整体更活泼...'"
                        @update:model-value="characterPromptRequirement = $event"
                    />
                </label>

                <div v-if="characterPromptDialogMode === 'photoPrompt'" class="space-y-2 rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex min-w-0 items-center gap-2 text-sm text-[var(--text-secondary)]">
                            <span class="i-lucide-paperclip h-4 w-4"></span>
                            <span class="truncate">参考图片（可选）</span>
                        </div>
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-sm text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)]" @click="openCharacterPromptReferenceDialog">
                            <span class="i-lucide-plus h-4 w-4"></span>
                            <span>添加图片</span>
                        </button>
                        <input ref="characterPromptReferenceInputRef" type="file" accept="image/*" multiple class="hidden" @change="importCharacterPromptReferences">
                    </div>

                    <div v-if="characterPromptReferences.length === 0" class="flex min-h-20 items-center justify-center rounded-md text-sm text-[var(--text-muted)]">
                        点击上方按钮添加参考图片
                    </div>
                    <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <div v-for="reference in characterPromptReferences" :key="reference.id" class="overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
                            <img :src="reference.dataUrl" :alt="reference.name" class="block aspect-square w-full object-cover">
                            <div class="flex items-center justify-between gap-2 border-t border-[var(--border-color)] px-2 py-1">
                                <span class="min-w-0 truncate text-[10px] text-[var(--text-muted)]">{{ reference.name }}</span>
                                <button type="button" class="shrink-0 text-[var(--text-muted)] transition-colors hover:text-[var(--danger-text)]" title="移除参考图" @click="removeCharacterPromptReference(reference.id)">
                                    <span class="i-lucide-x h-3.5 w-3.5"></span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <p v-if="characterPromptError" class="m-0 text-sm text-[var(--danger-text)]">{{ characterPromptError }}</p>
            </div>
        </Dialog>
    </section>
</template>
