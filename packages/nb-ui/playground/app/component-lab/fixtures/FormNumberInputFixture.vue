<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import FormField from "../../../../src/components/form/FormField.vue";
import FormNumberInput, {type NumberInputSize} from "../../../../src/components/form/FormNumberInput.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, getLabScene, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const value = ref("1.5");
const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    // bounded 场景从边界值起步，步进立即触发 clamp；invalid 场景从空值起步
    value.value = scene.value.invalid ? "" : props.sceneId === "bounded" ? "2" : "1.5";
}

function report(name: string, payload?: unknown): void {
    if (!props.definition.events.includes(name)) return;
    emit("lab-event", name, payload);
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <FormField
            label="字数上限"
            for="nb-lab-target"
            :error="scene.invalid ? '请输入有效数字' : ''"
            description="用文本输入保留空值、负号和小数点等编辑中间态。"
        >
            <FormNumberInput
                id="nb-lab-target"
                v-model="value"
                :size="(controls.size ?? 'default') as NumberInputSize"
                :disabled="Boolean(controls.disabled) || scene.disabled === true"
                :readonly="Boolean(controls.readonly)"
                min="0"
                max="2"
                :step="String(controls.step ?? '0.5')"
                title="可用 ArrowUp / ArrowDown 或右侧步进按钮"
                @update:model-value="report('update:modelValue', {value: $event})"
                @submit="report('submit')"
            />
        </FormField>
    </FixtureShell>
</template>
