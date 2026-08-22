<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Switch, {type SwitchSize} from "../../../../src/components/controls/Switch.vue";
import SwitchField from "../../../../src/components/controls/SwitchField.vue";
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
const autoSave = ref(true);
const cloudSync = ref(false);
const focusMode = ref(true);

const size = computed<SwitchSize>(() => (controls.value.size as SwitchSize) || "md");
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
        <div class="macos-compact-card space-y-6 max-w-lg">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                开关控件 (Switch) 与表单开关字段 (SwitchField)
            </h3>

            <!-- 纯 Switch 控件 -->
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">实时自动保存</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">键入停顿 800ms 后自动写入本地 SQLite 数据库</span>
                    </div>
                    <Switch
                        id="nb-lab-target"
                        v-model="autoSave"
                        :size="size"
                        :disabled="disabled"
                        @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    />
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">云端加密多端同步</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">端到端加密同步至个人云存储</span>
                    </div>
                    <Switch
                        v-model="cloudSync"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>
            </div>

            <!-- SwitchField 表单字段 -->
            <div class="pt-4 border-t border-[var(--divider)]">
                <SwitchField
                    v-model="focusMode"
                    label="全屏沉浸专注模式"
                    hint="自动隐藏侧栏大纲与状态条，只保留纯粹稿纸"
                    :disabled="disabled"
                />
            </div>
        </div>
    </FixtureShell>
</template>
