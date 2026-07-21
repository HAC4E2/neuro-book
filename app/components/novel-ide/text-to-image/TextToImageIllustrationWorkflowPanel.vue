<script setup lang="ts">
import {computed, onUnmounted, ref, watch} from "vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorCode, resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    buildIllustrationBatchGenerateBody,
    formatIllustrationPreviewSummary,
} from "nbook/app/utils/illustration-execution-ui";
import {IllustrationExecutionRegistrationReceiptSchema} from "nbook/shared/text-to-image-execution";
import {
    IllustrationExecutionPreviewSchema,
    IllustrationPlaceholderStatusSchema,
    type IllustrationExecutionPreview,
} from "nbook/shared/text-to-image-execution-ui";
import type {IllustrationPlanningWorkflowDto} from "nbook/shared/text-to-image-illustration-workflow";

const props = defineProps<{projectPath: string}>();

const workflows = ref<IllustrationPlanningWorkflowDto[]>([]);
const loading = ref(false);
const error = ref("");
const expandedId = ref<string | null>(null);
const actionIds = ref<Set<string>>(new Set());
const notification = useNotification();
const dialog = useDialog();
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const activeCount = computed(() => workflows.value.filter((workflow) => ["queued", "running", "validating", "applying"].includes(workflow.status)).length);

watch(() => props.projectPath, () => {
    workflows.value = [];
    expandedId.value = null;
    void loadWorkflows();
}, {immediate: true});

onUnmounted(() => {
    if (pollTimer) clearTimeout(pollTimer);
});

/** 只读取 Project SQLite 中的 plan-only 投影；不会启动 Agent 或写入章节。 */
async function loadWorkflows(): Promise<void> {
    if (!props.projectPath || loading.value) return;
    loading.value = true;
    error.value = "";
    try {
        workflows.value = await $fetch<IllustrationPlanningWorkflowDto[]>("/api/text-to-image/illustration-workflows", {
            query: {projectPath: props.projectPath},
        });
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "读取插图规划 Workflow 失败");
    } finally {
        loading.value = false;
        schedulePoll();
    }
}

/** 仅在存在非终态 Workflow 时轮询服务端状态。 */
function schedulePoll(): void {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (activeCount.value === 0) return;
    pollTimer = setTimeout(() => void loadWorkflows(), 1800);
}

/** 展开/收起单条只读 Shot Intent preview。 */
function toggleExpanded(workflowId: string): void {
    expandedId.value = expandedId.value === workflowId ? null : workflowId;
}

/** 单条 action 的忙碌状态互相隔离，避免取消一个章节时锁住其它 Workflow。 */
function setActionBusy(workflowId: string, busy: boolean): void {
    const next = new Set(actionIds.value);
    if (busy) next.add(workflowId);
    else next.delete(workflowId);
    actionIds.value = next;
}

/** 取消只改变目标 Workflow，并通过全局通知返回跨入口可见结果。 */
async function cancelWorkflow(workflowId: string): Promise<void> {
    if (!await dialog.confirm("确定取消这条插图规划吗？其它章节的规划不会受影响。", "取消插图规划")) return;
    setActionBusy(workflowId, true);
    try {
        await $fetch(`/api/text-to-image/illustration-workflows/${workflowId}/cancel`, {
            method: "POST",
            body: {projectPath: props.projectPath},
        });
        notification.success("插图规划已取消");
        await loadWorkflows();
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "取消插图规划失败"), {title: "取消失败"});
    } finally {
        setActionBusy(workflowId, false);
    }
}

/** 对相同 request 显式创建新 Attempt；服务端会在输入漂移时拒绝并标记 stale。 */
async function retryWorkflow(workflowId: string): Promise<void> {
    setActionBusy(workflowId, true);
    try {
        await $fetch(`/api/text-to-image/illustration-workflows/${workflowId}/retry`, {
            method: "POST",
            body: {projectPath: props.projectPath},
        });
        notification.success("插图规划已重新排队");
        await loadWorkflows();
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "重试插图规划失败"), {title: "重试失败"});
        await loadWorkflows();
    } finally {
        setActionBusy(workflowId, false);
    }
}

