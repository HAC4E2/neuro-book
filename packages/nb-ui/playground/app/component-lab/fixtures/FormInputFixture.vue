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
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-3 flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">项目基本信息</h3>
                    <p class="text-xs text-[var(--text-muted)]">表单单行输入控件，悬浮于窗口与桌面之上。</p>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)]">
                    文本输入 · FormInput
                </span>
            </div>

            <!-- 输入控件展示 -->
            <div class="stage-box">
                <FormField
                    label="显示名称"
                    for="nb-lab-target"
                    :error="scene.invalid ? '名称不能为空' : ''"
                    description="焦点光晕、前缀插槽与原生输入属性保持系统一致。"
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
                        <template v-if="sceneId === 'prefix'" #prefix>
                            <span class="text-[var(--text-muted)]">@</span>
                        </template>
                    </FormInput>
                </FormField>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.macos-compact-card {
    width: 100%;
    max-width: 480px;
    margin: var(--space-3) auto 0;
    padding: var(--space-5) var(--space-6);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-panel) 75%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    box-shadow: 0 20px 48px -12px color-mix(in srgb, var(--shadow-color) 26%, transparent),
                0 2px 8px color-mix(in srgb, var(--shadow-color) 8%, transparent);
}

.stage-box {
    position: relative;
    width: 100%;
    margin-top: var(--space-2);
}
</style>
