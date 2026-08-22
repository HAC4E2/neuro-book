<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Accordion, {type AccordionItemData} from "../../../../src/components/layout/Accordion.vue";
import Collapsible from "../../../../src/components/layout/Collapsible.vue";
import Button from "../../../../src/components/controls/Button.vue";
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
const activeItem = ref<string | string[]>("ch1");
const collapsibleOpen = ref(false);

const accordionType = computed(() => (controls.value.type as any) || "single");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const items: AccordionItemData[] = [
    {
        value: "ch1",
        title: "第一章：深渊苏醒与神经回响",
        subtitle: "字数：4,230 · 状态：已校对",
        iconClass: "i-lucide-book-open",
        content: "当意识的第一道脉冲穿过义体神经中枢时，窗外正下着新东京特有的霓虹酸雨。林澈睁开眼，视网膜HUD界面瞬间刷新出24条未读加密讯息...",
    },
    {
        value: "ch2",
        title: "第二章：赛博黑市与未解密钥",
        subtitle: "字数：3,890 · 状态：草稿",
        iconClass: "i-lucide-cpu",
        content: "地下十三层的通风管发出沉闷的低吼。接头人把一枚带有生物识别锁的微型芯片推过吧台，上面刻着已经绝迹的旧时代企业徽记...",
    },
    {
        value: "ch3",
        title: "第三章：幽灵协议与记忆碎片",
        subtitle: "字数：5,120 · 状态：大纲",
        iconClass: "i-lucide-shield-alert",
        content: "安全巡检无人机在头顶盘旋，红色的扫描光束切过潮湿的水泥墙面。林澈屏住呼吸，手指按在战术终端的紧急格式化物理开关上...",
    },
];

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
        <div class="space-y-6">
            <!-- 手风琴组件 -->
            <div class="macos-compact-card">
                <h3 class="text-sm font-bold text-[var(--text-main)] mb-3 pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                    大纲章节手风琴 (Accordion)
                </h3>

                <Accordion
                    id="nb-lab-target"
                    v-model="activeItem"
                    :type="accordionType"
                    :disabled="disabled"
                    :items="items"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>

            <!-- 轻量受控折叠容器 (Collapsible) -->
            <div class="macos-compact-card">
                <h3 class="text-sm font-bold text-[var(--text-main)] mb-3 pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                    轻量折叠面板 (Collapsible)
                </h3>

                <Collapsible v-model:open="collapsibleOpen">
                    <template #trigger>
                        <div class="flex items-center justify-between p-3 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)] cursor-pointer select-none">
                            <span class="text-xs font-semibold text-[var(--text-main)]">世界观基础设定 (点击展开/收起)</span>
                            <Button size="sm" variant="ghost">
                                {{ collapsibleOpen ? "收起" : "展开" }}
                            </Button>
                        </div>
                    </template>

                    <div class="mt-2.5 p-3.5 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_6%,transparent)] text-xs text-[var(--text-secondary)] leading-relaxed">
                        <p class="font-medium text-[var(--text-main)] mb-1">【脑机接口与神经网络】</p>
                        本世界观采用三级神经接入标准：低阶商用接口（仅支持视听HUD）、中阶执法专线（支持运动神经直连）与军规深潜协议（意识完全映射）。
                    </div>
                </Collapsible>
            </div>
        </div>
    </FixtureShell>
</template>
