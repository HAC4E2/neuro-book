<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {copyImageBlobToClipboard, downloadImageBlob, readImageBlob} from "nbook/app/utils/text-to-image-image-actions";
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
type MaskRect = {left: number; top: number; width: number; height: number};
type BusyAction = "copying" | "downloading" | "submitting";

const activeAction = ref<AssetAction>("menu");
const busyAction = ref<BusyAction | null>(null);
const busy = computed(() => busyAction.value !== null);
const error = ref("");
const tagDraft = ref("");
const tagModificationRequest = ref("");
const inpaintPrompt = ref("");
const inpaintStrength = ref(0.54);
const maskCanvas = ref<HTMLCanvasElement | null>(null);
const maskViewport = ref<HTMLDivElement | null>(null);
const maskRect = ref<MaskRect>({left: 0, top: 0, width: 0, height: 0});
const maskHasPaint = ref(false);
const painting = ref(false);
const historyAssets = ref<TextToImageAssetDto[]>([]);
const historyIndex = ref(0);
const historyLoading = ref(false);
const showPreset = ref(false);
const pendingPrompts = ref<PendingTextToImagePrompts>({});
let historyRequestSequence = 0;

const notification = useNotification();
const activeAsset = computed(() => historyAssets.value[historyIndex.value] ?? props.asset);

watch(() => [props.modelValue, props.asset] as const, ([visible, asset]) => {
    if (!visible) return;
    activeAction.value = "menu";
    busyAction.value = null;
    error.value = "";
    tagModificationRequest.value = "";
    tagDraft.value = asset ? resolvePendingTextToImagePrompt(asset, pendingPrompts.value) : "";
    inpaintPrompt.value = asset ? resolvePendingTextToImagePrompt(asset, pendingPrompts.value) : "";
    inpaintStrength.value = 0.54;
    showPreset.value = false;
    void loadHistory(asset);
}, {immediate: true});

watch(() => props.projectRoot, (next, previous) => {
    if (next !== previous && props.modelValue) {
        historyRequestSequence += 1;
        emit("update:modelValue", false);
    }
});

onMounted(() => window.addEventListener("resize", handleWindowResize));
onBeforeUnmount(() => window.removeEventListener("resize", handleWindowResize));

async function loadHistory(asset: TextToImageAssetDto | null): Promise<void> {
    const requestId = ++historyRequestSequence;
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
        if (requestId !== historyRequestSequence) return;
        const items = result.items.some((item) => item.id === asset.id)
            ? result.items
            : [asset, ...result.items];
        historyAssets.value = [...new Map(items.map((item) => [item.id, item])).values()]
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        historyIndex.value = Math.max(0, historyAssets.value.findIndex((item) => item.id === asset.id));
        syncDraftWithActiveAsset();
    } catch {
        // 当前资产仍可操作，历史列表失败不影响大图和复制/下载。
    } finally {
        if (requestId === historyRequestSequence) historyLoading.value = false;
    }
}

function moveHistory(offset: number): void {
    if (busy.value || historyAssets.value.length <= 1) return;
    historyIndex.value = Math.min(
        historyAssets.value.length - 1,
        Math.max(0, historyIndex.value + offset),
    );
    syncDraftWithActiveAsset();
    if (activeAction.value === "inpaint") void nextTick(resetMaskCanvas);
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

function safeDownloadFileName(asset: TextToImageAssetDto): string {
    const name = asset.fileName.split(/[\\/]/u).pop()?.trim() || `text-to-image-${asset.id}.png`;
    return name.replace(/[^\w.\-\u4e00-\u9fff ]/gu, "_");
}

function requestClose(): void {
    if (busy.value) return;
    emit("update:modelValue", false);
}

async function copyActiveImage(): Promise<void> {
    const asset = activeAsset.value;
    if (!asset || busy.value) return;
    const assetId = asset.id;
    busyAction.value = "copying";
    error.value = "";
    try {
        const blob = await readImageBlob(assetUrl(asset));
        if (activeAsset.value?.id !== assetId) return;
        await copyImageBlobToClipboard(blob);
        notification.success("图片已复制到剪贴板");
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "图片复制失败");
    } finally {
        busyAction.value = null;
    }
}

