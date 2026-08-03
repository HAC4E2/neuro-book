<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

type AssetPage = {
    items: TextToImageAssetDto[];
    page: number;
    pageSize: number;
    hasMore: boolean;
};

const projectPath = ref("workspace/demo");
const page = ref(1);
const pageSize = ref(24);
const assets = ref<TextToImageAssetDto[]>([]);
const hasMore = ref(false);
const error = ref("");
const loading = ref(false);

onMounted(() => {
    void load();
});

async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
        const result = await $fetch<AssetPage>("/api/text-to-image/assets", {
            query: {
                projectPath: projectPath.value,
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
    return `/api/text-to-image/assets/${asset.id}/content?projectPath=${encodeURIComponent(projectPath.value)}`;
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="flex items-center gap-2">
            <input v-model="projectPath" class="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]" placeholder="workspace/demo" />
            <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)]" @click="page = 1; load()">加载</button>
        </div>
        <div v-if="assets.length > 0" class="grid grid-cols-3 gap-3">
            <div v-for="asset in assets" :key="asset.id" class="overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
                <img :src="assetUrl(asset)" class="h-32 w-full object-cover" :alt="asset.fileName" />
                <div class="p-2">
                    <p class="truncate text-[11px] text-[var(--text-muted)]">{{ asset.fileName }}</p>
                    <p class="truncate text-[11px] text-[var(--text-muted)]">{{ asset.width }}x{{ asset.height }} · seed {{ asset.seed }}</p>
                </div>
            </div>
        </div>
        <p v-else-if="!loading" class="text-[12px] text-[var(--text-muted)]">暂无历史图片</p>
        <div class="flex items-center gap-2">
            <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="page <= 1" @click="page -= 1; load()">上一页</button>
            <span class="text-[12px] text-[var(--text-muted)]">第 {{ page }} 页</span>
            <button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" :disabled="!hasMore" @click="page += 1; load()">下一页</button>
        </div>
        <p v-if="error" class="text-[12px] text-[var(--danger-text)]">{{ error }}</p>
    </div>
</template>
