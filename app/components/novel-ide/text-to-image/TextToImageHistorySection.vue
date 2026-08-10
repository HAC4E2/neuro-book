<script setup lang="ts">
import {nextTick, onBeforeUnmount, onMounted, ref} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const props = defineProps<{
    projectRoot: string;
}>();

type AssetPage = {
    items: TextToImageAssetDto[];
    page: number;
    pageSize: number;
    hasMore: boolean;
};

type AssetAction = "tag" | "inpaint" | null;

const page = ref(1);
const pageSize = ref(24);
const assets = ref<TextToImageAssetDto[]>([]);
const hasMore = ref(false);
const error = ref("");
const loading = ref(false);
const busy = ref(false);
const menuAssetId = ref<string | null>(null);
const actionAsset = ref<TextToImageAssetDto | null>(null);
const activeAction = ref<AssetAction>(null);
const tagDraft = ref("");
const inpaintPrompt = ref("");
const inpaintStrength = ref(0.54);
const maskCanvas = ref<HTMLCanvasElement | null>(null);
const painting = ref(false);

let pressTimer: ReturnType<typeof setTimeout> | undefined;
let pressStartX = 0;
let pressStartY = 0;

const notification = useNotification();

onMounted(() => {
    void load();
});

onBeforeUnmount(() => {
    clearPressTimer();
});

async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
        const result = await $fetch<AssetPage>("/api/text-to-image/assets", {
            query: {
                projectRoot: props.projectRoot,
                page: page.value,
                pageSize: pageSize.value,
            },
        });
        assets.value = result.items;
        hasMore.value = result.hasMore;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "加载历史图片失败");
    } finally {
        loading.value = false;
    }
}

function assetUrl(asset: TextToImageAssetDto): string {
    return `/api/text-to-image/assets/${asset.id}/content?projectRoot=${encodeURIComponent(props.projectRoot)}`;
}

function startPress(event: PointerEvent, asset: TextToImageAssetDto): void {
    clearPressTimer();
    pressStartX = event.clientX;
    pressStartY = event.clientY;
    pressTimer = setTimeout(() => {
        menuAssetId.value = asset.id;
    }, 550);
}

function cancelPress(event?: PointerEvent): void {
    if (event && menuAssetId.value === null) {
        const distance = Math.hypot(event.clientX - pressStartX, event.clientY - pressStartY);
        if (distance > 8) {
            clearPressTimer();
            return;
        }
    }
    clearPressTimer();
}

function clearPressTimer(): void {
    if (pressTimer !== undefined) {
        clearTimeout(pressTimer);
        pressTimer = undefined;
    }
}

function openTagEdit(asset: TextToImageAssetDto): void {
    actionAsset.value = asset;
    tagDraft.value = asset.prompt;
    activeAction.value = "tag";
    menuAssetId.value = null;
}

async function submitTagEdit(): Promise<void> {
    const asset = actionAsset.value;
    if (!asset || tagDraft.value.trim() === "") {
        error.value = "Tag 不能为空";
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        await $fetch(`/api/text-to-image/assets/${asset.id}/edit-tag`, {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                newPrompt: tagDraft.value,
            },
        });
        activeAction.value = null;
        actionAsset.value = null;
        notification.success("Tag 已重新生成");
        await load();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "Tag 重新生成失败");
    } finally {
        busy.value = false;
    }
}

async function reroll(asset: TextToImageAssetDto): Promise<void> {
    menuAssetId.value = null;
    busy.value = true;
    error.value = "";
    try {
        await $fetch(`/api/text-to-image/assets/${asset.id}/reroll`, {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
            },
        });
        notification.success("图片已重新生成");
        await load();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "重新生成失败");
    } finally {
        busy.value = false;
    }
}

