<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    clearPendingTextToImagePrompt,
    resolvePendingTextToImagePrompt,
    setPendingTextToImagePrompt,
    type PendingTextToImagePrompts,
} from "nbook/app/components/novel-ide/text-to-image/asset-action-state";

const props = defineProps<{
    modelValue: boolean;
    projectRoot: string;
    asset: TextToImageAssetDto | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "success", asset: TextToImageAssetDto): void;
}>();

type AssetAction = "menu" | "tag" | "inpaint";

const activeAction = ref<AssetAction>("menu");
const busy = ref(false);
const error = ref("");
const tagDraft = ref("");
const tagModificationRequest = ref("");
const inpaintPrompt = ref("");
const inpaintStrength = ref(0.54);
const maskCanvas = ref<HTMLCanvasElement | null>(null);
const painting = ref(false);
const historyAssets = ref<TextToImageAssetDto[]>([]);
const historyIndex = ref(0);
const historyLoading = ref(false);
const showPreset = ref(false);
const pendingPrompts = ref<PendingTextToImagePrompts>({});

const notification = useNotification();

const activeAsset = computed(() => historyAssets.value[historyIndex.value] ?? props.asset);

watch(() => [props.modelValue, props.asset] as const, ([visible, asset]) => {
    if (!visible) return;
    activeAction.value = "menu";
    busy.value = false;
    error.value = "";
    tagModificationRequest.value = "";
    tagDraft.value = asset ? resolvePendingTextToImagePrompt(asset, pendingPrompts.value) : "";
    inpaintPrompt.value = asset ? resolvePendingTextToImagePrompt(asset, pendingPrompts.value) : "";
    inpaintStrength.value = 0.54;
    showPreset.value = false;
    void loadHistory(asset);
}, {immediate: true});

async function loadHistory(asset: TextToImageAssetDto | null): Promise<void> {
    historyAssets.value = asset ? [asset] : [];
    historyIndex.value = 0;
    if (!asset || !props.projectRoot.trim()) return;
    historyLoading.value = true;
    try {
        const result = await $fetch<{items: TextToImageAssetDto[]}>("/api/text-to-image/assets", {
            query: {
                projectRoot: props.projectRoot,
                page: 1,
                pageSize: 100,
                sourceAnchorId: asset.sourceAnchorId ?? asset.id,
            },
        });
        const items = result.items.some((item) => item.id === asset.id)
            ? result.items
            : [asset, ...result.items];
        historyAssets.value = [...new Map(items.map((item) => [item.id, item])).values()]
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        historyIndex.value = Math.max(0, historyAssets.value.findIndex((item) => item.id === asset.id));
        syncDraftWithActiveAsset();
    } catch {
        // The current asset remains usable when history lookup is unavailable.
    } finally {
        historyLoading.value = false;
    }
}

function moveHistory(offset: number): void {
    if (historyAssets.value.length <= 1) return;
    historyIndex.value = Math.min(
        historyAssets.value.length - 1,
        Math.max(0, historyIndex.value + offset),
    );
    const asset = activeAsset.value;
    tagDraft.value = asset ? resolvePendingTextToImagePrompt(asset, pendingPrompts.value) : "";
    inpaintPrompt.value = asset ? resolvePendingTextToImagePrompt(asset, pendingPrompts.value) : "";
}

function syncDraftWithActiveAsset(): void {
    const asset = activeAsset.value;
    if (!asset) return;
    tagDraft.value = resolvePendingTextToImagePrompt(asset, pendingPrompts.value);
    inpaintPrompt.value = resolvePendingTextToImagePrompt(asset, pendingPrompts.value);
}

function assetUrl(asset: TextToImageAssetDto): string {
    return `/api/text-to-image/assets/${asset.id}/content?projectRoot=${encodeURIComponent(props.projectRoot)}`;
}

function requestClose(): void {
    if (busy.value) return;
    const selectedAsset = activeAsset.value;
    if (selectedAsset && props.asset && selectedAsset.id !== props.asset.id) {
        emit("success", selectedAsset);
    }
    emit("update:modelValue", false);
}

function openTagEdit(): void {
    const asset = activeAsset.value;
    if (!asset) return;
    syncDraftWithActiveAsset();
    tagModificationRequest.value = "";
    error.value = "";
    activeAction.value = "tag";
}

