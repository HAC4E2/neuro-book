<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import RadioGroup, {type RadioOption} from "../../../../src/components/form/RadioGroup.vue";
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
const exportFormat = ref("epub");
const aiModel = ref("claude");

const orientation = computed(() => (controls.value.orientation as any) || "vertical");
const size = computed(() => (controls.value.size as any) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const formatOptions: RadioOption[] = [
    {value: "epub", label: "EPUB 电子书", description: "标准电子书格式，适配各大主流移动端阅读器"},
    {value: "pdf", label: "PDF 印刷版式", description: "严格固定版面与字体排版，适合实体装订与打印"},
    {value: "docx", label: "Word 文档 (.docx)", description: "适合与出版社编辑进行批注与审校协作"},
    {value: "txt", label: "纯文本 (.txt)", description: "零格式干净纯文本，体积最小"},
];

const modelOptions: RadioOption[] = [
    {value: "claude", label: "Claude 3.5 Sonnet", description: "长文情节续写与深度人物心理刻画"},
    {value: "gpt4", label: "GPT-4o", description: "快速情节风暴与多语言翻译"},
    {value: "local", label: "本地模型 (Ollama)", description: "100% 离线私密长篇大纲生成"},
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
                单选组 (RadioGroup)
            </h3>

            <!-- 导出格式选择 -->
            <div>
                <span class="block text-xs font-semibold text-[var(--text-main)] mb-3">作品导出目标格式</span>
                <RadioGroup
                    id="nb-lab-target"
                    v-model="exportFormat"
                    :options="formatOptions"
                    :orientation="orientation"
                    :size="size"
                    :disabled="disabled"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>

            <!-- AI 创作助手模型选择 -->
            <div class="pt-4 border-t border-[var(--divider)]">
                <span class="block text-xs font-semibold text-[var(--text-main)] mb-3">辅助写作模型驱动</span>
                <RadioGroup
                    v-model="aiModel"
                    :options="modelOptions"
                    :size="size"
                    :disabled="disabled"
                />
            </div>
        </div>
    </FixtureShell>
</template>
