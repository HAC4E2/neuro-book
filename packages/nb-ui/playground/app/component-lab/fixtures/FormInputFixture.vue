<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import FormField from "../../../../src/components/form/FormField.vue";
import FormInput, {type FormInputType} from "../../../../src/components/form/FormInput.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, getLabScene, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const value = ref("NeuroBook");
const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    value.value = scene.value.invalid ? "" : "NeuroBook";
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
            label="显示名称"
            for="nb-lab-target"
            :error="scene.invalid ? '名称不能为空' : ''"
            description="焦点、prefix 和原生输入属性都在同一个目标上。"
        >
            <FormInput
                id="nb-lab-target"
                v-model="value"
                :type="(controls.type ?? 'text') as FormInputType"
                :disabled="Boolean(controls.disabled) || scene.disabled === true"
                :readonly="Boolean(controls.readonly)"
                placeholder="输入名称"
                min="0"
                max="100"
                step="1"
                @focus="report('focus', {target: 'input'})"
                @update:model-value="report('update:modelValue', {value: $event})"
            >
                <template v-if="sceneId === 'prefix'" #prefix><span class="text-[var(--text-muted)]">@</span></template>
            </FormInput>
        </FormField>
    </FixtureShell>
</template>
