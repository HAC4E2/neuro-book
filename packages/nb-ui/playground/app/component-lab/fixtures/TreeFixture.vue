<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Tree, {type GenericTreeNode} from "../../../../src/components/navigation/Tree.vue";
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
const selectedNode = ref("ch-2");
const expandedNodes = ref(["vol-1", "vol-2"]);

const multiple = computed(() => Boolean(controls.value.multiple));
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const treeData: GenericTreeNode[] = [
    {
        id: "vol-1",
        title: "第一卷：深潜意识海",
        children: [
            {id: "ch-1", title: "第01章：第404号神经节点", iconClass: "i-lucide-file-text"},
            {id: "ch-2", title: "第02章：赛博空间的不速之客", iconClass: "i-lucide-file-text"},
            {id: "ch-3", title: "第03章：幽灵协议与量子密钥", iconClass: "i-lucide-file-text"},
        ],
    },
    {
        id: "vol-2",
        title: "第二卷：地下反抗军",
        children: [
            {id: "ch-4", title: "第04章：下城区霓虹与雨夜", iconClass: "i-lucide-file-text"},
            {id: "ch-5", title: "第05章：荒坂财阀的悬赏令", iconClass: "i-lucide-file-text"},
        ],
    },
    {
        id: "vol-3",
        title: "第三卷：终极觉醒",
        children: [
            {id: "ch-6", title: "第06章：机械与灵魂的终章", iconClass: "i-lucide-file-text"},
        ],
    },
];

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
        <div class="macos-compact-card space-y-4 !max-w-[480px]">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                无限层级大纲树 (Tree)
            </h3>

            <div class="space-y-2">
                <span class="block text-xs font-semibold text-[var(--text-muted)]">作品分卷与章节大纲:</span>
                <Tree
                    id="nb-lab-target"
                    v-model="selectedNode"
                    v-model:expanded="expandedNodes"
                    :items="treeData"
                    :multiple="multiple"
                    :disabled="disabled"
                    @select="emit('lab-event', 'select', $event)"
                />
            </div>
        </div>
    </FixtureShell>
</template>
