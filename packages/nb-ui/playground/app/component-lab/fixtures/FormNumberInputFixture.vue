<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
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

// 5 种不同设计方案切换
const designStyle = ref<"macos" | "minimal" | "split" | "crystal" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 经典上下微调钮 (推荐)", value: "macos"},
    {label: "方案 2: 极简纯平内嵌步进", value: "minimal"},
    {label: "方案 3: 左右分离两翼加减", value: "split"},
    {label: "方案 4: 悬浮微晶数显胶囊", value: "crystal"},
    {label: "方案 5: 实底工控高对比", value: "solid"},
];

// 真实小说排版与工作区参数
const lineHeight = ref(1.75);
const targetWordCount = ref(3500);
const aiTemperature = ref(0.7);
const snapshotMinutes = ref(15);

const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    lineHeight.value = scene.value.invalid ? 0 : 1.75;
    targetWordCount.value = 3500;
    aiTemperature.value = 0.7;
    snapshotMinutes.value = 15;
}

function adjustVal(target: "lineHeight" | "targetWordCount" | "aiTemperature" | "snapshotMinutes", delta: number): void {
    if (Boolean(controls.value.disabled) || scene.value.disabled) return;
    if (target === "lineHeight") {
        lineHeight.value = Math.max(1.0, Math.min(3.0, Number((lineHeight.value + delta).toFixed(2))));
    } else if (target === "targetWordCount") {
        targetWordCount.value = Math.max(500, Math.min(20000, targetWordCount.value + delta));
    } else if (target === "aiTemperature") {
        aiTemperature.value = Math.max(0.0, Math.min(1.5, Number((aiTemperature.value + delta).toFixed(1))));
    } else if (target === "snapshotMinutes") {
        snapshotMinutes.value = Math.max(1, Math.min(120, snapshotMinutes.value + delta));
    }
    emit("lab-event", "update:modelValue", {target, delta});
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
        <!-- 顶层设计风格切换栏 -->
        <div class="mb-6 flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)]">FormNumberInput 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击上下微调或左右按钮体验步进反馈</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 经典上下微调钮（推荐）</strong>——`rounded-[6px]` 超椭圆；右侧集成上下微型双联 Chevron 按钮，按压带有 <code>active:scale-[0.88]</code> 物理下沉感，支持微步进与长按连续加速。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：极简纯平内嵌步进</strong>——`rounded-[8px]` 现代大圆角；无外框，右侧上下按钮常态半隐，悬停时平滑浮现 12% 柔光底板。
                    </span>
                    <span v-else-if="designStyle === 'split'" class="scheme-banner-text">
                        <strong>方案 3：左右分离两翼加减</strong>——左右两端各嵌一颗独立 <code>[-]</code> 与 <code>[+]</code> 圆角方块，中间为纯文本读数，触控面积大，手感极佳。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 4：悬浮微晶数显胶囊</strong>——`rounded-full` 正圆胶囊；75% 半透明高斯磨砂底，数字居中发光，右侧微晶上下滑块。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高对比</strong>——`rounded-[4px]` 工业精密切割；常态 14% 实底 + 1px 细微网格线，两端配备实心硬质步进按键。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-4 flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-sliders h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">写作引擎与排版数值调节</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    数值步进 · FormNumberInput
                </span>
            </div>

            <!-- 5 种方案渲染演示区 -->
            <div class="space-y-4">
                <!-- 1. 正文排版行高比例 -->
                <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
                        <span>正文行距倍率 (Line Height)</span>
                        <span class="font-mono text-[var(--accent-main)]">{{ lineHeight }}x</span>
                    </div>

                    <!-- 方案 1: macOS 经典上下微调钮 -->
                    <div
                        v-if="designStyle === 'macos'"
                        class="relative flex h-9 items-center rounded-[6px] border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] px-3 focus-within:border-[var(--accent-main)] focus-within:shadow-[var(--focus-ring)]"
                    >
                        <input
                            id="nb-lab-target"
                            v-model.number="lineHeight"
                            type="number"
                            step="0.05"
                            class="w-full bg-transparent font-mono text-sm text-[var(--text-main)] outline-none"
                        />
                        <div class="flex flex-col border-l border-[color-mix(in_srgb,var(--text-main)_14%,transparent)] pl-1.5 -mr-1">
                            <button
                                type="button"
                                class="flex h-3.5 w-5 items-center justify-center rounded-[3px] text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] hover:text-[var(--text-main)] active:scale-90 cursor-pointer"
                                @click="adjustVal('lineHeight', 0.05)"
                            >
                                <span class="i-lucide-chevron-up h-3 w-3" />
                            </button>
                            <button
                                type="button"
                                class="flex h-3.5 w-5 items-center justify-center rounded-[3px] text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] hover:text-[var(--text-main)] active:scale-90 cursor-pointer"
                                @click="adjustVal('lineHeight', -0.05)"
                            >
                                <span class="i-lucide-chevron-down h-3 w-3" />
                            </button>
                        </div>
                    </div>

                    <!-- 方案 2: 极简纯平内嵌步进 -->
                    <div
                        v-else-if="designStyle === 'minimal'"
                        class="group relative flex h-9 items-center rounded-[8px] bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] px-3 focus-within:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] focus-within:ring-2 focus-within:ring-[var(--accent-main)]"
                    >
                        <input
                            v-model.number="lineHeight"
                            type="number"
                            step="0.05"
                            class="w-full bg-transparent font-mono text-sm text-[var(--text-main)] outline-none"
                        />
                        <div class="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                                type="button"
                                class="h-6 w-6 rounded-md bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] flex items-center justify-center text-[var(--text-main)] active:scale-90 cursor-pointer text-xs"
                                @click="adjustVal('lineHeight', -0.05)"
                            >-</button>
                            <button
                                type="button"
                                class="h-6 w-6 rounded-md bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] flex items-center justify-center text-[var(--text-main)] active:scale-90 cursor-pointer text-xs"
                                @click="adjustVal('lineHeight', 0.05)"
                            >+</button>
                        </div>
                    </div>

                    <!-- 方案 3: 左右分离两翼加减 -->
                    <div
                        v-else-if="designStyle === 'split'"
                        class="flex h-9 items-center rounded-[6px] border border-[color-mix(in_srgb,var(--text-main)_18%,transparent)] p-0.5 bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)]"
                    >
                        <button
                            type="button"
                            class="h-full w-8 rounded-[4px] bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_18%,transparent)] flex items-center justify-center text-[var(--text-main)] active:scale-90 cursor-pointer font-bold"
                            @click="adjustVal('lineHeight', -0.05)"
                        >
                            <span class="i-lucide-minus h-3.5 w-3.5" />
                        </button>
                        <input
                            v-model.number="lineHeight"
                            type="number"
                            step="0.05"
                            class="w-full text-center bg-transparent font-mono text-sm font-semibold text-[var(--text-main)] outline-none"
                        />
                        <button
                            type="button"
                            class="h-full w-8 rounded-[4px] bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_18%,transparent)] flex items-center justify-center text-[var(--text-main)] active:scale-90 cursor-pointer font-bold"
                            @click="adjustVal('lineHeight', 0.05)"
                        >
                            <span class="i-lucide-plus h-3.5 w-3.5" />
                        </button>
                    </div>

                    <!-- 方案 4: 悬浮微晶数显胶囊 -->
                    <div
                        v-else-if="designStyle === 'crystal'"
                        class="flex h-9 items-center justify-between rounded-full border border-[color-mix(in_srgb,var(--text-main)_15%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] backdrop-blur-md px-3 shadow-sm focus-within:shadow-[0_0_12px_color-mix(in_srgb,var(--accent-main)_35%,transparent)]"
                    >
                        <input
                            v-model.number="lineHeight"
                            type="number"
                            step="0.05"
                            class="w-full bg-transparent font-mono text-sm font-bold text-[var(--accent-main)] outline-none"
                        />
                        <div class="flex items-center gap-1.5">
                            <button
                                type="button"
                                class="h-6 w-6 rounded-full bg-[color-mix(in_srgb,var(--accent-main)_15%,transparent)] text-[var(--accent-main)] hover:bg-[var(--accent-main)] hover:text-[var(--text-inverse)] flex items-center justify-center transition-colors active:scale-90 cursor-pointer"
                                @click="adjustVal('lineHeight', -0.05)"
                            >
                                <span class="i-lucide-minus h-3 w-3" />
                            </button>
                            <button
                                type="button"
                                class="h-6 w-6 rounded-full bg-[color-mix(in_srgb,var(--accent-main)_15%,transparent)] text-[var(--accent-main)] hover:bg-[var(--accent-main)] hover:text-[var(--text-inverse)] flex items-center justify-center transition-colors active:scale-90 cursor-pointer"
                                @click="adjustVal('lineHeight', 0.05)"
                            >
                                <span class="i-lucide-plus h-3 w-3" />
                            </button>
                        </div>
                    </div>

                    <!-- 方案 5: 实底工控高对比 -->
                    <div
                        v-else-if="designStyle === 'solid'"
                        class="flex h-9 items-center rounded-[4px] border-2 border-[color-mix(in_srgb,var(--text-main)_30%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] overflow-hidden"
                    >
                        <button
                            type="button"
                            class="h-full px-3 bg-[color-mix(in_srgb,var(--text-main)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_30%,transparent)] text-[var(--text-main)] font-black active:bg-[var(--accent-main)] active:text-[var(--text-inverse)] cursor-pointer"
                            @click="adjustVal('lineHeight', -0.05)"
                        >-</button>
                        <input
                            v-model.number="lineHeight"
                            type="number"
                            step="0.05"
                            class="w-full text-center bg-transparent font-mono text-sm font-black text-[var(--text-main)] outline-none"
                        />
                        <button
                            type="button"
                            class="h-full px-3 bg-[color-mix(in_srgb,var(--text-main)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_30%,transparent)] text-[var(--text-main)] font-black active:bg-[var(--accent-main)] active:text-[var(--text-inverse)] cursor-pointer"
                            @click="adjustVal('lineHeight', 0.05)"
                        >+</button>
                    </div>
                </div>

                <!-- 2. 单章目标字数限额 -->
                <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
                        <span>单章推荐字数 (Target Words)</span>
                        <span class="font-mono text-[var(--accent-main)]">{{ targetWordCount }} 字</span>
                    </div>
                    <div class="flex h-9 items-center justify-between rounded-[6px] border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] px-3 focus-within:border-[var(--accent-main)] focus-within:shadow-[var(--focus-ring)]">
                        <input
                            v-model.number="targetWordCount"
                            type="number"
                            step="500"
                            class="w-full bg-transparent font-mono text-sm text-[var(--text-main)] outline-none"
                        />
                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                class="px-2 py-0.5 rounded text-xs bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_16%,transparent)] text-[var(--text-main)] active:scale-95 cursor-pointer font-mono"
                                @click="adjustVal('targetWordCount', -500)"
                            >-500</button>
                            <button
                                type="button"
                                class="px-2 py-0.5 rounded text-xs bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_16%,transparent)] text-[var(--text-main)] active:scale-95 cursor-pointer font-mono"
                                @click="adjustVal('targetWordCount', 500)"
                            >+500</button>
                        </div>
                    </div>
                </div>

                <!-- 3. AI 灵感创意温度 -->
                <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
                        <span>AI 创意散发温度 (Temperature: 0.0 ~ 1.5)</span>
                        <span class="font-mono text-[var(--accent-main)]">{{ aiTemperature }}</span>
                    </div>
                    <div class="flex h-9 items-center justify-between rounded-[6px] border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] px-3">
                        <input
                            v-model.number="aiTemperature"
                            type="number"
                            step="0.1"
                            class="w-full bg-transparent font-mono text-sm text-[var(--text-main)] outline-none"
                        />
                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                class="px-2 py-0.5 rounded text-xs bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_16%,transparent)] text-[var(--text-main)] active:scale-95 cursor-pointer font-mono"
                                @click="adjustVal('aiTemperature', -0.1)"
                            >-0.1</button>
                            <button
                                type="button"
                                class="px-2 py-0.5 rounded text-xs bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_16%,transparent)] text-[var(--text-main)] active:scale-95 cursor-pointer font-mono"
                                @click="adjustVal('aiTemperature', 0.1)"
                            >+0.1</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-5 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span class="font-mono">ID: {{ scene.id }} | {{ scene.label }}</span>
                <span>当前方案: {{ designOptions.find(o => o.value === designStyle)?.label }}</span>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.macos-compact-card {
    width: 100%;
    max-width: 520px;
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