async function submitTagEdit(): Promise<void> {
    const asset = activeAsset.value;
    if (!asset || tagModificationRequest.value.trim() === "") {
        error.value = "请输入 Tag 修改要求";
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        const result = await $fetch<{prompt: string}>(
            `/api/text-to-image/assets/${asset.id}/edit-tag`,
            {
                method: "POST",
                body: {
                    projectRoot: props.projectRoot,
                    modificationRequest: tagModificationRequest.value,
                },
            },
        );
        pendingPrompts.value = setPendingTextToImagePrompt(pendingPrompts.value, asset, result.prompt);
        tagDraft.value = result.prompt;
        notification.success("Tag 已更新，请点击发送生成图片");
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "Tag 修改失败");
    } finally {
        busy.value = false;
    }
}

async function sendCurrentPrompt(): Promise<void> {
    const asset = activeAsset.value;
    if (!asset) return;
    const prompt = activeAction.value === "tag"
            ? tagDraft.value.trim()
            : resolvePendingTextToImagePrompt(asset, pendingPrompts.value).trim();
    if (prompt === "") {
        error.value = "发送 Tag 不能为空";
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        const result = await $fetch<{jobId: string; asset: TextToImageAssetDto}>(
            `/api/text-to-image/assets/${asset.id}/send`,
            {
                method: "POST",
                body: {
                    projectRoot: props.projectRoot,
                    prompt,
                },
            },
        );
        pendingPrompts.value = clearPendingTextToImagePrompt(pendingPrompts.value, asset);
        notification.success("图片已发送并重新生成");
        emit("success", result.asset);
        emit("update:modelValue", false);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "发送图片失败");
    } finally {
        busy.value = false;
    }
}

async function openInpaint(): Promise<void> {
    const asset = activeAsset.value;
    if (!asset) return;
    inpaintPrompt.value = resolvePendingTextToImagePrompt(asset, pendingPrompts.value);
    inpaintStrength.value = 0.54;
    activeAction.value = "inpaint";
    await nextTick();
    await resetMaskCanvas();
}

