<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Avatar, {type AvatarShape, type AvatarSize} from "../../../../src/components/display/Avatar.vue";
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
const shape = computed<AvatarShape>(() => (controls.value.shape as AvatarShape) || "squircle");
const size = computed<AvatarSize>(() => (controls.value.size as AvatarSize) || "md");

const characters = [
    {name: "林澈", fallback: "LC", role: "主角 · 神经调试师"},
    {name: "阿九", fallback: "AJ", role: "配角 · 黑市情报贩"},
    {name: "荒坂科研部", fallback: "AK", role: "势力 · 巨型财阀"},
    {name: "Ghost Protocol", fallback: "GP", role: "AI 协议"},
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
        <div class="macos-compact-card space-y-6">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                头像与人物徽标 (Avatar)
            </h3>

            <!-- 各种尺寸与形态 -->
            <div class="flex items-center gap-4 flex-wrap">
                <Avatar
                    id="nb-lab-target"
                    fallback="NB"
                    :shape="shape"
                    size="xs"
                />
                <Avatar
                    fallback="NB"
                    :shape="shape"
                    size="sm"
                />
                <Avatar
                    fallback="NB"
                    :shape="shape"
                    size="md"
                />
                <Avatar
                    fallback="NB"
                    :shape="shape"
                    size="lg"
                />
                <Avatar
                    fallback="NB"
                    :shape="shape"
                    size="xl"
                />
            </div>

            <!-- 人物角色列表应用示例 -->
            <div class="pt-4 border-t border-[var(--divider)] space-y-3">
                <div
                    v-for="char in characters"
                    :key="char.name"
                    class="flex items-center gap-3 p-2 rounded-[var(--radius-control)] hover:bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] transition-colors"
                >
                    <Avatar
                        :fallback="char.fallback"
                        :shape="shape"
                        :size="size"
                    />
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">{{ char.name }}</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">{{ char.role }}</span>
                    </div>
                </div>
            </div>
        </div>
    </FixtureShell>
</template>
