<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import FormField from "../../../../src/components/form/FormField.vue";
import FormNumberInput, {type NumberInputSize} from "../../../../src/components/form/FormNumberInput.vue";
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

const value = ref("1.5");
const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    // bounded 场景从边界值起步，步进立即触发 clamp；invalid 场景从空值起步
    value.value = scene.value.invalid ? "" : props.sceneId === "bounded" ? "2" : "1.5";
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
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">写作排版参数</h3>
                    <p class="text-xs text-[var(--text-muted)]">数值微调输入控件，悬浮于窗口与桌面之上。</p>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)]">
                    数值输入 · FormNumberInput
                </span>
            </div>

            <!-- 数值输入控件展示 -->
            <div class="stage-box">
                <FormField
                    label="字数倍率 / 行高"
                    for="nb-lab-target"
                    :error="scene.invalid ? '请输入有效数字' : ''"
                    description="支持键盘上下键、滚轮与右侧步进按钮精确调节。"
                >
                    <FormNumberInput
                        id="nb-lab-target"
                        v-model="value"
                        :size="(controls.size ?? 'default') as NumberInputSize"
                        :disabled="Boolean(controls.disabled) || scene.disabled === true"
                        :readonly="Boolean(controls.readonly)"
                        min="0"
                        max="2"
                        :step="String(controls.step ?? '0.5')"
                        title="可用 ArrowUp / ArrowDown 或右侧步进按钮"
                        @update:model-value="report('update:modelValue', {value: $event})"
                        @submit="report('submit')"
                    />
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