/** 收集 revision 原因；nonce、当前事实与新 request hash 全部由服务端生成。 */
async function replanWorkflow(workflowId: string): Promise<void> {
    const reason = (await dialog.prompt("请输入重新规划原因。它会成为新 revision 的审计信息。", "", "重新规划插图"))?.trim();
    if (!reason) return;
    setActionBusy(workflowId, true);
    try {
        const replanned = await $fetch<IllustrationPlanningWorkflowDto>(`/api/text-to-image/illustration-workflows/${workflowId}/replan`, {
            method: "POST",
            body: {projectPath: props.projectPath, reason},
        });
        expandedId.value = replanned.id;
        notification.success("新的插图规划 revision 已创建");
        await loadWorkflows();
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "重新规划失败"), {title: "重新规划失败"});
    } finally {
        setActionBusy(workflowId, false);
    }
}

/**
 * 对一个已发布 Workflow 的 ready placeholders 做一次 batch Preview 和一次确认。
 * placeholder IDs 只来自 completed Planning Apply Journal 的公开 DTO。
 */
async function generateWorkflowBatch(workflow: IllustrationPlanningWorkflowDto): Promise<void> {
    if (workflow.publishedPlaceholderIds.length === 0) return;
    setActionBusy(workflow.id, true);
    try {
        const statuses = await Promise.all(workflow.publishedPlaceholderIds.map(async (placeholderId) => IllustrationPlaceholderStatusSchema.parse(
            await $fetch<unknown>(`/api/text-to-image/prompt-placeholders/${encodeURIComponent(placeholderId)}/status`, {
                query: {projectPath: props.projectPath},
            }),
        )));
        const readyPlaceholderIds = statuses.filter((status) => status.status === "ready").map((status) => status.placeholderId);
        if (readyPlaceholderIds.length === 0) {
            notification.warning("该 Workflow 没有可生成的 ready 插图；请先处理过期或已排队项。", {title: "生成全部"});
            return;
        }
        if (readyPlaceholderIds.length !== workflow.publishedPlaceholderIds.length) {
            notification.info(`将只生成 ${readyPlaceholderIds.length} 个 ready 插图，其余已排队、运行或过期。`, {title: "生成全部"});
        }
        const preview = await fetchBatchPreview(readyPlaceholderIds);
        if (!await confirmBatchPreview(preview)) return;
        try {
            await authorizeBatch(readyPlaceholderIds, preview);
        } catch (caught) {
            const code = resolveApiErrorCode(caught);
            if (code !== "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED" && code !== "ILLUSTRATION_PREVIEW_TOKEN_EXPIRED") throw caught;
            const refreshed = await fetchBatchPreview(readyPlaceholderIds);
            if (!await confirmBatchPreview(refreshed, "批量请求已变化，请确认新的 Manifest")) return;
            await authorizeBatch(readyPlaceholderIds, refreshed);
        }
        notification.success(`${readyPlaceholderIds.length} 个图片任务已原子注册并排队`, {title: "生成全部"});
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "批量注册图片任务失败"), {title: "生成全部失败"});
    } finally {
        setActionBusy(workflow.id, false);
    }
}

/** Batch Preview 是只读语义 POST，请求体只有 Project 与已发布 placeholder IDs。 */
async function fetchBatchPreview(placeholderIds: string[]): Promise<IllustrationExecutionPreview> {
    return IllustrationExecutionPreviewSchema.parse(await $fetch<unknown>("/api/text-to-image/prompt-placeholders/execution-preview-batch", {
        method: "POST",
        body: {projectPath: props.projectPath, placeholderIds},
    }));
}

/** 每个实际展示的 batch Manifest 只对应一次明确确认。 */
async function confirmBatchPreview(preview: IllustrationExecutionPreview, title = "确认批量生成"): Promise<boolean> {
    const warnings = preview.warnings.length > 0 ? `\n警告：${preview.warnings.join("；")}` : "";
    return await dialog.confirm(
        `${formatIllustrationPreviewSummary(preview)}\nManifest：${preview.manifestHash.slice(0, 22)}…${warnings}`,
        title,
    );
}

