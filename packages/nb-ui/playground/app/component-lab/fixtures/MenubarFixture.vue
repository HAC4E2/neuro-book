<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Menubar, {type MenubarMenuData} from "../../../../src/components/controls/Menubar.vue";
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
const size = computed(() => (controls.value.size as any) || "md");

const menus: MenubarMenuData[] = [
    {
        id: "file",
        label: "文件 (File)",
        items: [
            {label: "新建章节", value: "new-chapter", shortcut: "⌘N", iconClass: "i-lucide-file-plus"},
            {label: "快速保存", value: "save", shortcut: "⌘S", iconClass: "i-lucide-save"},
            {
                label: "导出作品",
                value: "export",
                iconClass: "i-lucide-download",
                children: [
                    {label: "EPUB 电子书", value: "export-epub", iconClass: "i-lucide-book"},
                    {label: "PDF 文档", value: "export-pdf", iconClass: "i-lucide-file-text"},
                    {label: "Markdown 纯文本", value: "export-md"},
                ],
            },
            {label: "", value: "sep-1", separator: true},
            {label: "删除章节", value: "delete", shortcut: "⌫", iconClass: "i-lucide-trash-2", tone: "danger"},
        ],
    },
    {
        id: "edit",
        label: "编辑 (Edit)",
        items: [
            {label: "撤销", value: "undo", shortcut: "⌘Z", iconClass: "i-lucide-undo-2"},
            {label: "重做", value: "redo", shortcut: "⇧⌘Z", iconClass: "i-lucide-redo-2"},
            {label: "", value: "sep-2", separator: true},
            {label: "剪切", value: "cut", shortcut: "⌘X"},
            {label: "复制", value: "copy", shortcut: "⌘C"},
            {label: "粘贴", value: "paste", shortcut: "⌘V"},
        ],
    },
    {
        id: "write",
        label: "写作 (Write)",
        items: [
            {label: "AI 智能情节续写", value: "ai-continue", shortcut: "⌥Space", iconClass: "i-lucide-sparkles"},
            {label: "全屏沉浸专注模式", value: "focus-mode", shortcut: "⌃⌘F", iconClass: "i-lucide-maximize"},
            {label: "字数与阅读时长统计", value: "word-count", iconClass: "i-lucide-bar-chart-2"},
        ],
    },
    {
        id: "help",
        label: "帮助 (Help)",
        items: [
            {label: "快捷键指南", value: "shortcuts", shortcut: "⌘/", iconClass: "i-lucide-keyboard"},
            {label: "关于 NeuroBook", value: "about", iconClass: "i-lucide-info"},
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
        <div class="macos-compact-card space-y-6 !max-w-[680px]">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                桌面应用主菜单栏 (Menubar)
            </h3>

            <!-- 菜单栏展示 -->
            <div class="flex items-center justify-between p-2 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Menubar
                    id="nb-lab-target"
                    :menus="menus"
                    :size="size"
                    @select="emit('lab-event', 'select', $event)"
                />
            </div>

            <p class="text-xs text-[var(--text-muted)] leading-relaxed">
                提示：支持键盘 ← / → 方向键在各菜单间连续平滑穿梭，支持 ↑ / ↓ 方向键选择条目，Esc 关闭并归还焦点。
            </p>
        </div>
    </FixtureShell>
</template>
