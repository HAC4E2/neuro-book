<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import IconButton from "nbook/app/components/common/IconButton.vue";
import TextToImageAssetDetailDialog from "nbook/app/components/novel-ide/text-to-image/TextToImageAssetDetailDialog.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    TextToImageAssetListItemDto,
    TextToImageAssetPageDto,
    TextToImageJobDto,
    TextToImageJobPageDto,
    TextToImageJobStatus,
} from "nbook/shared/dto/text-to-image.dto";

const props = defineProps<{projectPath: string}>();
const assets = ref<TextToImageAssetListItemDto[]>([]);
const jobs = ref<TextToImageJobDto[]>([]);
const loading = ref(false);
const error = ref("");
const selectedAsset = ref<TextToImageAssetListItemDto | null>(null);
const statusFilter = ref<TextToImageJobStatus | "all">("all");
const order = ref<"newest" | "oldest">("newest");

const imageCountLabel = computed(() => `${assets.value.length} 张图片 · ${jobs.value.length} 个任务`);
const displayedAssets = computed(() => order.value === "newest" ? assets.value : [...assets.value].reverse());
const jobsWithoutAssets = computed(() => {
    const assetJobIds = new Set(assets.value.map((asset) => asset.jobId));
    const pending = jobs.value.filter((job) => !assetJobIds.has(job.id));
    return order.value === "newest" ? pending : [...pending].reverse();
});
const statusOptions: SelectOption[] = [
    {value: "all", label: "全部状态"},
    {value: "queued", label: "排队中"},
    {value: "running", label: "生成中"},
    {value: "completing", label: "完成处理中"},
    {value: "succeeded", label: "已完成"},
    {value: "failed", label: "失败"},
    {value: "canceled", label: "已取消"},
    {value: "interrupted", label: "已中断"},
    {value: "configuration_stale", label: "配置过期"},
    {value: "outcome_unknown", label: "结果未知"},
];
const orderOptions: SelectOption[] = [
    {value: "newest", label: "最新优先"},
    {value: "oldest", label: "最早优先"},
];

async function load(): Promise<void> {
    if (!props.projectPath || loading.value) {
        return;
    }
    loading.value = true;
    error.value = "";
    try {
        const status = statusFilter.value === "all" ? undefined : statusFilter.value;
        const [assetResponse, jobResponse] = await Promise.all([
            $fetch<TextToImageAssetPageDto>("/api/text-to-image/assets", {
                query: {projectPath: props.projectPath, status, pageSize: 60},
            }),
            $fetch<TextToImageJobPageDto>("/api/text-to-image/jobs", {
                query: {projectPath: props.projectPath, status, pageSize: 60},
            }),
        ]);
        assets.value = assetResponse.items;
        jobs.value = jobResponse.items;
    } catch (loadError) {
        error.value = resolveApiErrorMessage(loadError, "读取历史图片失败");
    } finally {
        loading.value = false;
    }
}

function imageUrl(asset: TextToImageAssetListItemDto): string {
    return `/api/text-to-image/assets/${encodeURIComponent(asset.id)}/content?projectPath=${encodeURIComponent(props.projectPath)}`;
}

function formatTime(value: string): string {
    return new Date(value).toLocaleString();
}

function updateSelectedAssetDialog(visible: boolean): void {
    if (!visible) {
        selectedAsset.value = null;
    }
}

function formatJobStatus(status: TextToImageJobStatus): string {
    const labels: Record<TextToImageJobStatus, string> = {
        queued: "排队中",
        running: "生成中",
        completing: "完成处理中",
        succeeded: "已完成",
        failed: "失败",
        canceled: "已取消",
        interrupted: "已中断",
        configuration_stale: "配置过期",
        outcome_unknown: "结果未知",
    };
    return labels[status];
}

watch(() => props.projectPath, () => {
    assets.value = [];
    void load();
}, {immediate: true});

onMounted(() => void load());
</script>

<template>
    <section class="flex h-full min-h-0 flex-col bg-[var(--bg-main)]">
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-2.5">
            <div class="min-w-0">
                <h2 class="truncate text-[14px] font-semibold text-[var(--text-main)]">历史图片</h2>
                <p class="truncate text-[11px] text-[var(--text-muted)]">{{ imageCountLabel }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
                <div class="w-24"><FormSelect v-model="statusFilter" :options="statusOptions" size="sm" dropdown-direction="down" @update:model-value="void load()" /></div>
                <div class="w-24"><FormSelect v-model="order" :options="orderOptions" size="sm" dropdown-direction="down" /></div>
                <IconButton title="刷新历史图片" size="sm" :disabled="loading" @click="void load()">
                    <span class="i-lucide-refresh-cw h-4 w-4" :class="loading ? 'animate-spin' : ''"></span>
                </IconButton>
            </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
            <p v-if="error" class="text-[12px] text-[var(--danger-text)]">{{ error }}</p>
            <div v-else-if="loading && assets.length === 0" class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                <div v-for="index in 8" :key="index" class="aspect-[3/4] animate-pulse bg-[var(--bg-input)]"></div>
            </div>
            <div v-else-if="assets.length === 0 && jobsWithoutAssets.length === 0" class="flex h-full min-h-48 items-center justify-center text-[12px] text-[var(--text-muted)]">暂无匹配的文生图记录</div>
            <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                <button v-for="asset in displayedAssets" :key="asset.id" type="button" class="overflow-hidden border border-[var(--border-color)] bg-[var(--bg-panel)] text-left transition-colors hover:bg-[var(--bg-hover)]" @click="selectedAsset = asset">
                    <img :src="imageUrl(asset)" :alt="asset.fileName" class="aspect-[3/4] w-full bg-[var(--bg-input)] object-contain">
                    <span class="block space-y-1 border-t border-[var(--border-color)] p-2">
                        <span class="block truncate text-[11px] font-medium text-[var(--text-main)]">{{ asset.model }}</span>
                        <span class="block truncate text-[10px] text-[var(--text-muted)]">seed {{ asset.seed }} · {{ asset.width }}x{{ asset.height }}</span>
                        <span class="block truncate text-[10px] text-[var(--text-muted)]">{{ formatTime(asset.createdAt) }}</span>
                    </span>
                </button>
                <div v-for="job in jobsWithoutAssets" :key="job.id" class="aspect-[3/4] border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 text-[11px] text-[var(--text-secondary)]">
                    <span class="mb-3 block h-5 w-5" :class="job.status === 'running' || job.status === 'completing' ? 'i-lucide-loader-2 animate-spin text-[var(--status-info)]' : job.status === 'failed' || job.status === 'outcome_unknown' ? 'i-lucide-circle-help text-[var(--status-danger)]' : 'i-lucide-clock-3 text-[var(--status-warning)]'"></span>
                    <span class="block font-medium text-[var(--text-main)]">{{ formatJobStatus(job.status) }}</span>
                    <span class="mt-1 block truncate">{{ job.kind }}</span>
                    <span class="mt-2 block line-clamp-3 text-[10px] text-[var(--text-muted)]">{{ job.errorMessage || '等待服务端处理' }}</span>
                    <span class="mt-2 block text-[10px] text-[var(--text-muted)]">{{ formatTime(job.createdAt) }}</span>
                </div>
            </div>
        </div>
        <TextToImageAssetDetailDialog
            :model-value="selectedAsset !== null"
            :project-path="props.projectPath"
            :asset="selectedAsset"
            @update:model-value="updateSelectedAssetDialog"
            @changed="void load()"
        />
    </section>
</template>
