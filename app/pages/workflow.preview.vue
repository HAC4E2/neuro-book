<script setup lang="ts">
import {onMounted, ref} from "vue";
import WorkflowMermaid from "nbook/app/components/workflow-preview/WorkflowMermaid.vue";
import WorkflowRunPanel from "nbook/app/components/workflow-preview/WorkflowRunPanel.vue";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {WorkflowDemoScenarioDto} from "nbook/server/agent/workflow/workflow-demo-service";

/**
 * Task 110 · nb-workflow × NeuroBook 真实 session 层的初步接入演示页。
 * 四个经典场景（mock responder × 真实 JSONL session）+ 一个真实 agent 场景（真 harness 全链）。
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
    loadScenarios();
    refreshRuns();
});
</script>

<template>
    <!-- workflow demo 预览页 -->
    <div ref="themeHostRef" class="workflow-preview-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
        <!-- 页面头部 -->
        <header class="border-b border-[var(--border-color)] bg-[var(--toolbar-bg)]/95 backdrop-blur">
            <div class="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 py-5 xl:flex-row xl:items-end xl:justify-between">
                <div class="max-w-[900px]">
                    <div class="text-[11px] uppercase tracking-[0.3em] text-[var(--text-muted)]">Workflow Preview · Task 110</div>
                    <h1 class="mt-2 text-2xl font-semibold text-[var(--text-main)]">Agent Workflow 编排 · 初步接入演示</h1>
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
