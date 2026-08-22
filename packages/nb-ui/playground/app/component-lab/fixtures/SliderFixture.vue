<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Slider from "../../../../src/components/form/Slider.vue";
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

const fontSize = ref(16);
const volumeRange = ref([20, 80]);
const opacity = ref(75);

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
        <div class="macos-compact-card">
            <h3 class="text-sm font-bold text-[var(--text-main)] mb-4 pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                滑动条属性调节
            </h3>

            <div class="space-y-6 max-w-md">
                <!-- 单值滑块 -->
                <div>
                    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                        <span>字体大小 (Font Size)</span>
                        <span class="font-mono font-semibold text-[var(--text-main)]">{{ fontSize }}px</span>
                    </div>
                    <Slider
                        id="nb-lab-target"
                        v-model="fontSize"
                        :min="12"
                        :max="32"
                        :step="1"
                        :size="size"
                        :disabled="disabled"
                        @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    />
                </div>

                <!-- 双值范围滑块 -->
                <div>
                    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                        <span>阅读分卷章节范围</span>
                        <span class="font-mono font-semibold text-[var(--text-main)]">第 {{ volumeRange[0] }} ~ {{ volumeRange[1] }} 章</span>
                    </div>
                    <Slider
                        v-model="volumeRange"
                        :min="1"
                        :max="100"
                        :step="1"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>

                <!-- 磨砂透明度 -->
                <div>
                    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                        <span>毛玻璃透明度</span>
                        <span class="font-mono font-semibold text-[var(--text-main)]">{{ opacity }}%</span>
                    </div>
                    <Slider
                        v-model="opacity"
                        :min="0"
                        :max="100"
                        :step="5"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>
            </div>
        </div>
    </FixtureShell>
</template>
