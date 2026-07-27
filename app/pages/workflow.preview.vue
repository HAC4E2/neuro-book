<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import WorkflowMermaid from "nbook/app/components/workflow-preview/WorkflowMermaid.vue";
import WorkflowRunPanel from "nbook/app/components/workflow-preview/WorkflowRunPanel.vue";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useProjectSession} from "nbook/app/composables/useProjectSession";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {AgentJobSnapshot} from "nbook/server/agent/jobs/agent-job-manager";
import type {WorkflowDemoScenarioDto} from "nbook/server/agent/workflow/workflow-demo-service";
import type {NovelListItemDto} from "nbook/shared/dto/novel-chapter.dto";

type WorkflowCatalogItemDto = {
    key: string;
    title: string;
    description: string;
    whenToUse: string | null;
    argsHint: Array<{name: string; label: string; defaultValue: string}>;
    source: "system" | "user" | "project";
};

type WorkflowCatalogDto = {
    workflows: WorkflowCatalogItemDto[];
    models: Array<{modelKey: string; note: string}>;
};

type FormalWorkflowRun = {
    jobId: string;
    runId: string;
    workflowKey: string;
    /** 只有本页当前生命周期发起的 run 保留其显式项目；job ref 不重复持久化此字段。 */
    projectPath: string | null;
};

/**
 * Task 110/111 · 正式 Workflow Catalog 主动触发入口 + 内核演示页。
 * 正式区绑定显式 Project Workspace；原有经典 demo/真实 agent 场景保持独立，继续用于投影验证。
 */
const theme = ref<IdeTheme>("dark");
const themeHostRef = ref<HTMLElement | null>(null);
const {mountThemeHost, setTheme} = useIdeTheme(theme);
const themeOptions: Array<{value: IdeTheme; label: string}> = [
    {value: "dark", label: "暗色"},
    {value: "light", label: "浅色"},
    {value: "sepia", label: "羊皮纸"},
];

const scenarios = ref<WorkflowDemoScenarioDto[]>([]);
const argsDrafts = ref<Record<string, Record<string, string>>>({});
const runs = ref<{runId: string; scenarioKey: string; status: string}[]>([]);
const activeRun = ref<{runId: string; scenarioKey: string} | null>(null);
const pageError = ref("");
const starting = ref("");
/** Task 111 正式入口：Catalog、显式 Project Workspace 与本页启动的 run。 */
const catalogWorkflows = ref<WorkflowCatalogItemDto[]>([]);
const catalogModels = ref<WorkflowCatalogDto["models"]>([]);
const projects = ref<NovelListItemDto[]>([]);
const selectedProjectPath = ref("");
const selectedModelKey = ref("");
const formalArgsDrafts = ref<Record<string, Record<string, string>>>({});
const formalRuns = ref<FormalWorkflowRun[]>([]);
const formalActiveRun = ref<FormalWorkflowRun | null>(null);
const formalStarting = ref("");
const formalError = ref("");
const formalCatalogLoading = ref(false);
const formalEntryLoading = ref(false);
const formalLoading = computed(() => formalCatalogLoading.value || formalEntryLoading.value);
const formalProjectTarget = computed(() => selectedProjectPath.value || null);
const {status: formalProjectStatus} = useProjectSession(formalProjectTarget);
const formalProjectStatusLabel = computed(() => ({
    idle: "未选择项目",
    connecting: "正在打开项目",
    connected: "项目已就绪",
    disconnected: "项目连接中断",
})[formalProjectStatus.value]);
/** 演示速度：mock responder sleep 的倍率（只影响观感节奏，不影响 replay 语义） */
const speedFactor = ref(4);
const SPEED_OPTIONS = [
    {value: 1, label: "1× 原速"},
    {value: 4, label: "4× 演示"},
    {value: 8, label: "8× 超慢"},
];

async function loadScenarios() {
    try {
        scenarios.value = await $fetch<WorkflowDemoScenarioDto[]>("/api/agent/workflow-demo/scenarios");
        for (const scenario of scenarios.value) {
            argsDrafts.value[scenario.key] = Object.fromEntries(scenario.argsHint.map((hint) => [hint.name, hint.defaultValue]));
        }
    } catch (e) {
        pageError.value = resolveApiErrorMessage(e, "读取场景列表失败");
    }
}

async function refreshRuns() {
    try {
        runs.value = await $fetch<{runId: string; scenarioKey: string; status: string}[]>("/api/agent/workflow-demo/runs");
    } catch { /* run 列表失败不阻塞主流程 */ }
}

