<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import CheckboxGroup, {type CheckboxOption} from "../../../../src/components/form/CheckboxGroup.vue";
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
const selectedValues = ref(["epub", "toc"]);

const orientation = computed(() => (controls.value.orientation as any) || "vertical");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const exportOptions: CheckboxOption[] = [
    {value: "epub", label: "生成 EPUB 3.0 电子书", description: "包含完整书签、元数据与封面"},
    {value: "pdf", label: "导出印刷级 PDF 文档", description: "高分辨率排版与自适应出血线"},
    {value: "toc", label: "自动生成多级目录与大纲索引", description: "方便快速章节定位与跳转"},
    {value: "watermark", label: "添加作品防盗版权水印", description: "在页脚嵌入作者签名与唯一哈希"},
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
        <div class="macos-compact-card space-y-6 max-w-md">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                复选框受控组合 (CheckboxGroup)
            </h3>

            <div class="space-y-3">
                <span class="block text-xs font-semibold text-[var(--text-main)]">作品发布导出选项配置:</span>
                <CheckboxGroup
                    id="nb-lab-target"
                    v-model="selectedValues"
                    :options="exportOptions"
                    :orientation="orientation"
                    :disabled="disabled"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>
        </div>
    </FixtureShell>
</template>