/** 授权 body 只能由已展示 Preview 构建，不允许页面补写 Provider/Recipe/seed。 */
async function authorizeBatch(placeholderIds: string[], preview: IllustrationExecutionPreview): Promise<void> {
    IllustrationExecutionRegistrationReceiptSchema.parse(await $fetch<unknown>("/api/text-to-image/prompt-placeholders/generate-batch", {
        method: "POST",
        body: buildIllustrationBatchGenerateBody(props.projectPath, placeholderIds, preview),
    }));
}

/** 非终态可取消；retry 只由服务端标记 retryable 的 failed/canceled 开放。 */
function canCancel(workflow: IllustrationPlanningWorkflowDto): boolean {
    return ["queued", "running", "validating", "applying"].includes(workflow.status);
}

/** 重新规划创建新 request，只在旧 Workflow 已终结时开放。 */
function canReplan(workflow: IllustrationPlanningWorkflowDto): boolean {
    return ["ready", "failed", "canceled", "stale"].includes(workflow.status);
}

/** Workflow 状态使用固定中文投影。 */
function statusLabel(status: IllustrationPlanningWorkflowDto["status"]): string {
    return {
        queued: "排队中",
        running: "Director 规划中",
        validating: "严格校验中",
        applying: "发布中",
        ready: "预览就绪",
        failed: "失败",
        canceled: "已取消",
        stale: "已过期",
    }[status];
}

/** 状态色只映射已登记的主题语义变量。 */
function statusClass(status: IllustrationPlanningWorkflowDto["status"]): string {
    if (status === "ready") return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
    if (status === "failed") return "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
    if (status === "canceled" || status === "stale" || status === "queued") return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
    return "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]";
}

