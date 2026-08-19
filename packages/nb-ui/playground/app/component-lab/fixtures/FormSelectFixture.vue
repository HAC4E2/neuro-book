<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import FormField from "../../../../src/components/form/FormField.vue";
import FormSelect, {type FormSelectDirection, type FormSelectOption, type FormSelectSize} from "../../../../src/components/form/FormSelect.vue";
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

const value = ref("");
const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

const options = computed<FormSelectOption[]>(() => {
    if (props.sceneId === "rich") {
        return [
            {label: "Markdown（.md）", value: "md", description: "适合长文写作", iconClass: "i-lucide-file-text"},
            {label: "纯文本（.txt）", value: "txt", description: "不带格式的文本"},
            {label: "PDF（暂不可用）", value: "pdf", description: "导出器尚未安装", disabled: true},
        ];
    }
    return [
        {label: "Markdown（.md）", value: "md"},
        {label: "纯文本（.txt）", value: "txt"},
        {label: "PDF（暂不可用）", value: "pdf", disabled: true},
    ];
});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    // 默认场景从未选中起步以展示 placeholder；其余场景预选 md
    value.value = props.sceneId === "default" ? "" : "md";
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
            label="导出格式"
            for="nb-lab-target"
            :error="scene.invalid ? '请选择一个可用格式' : ''"
            description="展开后检查 portal、方向、说明文字和禁用项。"
        >
            <FormSelect
                id="nb-lab-target"
                v-model="value"
                :options="options"
                :size="(controls.size ?? 'default') as FormSelectSize"
                :dropdown-direction="(controls.direction ?? 'auto') as FormSelectDirection"
                :hide-checkmark="Boolean(controls.hideCheckmark)"
                :disabled="Boolean(controls.disabled) || scene.disabled === true"
                placeholder="选择格式"
                @focus="report('focus', {target: 'combobox'})"
                @update:model-value="report('update:modelValue', {value: $event})"
            />
        </FormField>
    </FixtureShell>
</template>
