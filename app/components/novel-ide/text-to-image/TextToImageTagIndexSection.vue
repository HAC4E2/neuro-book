<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from "vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    TagIndexOperation,
    TagIndexSearchResponse,
    TagIndexStatus,
} from "nbook/shared/text-to-image-tag-index";

type TextToImageTagInsertTarget = {
    value: string;
    label: string;
    description?: string;
    iconClass?: string;
};

const props = withDefaults(defineProps<{
    targets?: TextToImageTagInsertTarget[];
    selectedTarget?: string;
}>(), {
    targets: () => [],
    selectedTarget: "",
});

const emit = defineEmits<{
    (event: "insert", tag: string): void;
    (event: "update:selectedTarget", value: string): void;
}>();

const notification = useNotification();
const status = ref<TagIndexStatus | null>(null);
const statusLoading = ref(false);
const starting = ref(false);
const canceling = ref(false);
const searchQuery = ref("");
const searching = ref(false);
const searchResults = ref<TagIndexSearchResponse["candidates"]>([]);
const error = ref("");
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const targetOptions = computed<SelectOption[]>(() => props.targets.map((target) => ({
    value: target.value,
    label: target.label,
    description: target.description,
    iconClass: target.iconClass ?? "i-lucide-text-cursor-input",
})));
const selectedTargetValue = computed(() => props.selectedTarget || props.targets[0]?.value || "");
const operationRunning = computed(() => status.value?.operation
    ? !["active", "failed", "canceled"].includes(status.value.operation.state)
    : false);
const canSearch = computed(() => Boolean(status.value?.active));

onMounted(() => {
    void loadStatus();
});

onUnmounted(() => {
    if (pollTimer) clearTimeout(pollTimer);
});

/** 只轮询 NeuroBook 本地状态端点；打开本节不会触发任何网络请求。 */
async function loadStatus(): Promise<void> {
    if (statusLoading.value) return;
    statusLoading.value = true;
    error.value = "";
    try {
        status.value = await $fetch<TagIndexStatus>("/api/text-to-image/tag-index");
        schedulePoll();
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "读取本地 Tag 词库状态失败");
    } finally {
        statusLoading.value = false;
    }
}

/** 只有 operation 非终态时才继续轮询本地 checkpoint。 */
function schedulePoll(): void {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (!operationRunning.value) return;
    pollTimer = setTimeout(() => void loadStatus(), 1500);
}

/**
 * 手动触发本地词库重新导入。请求体沿用固定条款确认结构（confirmed/version/hash 均取自 status 响应）；
 * 数据源已是随应用打包的本地文件，不再需要用户逐次勾选条款确认，这里直接透传服务端返回的当前版本与 hash。
 */
async function startSync(): Promise<void> {
    if (!status.value || starting.value) return;
    starting.value = true;
    error.value = "";
    try {
        await $fetch<TagIndexOperation>("/api/text-to-image/tag-index/sync", {
            method: "POST",
            body: {
                confirmed: true,
                termsConfirmationVersion: status.value.terms.confirmationVersion,
                termsContentHash: status.value.terms.contentHash,
            },
        });
        notification.info("本地词库导入已启动");
        await loadStatus();
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "启动本地词库导入失败");
    } finally {
        starting.value = false;
    }
}

/** 请求取消当前 operation；旧 active 索引不受影响。 */
async function cancelSync(): Promise<void> {
    const operationId = status.value?.operation?.operationId;
    if (!operationId || canceling.value) return;
    canceling.value = true;
    error.value = "";
    try {
        await $fetch(`/api/text-to-image/tag-index/sync/${encodeURIComponent(operationId)}/cancel`, {method: "POST"});
        notification.info("已请求取消词库导入");
        await loadStatus();
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "取消词库导入失败");
    } finally {
        canceling.value = false;
    }
}

