<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Kbd, {type KbdSize} from "../../../../src/components/display/Kbd.vue";
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
const size = computed<KbdSize>(() => (controls.value.size as KbdSize) || "md");

const shortcuts = [
    {action: "快速全局搜索 / 命令面板", keys: ["⌘", "K"]},
    {action: "保存当前章节草稿", keys: ["⌘", "S"]},
    {action: "开启全屏沉浸写作模式", keys: ["⌃", "⌘", "F"]},
    {action: "撤销上一段输入", keys: ["⌘", "Z"]},
    {action: "重做", keys: ["⇧", "⌘", "Z"]},
    {action: "智能续写与情节分支灵感", keys: ["⌥", "Space"]},
    {action: "添加行内词条批注", keys: ["⌘", "⌥", "N"]},
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
                快捷键帽 (Kbd) 与键盘流指令
            </h3>

            <div class="divide-y divide-[var(--divider)]">
                <div
                    v-for="item in shortcuts"
                    :key="item.action"
                    class="flex items-center justify-between py-2.5"
                >
                    <span class="text-xs font-medium text-[var(--text-main)]">{{ item.action }}</span>
                    <div class="flex items-center gap-1">
                        <Kbd
                            v-for="key in item.keys"
                            :key="key"
                            :size="size"
                        >
                            {{ key }}
                        </Kbd>
                    </div>
                </div>
            </div>
        </div>
    </FixtureShell>
</template>
