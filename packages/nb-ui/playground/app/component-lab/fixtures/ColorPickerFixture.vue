<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import ColorPicker from "../../../../src/components/form/ColorPicker.vue";
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
const primaryColor = ref("#6366F1");
const accentColor = ref("#EC4899");
const tagColor = ref("#10B981");

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
                取色器与调色板 (ColorPicker)
            </h3>

            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">主题主色 (Primary)</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">核心按钮与聚焦发光</span>
                    </div>
                    <ColorPicker
                        id="nb-lab-target"
                        v-model="primaryColor"
                        :size="size"
                        :disabled="disabled"
                        @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    />
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">强调色 (Accent)</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">高亮徽章与活动态</span>
                    </div>
                    <ColorPicker
                        v-model="accentColor"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">章节标签色彩</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">大纲树标签标记</span>
                    </div>
                    <ColorPicker
                        v-model="tagColor"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>
            </div>
        </div>
    </FixtureShell>
</template>
