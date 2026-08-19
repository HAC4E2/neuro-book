<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";
import Tabs, {type TabsItem, type TabsSize} from "../../../../src/components/controls/Tabs.vue";
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

const value = ref("controls");
const controls = ref<Record<string, string | boolean>>({});

const tabItems: TabsItem[] = [
    {value: "controls", label: "控件", iconClass: "i-lucide-sliders-horizontal"},
    {value: "data", label: "数据", count: 4},
    {value: "off", label: "禁用", disabled: true},
];

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    value.value = "controls";
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
        <Tabs
            id="nb-lab-target"
            v-model="value"
            :items="tabItems"
            :size="(controls.size ?? 'md') as TabsSize"
            aria-label="示例页签"
            @update:model-value="report('update:modelValue', {value: $event})"
        />
    </FixtureShell>
</template>
