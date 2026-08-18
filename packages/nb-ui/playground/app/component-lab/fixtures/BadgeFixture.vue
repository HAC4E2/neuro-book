<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";
import Badge, {type BadgeSize, type BadgeTone, type BadgeVariant} from "../../../../src/components/display/Badge.vue";
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
        <div class="lab-fixture__center">
            <Badge
                id="nb-lab-target"
                :tone="(controls.tone ?? 'accent') as BadgeTone"
                :variant="(controls.variant ?? 'soft') as BadgeVariant"
                :size="(controls.size ?? 'md') as BadgeSize"
                :dot="sceneId === 'dot'"
                icon-class="i-lucide-check"
            >
                同步完成
            </Badge>
        </div>
    </FixtureShell>
</template>
