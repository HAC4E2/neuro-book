<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Popover from "../../../../src/components/feedback/Popover.vue";
import HoverCard from "../../../../src/components/feedback/HoverCard.vue";
import Button from "../../../../src/components/controls/Button.vue";
import Badge from "../../../../src/components/display/Badge.vue";
import FormInput from "../../../../src/components/form/FormInput.vue";
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
const popoverOpen = ref(false);
const quickNote = ref("");

const side = computed(() => (controls.value.side as any) || "bottom");
const arrow = computed(() => Boolean(controls.value.arrow));

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
        <div class="macos-compact-card space-y-6">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                气泡卡片与悬浮词条 (Popover & HoverCard)
            </h3>

            <!-- Popover 示例 -->
            <div class="flex items-center gap-4 flex-wrap">
                <Popover
                    v-model:open="popoverOpen"
                    :side="side"
                    :arrow="arrow"
                    @update:open="emit('lab-event', 'update:open', $event)"
                >
                    <template #trigger>
                        <Button id="nb-lab-target" variant="secondary" icon-class="i-lucide-bookmark-plus">
                            添加行内批注 (Popover)
                        </Button>
                    </template>

                    <div class="w-64 space-y-3">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-[var(--text-main)]">快速批注卡片</span>
                            <Badge size="sm" tone="accent" variant="soft">第 14 行</Badge>
                        </div>
                        <FormInput
                            v-model="quickNote"
                            placeholder="输入批注内容..."
                        />
                        <div class="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" @click="popoverOpen = false">取消</Button>
                            <Button size="sm" variant="primary" @click="popoverOpen = false">保存批注</Button>
                        </div>
                    </div>
                </Popover>
            </div>

            <!-- HoverCard 长篇写作设定集词条划词预览示例 -->
            <div class="p-4 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <p class="text-sm leading-relaxed text-[var(--text-secondary)]">
                    在《赛博夜雨》正文中，主角装备了军规级
                    <HoverCard :side="side" :arrow="arrow">
                        <template #trigger>
                            <span class="inline-flex items-center font-semibold text-[var(--accent-main)] underline decoration-dotted underline-offset-4 cursor-pointer hover:opacity-80">
                                「深潜神经义眼 Mk-IV」
                            </span>
                        </template>

                        <div class="space-y-2">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-xs font-bold text-[var(--text-main)]">深潜神经义眼 Mk-IV</span>
                                <Badge size="sm" tone="warning" variant="solid">绝密军规</Badge>
                            </div>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
                                由荒坂科技第七生化实验室研制的特种战术义体，支持全频段电磁波谱感知与量子加密视网膜直连。
                            </p>
                            <div class="flex items-center gap-2 pt-1 text-[11px] text-[var(--text-muted)] border-t border-[var(--divider)]">
                                <span>出场：第1卷第3章</span>
                                <span>·</span>
                                <span>关联人物：林澈</span>
                            </div>
                        </div>
                    </HoverCard>
                    ，在夜雨滂沱的霓虹街头穿梭自如。
                </p>
            </div>
        </div>
    </FixtureShell>
</template>
