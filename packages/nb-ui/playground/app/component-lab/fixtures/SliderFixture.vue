<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Slider from "../../../../src/components/form/Slider.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

// 5 种不同设计方案切换
const designStyle = ref<"macos" | "minimal" | "crystal" | "notched" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生触觉圆钮 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平细条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光滑球", value: "crystal"},
    {label: "方案 4: 精工步进刻度卡槽", value: "notched"},
    {label: "方案 5: 实底工控高反差方条", value: "solid"},
];

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
    fontSize.value = 16;
    volumeRange.value = [20, 80];
    opacity.value = 75;
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <!-- 顶层设计风格切换栏 -->
        <div class="mb-6 flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)]">Slider 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">拖拽滑块体验阻尼手感与悬停放大反馈</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生触觉圆钮（推荐）</strong>——`rounded-full` 药丸轨道；滑块悬停 <code>hover:scale-110</code>，拖拽按压 <code>active:scale-95</code>，高亮条平滑阻尼填充。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平细条</strong>——超细 2px 紧凑轨道；滑块微型化，手感纯平极简。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光滑球</strong>——滑块外围扩散 <strong>4px 品牌弥散柔晕</strong>，填充条带有半透明晶体光泽。
                    </span>
                    <span v-else-if="designStyle === 'notched'" class="scheme-banner-text">
                        <strong>方案 4：精工步进刻度卡槽</strong>——带有物理分段刻度微指示，滑块卡位清脆准确。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方条</strong>——`rounded-[2px]` 硬质工控滑块 + 深色饱和粗轨道，高反差指示。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-sliders-horizontal h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">编辑器视觉与连续排版参数连续调节</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    滑动条 · Slider
                </span>
            </div>

            <div class="space-y-6">
                <!-- 单值滑块: 字号 -->
                <div>
                    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                        <span>正文排版字号 (Font Size)</span>
                        <span class="font-mono font-semibold text-[var(--accent-main)]">{{ fontSize }}px</span>
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

                <!-- 双值范围滑块: 导出章节分卷 -->
                <div>
                    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                        <span>分卷导出区间范围 (Volume Range)</span>
                        <span class="font-mono font-semibold text-[var(--accent-main)]">第 {{ volumeRange[0] }} ~ {{ volumeRange[1] }} 章</span>
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
                        <span>毛玻璃底纹磨砂透明度 (Backdrop Opacity)</span>
                        <span class="font-mono font-semibold text-[var(--accent-main)]">{{ opacity }}%</span>
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

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>当前字号预览: <span :style="{fontSize: `${fontSize}px`}" class="text-[var(--text-main)] font-serif leading-none">长篇小说样张</span></span>
                <span>当前方案: {{ designOptions.find(o => o.value === designStyle)?.label }}</span>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.macos-compact-card {
    width: 100%;
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

.scheme-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
    backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}

.scheme-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    background: var(--accent-main);
    color: var(--text-inverse);
    letter-spacing: 0.02em;
    flex-shrink: 0;
}

.scheme-banner-text {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
}
</style>
