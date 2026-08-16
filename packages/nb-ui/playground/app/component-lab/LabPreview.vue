<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import FormCheckbox from "../../../src/components/form/FormCheckbox.vue";
import FormField from "../../../src/components/form/FormField.vue";
import FormInput, {type FormInputType} from "../../../src/components/form/FormInput.vue";
import FormNumberInput, {type NumberInputSize} from "../../../src/components/form/FormNumberInput.vue";
import FormSelect, {type FormSelectDirection, type FormSelectOption, type FormSelectSize} from "../../../src/components/form/FormSelect.vue";
import {getLabComponent, type LabComponentId, type LabControlType} from "./registry";

const props = defineProps<{
    componentId: LabComponentId;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload: unknown): void;
    (event: "rendered"): void;
}>();

const definition = computed(() => getLabComponent(props.componentId));
const sceneIsInvalid = computed(() => props.sceneId === "invalid");
const sceneIsDisabled = computed(() => props.sceneId === "disabled");

const inputValue = ref("NeuroBook");
const inputDisabled = ref(false);
const inputReadonly = ref(false);
const inputType = ref<FormInputType>("text");

const numberValue = ref("1.5");
const numberDisabled = ref(false);
const numberReadonly = ref(false);
const numberSize = ref<NumberInputSize>("default");
const numberStep = ref("0.5");

const selectValue = ref("");
const selectDisabled = ref(false);
const selectHideCheckmark = ref(false);
const selectSize = ref<FormSelectSize>("default");
const selectDirection = ref<FormSelectDirection>("auto");

const checkboxValue = ref(false);
const checkboxDisabled = ref(false);
const checkboxLabel = ref("启用同步");

