<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Toolbar from "../../../../src/components/controls/Toolbar.vue";
import ToggleGroup from "../../../../src/components/controls/ToggleGroup.vue";
import Button from "../../../../src/components/controls/Button.vue";
import IconButton from "../../../../src/components/controls/IconButton.vue";
import Separator from "../../../../src/components/layout/Separator.vue";
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
const textFormatting = ref<string[]>(["bold"]);
const textAlignment = ref<string>("left");

const orientation = computed(() => (controls.value.orientation as any) || "horizontal");

const formatOptions = [
    {value: "bold", label: "B", title: "加粗 (⌘B)"},
    {value: "italic", label: "I", title: "斜体 (⌘I)"},
    {value: "underline", label: "U", title: "下划线 (⌘U)"},
    {value: "strikethrough", label: "S", title: "删除线"},
];

const alignOptions = [
    {value: "left", iconClass: "i-lucide-align-left", title: "左对齐"},
    {value: "center", iconClass: "i-lucide-align-center", title: "居中对齐"},
    {value: "right", iconClass: "i-lucide-align-right", title: "右对齐"},
    {value: "justify", iconClass: "i-lucide-align-justify", title: "两端对齐"},
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
        <div class="macos-compact-card space-y-6">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                编辑器工具栏 (Toolbar) 与切换组 (ToggleGroup)
            </h3>

            <!-- 长篇写作富文本编辑工具栏 -->
            <div class="p-3 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Toolbar id="nb-lab-target" :orientation="orientation">
                    <!-- 撤销 / 重做 -->
                    <div class="flex items-center gap-0.5">
                        <IconButton size="sm" icon-class="i-lucide-undo-2" aria-label="撤销" />
                        <IconButton size="sm" icon-class="i-lucide-redo-2" aria-label="重做" />
                    </div>

                    <Separator orientation="vertical" class="h-4 mx-1" />

                    <!-- 字体样式多选组 -->
                    <ToggleGroup
                        v-model="textFormatting"
                        type="multiple"
                        size="sm"
                        :options="formatOptions"
                        @update:model-value="emit('lab-event', 'update:formatting', $event)"
                    />

                    <Separator orientation="vertical" class="h-4 mx-1" />

                    <!-- 对齐方式单选组 -->
                    <ToggleGroup
                        v-model="textAlignment"
                        type="single"
                        size="sm"
                        :options="alignOptions"
                        @update:model-value="emit('lab-event', 'update:alignment', $event)"
                    />

                    <Separator orientation="vertical" class="h-4 mx-1" />

                    <!-- 写作动作 -->
                    <Button size="sm" variant="ghost" icon-class="i-lucide-sparkles">
                        AI 润色
                    </Button>
                </Toolbar>
            </div>
        </div>
    </FixtureShell>
</template>