async function openInpaint(asset: TextToImageAssetDto): Promise<void> {
    actionAsset.value = asset;
    inpaintPrompt.value = asset.prompt;
    inpaintStrength.value = 0.54;
    activeAction.value = "inpaint";
    menuAssetId.value = null;
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
    const asset = actionAsset.value;
    const canvas = maskCanvas.value;
    if (!asset || !canvas) return;
    const maskBase64 = canvas.toDataURL("image/png");
    busy.value = true;
    error.value = "";
    try {
        await $fetch(`/api/text-to-image/assets/${asset.id}/inpaint`, {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                maskBase64,
                strength: inpaintStrength.value,
                newPrompt: inpaintPrompt.value,
            },
        });
        activeAction.value = null;
        actionAsset.value = null;
        notification.success("局部重绘任务已生成");
        await load();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "局部重绘失败");
    } finally {
        busy.value = false;
    }
}

function closeAction(): void {
    if (busy.value) return;
    activeAction.value = null;
    actionAsset.value = null;
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="flex items-center gap-2">
            <span class="h-9 flex-1 truncate rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-[15px] text-[var(--text-muted)]">{{ props.projectRoot }}</span>
            <button class="h-9 rounded-md bg-[var(--accent-main)] px-3 text-[15px] font-medium text-[var(--text-inverse)]" @click="page = 1; load()">加载</button>
        </div>
        <div v-if="assets.length > 0" class="grid grid-cols-3 gap-3">
            <div
                v-for="asset in assets"
                :key="asset.id"
                class="relative overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]"
                @pointerdown="startPress($event, asset)"
                @pointermove="cancelPress($event)"
                @pointerup="cancelPress()"
                @pointerleave="cancelPress()"
            >
                <img :src="assetUrl(asset)" class="h-32 w-full touch-none object-cover select-none" :alt="asset.fileName" draggable="false" />
                <div class="p-2">
                    <p class="truncate text-[14px] text-[var(--text-muted)]">{{ asset.fileName }}</p>
                    <p class="truncate text-[14px] text-[var(--text-muted)]">{{ asset.width }}x{{ asset.height }} · seed {{ asset.seed }}</p>
                </div>
                <div v-if="menuAssetId === asset.id" class="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
                    <div class="grid grid-cols-3 gap-2">
                        <button class="flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[12px] text-[var(--text-main)]" title="Tag 修改" @click="openTagEdit(asset)">
                            <span class="i-lucide-tags h-4 w-4"></span>
                            Tag
                        </button>
                        <button class="flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[12px] text-[var(--text-main)]" title="重新生成" @click="reroll(asset)">
                            <span class="i-lucide-refresh-cw h-4 w-4"></span>
                            重 roll
                        </button>
                        <button class="flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[12px] text-[var(--text-main)]" title="局部重绘" @click="openInpaint(asset)">
                            <span class="i-lucide-paintbrush h-4 w-4"></span>
                            重绘
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <p v-else-if="!loading" class="text-[15px] text-[var(--text-muted)]">暂无历史图片，长按图片可执行后处理</p>
        <div class="flex items-center gap-2">
            <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[15px] text-[var(--text-secondary)]" :disabled="page <= 1" @click="page -= 1; load()">上一页</button>
            <span class="text-[15px] text-[var(--text-muted)]">第 {{ page }} 页</span>
            <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[15px] text-[var(--text-secondary)]" :disabled="!hasMore" @click="page += 1; load()">下一页</button>
        </div>
        <p v-if="error" class="text-[15px] text-[var(--danger-text)]">{{ error }}</p>

        <Dialog
            :model-value="activeAction === 'tag'"
            size="md"
            title="Tag 修改"
            :busy="busy"
            @confirm="submitTagEdit"
            @request-close="closeAction"
        >
            <label class="flex flex-col gap-2 text-[15px] text-[var(--text-secondary)]">
                完整 Tag
                <textarea v-model="tagDraft" rows="8" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[14px] text-[var(--text-main)]" />
            </label>
        </Dialog>

        <Dialog
            :model-value="activeAction === 'inpaint'"
            size="md"
            title="局部重绘"
            :busy="busy"
            @confirm="submitInpaint"
            @request-close="closeAction"
        >
            <div class="relative h-[320px] overflow-hidden rounded-md border border-[var(--border-color)] bg-black">
                <img v-if="actionAsset" :src="assetUrl(actionAsset)" class="absolute inset-0 h-full w-full object-contain" :alt="actionAsset.fileName" />
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
        </Dialog>
    </div>
</template>
