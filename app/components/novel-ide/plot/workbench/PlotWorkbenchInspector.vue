<script setup lang="ts">
import {computed} from "vue";
import Combobox from "nbook/app/components/common/form/Combobox.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import {
    PLOT_KIND_LABELS,
    PLOT_SCENE_STATUS_LABELS,
    PLOT_THREAD_STATUS_LABELS,
    type PlotThreadPanelChapter,
    type PlotThreadPanelPlot,
    type PlotThreadPanelRef,
    type PlotThreadPanelScene,
    type PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {
    StoryPlotKindDto,
    StorySceneStatusDto,
    StoryThreadStatusDto,
} from "nbook/shared/dto/plot.dto";

type WorkbenchInlineRefKind = "content" | "thread" | "scene" | "plot";
type WorkbenchInlineRefSource = "thread" | "scene" | "plot";

type WorkbenchInlineRef = {
    id: string;
    kind: WorkbenchInlineRefKind;
    title: string;
    target: string;
    source: WorkbenchInlineRefSource;
    field: "summary" | "purpose" | "writingTip" | "effect";
};
type WorkbenchManualRef = {
    id: string;
    relation: string;
    target: string;
    note: string | null;
};

const props = defineProps<{
    mode: "thread" | "scene" | "plot";
    thread: PlotThreadPanelThread | null;
    scene: PlotThreadPanelScene | null;
    plot: PlotThreadPanelPlot | null;
    chapters: PlotThreadPanelChapter[];
    effectiveRefs: WorkbenchInlineRef[];
    manualRefs: WorkbenchManualRef[];
    refTargetOptions: string[];
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "updateThread", threadId: string, patch: Partial<PlotThreadPanelThread>): void;
    (e: "updateScene", sceneId: string, patch: Partial<PlotThreadPanelScene>): void;
    (e: "updatePlot", plotId: string, patch: Partial<PlotThreadPanelPlot>): void;
    (e: "updateRefs", refs: WorkbenchManualRef[]): void;
}>();

const threadStatusOptions: SelectOption[] = Object.entries(PLOT_THREAD_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
}));
const sceneStatusOptions: SelectOption[] = Object.entries(PLOT_SCENE_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
}));
const plotKindOptions: SelectOption[] = Object.entries(PLOT_KIND_LABELS).map(([value, label]) => ({
    value,
    label,
}));
const refRelationOptions = [
    "mentions",
    "foreshadows",
    "depends_on",
    "pays_off",
    "conflicts_with",
    "setup_for",
    "derived_from",
];
const chapterOptions = computed<SelectOption[]>(() => [
    {value: "", label: "未挂章"},
    ...props.chapters.map((chapter) => ({
        value: chapter.id,
        label: `${chapter.numberLabel} · ${chapter.title}`,
    })),
]);
const currentTitle = computed(() => {
    if (props.mode === "thread") {
        return props.thread?.title ?? "Thread";
    }
    if (props.mode === "scene") {
        return props.scene?.title ?? "Scene";
    }
    return props.plot ? (PLOT_KIND_LABELS[props.plot.kind] ?? "Plot") : "Plot";
});
const refsByKind = computed(() => {
    const groups: Record<WorkbenchInlineRefKind, WorkbenchInlineRef[]> = {
        content: [],
        thread: [],
        scene: [],
        plot: [],
    };
    for (const refItem of props.effectiveRefs) {
        groups[refItem.kind].push(refItem);
    }
    return groups;
});
const visibleRefGroups = computed(() => [
    {kind: "content" as const, label: "内容节点", items: refsByKind.value.content},
    {kind: "thread" as const, label: "Thread", items: refsByKind.value.thread},
    {kind: "scene" as const, label: "Scene", items: refsByKind.value.scene},
    {kind: "plot" as const, label: "Plot", items: refsByKind.value.plot},
].filter((group) => group.items.length > 0));

/**
 * 更新当前 Thread mock。
 */
function updateThread(patch: Partial<PlotThreadPanelThread>): void {
    if (!props.thread) {
        return;
    }
    emit("updateThread", props.thread.id, patch);
}

/**
 * 更新当前 Scene mock。
 */
function updateScene(patch: Partial<PlotThreadPanelScene>): void {
    if (!props.scene) {
        return;
    }
    emit("updateScene", props.scene.id, patch);
}

/**
 * 更新当前 Plot mock。
 */
function updatePlot(patch: Partial<PlotThreadPanelPlot>): void {
    if (!props.plot) {
        return;
    }
    emit("updatePlot", props.plot.id, patch);
}

/**
 * 新增一条手动 refs。
 */
