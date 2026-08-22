<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import PinInput from "../../../../src/components/form/PinInput.vue";
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
const pinValue = ref<string[]>([]);
const mask = computed(() => Boolean(controls.value.mask));
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
        <div class="macos-compact-card space-y-4 max-w-sm">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                安全验证码 / PIN 码输入 (PinInput)
            </h3>

            <div class="space-y-3">
                <span class="block text-xs font-semibold text-[var(--text-main)]">请输入作品加密口令</span>
                <PinInput
                    id="nb-lab-target"
                    v-model="pinValue"
                    :length="6"
                    :mask="mask"
                    :disabled="disabled"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    @complete="emit('lab-event', 'complete', $event)"
                />
                <span class="block text-[11px] text-[var(--text-muted)]">支持数字键盘键入与退格自动聚焦</span>
            </div>
        </div>
    </FixtureShell>
</template>