let formalCatalogRevision = 0;

/** 按当前 Project Workspace 读取 Catalog；切换项目时只允许最新请求更新页面。 */
async function loadFormalCatalog(projectPath = selectedProjectPath.value): Promise<void> {
    const revision = ++formalCatalogRevision;
    formalCatalogLoading.value = true;
    formalError.value = "";
    try {
        const catalog = await $fetch<WorkflowCatalogDto>("/api/agent/workflow/catalog", {
            query: projectPath ? {projectPath} : undefined,
        });
        if (revision !== formalCatalogRevision || projectPath !== selectedProjectPath.value) {
            return;
        }
        catalogWorkflows.value = catalog.workflows;
        catalogModels.value = catalog.models;
        if (selectedModelKey.value && !catalog.models.some((model) => model.modelKey === selectedModelKey.value)) {
            selectedModelKey.value = "";
        }
        formalArgsDrafts.value = Object.fromEntries(catalog.workflows.map((workflow) => [
            workflow.key,
            Object.fromEntries(workflow.argsHint.map((hint) => [
                hint.name,
                formalArgsDrafts.value[workflow.key]?.[hint.name] ?? hint.defaultValue,
            ])),
        ]));
    } catch (error) {
        if (revision === formalCatalogRevision && projectPath === selectedProjectPath.value) {
            formalError.value = resolveApiErrorMessage(error, "读取正式 Workflow Catalog 失败");
        }
    } finally {
        if (revision === formalCatalogRevision) {
            formalCatalogLoading.value = false;
        }
    }
}

/**
 * 读取现有 Project Workspace、后台 Job，再按有效项目读取正式 Workflow Catalog。
 * 选中项由 useProjectSession 建立 open + presence；列表刷新本身不改变选择。
 */
let formalEntryRevision = 0;

async function loadFormalEntry(): Promise<void> {
    const revision = ++formalEntryRevision;
    formalEntryLoading.value = true;
    formalError.value = "";
    try {
        const [projectList, jobList] = await Promise.all([
            $fetch<NovelListItemDto[]>("/api/projects"),
            $fetch<{jobs: AgentJobSnapshot[]}>("/api/agent/jobs"),
        ]);
        if (revision !== formalEntryRevision) {
            return;
        }
        projects.value = projectList;
        if (selectedProjectPath.value && !projectList.some((project) => project.projectPath === selectedProjectPath.value)) {
            selectedProjectPath.value = "";
        }
        const knownProjectPaths = new Map(formalRuns.value.map((run) => [run.jobId, run.projectPath]));
        formalRuns.value = jobList.jobs.flatMap((job): FormalWorkflowRun[] => {
            if (job.kind !== "workflow" || job.ownerSessionId !== null || !job.ref || typeof job.ref !== "object" || Array.isArray(job.ref)) {
                return [];
            }
            const runId = typeof job.ref.runId === "string" ? job.ref.runId : "";
            const workflowKey = typeof job.ref.workflowKey === "string" ? job.ref.workflowKey : "";
            return runId ? [{jobId: job.jobId, runId, workflowKey: workflowKey || job.title, projectPath: knownProjectPaths.get(job.jobId) ?? null}] : [];
        });
        if (formalActiveRun.value) {
            formalActiveRun.value = formalRuns.value.find((run) => run.jobId === formalActiveRun.value?.jobId) ?? null;
        }
        await loadFormalCatalog();
    } catch (error) {
        if (revision === formalEntryRevision) {
            formalError.value = resolveApiErrorMessage(error, "读取正式 Workflow Catalog 失败");
        }
    } finally {
        if (revision === formalEntryRevision) {
            formalEntryLoading.value = false;
        }
    }
}

