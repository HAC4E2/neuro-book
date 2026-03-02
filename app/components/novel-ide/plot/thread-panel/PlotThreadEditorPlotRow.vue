<script setup lang="ts">
import {useSortable} from "@dnd-kit/vue/sortable";
import IconButton from "nbook/app/components/common/IconButton.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import type {PlotThreadPanelPlot} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";

const props = defineProps<{
    plot: PlotThreadPanelPlot;
    index: number;
    sceneId: string;
}>();

const emit = defineEmits<{
    (e: "update", payload: {
        plotId: string;
        patch: {
            kind?: PlotThreadPanelPlot["kind"];
            summary?: string;
            effect?: string | null;
            writingTip?: string | null;
        };
    }): void;
    (e: "remove", plotId: string): void;
}>();

const elementRef = ref<HTMLElement | null>(null);
const handleRef = ref<HTMLElement | null>(null);

const kindOptions: SelectOption[] = [
    {value: "setup", label: "铺垫"},
    {value: "action", label: "行动"},
    {value: "conflict", label: "冲突"},
    {value: "despair", label: "低谷"},
    {value: "relief", label: "释放"},
    {value: "reward", label: "回报"},
    {value: "mystery", label: "悬念"},
    {value: "reveal", label: "揭示"},
    {value: "twist", label: "反转"},
    {value: "payoff", label: "回收"},
    {value: "result", label: "结果"},
];

/**
 * 注册 Plot 排序能力。
 */
const {isDragging, isDropTarget} = useSortable({
    id: computed(() => props.plot.id),
    index: computed(() => props.index),
    group: computed(() => `scene-plot:${props.sceneId}`),
    type: "plot",
    accept: "plot",
    data: computed(() => ({
        kind: "plot" as const,
        plotId: props.plot.id,
        sceneId: props.sceneId,
    })),
    element: elementRef,
    handle: handleRef,
    feedback: "default",
});

/**
 * 更新当前 Plot 的单个字段。
 */
function updateField<K extends "kind" | "summary" | "effect" | "writingTip">(key: K, value: PlotThreadPanelPlot[K]): void {
    emit("update", {
        plotId: props.plot.id,
        patch: {
            [key]: value,
        },
    });
}
</script>

<template>
    <!-- Scene 编辑器中的单条 Plot 行 -->
    <div
        ref="elementRef"
        :data-dragging="isDragging || undefined"
        :data-drop-target="isDropTarget || undefined"
        class="plot-editor-row rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2"
    >
        <div class="flex items-start gap-2">
            <button
                ref="handleRef"
                type="button"
                class="mt-0.5 inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                title="拖拽排序 Plot"
                @click.stop
            >
                <span class="i-lucide-grip-vertical h-3 w-3"></span>
            </button>

            <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex items-center gap-1.5">
                    <span class="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[11px] font-medium tabular-nums leading-none text-[var(--text-muted)]">
                        {{ props.index + 1 }}
                    </span>
                    <div class="w-[104px] shrink-0">
                        <FormSelect
                            :model-value="props.plot.kind"
                            :options="kindOptions"
                            @update:model-value="updateField('kind', $event as PlotThreadPanelPlot['kind'])"
                        />
                    </div>
                    <div class="min-w-0 flex-1">
                        <FormInput
                            :model-value="props.plot.summary"
                            placeholder="情节点摘要"
                            @update:model-value="updateField('summary', $event)"
                        />
                    </div>
                    <IconButton
                        variant="danger"
                        title="删除 Plot"
                        @click="emit('remove', props.plot.id)"
                    >
                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                    </IconButton>
                </div>

                <div class="grid grid-cols-2 gap-1.5">
                    <div class="space-y-1">
                        <div class="text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">结果</div>
                        <FormTextarea
                            :model-value="props.plot.effect ?? ''"
                            :rows="2"
                            placeholder="结果"
                            @update:model-value="updateField('effect', ($event.trim() || null))"
                        />
                    </div>
                    <div class="space-y-1">
                        <div class="text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">写作提示</div>
                        <FormTextarea
                            :model-value="props.plot.writingTip ?? ''"
                            :rows="2"
                            placeholder="写作提示"
                            @update:model-value="updateField('writingTip', ($event.trim() || null))"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.plot-editor-row[data-dragging="true"] {
    transform: rotate(0.25deg);
}

.plot-editor-row[data-drop-target="true"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 45%, transparent);
}
</style>
