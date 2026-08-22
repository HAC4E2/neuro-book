<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Stepper, {type StepperStepData} from "../../../../src/components/controls/Stepper.vue";
import Button from "../../../../src/components/controls/Button.vue";
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
const currentStep = ref(2);

const orientation = computed(() => (controls.value.orientation as any) || "horizontal");
const linear = computed(() => Boolean(controls.value.linear));

const steps: StepperStepData[] = [
    {step: 1, title: "创建作品档案", description: "设定书名与作者", iconClass: "i-lucide-book-open"},
    {step: 2, title: "世界观与大纲", description: "规划主线分卷", iconClass: "i-lucide-network"},
    {step: 3, title: "正文连载排版", description: "设定集与校对", iconClass: "i-lucide-pen-tool"},
    {step: 4, title: "导出与发布", description: "EPUB/PDF 生成", iconClass: "i-lucide-check-circle"},
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
        <div class="macos-compact-card space-y-6 !max-w-[720px]">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                作品创作向导流程 (Stepper)
            </h3>

            <div class="p-3 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Stepper
                    id="nb-lab-target"
                    v-model="currentStep"
                    :steps="steps"
                    :orientation="orientation"
                    :linear="linear"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>

            <div class="flex items-center justify-between pt-2">
                <Button
                    size="sm"
                    variant="secondary"
                    :disabled="currentStep <= 1"
                    @click="currentStep = Math.max(1, currentStep - 1)"
                >
                    上一步
                </Button>
                <span class="text-xs text-[var(--text-muted)] font-mono">当前步骤: {{ currentStep }} / {{ steps.length }}</span>
                <Button
                    size="sm"
                    variant="primary"
                    :disabled="currentStep >= steps.length"
                    @click="currentStep = Math.min(steps.length, currentStep + 1)"
                >
                    下一步
                </Button>
            </div>
        </div>
    </FixtureShell>
</template>