/** ISO 时间仅用于 UI 展示。 */
function formatTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<template>
    <!-- 插图规划 Workflow：只读 Project SQLite 状态与 Shot Intent preview -->
    <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
        <div class="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-3 py-2.5">
            <div class="min-w-0">
                <h3 class="m-0 truncate text-[12px] font-medium text-[var(--text-main)]">插图规划 Workflow</h3>
                <p class="m-0 mt-0.5 text-[10px] text-[var(--text-muted)]">管理持久规划状态并只读预览 Director 结果；本区不保存 LLM、NovelAI、Recipe 或生成参数。</p>
            </div>
            <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="loading" @click="void loadWorkflows()">
                <span class="h-3 w-3" :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'"></span>
                刷新
            </button>
        </div>

        <!-- Workflow 列表与局部错误 -->
        <div class="space-y-2 p-3">
            <p v-if="error" class="m-0 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">{{ error }}</p>
            <div v-if="!loading && workflows.length === 0" class="rounded-md border border-dashed border-[var(--border-color)] px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">尚无插图规划。请从已保存正文的章节或选区入口发起规划。</div>

            <article v-for="workflow in workflows" :key="workflow.id" class="overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
                <button type="button" class="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-hover)]" @click="toggleExpanded(workflow.id)">
                    <span class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="expandedId === workflow.id ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"></span>
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-[11px] font-medium text-[var(--text-main)]">{{ workflow.chapterPath }}</span>
                        <span class="mt-0.5 block text-[10px] text-[var(--text-muted)]">{{ workflow.operation === "plan-chapter" ? "整章规划" : "选区单图" }} · {{ formatTime(workflow.updatedAt) }}</span>
                    </span>
                    <span v-if="workflow.queuePosition" class="text-[10px] text-[var(--text-muted)]">#{{ workflow.queuePosition }}</span>
                    <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="statusClass(workflow.status)">{{ statusLabel(workflow.status) }}</span>
                </button>

                <!-- 单条 Workflow 的严格 preview，不显示输入全文与 evidence -->
                <div v-if="expandedId === workflow.id" class="space-y-2 border-t border-[var(--border-color)] px-3 py-3">
                    <div class="grid gap-1 text-[10px] text-[var(--text-muted)] sm:grid-cols-2">
                        <div>Request：<code>{{ workflow.planningRequestHash.slice(0, 22) }}…</code></div>
                        <div>Input：<code>{{ workflow.planningInputHash.slice(0, 22) }}…</code></div>
                    </div>
                    <p v-if="workflow.errorMessage" class="m-0 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-1.5 text-[10px] text-[var(--status-danger)]"><strong>{{ workflow.errorCode }}</strong>：{{ workflow.errorMessage }}</p>
                    <p v-if="workflow.staleReason" class="m-0 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1.5 text-[10px] text-[var(--status-warning)]">失效原因：{{ workflow.staleReason }}</p>

                    <!-- Workflow 显式状态操作：不包含任何模型、Recipe 或 NovelAI 参数写入口 -->
                    <div v-if="canCancel(workflow) || workflow.retryable || canReplan(workflow) || (workflow.status === 'ready' && workflow.publishedPlaceholderIds.length > 0)" class="flex flex-wrap items-center gap-2">
                        <button v-if="workflow.status === 'ready' && workflow.publishedPlaceholderIds.length > 0" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--accent-main)] bg-[var(--accent-bg)] px-2 text-[10px] text-[var(--accent-text)] hover:opacity-80 disabled:opacity-50" :disabled="actionIds.has(workflow.id)" @click="void generateWorkflowBatch(workflow)">
                            <span class="h-3 w-3" :class="actionIds.has(workflow.id) ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-images'"></span>
                            生成全部（{{ workflow.publishedPlaceholderIds.length }}）
                        </button>
                        <button v-if="canCancel(workflow)" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 text-[10px] text-[var(--status-danger)] hover:opacity-80 disabled:opacity-50" :disabled="actionIds.has(workflow.id)" @click="void cancelWorkflow(workflow.id)">
                            <span class="h-3 w-3" :class="actionIds.has(workflow.id) ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-square'"></span>
                            取消
                        </button>
                        <button v-if="workflow.retryable && (workflow.status === 'failed' || workflow.status === 'canceled')" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="actionIds.has(workflow.id)" @click="void retryWorkflow(workflow.id)">
                            <span class="h-3 w-3" :class="actionIds.has(workflow.id) ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-rotate-ccw'"></span>
                            重试同一请求
                        </button>
                        <button v-if="canReplan(workflow)" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--accent-main)] bg-[var(--accent-bg)] px-2 text-[10px] text-[var(--accent-text)] hover:opacity-80 disabled:opacity-50" :disabled="actionIds.has(workflow.id)" @click="void replanWorkflow(workflow.id)">
                            <span class="h-3 w-3" :class="actionIds.has(workflow.id) ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-git-branch-plus'"></span>
                            重新规划
                        </button>
                    </div>

                    <div v-if="workflow.validatedPlan" class="space-y-2">
                        <div v-for="(shot, index) in workflow.validatedPlan.shots" :key="shot.shotIntentHash" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/55 px-3 py-2">
                            <div class="flex items-start justify-between gap-3">
                                <div class="text-[11px] font-medium text-[var(--text-main)]">镜头 {{ index + 1 }} · {{ shot.purpose }}</div>
                                <code class="shrink-0 text-[9px] text-[var(--text-muted)]">{{ shot.anchorId }}</code>
                            </div>
                            <div class="mt-1 text-[10px] text-[var(--text-secondary)]">{{ shot.composition.shotSize }} / {{ shot.composition.cameraAngle }} / {{ shot.composition.viewpoint }} / {{ shot.composition.canvasIntent }}</div>
                            <div class="mt-1 text-[10px] text-[var(--text-muted)]">角色 {{ shot.characterIds.length }} · 服装 {{ shot.outfitRefs.length }} · Pattern {{ shot.tagPatternRefs.length }}</div>
                        </div>
                    </div>
                    <div v-else class="text-[10px] text-[var(--text-muted)]">当前尚无通过严格校验的 Shot Intent preview。</div>
                </div>
            </article>
        </div>
    </section>
</template>
