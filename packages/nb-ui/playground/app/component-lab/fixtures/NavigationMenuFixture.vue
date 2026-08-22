<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";
import NavigationMenu, {type NavigationMenuItemData} from "../../../../src/components/navigation/NavigationMenu.vue";
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

const items: NavigationMenuItemData[] = [
    {
        id: "workspace",
        label: "写作工作区",
        links: [
            {title: "长篇卷章大纲", description: "多层级主支线情节大纲规划", iconClass: "i-lucide-network"},
            {title: "沉浸专注编辑器", description: "字数统计与全屏双栏排版", iconClass: "i-lucide-pen-tool"},
            {title: "世界观设定集", description: "角色档案、势力与科技树", iconClass: "i-lucide-database"},
            {title: "AI 续写实验室", description: "上下文感知与多模型诊断", iconClass: "i-lucide-sparkles"},
        ],
    },
    {
        id: "export",
        label: "发布与排版",
        links: [
            {title: "EPUB 电子书导出", description: "支持封面插图与标准目录", iconClass: "i-lucide-book"},
            {title: "PDF 印刷级排版", description: "字号、行距与版心精细调整", iconClass: "i-lucide-file-text"},
        ],
    },
    {
        id: "community",
        label: "扩展与主题",
        href: "#",
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
        <div class="macos-compact-card space-y-6 !max-w-[640px] pb-32">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                多栏形变导航菜单 (NavigationMenu)
            </h3>

            <div class="flex justify-center">
                <NavigationMenu
                    id="nb-lab-target"
                    :items="items"
                    @select="emit('lab-event', 'select', $event)"
                />
            </div>

            <p class="text-xs text-[var(--text-muted)] text-center">
                提示：鼠标在「写作工作区」与「发布与排版」之间滑动时，下方浮层视口会自适应进行平滑位移与形变动画。
            </p>
        </div>
    </FixtureShell>
</template>
