<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";
import FormField from "../../../../src/components/form/FormField.vue";
import TimePicker from "../../../../src/components/form/TimePicker.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, getLabScene, type LabComponentDefinition} from "../registry";
import {computed} from "vue";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const value = ref<string | undefined>("09:30");
const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

const stepMinutes = computed(() => {
    const parsed = Number.parseInt(String(controls.value.step ?? "30"), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    value.value = props.sceneId === "invalid" ? undefined : "09:30";
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
        <FormField
            label="提醒时间"
            for="nb-lab-target"
            :error="scene.invalid ? '请选择有效时间' : ''"
            description="切到 macOS 主题时这里变成滚轮实现，v-model 契约不变。"
        >
            <TimePicker
                id="nb-lab-target"
                v-model="value"
                :min="String(controls.min ?? '08:00')"
                :max="String(controls.max ?? '20:00')"
                :step="stepMinutes"
                :invalid="scene.invalid === true"
                :disabled="scene.disabled === true"
                @update:model-value="report('update:modelValue', {value: $event})"
            />
        </FormField>
    </FixtureShell>
</template>
