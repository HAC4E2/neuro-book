<script setup lang="ts">
/**
 * 后台任务中心浮窗（Task 111 PLAN-F）：
 * 非模态 DialogWindow 壳 + 工具条（过滤 chips / 清除已结束 / 刷新）+ 分组列表（进行中置顶）。
 * 数据来自 useAgentJobsFeed 共享单例（与 Header 徽标同源）；面板开合驱动 feed 变频。
 */
import DialogWindow from "nbook/app/components/common/DialogWindow.vue";
import AgentJobRow from "nbook/app/components/novel-ide/jobs/AgentJobRow.vue";
import {useAgentJobsFeed} from "nbook/app/composables/useAgentJobsFeed";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {AgentJobSnapshot} from "nbook/server/agent/jobs/agent-job-manager";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const feed = useAgentJobsFeed();
const {jobs, loaded, error: feedError} = feed;
const notification = useNotification();
const {t} = useI18n();

type JobsFilter = "all" | "active" | "done";
const filter = ref<JobsFilter>("all");
const clearing = ref(false);

const isActiveJob = (job: AgentJobSnapshot): boolean => job.status === "running" || job.status === "waiting";

/** 进行中置顶（feed 已按 createdAt 倒序）；已结束按 endedAt 倒序 */
const activeJobs = computed(() => jobs.value.filter(isActiveJob));
const finishedJobs = computed(() => jobs.value
    .filter((job) => !isActiveJob(job))
    .slice()
    .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt)));

const filters = computed<Array<{key: JobsFilter; label: string; count: number}>>(() => [
    {key: "all", label: t("ide.agentJobs.filterAll"), count: jobs.value.length},
    {key: "active", label: t("ide.agentJobs.filterActive"), count: activeJobs.value.length},
    {key: "done", label: t("ide.agentJobs.filterDone"), count: finishedJobs.value.length},
]);

const sections = computed<Array<{key: string; label: string; jobs: AgentJobSnapshot[]}>>(() => {
    const out: Array<{key: string; label: string; jobs: AgentJobSnapshot[]}> = [];
    if (filter.value !== "done" && activeJobs.value.length > 0) {
        out.push({key: "active", label: t("ide.agentJobs.groupActive"), jobs: activeJobs.value});
    }
    if (filter.value !== "active" && finishedJobs.value.length > 0) {
        out.push({key: "finished", label: t("ide.agentJobs.groupFinished"), jobs: finishedJobs.value});
    }
    return out;
});

async function clearFinished(): Promise<void> {
    if (clearing.value || finishedJobs.value.length === 0) return;
    clearing.value = true;
    try {
        const removed = await feed.clearFinished();
        notification.success(t("ide.agentJobs.clearFinishedDone", {count: removed}));
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, t("ide.agentJobs.clearFailed")));
    } finally {
        clearing.value = false;
    }
}

// 面板开合驱动共享 feed 变频（开=快轮询，关=慢轮询喂徽标）
watch(() => props.modelValue, (open) => {
    feed.setPanelOpen(open);
});
</script>

<template>
    <!-- 后台任务中心浮窗（非模态，可拖动） -->
    <DialogWindow :model-value="props.modelValue" :title="t('ide.agentJobs.title')" :width="680" height="min(640px, calc(100vh - 88px))" body-class="overflow-hidden !p-0" @update:model-value="emit('update:modelValue', $event)">
        <!-- 工具条：过滤 chips + 清除已结束 + 刷新 -->
        <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border-color)] px-3 py-2">
            <button
                v-for="item in filters"
                :key="item.key"
                type="button"
                class="rounded-full border px-2.5 py-0.5 text-[11px] transition-colors"
                :class="filter === item.key ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                @click="filter = item.key"
            >{{ item.label }} {{ item.count }}</button>
            <span class="flex-1"></span>
            <button type="button" class="flex items-center gap-1 rounded border border-[var(--border-color)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="clearing || finishedJobs.length === 0" @click="void clearFinished()">
                <span class="i-lucide-paintbrush h-3.5 w-3.5"></span>
                <span>{{ t("ide.agentJobs.clearFinished") }}</span>
            </button>
            <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('ide.agentJobs.refresh')" @click="feed.refresh()">
                <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
            </button>
        </div>

        <!-- 轮询失败提示条（可恢复；轮询不停，成功自动消失） -->
        <p v-if="feedError" class="mx-3 mt-2 shrink-0 rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-1.5 text-[12px] text-[var(--status-danger)]">{{ feedError }}</p>

        <!-- 任务列表（进行中置顶分组） -->
        <div class="min-h-0 flex-1 overflow-y-auto">
            <div v-if="!loaded" class="flex items-center justify-center py-10 text-[var(--text-muted)]">
                <span class="i-lucide-loader-2 h-5 w-5 animate-spin"></span>
            </div>
            <div v-else-if="sections.length === 0" class="flex flex-col items-center gap-1 px-6 py-10 text-center">
                <p class="text-sm text-[var(--text-secondary)]">{{ t("ide.agentJobs.empty") }}</p>
                <p class="text-[12px] text-[var(--text-muted)]">{{ t("ide.agentJobs.emptyHint") }}</p>
            </div>
            <template v-else>
                <section v-for="section in sections" :key="section.key">
                    <h3 class="sticky top-0 z-10 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-1.5 text-[11px] tracking-wider text-[var(--text-muted)]">{{ section.label }}（{{ section.jobs.length }}）</h3>
                    <AgentJobRow v-for="job in section.jobs" :key="job.jobId" :job="job" @cancelled="feed.refresh()" />
                </section>
            </template>
        </div>
    </DialogWindow>
</template>