const selectOptions = computed<FormSelectOption[]>(() => {
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
    const {componentId, sceneId} = props;
    inputValue.value = sceneId === "invalid" ? "" : "NeuroBook";
    inputDisabled.value = componentId === "form-input" && sceneId === "disabled";
    inputReadonly.value = false;
    inputType.value = "text";

    numberValue.value = sceneId === "invalid" ? "" : sceneId === "bounded" ? "2" : "1.5";
    numberDisabled.value = componentId === "form-number-input" && sceneId === "disabled";
    numberReadonly.value = false;
    numberSize.value = "default";
    numberStep.value = "0.5";

    selectValue.value = sceneId === "default" ? "" : "md";
    selectDisabled.value = componentId === "form-select" && sceneId === "disabled";
    selectHideCheckmark.value = false;
    selectSize.value = "default";
    selectDirection.value = "auto";

    checkboxValue.value = sceneId !== "fallback";
    checkboxDisabled.value = componentId === "form-checkbox" && sceneId === "disabled";
    checkboxLabel.value = sceneId === "fallback" ? "" : "启用同步";
}

function report(name: string, payload: unknown = null): void {
    emit("lab-event", name, payload);
}

function reportValue(name: string, value: unknown): void {
    report(name, {value});
}

function controlValue(id: string): boolean | string {
    if (id === "disabled") return props.componentId === "form-input" ? inputDisabled.value : props.componentId === "form-number-input" ? numberDisabled.value : props.componentId === "form-select" ? selectDisabled.value : checkboxDisabled.value;
    if (id === "readonly") return props.componentId === "form-input" ? inputReadonly.value : numberReadonly.value;
    if (id === "type") return inputType.value;
    if (id === "size") return props.componentId === "form-number-input" ? numberSize.value : props.componentId === "form-select" ? selectSize.value : "default";
    if (id === "step") return numberStep.value;
    if (id === "direction") return selectDirection.value;
    if (id === "hideCheckmark") return selectHideCheckmark.value;
    if (id === "label") return checkboxLabel.value;
    return "";
}

function setBooleanControl(id: string, value: boolean): void {
    if (id === "disabled") {
        if (props.componentId === "form-input") inputDisabled.value = value;
        else if (props.componentId === "form-number-input") numberDisabled.value = value;
        else if (props.componentId === "form-select") selectDisabled.value = value;
        else checkboxDisabled.value = value;
    } else if (id === "readonly") {
        if (props.componentId === "form-input") inputReadonly.value = value;
        else numberReadonly.value = value;
    } else if (id === "hideCheckmark") {
        selectHideCheckmark.value = value;
    }
}

function setTextControl(id: string, value: string): void {
    if (id === "type") inputType.value = value as FormInputType;
    else if (id === "size") {
        if (props.componentId === "form-number-input") numberSize.value = value as NumberInputSize;
        else selectSize.value = value as FormSelectSize;
    } else if (id === "step") numberStep.value = value;
    else if (id === "direction") selectDirection.value = value as FormSelectDirection;
    else if (id === "label") checkboxLabel.value = value;
}

function updateControl(id: string, type: LabControlType, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (type === "boolean") setBooleanControl(id, (target as HTMLInputElement).checked);
    else setTextControl(id, target.value);
}

function announceRendered(): void {
    void nextTick(() => emit("rendered"));
}

watch(() => [props.componentId, props.sceneId], () => {
    resetState();
    announceRendered();
}, {immediate: true});

onMounted(announceRendered);
</script>

<template>
    <div class="lab-preview">
        <div class="lab-preview__surface">
            <div class="lab-preview__fixture">
                <div class="lab-preview__eyebrow">{{ definition.label }} / {{ definition.scenes.find((scene) => scene.id === props.sceneId)?.label ?? props.sceneId }}</div>

                <FormField v-if="props.componentId === 'form-input'" label="显示名称" :error="sceneIsInvalid ? '名称不能为空' : ''" description="焦点、prefix 和原生输入属性都在同一个目标上。">
                    <FormInput
                        v-if="props.sceneId === 'prefix'"
                        id="nb-lab-target"
                        v-model="inputValue"
                        :type="inputType"
                        :disabled="inputDisabled || sceneIsDisabled"
                        :readonly="inputReadonly"
                        placeholder="输入名称"
                        min="0"
                        max="100"
                        step="1"
                        @focus="report('focus', {target: 'input'})"
                        @update:model-value="reportValue('update:modelValue', $event)"
                    >
                        <template #prefix><span class="text-[var(--text-muted)]">@</span></template>
                    </FormInput>
                    <FormInput
                        v-else
                        id="nb-lab-target"
                        v-model="inputValue"
                        :type="inputType"
                        :disabled="inputDisabled || sceneIsDisabled"
                        :readonly="inputReadonly"
                        placeholder="输入名称"
                        min="0"
                        max="100"
                        step="1"
                        @focus="report('focus', {target: 'input'})"
                        @update:model-value="reportValue('update:modelValue', $event)"
                    />
                </FormField>

                <FormField v-else-if="props.componentId === 'form-number-input'" label="字数上限" :error="sceneIsInvalid ? '请输入有效数字' : ''" description="用文本输入保留空值、负号和小数点等编辑中间态。">
                    <FormNumberInput
                        id="nb-lab-target"
                        v-model="numberValue"
                        :size="numberSize"
                        :disabled="numberDisabled || sceneIsDisabled"
                        :readonly="numberReadonly"
                        min="0"
                        max="2"
                        :step="numberStep"
                        title="可用 ArrowUp / ArrowDown 或右侧步进按钮"
                        @update:model-value="reportValue('update:modelValue', $event)"
                        @submit="report('submit')"
                    />
                </FormField>

                <FormField v-else-if="props.componentId === 'form-select'" label="导出格式" :error="sceneIsInvalid ? '请选择一个可用格式' : ''" description="展开后检查 portal、方向、说明文字和禁用项。">
                    <FormSelect
                        id="nb-lab-target"
                        v-model="selectValue"
                        :options="selectOptions"
                        :size="selectSize"
                        :dropdown-direction="selectDirection"
                        :hide-checkmark="selectHideCheckmark"
                        :disabled="selectDisabled || sceneIsDisabled"
                        placeholder="选择格式"
                        @focus="report('focus', {target: 'combobox'})"
                        @update:model-value="reportValue('update:modelValue', $event)"
                    />
                </FormField>

                <FormField v-else for="nb-lab-target" label="同步状态" :error="sceneIsInvalid ? '请确认同步状态' : ''" description="不提供 label 时组件显示当前布尔值，仍保留 checkbox 语义。">
                    <FormCheckbox
                        id="nb-lab-target"
                        v-model="checkboxValue"
                        :label="checkboxLabel"
                        :disabled="checkboxDisabled || sceneIsDisabled"
                        @focus="report('focus', {target: 'checkbox'})"
                        @update:model-value="reportValue('update:modelValue', $event)"
                    />
                </FormField>

                <p>场景状态由 URL 恢复；变量覆盖只在组件调试页生效。</p>
            </div>
        </div>

        <section class="lab-props" aria-label="场景属性">
            <h2>场景属性</h2>
            <div class="lab-props-grid">
                <label v-for="control in definition.controls" :key="control.id" class="lab-prop-field">
                    <span>{{ control.label }}</span>
                    <span v-if="control.type === 'boolean'" class="lab-prop-check">
                        <input type="checkbox" :checked="Boolean(controlValue(control.id))" @change="updateControl(control.id, control.type, $event)">
                        使用此状态
                    </span>
                    <select v-else-if="control.type === 'select'" class="lab-native-select" :value="String(controlValue(control.id))" @change="updateControl(control.id, control.type, $event)">
                        <option v-for="option in control.options" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <input v-else class="lab-native-input" type="text" :value="String(controlValue(control.id))" @change="updateControl(control.id, control.type, $event)">
                </label>
            </div>
        </section>
    </div>
</template>
