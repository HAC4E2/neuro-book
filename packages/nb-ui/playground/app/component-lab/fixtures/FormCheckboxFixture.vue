<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import FormCheckbox from "../../../../src/components/form/FormCheckbox.vue";
import FormField from "../../../../src/components/form/FormField.vue";
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

const value = ref(true);
const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

const label = computed(() => props.sceneId === "fallback" ? "" : String(controls.value.label ?? "启用同步"));

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    value.value = props.sceneId !== "fallback";
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
            label="同步状态"
            for="nb-lab-target"
            :error="scene.invalid ? '请确认同步状态' : ''"
            description="不提供 label 时组件显示当前布尔值，仍保留 checkbox 语义。"
        >
            <FormCheckbox
                id="nb-lab-target"
                v-model="value"
                :label="label"
                :disabled="Boolean(controls.disabled) || scene.disabled === true"
                @focus="report('focus', {target: 'checkbox'})"
                @update:model-value="report('update:modelValue', {value: $event})"
            />
        </FormField>
    </FixtureShell>
</template>
