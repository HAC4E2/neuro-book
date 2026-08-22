<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Autocomplete, {type AutocompleteOption} from "../../../../src/components/form/Autocomplete.vue";
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
const keyword = ref("");

const size = computed(() => (controls.value.size as any) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const worldBuildingOptions: AutocompleteOption[] = [
    {value: "荒坂第七实验室", label: "荒坂第七实验室", description: "深潜脑机接口与记忆芯片研发机构", iconClass: "i-lucide-building"},
    {value: "幽灵协议", label: "幽灵协议", description: "暗网反追踪底层加密通讯协议", iconClass: "i-lucide-shield-alert"},
    {value: "量子密钥生成器", label: "量子密钥生成器", description: "用于解密神经元突触加密锁的核心装置", iconClass: "i-lucide-key"},
    {value: "林澈 (Lin Che)", label: "林澈 (Lin Che)", description: "前首席深潜调试师，代号「渡鸦」", iconClass: "i-lucide-user"},
    {value: "下城区霓虹雨巷", label: "下城区霓虹雨巷", description: "地下反抗军聚集地与黑市交易中心", iconClass: "i-lucide-map-pin"},
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
        <div class="macos-compact-card space-y-6 max-w-md pb-24">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                自动联想补全 (Autocomplete)
            </h3>

            <div class="space-y-3">
                <span class="block text-xs font-semibold text-[var(--text-main)]">设定集词条与快捷插入搜索:</span>
                <Autocomplete
                    id="nb-lab-target"
                    v-model="keyword"
                    :options="worldBuildingOptions"
                    :size="size"
                    :disabled="disabled"
                    placeholder="键入关键词（如'荒坂'、'量子'、'林澈'）..."
                    @select="emit('lab-event', 'select', $event)"
                />
            </div>
        </div>
    </FixtureShell>
</template>
