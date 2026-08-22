<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Progress, {type ProgressSize, type ProgressTone} from "../../../../src/components/display/Progress.vue";
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
const progressValue = ref(68);

const size = computed<ProgressSize>(() => (controls.value.size as ProgressSize) || "md");
const tone = computed<ProgressTone>(() => (controls.value.tone as ProgressTone) || "accent");

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
        <div class="macos-compact-card space-y-6 max-w-md">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                进度条 (Progress)
            </h3>

            <!-- 动态受控进度 -->
            <div>
                <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                    <span>全书创作总进度</span>
                    <span class="font-mono font-semibold text-[var(--text-main)]">{{ progressValue }}%</span>
                </div>
                <Progress
                    id="nb-lab-target"
                    :model-value="progressValue"
                    :tone="tone"
                    :size="size"
                />
            </div>

            <!-- 四种状态语调进度展示 -->
            <div class="space-y-3 pt-4 border-t border-[var(--divider)]">
                <div>
                    <div class="flex justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>主要创作目标 (Accent)</span>
                        <span>80%</span>
                    </div>
                    <Progress :model-value="80" tone="accent" size="sm" />
                </div>

                <div>
                    <div class="flex justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>本地备份同步完成 (Success)</span>
                        <span>100%</span>
                    </div>
                    <Progress :model-value="100" tone="success" size="sm" />
                </div>

                <div>
                    <div class="flex justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>存储空间预警 (Warning)</span>
                        <span>85%</span>
                    </div>
                    <Progress :model-value="85" tone="warning" size="sm" />
                </div>

                <div>
                    <div class="flex justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>字数超出本卷上限 (Danger)</span>
                        <span>95%</span>
                    </div>
                    <Progress :model-value="95" tone="danger" size="sm" />
                </div>
            </div>

            <div class="flex items-center gap-2 pt-2">
                <Button size="sm" variant="secondary" @click="progressValue = Math.max(0, progressValue - 10)">-10%</Button>
                <Button size="sm" variant="secondary" @click="progressValue = Math.min(100, progressValue + 10)">+10%</Button>
            </div>
        </div>
    </FixtureShell>
</template>
