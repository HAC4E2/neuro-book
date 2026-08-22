<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";
import SwitchField from "../../../../src/components/controls/SwitchField.vue";
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

const value = ref(true);
const controls = ref<Record<string, string | boolean>>({});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    value.value = true;
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
        <div class="macos-compact-card space-y-4">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                表单开关字段 (SwitchField)
            </h3>

            <SwitchField
                id="nb-lab-target"
                v-model="value"
                label="自动同步"
                :description="String(controls.description ?? '')"
                :disabled="sceneId === 'disabled'"
                @update:model-value="report('update:modelValue', {value: $event})"
            />
        </div>
    </FixtureShell>
</template>
