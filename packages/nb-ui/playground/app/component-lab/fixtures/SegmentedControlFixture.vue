<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl, {type SegmentedControlOption, type SegmentedControlSize, type SegmentedControlTone} from "../../../../src/components/controls/SegmentedControl.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const value = ref<string | number | boolean | null>("left");
const controls = ref<Record<string, string | boolean>>({});

const options = computed<SegmentedControlOption[]>(() => [
    {label: "左对齐", value: "left", iconClass: "i-lucide-align-left"},
    {label: "居中", value: "center", iconClass: "i-lucide-align-center"},
    {label: "右对齐", value: "right", iconClass: "i-lucide-align-right", disabled: props.sceneId === "disabled-item"},
]);

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    value.value = "left";
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <SegmentedControl
            id="nb-lab-target"
            v-model="value"
            :options="options"
            :size="(controls.size ?? 'sm') as SegmentedControlSize"
            :tone="(controls.tone ?? 'default') as SegmentedControlTone"
            aria-label="对齐方式"
            @update:model-value="props.definition.events.includes('update:modelValue') && emit('lab-event', 'update:modelValue', {value: $event})"
        />
    </FixtureShell>
</template>
