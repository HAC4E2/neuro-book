<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Splitter, {type SplitterPanelConfig} from "../../../../src/components/layout/Splitter.vue";
import FileTree from "../../../../src/components/navigation/FileTree.vue";
import type {FileTreeNode} from "../../../../src/components/navigation/file-tree.types";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>(), emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const controls = ref<Record<string, string | boolean>>({});
const direction = computed(() => (controls.value.direction as any) || "horizontal");

const panels: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28, minSize: 18, maxSize: 45, collapsible: true},
    {id: "editor", defaultSize: 52, minSize: 30},
    {id: "inspector", defaultSize: 20, minSize: 15, maxSize: 35, collapsible: true},
];

const treeData: FileTreeNode[] = [
    {
        id: "v1",
        label: "第一卷：深渊苏醒",
        kind: "directory",
        children: [
            {id: "c1", label: "01. 神经连接.md", kind: "file"},
            {id: "c2", label: "02. 赛博黑市.md", kind: "file"},
            {id: "c3", label: "03. 幽灵协议.md", kind: "file"},
        ],
    },
    {
        id: "v2",
        label: "设定集与人物资料",
        kind: "directory",
        children: [
            {id: "w1", label: "世界观设定.md", kind: "file"},
            {id: "w2", label: "林澈（主角档案）.md", kind: "file"},
        ],
    },
];

const selectedTreeId = ref<string | null>("c1");
const expandedTreeIds = ref<string[]>(["v1", "v2"]);

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div class="macos-compact-card p-0 overflow-hidden h-[420px] flex flex-col !max-w-[860px]">
            <!-- 顶栏标题 -->
            <div class="flex items-center justify-between px-4 py-2.5 bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border-b border-[var(--divider)]">
                <span class="text-xs font-bold text-[var(--text-main)]">三栏可调节长篇写作工作区 (Splitter)</span>
                <span class="text-[11px] text-[var(--text-muted)]">可鼠标按住中间细线自由拖拽缩放</span>
            </div>

            <!-- 分割工作区 -->
            <div class="flex-1 min-h-0">
                <Splitter
                    id="nb-lab-target"
                    :direction="direction"
                    :panels="panels"
                    @layout="emit('lab-event', 'layout', $event)"
                >
                    <!-- 左侧大纲栏 -->
                    <template #panel-outline>
                        <div class="p-3 h-full overflow-y-auto bg-[color-mix(in_srgb,var(--text-main)_2%,transparent)]">
                            <div class="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">章节大纲</div>
                            <FileTree
                                :nodes="treeData"
                                :selected-id="selectedTreeId"
                                :expanded-ids="expandedTreeIds"
                                @select="selectedTreeId = $event.id"
                                @toggle-expand="expandedTreeIds = $event ? [...expandedTreeIds, $event.node.id] : expandedTreeIds"
                            />
                        </div>
                    </template>

                    <!-- 中间编辑器正文 -->
                    <template #panel-editor>
                        <div class="p-5 h-full overflow-y-auto bg-[var(--bg-main)]">
                            <h2 class="text-base font-bold text-[var(--text-main)] mb-3">第一章：深渊苏醒</h2>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
                                当意识的第一道脉冲穿过义体神经中枢时，窗外正下着新东京特有的霓虹酸雨。林澈睁开眼，视网膜HUD界面瞬间刷新出24条未读加密讯息。
                            </p>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
                                「深潜协议已就绪，量子密钥正在重组。」
                                他坐起身，拔掉后颈上的散热导管，冷凝液顺着脊柱缓缓滑落。
                            </p>
                        </div>
                    </template>

                    <!-- 右侧设定集检查器 -->
                    <template #panel-inspector>
                        <div class="p-3.5 h-full overflow-y-auto bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)] text-xs text-[var(--text-secondary)] space-y-3">
                            <div class="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">章节元数据</div>
                            <div>
                                <span class="block text-[11px] text-[var(--text-muted)]">目标字数</span>
                                <span class="font-semibold text-[var(--text-main)]">4,230 / 6,000</span>
                            </div>
                            <div>
                                <span class="block text-[11px] text-[var(--text-muted)]">出场人物</span>
                                <span class="text-[var(--text-main)]">林澈、接头人阿九</span>
                            </div>
                        </div>
                    </template>
                </Splitter>
            </div>
        </div>
    </FixtureShell>
</template>