function addManualRef(): void {
    emit("updateRefs", [
        ...props.manualRefs,
        {
            id: `ref-workbench-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            relation: "",
            target: "",
            note: null,
        },
    ]);
}

/**
 * 更新手动 refs 中的一项。
 */
function updateManualRef(refId: string, patch: Partial<WorkbenchManualRef>): void {
    emit("updateRefs", props.manualRefs.map((refItem) => refItem.id === refId
        ? {
            ...refItem,
            ...patch,
        }
        : refItem));
}

/**
 * 删除一条手动 refs。
 */
function removeManualRef(refId: string): void {
    emit("updateRefs", props.manualRefs.filter((refItem) => refItem.id !== refId));
}
</script>

<template>
    <!-- 工作台右侧编辑检查器 -->
    <aside class="flex min-h-0 w-[380px] shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-panel)]/88">
        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
            <div class="mb-4 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">当前编辑：{{ props.mode }}</div>
                    <div class="mt-0.5 truncate text-[13px] font-semibold text-[var(--text-main)]">{{ currentTitle }}</div>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="复制">
                        <span class="i-lucide-copy h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="刷新引用">
                        <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-rose-600" title="删除">
                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="关闭检查器" @click="emit('close')">
                        <span class="i-lucide-panel-right-close h-3.5 w-3.5"></span>
                    </button>
                </div>
            </div>

            <section v-if="props.mode === 'thread' && props.thread" class="space-y-3">
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <FormField label="标题">
                        <FormInput :model-value="props.thread.title" placeholder="Thread 标题" @update:model-value="updateThread({title: $event})" />
                    </FormField>
                    <FormField label="状态">
                        <FormSelect :model-value="props.thread.status" :options="threadStatusOptions" @update:model-value="updateThread({status: $event as StoryThreadStatusDto})" />
                    </FormField>
                </div>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.thread.summary"
                        :rows="5"
                        :min-height="132"
                        :max-height="220"
                        default-mode="source"
                        placeholder="Thread 摘要，可使用 [标题](lorebook/...) 或 [节点](plot://...)"
                        @update:model-value="updateThread({summary: $event})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.thread.writingTip ?? ''"
                        :rows="4"
                        :min-height="108"
                        :max-height="180"
                        default-mode="source"
                        placeholder="写作提示，可写入 inline ref"
                        @update:model-value="updateThread({writingTip: $event || null})"
                    />
                </FormField>
            </section>

            <section v-else-if="props.mode === 'scene' && props.scene" class="space-y-3">
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <FormField label="标题">
                        <FormInput :model-value="props.scene.title" placeholder="Scene 标题" @update:model-value="updateScene({title: $event})" />
                    </FormField>
                    <FormField label="状态">
                        <FormSelect :model-value="props.scene.status" :options="sceneStatusOptions" @update:model-value="updateScene({status: $event as StorySceneStatusDto})" />
                    </FormField>
                </div>
                <div class="grid grid-cols-[minmax(0,1fr)_84px] gap-2">
                    <FormField label="所属章节">
                        <FormSelect :model-value="props.scene.chapterPath ?? ''" :options="chapterOptions" @update:model-value="updateScene({chapterPath: $event || null})" />
                    </FormField>
                    <FormField label="序号">
                        <FormInput :model-value="String(props.scene.threadSortOrder + 1)" placeholder="序号" @update:model-value="updateScene({threadSortOrder: Math.max(0, Number($event || 1) - 1)})" />
                    </FormField>
                </div>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.scene.summary"
                        :rows="6"
                        :min-height="156"
                        :max-height="260"
                        default-mode="source"
                        placeholder="Scene 摘要，可使用内容节点或 plot inline ref"
                        @update:model-value="updateScene({summary: $event})"
                    />
                    <div class="mt-1 text-right text-[10px] text-[var(--text-muted)]">{{ props.scene.summary.length }}/5000</div>
                </FormField>
                <FormField label="目的">
                    <StructuredTextEditor
                        :model-value="props.scene.purpose ?? ''"
                        :rows="4"
                        :min-height="108"
                        :max-height="180"
                        default-mode="source"
                        placeholder="Scene 目的"
                        @update:model-value="updateScene({purpose: $event || null})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.scene.writingTip ?? ''"
                        :rows="4"
                        :min-height="108"
                        :max-height="180"
                        default-mode="source"
                        placeholder="写作提示"
                        @update:model-value="updateScene({writingTip: $event || null})"
                    />
                </FormField>
            </section>

            <section v-else-if="props.mode === 'plot' && props.plot" class="space-y-3">
                <FormField label="Plot 类型">
                    <FormSelect :model-value="props.plot.kind" :options="plotKindOptions" @update:model-value="updatePlot({kind: $event as StoryPlotKindDto})" />
                </FormField>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.plot.summary"
                        :rows="6"
                        :min-height="156"
                        :max-height="260"
                        default-mode="source"
                        placeholder="Plot 摘要，可使用 [标题](lorebook/...) 或 [节点](plot://...)"
                        @update:model-value="updatePlot({summary: $event})"
                    />
                </FormField>
                <FormField label="效果">
                    <StructuredTextEditor
                        :model-value="props.plot.effect ?? ''"
                        :rows="4"
                        :min-height="108"
                        :max-height="180"
                        default-mode="source"
                        placeholder="Plot 效果"
                        @update:model-value="updatePlot({effect: $event || null})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.plot.writingTip ?? ''"
                        :rows="4"
                        :min-height="108"
                        :max-height="180"
                        default-mode="source"
                        placeholder="写作提示"
                        @update:model-value="updatePlot({writingTip: $event || null})"
                    />
                </FormField>
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                    当前类型：{{ PLOT_KIND_LABELS[props.plot.kind] }}
                </div>
            </section>

            <section v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/30 px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
                请选择一个对象开始编辑。
            </section>

            <section class="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40">
                <div class="flex items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
                    <div>
                        <div class="text-[12px] font-semibold text-[var(--text-main)]">Refs</div>
                        <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">手动维护的结构化引用</div>
                    </div>
                    <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="addManualRef">
                        <span class="i-lucide-plus h-3 w-3"></span>
                        Ref
                    </button>
                </div>
                <div v-if="props.manualRefs.length" class="space-y-2 px-3 py-2">
                    <div v-for="refItem in props.manualRefs" :key="refItem.id" class="space-y-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-2">
                        <div class="grid grid-cols-[104px_minmax(0,1fr)_24px] items-center gap-1.5">
                            <Combobox :model-value="refItem.relation || null" :options="refRelationOptions" placeholder="relation" @update:model-value="updateManualRef(refItem.id, {relation: $event ?? ''})" />
                            <Combobox :model-value="refItem.target || null" :options="props.refTargetOptions" placeholder="lorebook/... 或 plot://..." @update:model-value="updateManualRef(refItem.id, {target: $event ?? ''})" />
                            <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-600" title="删除 Ref" @click="removeManualRef(refItem.id)">
                                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                            </button>
                        </div>
                        <FormInput :model-value="refItem.note ?? ''" placeholder="note，可为空" @update:model-value="updateManualRef(refItem.id, {note: $event || null})" />
                    </div>
                </div>
                <div v-else class="px-3 py-4 text-center text-[11px] leading-5 text-[var(--text-muted)]">
                    暂无手动 refs。可引用内容节点路径，也可引用 thread://、scene://、plot://。
                </div>
            </section>

            <section class="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/45">
                <div class="flex items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
                    <div class="text-[12px] font-semibold text-[var(--text-main)]">有效引用（Effective Refs）</div>
                    <span class="text-[10px] text-[var(--text-muted)]">由 inline ref 派生</span>
                </div>
                <div v-if="visibleRefGroups.length" class="space-y-3 px-3 py-2">
                    <div v-for="group in visibleRefGroups" :key="group.kind" class="space-y-1">
                        <div class="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            <span>{{ group.label }}</span>
                            <span>{{ group.items.length }}</span>
                        </div>
                        <div v-for="refItem in group.items" :key="refItem.id" class="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                            <span class="i-lucide-bookmark h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                            <span class="shrink-0 rounded bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--accent-main)]">{{ refItem.source }}</span>
                            <span class="min-w-0 flex-1 truncate">{{ refItem.title }} · {{ refItem.target }}</span>
                        </div>
                    </div>
                </div>
                <div v-else class="px-3 py-5 text-center text-[11px] leading-5 text-[var(--text-muted)]">
                    暂无 inline ref。结构化 refs 不会在这里手写维护。
                </div>
            </section>
        </div>

        <div class="shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
            <button type="button" class="workbench-ai-button">
                <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                AI 批注
            </button>
        </div>
    </aside>
</template>

<style scoped>
.workbench-ai-button {
    display: flex;
    height: 2.25rem;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid color-mix(in srgb, var(--accent-main) 52%, var(--border-color));
    background: color-mix(in srgb, var(--accent-main) 18%, var(--bg-panel));
    font-size: 12px;
    font-weight: 600;
    color: color-mix(in srgb, var(--accent-main) 88%, #5f3300);
}

.workbench-ai-button:hover {
    background: color-mix(in srgb, var(--accent-main) 24%, var(--bg-panel));
}
</style>
