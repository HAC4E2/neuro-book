<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {copyImageBlobToClipboard, downloadImageBlob, readImageBlob} from "nbook/app/utils/text-to-image-image-actions";

const props = defineProps<{
    projectRoot: string;
}>();

type AssetPage = {
    items: TextToImageAssetDto[];
    page: number;
    pageSize: number;
    hasMore: boolean;
};

const page = ref(1);
const pageSize = ref(24);
const assets = ref<TextToImageAssetDto[]>([]);
const hasMore = ref(false);
const error = ref("");
const loading = ref(false);
const activeInfoAsset = ref<TextToImageAssetDto | null>(null);
const infoAction = ref<"copying" | "downloading" | null>(null);
const infoBusy = computed(() => infoAction.value !== null);
const infoError = ref("");
const notification = useNotification();

onMounted(() => {
    void load();
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

function openAssetInfo(asset: TextToImageAssetDto): void {
    activeInfoAsset.value = asset;
    infoError.value = "";
}

function closeAssetInfo(): void {
    if (infoBusy.value) return;
    activeInfoAsset.value = null;
}

function safeDownloadFileName(asset: TextToImageAssetDto): string {
    const name = asset.fileName.split(/[\\/]/u).pop()?.trim() || `text-to-image-${asset.id}.png`;
    return name.replace(/[^\w.\-\u4e00-\u9fff ]/gu, "_");
}

async function copyInfoAsset(): Promise<void> {
    const asset = activeInfoAsset.value;
    if (!asset || infoBusy.value) return;
    infoAction.value = "copying";
    infoError.value = "";
    try {
        await copyImageBlobToClipboard(await readImageBlob(assetUrl(asset)));
        notification.success("图片已复制到剪贴板");
    } catch (cause) {
        infoError.value = resolveApiErrorMessage(cause, "图片复制失败");
    } finally {
        infoAction.value = null;
    }
}

async function downloadInfoAsset(): Promise<void> {
    const asset = activeInfoAsset.value;
    if (!asset || infoBusy.value) return;
    infoAction.value = "downloading";
    infoError.value = "";
    try {
        const blob = await readImageBlob(assetUrl(asset));
        downloadImageBlob(blob, safeDownloadFileName(asset));
        notification.success("图片已开始下载");
    } catch (cause) {
        infoError.value = resolveApiErrorMessage(cause, "下载图片失败");
    } finally {
        infoAction.value = null;
    }
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
                class="relative cursor-pointer overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]"
                @click="openAssetInfo(asset)"
            >
                <img :src="assetUrl(asset)" class="h-32 w-full touch-none object-cover select-none" :alt="asset.fileName" draggable="false" />
                <div class="p-2">
                    <p class="truncate text-[14px] text-[var(--text-muted)]">{{ asset.fileName }}</p>
                    <p class="truncate text-[14px] text-[var(--text-muted)]">{{ asset.width }}x{{ asset.height }} · seed {{ asset.seed }}</p>
                </div>
            </div>
        </div>
        <p v-else-if="!loading" class="text-[15px] text-[var(--text-muted)]">暂无历史图片，点击图片可查看生成信息</p>
        <div class="flex items-center gap-2">
            <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[15px] text-[var(--text-secondary)]" :disabled="page <= 1" @click="page -= 1; load()">上一页</button>
            <span class="text-[15px] text-[var(--text-muted)]">第 {{ page }} 页</span>
            <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[15px] text-[var(--text-secondary)]" :disabled="!hasMore" @click="page += 1; load()">下一页</button>
        </div>
        <p v-if="error" class="text-[15px] text-[var(--danger-text)]">{{ error }}</p>

        <Dialog
            :model-value="activeInfoAsset !== null"
            width="min(1200px, calc(100vw - 24px))"
            height="min(900px, calc(100dvh - 24px))"
            max-height="calc(100dvh - 24px)"
            title="生成信息"
            :busy="infoBusy"
            :show-footer="false"
            body-class="min-h-0 overflow-hidden"
            @request-close="closeAssetInfo"
        >
            <div v-if="activeInfoAsset" class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
                <div class="flex min-h-[520px] min-w-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border-color)] bg-black">
                    <img :src="assetUrl(activeInfoAsset)" class="max-h-full max-w-full object-contain" :alt="activeInfoAsset.fileName" />
                </div>
                <div class="flex min-h-0 flex-col gap-3 overflow-y-auto">
                    <div class="flex gap-2">
                        <button class="h-9 flex-1 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-main)] disabled:opacity-50" :disabled="infoBusy" @click="copyInfoAsset">复制图片</button>
                        <button class="h-9 flex-1 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-main)] disabled:opacity-50" :disabled="infoBusy" @click="downloadInfoAsset">下载图片</button>
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-[14px] text-[var(--text-secondary)]">
                        <p>模型：{{ activeInfoAsset.model }}</p>
                        <p>尺寸：{{ activeInfoAsset.width }} × {{ activeInfoAsset.height }}</p>
                        <p>Seed：{{ activeInfoAsset.seed }}</p>
                        <p>来源：{{ activeInfoAsset.sourceKind }}</p>
                        <p class="col-span-2">生成时间：{{ activeInfoAsset.createdAt }}</p>
                    </div>
                    <label class="flex flex-col gap-2 text-[14px] text-[var(--text-secondary)]">
                        正面 Prompt
                        <textarea :value="activeInfoAsset.prompt" rows="8" readonly class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[13px] text-[var(--text-main)]" />
                    </label>
                    <label class="flex flex-col gap-2 text-[14px] text-[var(--text-secondary)]">
                        负面 Prompt
                        <textarea :value="activeInfoAsset.negativePrompt || '（空）'" rows="5" readonly class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[13px] text-[var(--text-main)]" />
                    </label>
                    <p v-if="infoError" class="text-[13px] text-[var(--danger-text)]">{{ infoError }}</p>
                </div>
            </div>
        </Dialog>
    </div>
</template>