/** 只查询 active SQLite；查询不会改变索引或 Project 配置。 */
async function runSearch(): Promise<void> {
    const query = searchQuery.value.trim();
    if (!query || !canSearch.value || searching.value) return;
    searching.value = true;
    error.value = "";
    try {
        const result = await $fetch<TagIndexSearchResponse>("/api/text-to-image/tag-index/search", {
            query: {query, limit: 20},
        });
        searchResults.value = result.candidates;
    } catch (caught) {
        searchResults.value = [];
        error.value = resolveApiErrorMessage(caught, "搜索 active 词库失败");
    } finally {
        searching.value = false;
    }
}

/** 将 canonical Tag 插入用户当前选择的文生图文本字段。 */
function insertTag(tag: string): void {
    if (!selectedTargetValue.value) {
        notification.warning("没有可插入的文生图字段");
        return;
    }
    emit("insert", tag);
}

/** operation 状态使用固定用户文案。 */
function operationLabel(operation: TagIndexOperation): string {
    const labels: Record<TagIndexOperation["state"], string> = {
        fetching: "读取本地分页",
        source_verified: "本地来源校验完成",
        normalizing: "规范化与关系闭包",
        indexing: "构建分层索引",
        validating: "校验 SQLite / FTS",
        ready: "等待原子激活",
        active: "已激活",
        failed: "失败",
        canceled: "已取消",
    };
    return labels[operation.state];
}

