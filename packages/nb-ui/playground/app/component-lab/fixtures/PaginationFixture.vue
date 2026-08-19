<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Pagination from "../../../../src/components/controls/Pagination.vue";
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

const page = ref(3);
const controls = ref<Record<string, string | boolean>>({});

const pageCount = computed(() => {
    const parsed = Number.parseInt(String(controls.value.pageCount ?? "9"), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 9;
});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    if (props.sceneId === "first") page.value = 1;
    else if (props.sceneId === "last") page.value = Number.parseInt(String(defaults.pageCount ?? "9"), 10) || 9;
    else page.value = 3;
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
            <Pagination
                id="nb-lab-target"
                v-model:page="page"
                :page-count="pageCount"
                @update:page="report('update:page', {value: $event})"
            />
        </div>
    </FixtureShell>
</template>