/** 从正式 API 启动一次绑定到显式 Project Workspace 的 catalog workflow。 */
async function startFormalRun(workflow: WorkflowCatalogItemDto) {
    if (!selectedProjectPath.value) {
        formalError.value = "请先选择一个现有 Project Workspace";
        return;
    }
    if (formalProjectStatus.value !== "connected") {
        formalError.value = "Project Workspace 正在打开，请等待项目就绪后再运行";
        return;
    }
    const projectPath = selectedProjectPath.value;
    const modelKey = selectedModelKey.value;
    formalStarting.value = workflow.key;
    formalError.value = "";
    try {
        const result = await $fetch<{jobId: string; runId: string}>("/api/agent/workflow/runs", {
            method: "POST",
            body: {
                workflowKey: workflow.key,
                args: formalArgsDrafts.value[workflow.key] ?? {},
                ...(modelKey ? {model: modelKey} : {}),
                projectPath,
            },
        });
        const run = {
            jobId: result.jobId,
            runId: result.runId,
            workflowKey: workflow.key,
            projectPath,
        };
        formalRuns.value.unshift(run);
        formalActiveRun.value = run;
    } catch (error) {
        formalError.value = resolveApiErrorMessage(error, "启动正式 workflow 失败");
    } finally {
        formalStarting.value = "";
    }
}

async function startRun(scenario: WorkflowDemoScenarioDto) {
    starting.value = scenario.key;
    pageError.value = "";
    try {
        const args = argsDrafts.value[scenario.key] ?? {};
        const result = await $fetch<{runId: string}>("/api/agent/workflow-demo/runs", {
            method: "POST",
            body: {scenarioKey: scenario.key, args, speedFactor: speedFactor.value},
        });
        activeRun.value = {runId: result.runId, scenarioKey: scenario.key};
        await refreshRuns();
    } catch (e) {
        pageError.value = resolveApiErrorMessage(e, "启动 run 失败");
    } finally {
        starting.value = "";
    }
}

onMounted(() => {
    mountThemeHost(themeHostRef.value);
    loadFormalEntry();
    loadScenarios();
    refreshRuns();
});

watch(selectedProjectPath, () => {
    void loadFormalCatalog();
});
</script>