/** ISO 时间只用于只读展示。 */
function formatTime(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
</script>

<template>
    <!-- 本地 TTP 词库（Danbooru 衍生数据）状态：服务端唯一真相源，应用启动时自动后台导入，此处仅查看状态与手动重导 -->
    <div class="space-y-3">
        <p class="m-0 text-[10px] text-[var(--text-muted)]">应用启动时会自动在后台导入本地词库；此处仅用于查看状态与手动重新导入。</p>
        <p v-if="error" class="m-0 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">{{ error }}</p>

        <div v-if="status?.active" class="space-y-2 rounded-md border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div class="text-[11px] font-semibold text-[var(--status-success)]">Active：{{ status.active.indexVersion }}</div>
                    <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">快照 {{ status.active.snapshotDate }} · 激活 {{ formatTime(status.active.activatedAt) }}</div>
                </div>
                <span class="rounded-full border border-[var(--status-success-border)] px-2 py-0.5 text-[10px] text-[var(--status-success)]">可查询</span>
            </div>
            <div class="grid gap-2 text-[10px] text-[var(--text-secondary)] sm:grid-cols-2 lg:grid-cols-4">
                <div>主 Tag：{{ status.active.counts.mainTags }}</div>
                <div>Core / High：{{ status.active.tiers.core.count }} / {{ status.active.tiers.high.count }}</div>
                <div>Common / Tail：{{ status.active.tiers.common.count }} / {{ status.active.tiers.tail.count }}</div>
                <div>FTS：{{ status.active.validation.ftsRowCount }}</div>
            </div>
            <div class="text-[10px] text-[var(--text-muted)]">watermark：Tag {{ status.active.watermarks.tags }} · Alias / Implication：源不提供</div>
        </div>
        <div v-else class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-3 text-[11px] text-[var(--status-warning)]">尚无 active 本地词库索引；通常由应用启动自动导入完成，如长时间未就绪可在下方手动重导。</div>

        <!-- 当前导入 operation -->
        <div v-if="status?.operation" class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-[11px] font-medium text-[var(--text-main)]">{{ operationLabel(status.operation) }}</div>
                <code class="text-[10px] text-[var(--text-muted)]">{{ status.operation.operationId }}</code>
            </div>
            <div class="text-[10px] text-[var(--text-muted)]">已持久化 {{ status.progress?.pageCount ?? 0 }} 页 / {{ status.progress?.recordCount ?? 0 }} 条记录 · {{ formatTime(status.operation.updatedAt) }}</div>
            <div v-if="status.operation.source.watermarks" class="text-[10px] text-[var(--text-secondary)]">当前 {{ status.operation.source.pass }} / {{ status.operation.source.resource }} · cursor {{ status.operation.source.cursors[status.operation.source.pass][status.operation.source.resource] }}</div>
            <div v-if="status.operation.retry" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1.5 text-[10px] text-[var(--status-warning)]">{{ status.operation.retry.reason }} 第 {{ status.operation.retry.attempt }} 次退避，预计 {{ formatTime(status.operation.retry.retryAt) }} 重试</div>
            <div v-if="status.operation.error" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-1.5 text-[10px] text-[var(--status-danger)]"><strong>{{ status.operation.error.code }}</strong>：{{ status.operation.error.message }}</div>
            <div v-if="status.oldActiveContinuing" class="text-[10px] text-[var(--status-info)]">重建期间旧 active 版本继续提供查询与 Resolver 服务。</div>
            <div v-if="operationRunning" class="flex justify-end">
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-[11px] text-[var(--status-danger)] disabled:opacity-50" :disabled="canceling" @click="void cancelSync()">
                    <span class="i-lucide-square h-3.5 w-3.5"></span>{{ canceling ? "取消中" : "取消导入" }}
                </button>
            </div>
        </div>

        <!-- 本地源信息与手动重导 -->
        <div v-if="status && !operationRunning" class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
            <div class="text-[11px] font-medium text-[var(--text-main)]">本地 TTP 词库（Danbooru 衍生数据）</div>
            <p class="m-0 text-[10px] leading-5 text-[var(--text-muted)]">{{ status.terms.statement }}</p>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                <a class="text-[var(--accent-main)] hover:underline" :href="status.terms.attributionUrl" target="_blank" rel="noreferrer">数据归属</a>
                <span class="text-[var(--text-muted)]">固定阈值 post_count ≥ {{ status.source.minPostCount }}</span>
            </div>
            <div class="flex justify-end gap-2">
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[11px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="statusLoading" @click="void loadStatus()"><span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="{'animate-spin': statusLoading}"></span>刷新状态</button>
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="starting" @click="void startSync()"><span class="i-lucide-database h-3.5 w-3.5"></span>{{ starting ? "导入中" : "重新导入本地词库" }}</button>
            </div>
        </div>

        <!-- Active SQLite 搜索与手动插入 -->
        <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <FormInput v-model="searchQuery" label="搜索 active canonical / alias" placeholder="例如 wide_shot" :disabled="!canSearch || searching" @keydown.enter.prevent="void runSearch()" />
                <button type="button" class="mt-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[11px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="!searchQuery.trim() || !canSearch || searching" @click="void runSearch()"><span class="i-lucide-search h-3.5 w-3.5"></span>{{ searching ? "搜索中" : "搜索" }}</button>
            </div>
            <FormSelect v-if="targetOptions.length > 0" :model-value="selectedTargetValue" label="插入到" :options="targetOptions" @update:model-value="emit('update:selectedTarget', $event)" />
            <div v-if="searchResults.length > 0" class="custom-scrollbar max-h-64 space-y-1 overflow-auto">
                <button v-for="candidate in searchResults" :key="candidate.canonical.tagId" type="button" class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]" @click="insertTag(candidate.canonical.canonicalName)">
                    <span class="min-w-0"><code class="block truncate text-[11px] text-[var(--text-main)]">{{ candidate.canonical.canonicalName }}</code><span class="text-[10px] text-[var(--text-muted)]">{{ candidate.matchClass }} · {{ candidate.category }} · {{ candidate.usageTier }}</span></span>
                    <span class="text-[10px] text-[var(--text-muted)]">{{ candidate.postCount }}</span>
                </button>
            </div>
            <p v-if="!canSearch" class="m-0 text-[10px] text-[var(--text-muted)]">active 索引就绪后可搜索；搜索结果与索引均不会写入浏览器存储。</p>
        </div>
    </div>
</template>
