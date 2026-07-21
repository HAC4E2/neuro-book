<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {
    TextToImageNovelAiInspectionDto,
    TextToImageNovelAiReconciliationRequestDto,
} from "nbook/shared/dto/text-to-image.dto";

const props = defineProps<{
    inspection: TextToImageNovelAiInspectionDto;
    busy: boolean;
    error: string;
}>();

const emit = defineEmits<{
    (event: "confirm", payload: TextToImageNovelAiReconciliationRequestDto): void;
}>();

const selectedProviderId = ref<number | null>(null);
const confirmed = ref(false);
const recoveryKeepProviderId = computed(() => props.inspection.reconciliationKeepProviderId);
const canConfirm = computed(() => !props.busy
    && selectedProviderId.value !== null
    && confirmed.value
    && props.inspection.selectionToken !== null);

watch(() => [props.inspection.selectionToken, props.inspection.reconciliationKeepProviderId] as const, () => {
    if (recoveryKeepProviderId.value !== null) {
        selectedProviderId.value = recoveryKeepProviderId.value;
    }
    if (!props.inspection.candidates.some((candidate) => candidate.id === selectedProviderId.value)) {
        selectedProviderId.value = null;
    }
    confirmed.value = false;
}, {immediate: true});

/** 切换保留候选后必须重新勾选破坏性影响确认。 */
function selectProvider(providerId: number): void {
    if (recoveryKeepProviderId.value !== null && providerId !== recoveryKeepProviderId.value) {
        return;
    }
    selectedProviderId.value = providerId;
    confirmed.value = false;
}

/** 只提交明确候选 ID 与当前服务端 selection token。 */
function confirmSelection(): void {
    const keepProviderId = selectedProviderId.value;
    const selectionToken = props.inspection.selectionToken;
    if (!canConfirm.value || keepProviderId === null || selectionToken === null) {
        return;
    }
    emit("confirm", {keepProviderId, selectionToken});
}

/** 返回候选 Provider 在旧运行链中实际使用过的图片模型证据。 */
function recipeMigrationModel(providerId: number): string {
    return props.inspection.recipeMigrationModels.find((item) => item.providerId === providerId)?.model ?? "未记录旧模型";
}

/** 候选摘要显示到秒；完整 ISO 值仍由服务端参与 selection token。 */
function formatTimestamp(value: string): string {
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}
</script>

<template>
    <!-- 一次性 Provider reconciliation：只呈现脱敏候选，不接触 credential。 -->
    <div class="space-y-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2 text-[11px] text-[var(--status-warning)]">
        <p v-if="recoveryKeepProviderId !== null" class="m-0">上次对账已写入部分 Project，系统已锁定原选择 ID {{ recoveryKeepProviderId }}。保存、测试和 worker 仍停止；请继续恢复同一决定，不能改选其他 Provider。</p>
        <p v-else class="m-0">检测到 {{ props.inspection.candidates.length }} 条旧 NovelAI Provider。保存、测试和 worker 已停止；请选择唯一要保留的账户配置，系统不会按时间或名称猜选。</p>
        <label v-for="candidate in props.inspection.candidates" :key="candidate.id" class="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 rounded-md border p-2 transition-colors" :class="[selectedProviderId === candidate.id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--status-warning-border)] bg-[var(--bg-panel)]/55', recoveryKeepProviderId === null ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : 'cursor-default']">
            <input type="radio" name="novelai-provider-reconciliation" class="mt-0.5 h-3.5 w-3.5 accent-[var(--accent-main)]" :checked="selectedProviderId === candidate.id" :disabled="recoveryKeepProviderId !== null && recoveryKeepProviderId !== candidate.id" @change="selectProvider(candidate.id)">
            <span class="min-w-0">
                <span class="flex items-center justify-between gap-2 text-[var(--text-main)]">
                    <span class="truncate font-medium">{{ candidate.name }}</span>
                    <span class="shrink-0 text-[10px] text-[var(--text-muted)]">ID {{ candidate.id }}</span>
                </span>
                <span class="mt-1 block text-[10px] text-[var(--text-secondary)]">旧模型证据：{{ recipeMigrationModel(candidate.id) }}</span>
                <span class="mt-0.5 block text-[10px] text-[var(--text-muted)]">{{ candidate.hasCredential ? "已保存 API token" : "未保存 API token" }} · 更新于 {{ formatTimestamp(candidate.updatedAt) }}</span>
            </span>
        </label>
        <label class="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--bg-panel)]/55 p-2 text-[10px] text-[var(--text-secondary)]">
            <input v-model="confirmed" type="checkbox" class="mt-0.5 h-3.5 w-3.5 accent-[var(--accent-main)]" :disabled="selectedProviderId === null">
            <span>我确认只保留所选 Provider；其余 Provider 的排队任务会标记为配置过期，在途任务会标记为结果未知且不会自动重试。</span>
        </label>
        <p v-if="props.error" class="m-0 text-[11px] text-[var(--status-danger)]">{{ props.error }}</p>
        <div class="flex justify-end">
            <button type="button" class="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="!canConfirm" @click="confirmSelection">
                <span class="h-3.5 w-3.5" :class="props.busy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-shield-check'"></span>
                {{ props.busy ? "处理中" : recoveryKeepProviderId !== null ? "继续恢复原选择" : "确认保留唯一 Provider" }}
            </button>
        </div>
    </div>
</template>
