<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Editable, {type EditableSize} from "../../../../src/components/controls/Editable.vue";
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
const chapterTitle = ref("第03章：幽灵协议与量子密钥");
const characterName = ref("林澈 (Lin Che)");
const characterRole = ref("前荒坂第七生化实验室首席深潜调试师");

const size = computed<EditableSize>(() => (controls.value.size as EditableSize) || "md");
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
        <div class="macos-compact-card space-y-6">
            <h3 class="text-sm font-bold text-[var(--text-main)] pb-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                行内就地即时编辑 (Editable)
            </h3>

            <div class="space-y-4">
                <!-- 章节标题重命名 -->
                <div>
                    <span class="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">章节大纲标题 (点击或铅笔图标编辑):</span>
                    <Editable
                        id="nb-lab-target"
                        v-model="chapterTitle"
                        :size="size"
                        :disabled="disabled"
                        placeholder="输入章节标题..."
                        @submit="emit('lab-event', 'submit', $event)"
                    />
                </div>

                <!-- 角色名称修改 -->
                <div class="pt-3 border-t border-[var(--divider)]">
                    <span class="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">核心角色档案姓名:</span>
                    <Editable
                        v-model="characterName"
                        size="lg"
                        :disabled="disabled"
                    />
                </div>

                <!-- 角色头衔说明 -->
                <div>
                    <span class="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">角色身份描述:</span>
                    <Editable
                        v-model="characterRole"
                        size="sm"
                        :disabled="disabled"
                    />
                </div>
            </div>
        </div>
    </FixtureShell>
</template>
