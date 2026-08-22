<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import RangeCalendar from "../../../../src/components/form/RangeCalendar.vue";
import type {DateRange} from "reka-ui";
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
const dateRange = ref<any>({start: undefined, end: undefined});

const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

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
        <div class="macos-compact-card space-y-4 max-w-md">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                区间选择日历 (RangeCalendar)
            </h3>

            <div class="flex flex-col items-center gap-3">
                <span class="text-xs text-[var(--text-muted)]">选择长篇创作打卡统计起止区间</span>
                <RangeCalendar
                    id="nb-lab-target"
                    v-model="dateRange"
                    :disabled="disabled"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>
        </div>
    </FixtureShell>
</template>
