<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Rating, {type RatingSize} from "../../../../src/components/display/Rating.vue";
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
const score1 = ref(4);
const score2 = ref(5);
const score3 = ref(3);

const size = computed<RatingSize>(() => (controls.value.size as RatingSize) || "md");
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
                星级评分条 (Rating)
            </h3>

            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">章节情节紧凑度</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">读者反馈与主线张力</span>
                    </div>
                    <Rating
                        id="nb-lab-target"
                        v-model="score1"
                        :size="size"
                        :disabled="disabled"
                        @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    />
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">世界观设定严谨度</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">科技树与社会结构自洽</span>
                    </div>
                    <Rating
                        v-model="score2"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">人物心理刻画深度</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">动机与戏剧冲突弧光</span>
                    </div>
                    <Rating
                        v-model="score3"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>
            </div>
        </div>
    </FixtureShell>
</template>
