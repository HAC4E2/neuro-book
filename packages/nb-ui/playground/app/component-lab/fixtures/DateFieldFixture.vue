<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import DateField from "../../../../src/components/form/DateField.vue";
import DateRangeField from "../../../../src/components/form/DateRangeField.vue";
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
const dateValue = ref();
const rangeValue = ref<any>({start: undefined, end: undefined});

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
                分段日期输入框 (DateField)
            </h3>

            <div class="space-y-4">
                <div>
                    <span class="block text-xs font-semibold text-[var(--text-main)] mb-1.5">单日期分段精准输入:</span>
                    <DateField
                        id="nb-lab-target"
                        v-model="dateValue"
                        :size="size"
                        :disabled="disabled"
                        @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    />
                </div>

                <div class="pt-3 border-t border-[var(--divider)]">
                    <span class="block text-xs font-semibold text-[var(--text-main)] mb-1.5">起止区间分段输入 (DateRangeField):</span>
                    <DateRangeField
                        v-model="rangeValue"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>
            </div>
        </div>
    </FixtureShell>
</template>