async function resetMaskCanvas(): Promise<void> {
    const canvas = maskCanvas.value;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const context = canvas.getContext("2d");
    if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000000";
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function startPaint(event: PointerEvent): void {
    painting.value = true;
    paintAt(event);
}

function movePaint(event: PointerEvent): void {
    if (painting.value) {
        paintAt(event);
    }
}

function stopPaint(): void {
    painting.value = false;
}

function paintAt(event: PointerEvent): void {
    const canvas = maskCanvas.value;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
    const y = (event.clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(x, y, 18 * (canvas.width / Math.max(1, rect.width)), 0, Math.PI * 2);
    context.fill();
}

function eraseMask(): void {
    const canvas = maskCanvas.value;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000000";
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
}

async function submitInpaint(): Promise<void> {
    const asset = activeAsset.value;
    const canvas = maskCanvas.value;
    if (!asset || !canvas) return;
    const maskBase64 = canvas.toDataURL("image/png");
    busy.value = true;
    error.value = "";
    try {
        const result = await $fetch<{jobId: string; asset: TextToImageAssetDto}>(
            `/api/text-to-image/assets/${asset.id}/inpaint`,
            {
                method: "POST",
                body: {
                    projectRoot: props.projectRoot,
                    maskBase64,
                    strength: inpaintStrength.value,
                    newPrompt: inpaintPrompt.value,
                },
            },
        );
        notification.success("局部重绘任务已生成");
        emit("success", result.asset);
        emit("update:modelValue", false);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "局部重绘失败");
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        size="lg"
        title="图片后处理"
        :busy="busy"
        :show-footer="activeAction !== 'menu'"
        @confirm="activeAction === 'tag' ? sendCurrentPrompt() : submitInpaint()"
        @request-close="requestClose"
    >
        <div v-if="activeAsset" class="flex flex-col gap-3">
            <div class="relative h-[360px] overflow-hidden rounded-md border border-[var(--border-color)] bg-black">
                <img :src="assetUrl(activeAsset)" class="absolute inset-0 h-full w-full object-contain" :alt="activeAsset.fileName" />
                <button
                    class="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-30"
                    :disabled="historyLoading || historyIndex <= 0"
                    title="上一张历史图片"
                    @click="moveHistory(-1)"
                >
                    <span class="i-lucide-chevron-left h-5 w-5"></span>
                </button>
                <button
                    class="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-30"
                    :disabled="historyLoading || historyIndex >= historyAssets.length - 1"
                    title="下一张历史图片"
                    @click="moveHistory(1)"
                >
                    <span class="i-lucide-chevron-right h-5 w-5"></span>
                </button>
                <span class="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[13px] text-white">
                    {{ historyIndex + 1 }}/{{ historyAssets.length }}
                </span>
                <div v-if="activeAction === 'menu'" class="absolute inset-0 flex items-center justify-center gap-3 bg-black/40">
                    <button class="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[13px] text-[var(--text-main)]" title="展开预设" @click="showPreset = !showPreset">
                        <span class="i-lucide-file-text h-5 w-5"></span>
                        预设
                    </button>
                    <button class="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[13px] text-[var(--text-main)]" title="Tag 修改" @click="openTagEdit">
                        <span class="i-lucide-tags h-5 w-5"></span>
                        Tag
                    </button>
                    <button class="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[13px] text-[var(--text-main)]" title="发送" @click="sendCurrentPrompt">
                        <span class="i-lucide-refresh-cw h-5 w-5"></span>
                        发送
                    </button>
                    <button class="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[13px] text-[var(--text-main)]" title="局部重绘" @click="openInpaint">
                        <span class="i-lucide-paintbrush h-5 w-5"></span>
                        重绘
                    </button>
                </div>
            </div>

            <div v-if="showPreset" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 text-[13px] text-[var(--text-secondary)]">
                <div class="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                    <span>模型：{{ activeAsset.model }}</span>
                    <span>尺寸：{{ activeAsset.width }}x{{ activeAsset.height }}</span>
                    <span>Seed：{{ activeAsset.seed }}</span>
                </div>
                <p class="whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text-main)]">{{ activeAsset.prompt }}</p>
            </div>

            <template v-if="activeAction === 'tag'">
                <label class="flex flex-col gap-2 text-[15px] text-[var(--text-secondary)]">
                    当前待发送 Tag
                    <textarea :value="tagDraft" rows="7" readonly class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[14px] text-[var(--text-main)]" />
                </label>
                <label class="flex flex-col gap-2 text-[15px] text-[var(--text-secondary)]">
                    修改要求
                    <textarea v-model="tagModificationRequest" rows="4" placeholder="例如：把黑色长发改成银色短发，保留人物姿态和构图" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" />
                </label>
                <p class="text-[13px] text-[var(--text-muted)]">请求 LLM 只更新待发送 Tag，图片不会立即变化；确认后点击“发送”才会请求 NovelAI。</p>
            </template>

            <template v-else-if="activeAction === 'inpaint'">
                <div class="relative h-[320px] overflow-hidden rounded-md border border-[var(--border-color)] bg-black">
                    <img :src="assetUrl(activeAsset)" class="absolute inset-0 h-full w-full object-contain" :alt="activeAsset.fileName" />
                    <canvas
                        ref="maskCanvas"
                        class="absolute inset-0 h-full w-full touch-none cursor-crosshair"
                        @pointerdown="startPaint"
                        @pointermove="movePaint"
                        @pointerup="stopPaint"
                        @pointerleave="stopPaint"
                    ></canvas>
                </div>
                <div class="flex items-center justify-between">
                    <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[14px] text-[var(--text-secondary)]" @click="eraseMask">清除涂抹</button>
                    <label class="flex items-center gap-2 text-[15px] text-[var(--text-secondary)]">
                        强度 {{ inpaintStrength.toFixed(2) }}
                        <input v-model.number="inpaintStrength" type="range" min="0" max="1" step="0.01" class="w-32 accent-[var(--accent-main)]" />
                    </label>
                </div>
                <label class="flex flex-col gap-2 text-[15px] text-[var(--text-secondary)]">
                    重绘 Tag（可选）
                    <textarea v-model="inpaintPrompt" rows="5" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[14px] text-[var(--text-main)]" />
                </label>
            </template>

            <p v-if="error" class="text-[15px] text-[var(--danger-text)]">{{ error }}</p>
        </div>
        <p v-else class="text-[15px] text-[var(--text-muted)]">图片信息加载失败，请重新双击正文中的生成图片。</p>
        <template #footer="{confirm, cancel}">
            <button class="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-[13px] font-medium text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="busy" @click="cancel">取消</button>
            <button v-if="activeAction === 'tag'" class="inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-[var(--status-info)] px-4 text-[13px] font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="busy" @click="submitTagEdit">请求 LLM</button>
            <button class="inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-[var(--accent-main)] px-4 text-[13px] font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="busy" @click="confirm">{{ activeAction === 'tag' ? '发送' : '确定' }}</button>
        </template>
    </Dialog>
</template>