async function downloadActiveImage(): Promise<void> {
    const asset = activeAsset.value;
    if (!asset || busy.value) return;
    busyAction.value = "downloading";
    error.value = "";
    try {
        const blob = await readImageBlob(assetUrl(asset));
        downloadImageBlob(blob, safeDownloadFileName(asset));
        notification.success("图片已开始下载");
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "下载图片失败");
    } finally {
        busyAction.value = null;
    }
}

function openTagEdit(): void {
    const asset = activeAsset.value;
    if (!asset || busy.value) return;
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
    const assetId = asset.id;
    busyAction.value = "submitting";
    error.value = "";
    try {
        const result = await $fetch<{prompt: string}>(
            `/api/text-to-image/assets/${assetId}/edit-tag`,
            {
                method: "POST",
                body: {
                    projectRoot: props.projectRoot,
                    modificationRequest: tagModificationRequest.value,
                },
            },
        );
        if (activeAsset.value?.id !== assetId) return;
        pendingPrompts.value = setPendingTextToImagePrompt(pendingPrompts.value, asset, result.prompt);
        tagDraft.value = result.prompt;
        notification.success("Tag 已更新，请点击发送生成图片");
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "Tag 修改失败");
    } finally {
        busyAction.value = null;
    }
}

async function sendCurrentPrompt(): Promise<void> {
    const asset = activeAsset.value;
    if (!asset || busy.value) return;
    const assetId = asset.id;
    const isTagSend = activeAction.value === "tag";
    const prompt = isTagSend ? tagDraft.value.trim() : "";
    if (isTagSend && prompt === "") {
        error.value = "发送 Tag 不能为空";
        return;
    }
    busyAction.value = "submitting";
    error.value = "";
    try {
        const result = await $fetch<{jobId: string; asset: TextToImageAssetDto}>(
            `/api/text-to-image/assets/${assetId}/${isTagSend ? "send" : "reroll"}`,
            {
                method: "POST",
                body: {
                    projectRoot: props.projectRoot,
                    ...(isTagSend ? {prompt} : {}),
                },
            },
        );
        pendingPrompts.value = clearPendingTextToImagePrompt(pendingPrompts.value, asset);
        notification.success(isTagSend ? "图片已发送并重新生成" : "已使用当前画风串重新生成");
        emit("success", result.asset);
        emit("update:modelValue", false);
    } catch (cause) {
        const safeError = resolveApiErrorMessage(cause, "请求失败");
        const directErrors = new Set([
            "请先在文生图工作台配置 NovelAI",
            "请先保存 NovelAI API Key",
            "请先选择并保存一个画风串",
            "无法读取该图片的原始生成请求",
            "该历史图片缺少可重 roll 的基础 Prompt",
        ]);
        error.value = directErrors.has(safeError) || safeError.startsWith("当前 V5 模型不支持所选参数：")
            ? safeError
            : isTagSend ? `图片发送失败：${safeError}` : `使用当前画风串重新生成失败：${safeError}`;
    } finally {
        busyAction.value = null;
    }
}

async function openInpaint(): Promise<void> {
    const asset = activeAsset.value;
    if (!asset || busy.value) return;
    inpaintPrompt.value = resolvePendingTextToImagePrompt(asset, pendingPrompts.value);
    inpaintStrength.value = 0.54;
    maskHasPaint.value = false;
    activeAction.value = "inpaint";
    await nextTick();
    await resetMaskCanvas();
}

async function resetMaskCanvas(): Promise<void> {
    const canvas = maskCanvas.value;
    const viewport = maskViewport.value;
    const asset = activeAsset.value;
    if (!canvas || !viewport || !asset) return;
    const viewportRect = viewport.getBoundingClientRect();
    const hadPaint = maskHasPaint.value;
    const sourceWidth = Math.max(1, asset.width);
    const sourceHeight = Math.max(1, asset.height);
    const scale = Math.min(viewportRect.width / sourceWidth, viewportRect.height / sourceHeight);
    const width = Math.max(1, Math.floor(sourceWidth * Math.max(0.01, scale)));
    const height = Math.max(1, Math.floor(sourceHeight * Math.max(0.01, scale)));
    const left = Math.max(0, (viewportRect.width - width) / 2);
    const top = Math.max(0, (viewportRect.height - height) / 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    maskRect.value = {left, top, width, height};
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.floor(sourceWidth * dpr));
    canvas.height = Math.max(1, Math.floor(sourceHeight * dpr));
    maskHasPaint.value = false;
    if (hadPaint) {
        error.value = "窗口尺寸已变化，遮罩已清空，请重新涂抹";
    }
    const context = canvas.getContext("2d");
    if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000000";
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function handleWindowResize(): void {
    if (props.modelValue && activeAction.value === "inpaint") void resetMaskCanvas();
}

function startPaint(event: PointerEvent): void {
    if (busy.value) return;
    painting.value = true;
    paintAt(event);
}

function movePaint(event: PointerEvent): void {
    if (painting.value && !busy.value) paintAt(event);
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
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(x, y, 18 * Math.min(scaleX, scaleY), 0, Math.PI * 2);
    context.fill();
    maskHasPaint.value = true;
}

function eraseMask(): void {
    const canvas = maskCanvas.value;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        maskHasPaint.value = false;
    }
}

