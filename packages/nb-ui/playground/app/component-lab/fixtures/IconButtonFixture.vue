<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";
import IconButton from "../../../../src/components/controls/IconButton.vue";
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

const controls = ref<Record<string, string | boolean>>({});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
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
        <div class="lab-fixture__center">
            <IconButton
                id="nb-lab-target"
                title="刷新列表"
                :variant="(controls.variant ?? 'default') as 'default'"
                :size="(controls.size ?? 'md') as 'md'"
                :disabled="sceneId === 'disabled'"
                @click="report('click')"
            >
                <span class="i-lucide-refresh-cw" aria-hidden="true"></span>
            </IconButton>
        </div>
    </FixtureShell>
</template>
