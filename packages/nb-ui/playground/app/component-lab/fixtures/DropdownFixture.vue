<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";
import Button from "../../../../src/components/controls/Button.vue";
import Dropdown from "../../../../src/components/controls/Dropdown.vue";
import type {DropdownItem} from "../../../../src/components/controls/dropdown.types";
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

const menuItems: DropdownItem[] = [
    {label: "复制", value: "copy", iconClass: "i-lucide-copy"},
    {label: "重命名", value: "rename", iconClass: "i-lucide-pencil"},
    {label: "归档（不可用）", value: "archive", iconClass: "i-lucide-archive", disabled: true},
    {label: "", value: "sep", separator: true},
    {label: "删除", value: "delete", iconClass: "i-lucide-trash-2", tone: "danger"},
];

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
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
        <div id="nb-lab-target">
            <Dropdown
                :items="menuItems"
                :compact="Boolean(controls.compact)"
                @select="report('select', {value: $event})"
            >
                <Button variant="secondary">
                    操作菜单
                    <span class="i-lucide-chevron-down" aria-hidden="true"></span>
                </Button>
            </Dropdown>
        </div>
    </FixtureShell>
</template>
