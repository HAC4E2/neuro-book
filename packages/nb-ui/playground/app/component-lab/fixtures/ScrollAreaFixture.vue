<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import ScrollArea from "../../../../src/components/layout/ScrollArea.vue";
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
        <div class="macos-compact-card space-y-4">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                自定义滚动区域 (ScrollArea)
            </h3>

            <div class="h-64 rounded-[var(--radius-panel)] border border-[color-mix(in_srgb,var(--text-main)_10%,transparent)] bg-[var(--bg-main)] p-1">
                <ScrollArea id="nb-lab-target" class="h-full">
                    <div class="p-4 space-y-3 text-xs text-[var(--text-secondary)] leading-relaxed">
                        <h4 class="font-bold text-[var(--text-main)] text-sm">《赛博夜雨》卷首语与世界观白皮书</h4>
                        <p>在新东京的阴雨之下，意识与代码的界限早已模糊。每一次神经连接的火花，都是人类向数字神明献祭的微光。</p>
                        <p>我们在此记录那些在霓虹暗巷中穿梭的影子：被遗弃的赛博格、私自调试军规义体的地下医者，以及在量子暗网中追寻自由的幽灵协议。</p>
                        <p>世界不是由钢铁构成的，而是由流动的数据与不可磨灭的记忆交织而成。当你深潜入意识的奇点，请记住唯一的安全法则：永远不要相信没有经过本地加密的视网膜投影。</p>
                        <p>第七生化实验室的遗迹依然在地下散发着危险的热辐射，那些关于永生与升维的狂热誓言，终将沦为新时代街头流浪者的醉后谈资。</p>
                    </div>
                </ScrollArea>
            </div>
        </div>
    </FixtureShell>
</template>