<template>
    <!-- Workflow 正式入口与 demo 共存的预览页。 -->
    <div ref="themeHostRef" class="workflow-preview-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
        <!-- 页面头部 -->
        <header class="border-b border-[var(--border-color)] bg-[var(--toolbar-bg)]/95 backdrop-blur">
            <div class="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 py-5 xl:flex-row xl:items-end xl:justify-between">
                <div class="max-w-[900px]">
                    <div class="text-[11px] uppercase tracking-[0.3em] text-[var(--text-muted)]">Workflow Preview · Task 110 / 111</div>
                    <h1 class="mt-2 text-2xl font-semibold text-[var(--text-main)]">Agent Workflow 编排 · 正式入口与内核演示</h1>
                    <p class="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
                        nb-workflow 内核跑在 <b>NeuroBook 真实 session 层</b>上：所有参与者都是真实 JSONL session（checkout=moveLeaf、append 显式锚定、excursion 旁支留树上、acquire 按 tag 跨 run 复用）。四个经典场景用确定性 mock responder 驱动；「真实 Agent 并发问答」跑真 profile + 真模型。
                    </p>
                    <div class="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1">Route /workflow.preview</span>
                        <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1">真实 JSONL session</span>
                        <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1">journal 重放缓存</span>
                        <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1">三种投影</span>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button v-for="option in themeOptions" :key="option.value" type="button"
                        class="rounded-md border px-3 py-1.5 text-xs transition-colors"
                        :class="theme === option.value
                            ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                            : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                        @click="setTheme(option.value)">{{ option.label }}</button>
                </div>
            </div>
        </header>

        <main class="mx-auto flex max-w-[1500px] flex-col gap-6 px-5 py-6">
            <div v-if="pageError" class="rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger)]">{{ pageError }}</div>

            <!-- Task 111 正式 Catalog：显式选择 Project Workspace 后走正式 runs API。 -->
            <section class="rounded-xl border border-[var(--accent-main)]/35 bg-[var(--bg-panel)] p-4">
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div class="max-w-[860px]">
                        <div class="text-[10px] uppercase tracking-[0.24em] text-[var(--accent-main)]">正式 Catalog</div>
                        <h2 class="mt-1 text-base font-semibold text-[var(--text-main)]">用户主动触发 Workflow</h2>
                        <p class="mt-1 text-xs leading-6 text-[var(--text-secondary)]">每次运行都绑定你在此处明确选择的现有 Project Workspace；选择后本页会维持项目 open + presence，但不会切换 Novel IDE 的当前编辑项目，也不会借用下方 demo 的内存书稿。运行会创建真实 Agent session，并可能产生模型费用。</p>
                    </div>
                    <button type="button" class="rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-wait disabled:opacity-50" :disabled="formalLoading" @click="loadFormalEntry">{{ formalLoading ? "读取中…" : "刷新 Catalog" }}</button>
                </div>

                <div v-if="formalError" class="mt-3 rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">{{ formalError }}</div>

                <!-- 正式 run 的宿主选择：只允许后端列出的现有 Project Workspace。 -->
                <div class="mt-4 grid gap-3 md:grid-cols-2">
                    <label class="space-y-1 text-xs text-[var(--text-muted)]">
                        <span class="flex items-center justify-between gap-2">
                            <span>Project Workspace</span>
                            <span :class="formalProjectStatus === 'connected' ? 'text-[var(--status-success)]' : formalProjectStatus === 'disconnected' ? 'text-[var(--status-danger)]' : formalProjectStatus === 'connecting' ? 'text-[var(--status-info)]' : 'text-[var(--text-muted)]'">{{ formalProjectStatusLabel }}</span>
                        </span>
                        <select v-model="selectedProjectPath" class="w-full rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-2 text-sm text-[var(--text-main)]">
                            <option value="" disabled>{{ projects.length ? "选择项目" : "没有可用项目" }}</option>
                            <option v-for="project in projects" :key="project.projectPath" :value="project.projectPath">{{ project.title }} · {{ project.projectPath }}</option>
                        </select>
                    </label>
                    <label class="space-y-1 text-xs text-[var(--text-muted)]">
                        <span>Workflow 默认模型</span>
                        <select v-model="selectedModelKey" class="w-full rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-2 text-sm text-[var(--text-main)]">
                            <option value="">跟随各 Profile 默认模型</option>
                            <option v-for="model in catalogModels" :key="model.modelKey" :value="model.modelKey">{{ model.modelKey }}{{ model.note ? ` · ${model.note}` : "" }}</option>
                        </select>
                    </label>
                </div>

                <!-- 正式 workflow 卡片与 argsHint 表单。 -->
                <div v-if="catalogWorkflows.length" class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div v-for="workflow in catalogWorkflows" :key="workflow.key" class="flex flex-col rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-semibold text-[var(--text-main)]">{{ workflow.title }}</span>
                            <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">{{ workflow.key }}</span>
                            <span v-if="workflow.source === 'user'" class="rounded border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-info)]">用户覆盖</span>
                            <span v-else-if="workflow.source === 'project'" class="rounded border border-[var(--accent-main)] bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] text-[var(--accent-text)]">项目覆盖</span>
                        </div>
                        <p class="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{{ workflow.description }}</p>
                        <p v-if="workflow.whenToUse" class="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">适用：{{ workflow.whenToUse }}</p>
                        <div v-if="workflow.argsHint.length && formalArgsDrafts[workflow.key]" class="mt-3 space-y-2">
                            <label v-for="hint in workflow.argsHint" :key="hint.name" class="block space-y-1 text-[11px] text-[var(--text-muted)]">
                                <span>{{ hint.label }}</span>
                                <input v-model="formalArgsDrafts[workflow.key]![hint.name]" class="w-full rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 text-xs text-[var(--text-main)]">
                            </label>
                        </div>
                        <button type="button" class="mt-3 self-start rounded bg-[var(--accent-main)] px-4 py-1.5 text-xs font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="formalLoading || !selectedProjectPath || formalProjectStatus !== 'connected' || Boolean(formalStarting)" @click="startFormalRun(workflow)">
                            {{ formalStarting === workflow.key ? "启动中…" : formalProjectStatus === "disconnected" ? "项目连接中断" : selectedProjectPath && formalProjectStatus !== "connected" ? "正在打开项目…" : "运行正式 Workflow" }}
                        </button>
                    </div>
                </div>
                <div v-else-if="!formalError" class="mt-4 rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">{{ formalLoading ? "正在读取 Catalog…" : "Catalog 中暂无可用 workflow" }}</div>

                <!-- 本页启动的正式 run 历史与实时状态。 -->
                <div v-if="formalRuns.length" class="mt-4 flex flex-wrap gap-2">
                    <button v-for="run in formalRuns" :key="run.runId" type="button" class="rounded-full border px-3 py-1 text-xs"
                        :class="formalActiveRun?.runId === run.runId
                            ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                            : 'border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                        @click="formalActiveRun = run">{{ run.workflowKey }} · {{ run.jobId }} · {{ run.runId }}</button>
                </div>
                <div v-if="formalActiveRun" class="mt-4">
                    <div v-if="formalActiveRun.projectPath" class="mb-2 text-xs text-[var(--text-muted)]">{{ formalActiveRun.projectPath }}</div>
                    <WorkflowRunPanel :run-id="formalActiveRun.runId" :job-id="formalActiveRun.jobId" mode="formal" />
                </div>
            </section>

            <!-- 场景卡片 -->
            <section>
                <div class="mb-3 flex flex-wrap items-center gap-3">
                    <h2 class="text-base font-semibold text-[var(--text-main)]">场景</h2>
                    <!-- 演示速度选择：随启动请求发送 -->
                    <div class="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                        <span>演示速度</span>
                        <button v-for="option in SPEED_OPTIONS" :key="option.value"
                            class="rounded-full border px-2.5 py-0.5 transition-colors"
                            :class="speedFactor === option.value
                                ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                            @click="speedFactor = option.value">{{ option.label }}</button>
                    </div>
                </div>
                <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div v-for="scenario in scenarios" :key="scenario.key" class="flex flex-col rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4">
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-semibold text-[var(--text-main)]">{{ scenario.title }}</span>
                            <span class="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{{ scenario.key }}</span>
                            <span v-if="scenario.real" class="rounded-full border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-0.5 text-[10px] text-[var(--status-warning)]">真模型·有费用</span>
                        </div>
                        <p class="mt-2 flex-1 text-xs leading-6 text-[var(--text-secondary)]">{{ scenario.description }}</p>
                        <!-- args 表单 -->
                        <div v-if="scenario.argsHint.length && argsDrafts[scenario.key]" class="mt-2 flex flex-col gap-1.5">
                            <label v-for="hint in scenario.argsHint" :key="hint.name" class="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                                <span class="w-20 shrink-0">{{ hint.label }}</span>
                                <input v-model="argsDrafts[scenario.key]![hint.name]" class="min-w-0 flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1 text-xs text-[var(--text-main)]">
                            </label>
                        </div>
                        <div class="mt-3 flex items-center gap-2">
                            <button :disabled="starting === scenario.key"
                                class="rounded-md border border-[var(--accent-main)] bg-[var(--accent-bg)] px-4 py-1.5 text-xs text-[var(--accent-text)] transition-colors hover:opacity-90 disabled:opacity-40"
                                @click="startRun(scenario)">{{ starting === scenario.key ? "启动中…" : "▶ 运行" }}</button>
                        </div>
                        <!-- workflow 源码 + 静态投影 -->
                        <details class="mt-3">
                            <summary class="cursor-pointer text-[11px] text-[var(--text-muted)]">workflow 代码（服务端运行时源码）</summary>
                            <pre class="mt-2 max-h-72 overflow-auto rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 text-[11px] leading-5 text-[var(--text-secondary)]">{{ scenario.code }}</pre>
                        </details>
                        <details class="mt-2">
                            <summary class="cursor-pointer text-[11px] text-[var(--text-muted)]">静态投影（声明骨架 / AST 近似 CFG，运行前可见）</summary>
                            <div class="mt-2 flex flex-col gap-2">
                                <WorkflowMermaid v-if="scenario.skeletonMermaid" :code="scenario.skeletonMermaid" />
                                <WorkflowMermaid :code="scenario.cfgMermaid" />
                            </div>
                        </details>
                    </div>
                </div>
            </section>

            <!-- run 历史 -->
            <section v-if="runs.length">
                <div class="mb-2 flex items-center gap-2">
                    <h2 class="text-base font-semibold text-[var(--text-main)]">Run 历史</h2>
                    <button class="rounded border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="refreshRuns">刷新</button>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button v-for="run in runs" :key="run.runId"
                        class="rounded-full border px-3 py-1 text-xs"
                        :class="activeRun?.runId === run.runId
                            ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                            : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                        @click="activeRun = {runId: run.runId, scenarioKey: run.scenarioKey}">{{ run.runId }} · {{ run.scenarioKey }} · {{ run.status }}</button>
                </div>
            </section>

            <!-- 活跃 run 面板 -->
            <section v-if="activeRun">
                <h2 class="mb-3 text-base font-semibold text-[var(--text-main)]">实时运行视图</h2>
                <WorkflowRunPanel :run-id="activeRun.runId" :scenario-key="activeRun.scenarioKey" />
            </section>
        </main>
    </div>
</template>

<style scoped>
.workflow-preview-page {
    background-image: radial-gradient(circle at top left, color-mix(in srgb, var(--accent-main) 8%, transparent), transparent 28%);
}
</style>
