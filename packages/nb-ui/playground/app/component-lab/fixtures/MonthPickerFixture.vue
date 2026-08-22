<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import MonthPicker from "../../../../src/components/form/MonthPicker.vue";
import MonthRangePicker from "../../../../src/components/form/MonthRangePicker.vue";
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
const selectedMonth = ref();
const monthRange = ref<any>({start: undefined, end: undefined});

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
                月份与月份区间选择器 (MonthPicker)
            </h3>

            <div class="flex flex-col items-center gap-4">
                <div class="w-full">
                    <span class="block text-xs font-semibold text-[var(--text-muted)] mb-2 text-center">单月份选择 (写作月度统计):</span>
                    <MonthPicker
                        id="nb-lab-target"
                        v-model="selectedMonth"
                        :disabled="disabled"
                        @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    />
                </div>

                <div class="w-full pt-4 border-t border-[var(--divider)]">
                    <span class="block text-xs font-semibold text-[var(--text-muted)] mb-2 text-center">跨月区间选择 (MonthRangePicker):</span>
                    <MonthRangePicker
                        v-model="monthRange"
                        :disabled="disabled"
                    />
                </div>
            </div>
        </div>
    </FixtureShell>
</template>