function createSourceMaskPng(asset: TextToImageAssetDto, canvas: HTMLCanvasElement): string {
    const output = document.createElement("canvas");
    output.width = Math.max(1, asset.width);
    output.height = Math.max(1, asset.height);
    const context = output.getContext("2d");
    if (!context) throw new Error("无法生成局部重绘遮罩");
    context.drawImage(canvas, 0, 0, output.width, output.height);
    return output.toDataURL("image/png");
}

async function submitInpaint(): Promise<void> {
    const asset = activeAsset.value;
    const canvas = maskCanvas.value;
    if (!asset || !canvas || busy.value) return;
    const assetId = asset.id;
    const maskBase64 = createSourceMaskPng(asset, canvas);
    busyAction.value = "submitting";
    error.value = "";
    try {
        const result = await $fetch<{jobId: string; asset: TextToImageAssetDto}>(
            `/api/text-to-image/assets/${assetId}/inpaint`,
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
        busyAction.value = null;
    }
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        width="min(1440px, calc(100vw - 24px))"
        height="min(900px, calc(100dvh - 24px))"
        max-height="calc(100dvh - 24px)"
        title="图片后处理"
        :busy="busy"
        :show-footer="activeAction !== 'menu'"
        body-class="min-h-0 overflow-hidden"
        @confirm="activeAction === 'tag' ? sendCurrentPrompt() : submitInpaint()"
        @request-close="requestClose"
    >
        <div v-if="activeAsset" class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
            <div class="flex min-h-[520px] min-w-0 flex-col gap-2">
                <div v-if="activeAction !== 'inpaint'" class="relative min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--border-color)] bg-black">
                    <img :src="assetUrl(activeAsset)" class="absolute inset-0 h-full w-full object-contain" :alt="activeAsset.fileName" />
                    <button
                        class="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-30"
                        :disabled="busy || historyLoading || historyIndex <= 0"
                        title="上一张历史图片"
                        @click="moveHistory(-1)"
                    >
                        <span class="i-lucide-chevron-left h-5 w-5"></span>
                    </button>
                    <button
                        class="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-30"
                        :disabled="busy || historyLoading || historyIndex >= historyAssets.length - 1"
                        title="下一张历史图片"
                        @click="moveHistory(1)"
                    >
                        <span class="i-lucide-chevron-right h-5 w-5"></span>
                    </button>
                    <span class="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[13px] text-white">
                        {{ historyIndex + 1 }}/{{ historyAssets.length }}
                    </span>
                </div>
                <div v-else ref="maskViewport" class="relative min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--border-color)] bg-black">
                    <img :src="assetUrl(activeAsset)" class="absolute inset-0 h-full w-full object-contain" :alt="activeAsset.fileName" />
                    <canvas
                        ref="maskCanvas"
                        class="absolute touch-none cursor-crosshair"
                        @pointerdown="startPaint"
                        @pointermove="movePaint"
                        @pointerup="stopPaint"
                        @pointercancel="stopPaint"
                        @pointerleave="stopPaint"
                    ></canvas>
                </div>
                <div class="flex items-center justify-between text-[13px] text-[var(--text-muted)]">
                    <span>{{ activeAsset.width }} × {{ activeAsset.height }} · {{ activeAsset.model }}</span>
                    <span v-if="activeAction === 'inpaint'">遮罩区域按原图坐标提交</span>
                </div>
            </div>

            <aside class="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                <div class="flex items-center justify-between gap-2">
                    <div>
                        <h3 class="text-[16px] font-semibold text-[var(--text-main)]">图片操作</h3>
                        <p class="text-[12px] text-[var(--text-muted)]">第 {{ historyIndex + 1 }} / {{ historyAssets.length }} 张</p>
                    </div>
                    <div class="flex gap-1">
                        <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[13px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="busy" title="上一张历史图片" @click="moveHistory(-1)">上一张</button>
                        <button class="h-8 rounded-md border border-[var(--border-color)] px-2 text-[13px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="busy" title="下一张历史图片" @click="moveHistory(1)">下一张</button>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[13px] text-[var(--text-main)] disabled:opacity-50" :disabled="busy" @click="showPreset = !showPreset">{{ showPreset ? "收起预设" : "查看预设" }}</button>
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[13px] text-[var(--text-main)] disabled:opacity-50" :disabled="busy" @click="copyActiveImage">复制图片</button>
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[13px] text-[var(--text-main)] disabled:opacity-50" :disabled="busy" @click="downloadActiveImage">下载图片</button>
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-2 text-[13px] text-[var(--text-main)] disabled:opacity-50" :disabled="busy" @click="openTagEdit">Tag 修改</button>
                    <button class="col-span-2 h-9 rounded-md bg-[var(--accent-main)] px-2 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="busy" @click="sendCurrentPrompt">{{ activeAction === 'tag' ? "发送" : "重 roll" }}</button>
                    <button class="col-span-2 h-9 rounded-md border border-[var(--border-color)] px-2 text-[13px] text-[var(--text-main)] disabled:opacity-50" :disabled="busy" @click="openInpaint">局部重绘</button>
                </div>

                <div v-if="showPreset" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 text-[13px] text-[var(--text-secondary)]">
                    <div class="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                        <span>模型：{{ activeAsset.model }}</span>
                        <span>尺寸：{{ activeAsset.width }}x{{ activeAsset.height }}</span>
                        <span>Seed：{{ activeAsset.seed }}</span>
                    </div>
                    <p class="mb-2 whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text-main)]">{{ activeAsset.prompt }}</p>
                    <p class="whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text-muted)]">负面：{{ activeAsset.negativePrompt }}</p>
                </div>

                <template v-if="activeAction === 'tag'">
                    <label class="flex flex-col gap-2 text-[14px] text-[var(--text-secondary)]">
                        当前待发送 Tag
                        <textarea :value="tagDraft" rows="7" readonly class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[13px] text-[var(--text-main)]" />
                    </label>
                    <label class="flex flex-col gap-2 text-[14px] text-[var(--text-secondary)]">
                        修改要求
                        <textarea v-model="tagModificationRequest" rows="4" placeholder="例如：把黑色长发改成银色短发，保留人物姿态和构图" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[13px] text-[var(--text-main)]" />
                    </label>
                    <button class="h-9 rounded-md bg-[var(--status-info)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="busy" @click="submitTagEdit">请求 LLM</button>
                    <p class="text-[12px] text-[var(--text-muted)]">LLM 只更新待发送 Tag；图片不会立即变化。</p>
                </template>

                <template v-else-if="activeAction === 'inpaint'">
                    <div class="flex items-center justify-between">
                        <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="busy" @click="eraseMask">清除涂抹</button>
                        <label class="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                            强度 {{ inpaintStrength.toFixed(2) }}
                            <input v-model.number="inpaintStrength" type="range" min="0" max="1" step="0.01" class="w-32 accent-[var(--accent-main)]" />
                        </label>
                    </div>
                    <label class="flex flex-col gap-2 text-[14px] text-[var(--text-secondary)]">
                        重绘 Tag（可选）
                        <textarea v-model="inpaintPrompt" rows="7" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[13px] text-[var(--text-main)]" />
                    </label>
                    <p class="text-[12px] text-[var(--text-muted)]">白色区域会按原图坐标提交给局部重绘。</p>
                </template>

                <p v-if="error" class="text-[13px] text-[var(--danger-text)]">{{ error }}</p>
            </aside>
        </div>
        <p v-else class="text-[15px] text-[var(--text-muted)]">图片信息加载失败，请重新双击正文中的生成图片。</p>
        <template #footer="{confirm, cancel}">
            <button class="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-[13px] font-medium text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="busy" @click="cancel">取消</button>
            <button v-if="activeAction === 'tag'" class="inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-[var(--accent-main)] px-4 text-[13px] font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="busy" @click="confirm">发送</button>
            <button v-else-if="activeAction === 'inpaint'" class="inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-[var(--accent-main)] px-4 text-[13px] font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="busy" @click="confirm">确定</button>
        </template>
    </Dialog>
</template>
