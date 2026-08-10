<script setup lang="ts">
import {nextTick, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

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
const inpaintPrompt = ref("");
const inpaintStrength = ref(0.54);
const maskCanvas = ref<HTMLCanvasElement | null>(null);
const painting = ref(false);

const notification = useNotification();

watch(() => [props.modelValue, props.asset] as const, ([visible, asset]) => {
    if (!visible) return;
    activeAction.value = "menu";
    busy.value = false;
    error.value = "";
    tagDraft.value = asset?.prompt ?? "";
    inpaintPrompt.value = asset?.prompt ?? "";
    inpaintStrength.value = 0.54;
});

function assetUrl(asset: TextToImageAssetDto): string {
    return `/api/text-to-image/assets/${asset.id}/content?projectRoot=${encodeURIComponent(props.projectRoot)}`;
}

function requestClose(): void {
    if (busy.value) return;
    emit("update:modelValue", false);
}

function openTagEdit(): void {
    const asset = props.asset;
    if (!asset) return;
    tagDraft.value = asset.prompt;
    activeAction.value = "tag";
}

async function submitTagEdit(): Promise<void> {
    const asset = props.asset;
    if (!asset || tagDraft.value.trim() === "") {
        error.value = "Tag 不能为空";
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        const result = await $fetch<{jobId: string; asset: TextToImageAssetDto}>(
            `/api/text-to-image/assets/${asset.id}/edit-tag`,
            {
                method: "POST",
                body: {
                    projectRoot: props.projectRoot,
                    newPrompt: tagDraft.value,
                },
            },
        );
        notification.success("Tag 已重新生成");
        emit("success", result.asset);
        emit("update:modelValue", false);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "Tag 重新生成失败");
    } finally {
        busy.value = false;
    }
}

async function reroll(): Promise<void> {
    const asset = props.asset;
    if (!asset) return;
    busy.value = true;
    error.value = "";
    try {
        const result = await $fetch<{jobId: string; asset: TextToImageAssetDto}>(
            `/api/text-to-image/assets/${asset.id}/reroll`,
            {
                method: "POST",
                body: {
                    projectRoot: props.projectRoot,
                },
            },
        );
        notification.success("图片已重新生成");
        emit("success", result.asset);
        emit("update:modelValue", false);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "重新生成失败");
    } finally {
        busy.value = false;
    }
}

async function openInpaint(): Promise<void> {
    const asset = props.asset;
    if (!asset) return;
    inpaintPrompt.value = asset.prompt;
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
    const asset = props.asset;
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
        @confirm="activeAction === 'tag' ? submitTagEdit() : submitInpaint()"
        @request-close="requestClose"
    >
        <div v-if="props.asset" class="flex flex-col gap-3">
            <div v-if="activeAction === 'menu'" class="relative h-[360px] overflow-hidden rounded-md border border-[var(--border-color)] bg-black">
                <img :src="assetUrl(props.asset)" class="absolute inset-0 h-full w-full object-contain" :alt="props.asset.fileName" />
                <div class="absolute inset-0 flex items-center justify-center gap-3 bg-black/40">
                    <button class="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[13px] text-[var(--text-main)]" title="Tag 修改" @click="openTagEdit">
                        <span class="i-lucide-tags h-5 w-5"></span>
                        Tag
                    </button>
                    <button class="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[13px] text-[var(--text-main)]" title="重新生成" @click="reroll">
                        <span class="i-lucide-refresh-cw h-5 w-5"></span>
                        重 roll
                    </button>
                    <button class="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[13px] text-[var(--text-main)]" title="局部重绘" @click="openInpaint">
                        <span class="i-lucide-paintbrush h-5 w-5"></span>
                        重绘
                    </button>
                </div>
            </div>

            <label v-else-if="activeAction === 'tag'" class="flex flex-col gap-2 text-[15px] text-[var(--text-secondary)]">
                完整 Tag
                <textarea v-model="tagDraft" rows="10" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[14px] text-[var(--text-main)]" />
            </label>

            <template v-else>
                <div class="relative h-[320px] overflow-hidden rounded-md border border-[var(--border-color)] bg-black">
                    <img v-if="props.asset" :src="assetUrl(props.asset)" class="absolute inset-0 h-full w-full object-contain" :alt="props.asset.fileName" />
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
        <p v-else class="text-[15px] text-[var(--text-muted)]">图片信息加载失败，请重新长按正文中的生成图片。</p>
    </Dialog>
</template>
