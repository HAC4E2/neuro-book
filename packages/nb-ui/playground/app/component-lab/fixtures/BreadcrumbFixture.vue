<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Breadcrumb, {type BreadcrumbItemData} from "../../../../src/components/navigation/Breadcrumb.vue";
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

const items: BreadcrumbItemData[] = [
    {label: "我的书库", href: "#", iconClass: "i-lucide-library"},
    {label: "《赛博夜雨档案》", href: "#", iconClass: "i-lucide-book"},
    {label: "第一卷：深渊苏醒", href: "#"},
    {label: "第03章：幽灵协议.md", current: true, iconClass: "i-lucide-file-text"},
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
        <div class="macos-compact-card space-y-4">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                面包屑导航 (Breadcrumb)
            </h3>

            <div class="p-3.5 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Breadcrumb
                    id="nb-lab-target"
                    :items="items"
                    @click="(item) => emit('lab-event', 'click', item.label)"
                />
            </div>
        </div>
    </FixtureShell>
</template>
