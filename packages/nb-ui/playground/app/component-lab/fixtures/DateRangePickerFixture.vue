<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import DateRangePicker from "../../../../src/components/form/DateRangePicker.vue";
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

const size = computed(() => (controls.value.size as any) || "md");
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
        <div class="macos-compact-card space-y-6 max-w-sm">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                复合日期区间选择器 (DateRangePicker)
            </h3>

            <div class="space-y-3">
                <span class="block text-xs font-semibold text-[var(--text-main)]">作品征文/连载活动起止周期:</span>
                <DateRangePicker
                    id="nb-lab-target"
                    v-model="dateRange"
                    :size="size"
                    :disabled="disabled"
                    placeholder="选择活动起止日期..."
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>
        </div>
    </FixtureShell>
</template>
