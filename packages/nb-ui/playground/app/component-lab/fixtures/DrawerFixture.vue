<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Drawer from "../../../../src/components/feedback/Drawer.vue";
import Button from "../../../../src/components/controls/Button.vue";
import Badge from "../../../../src/components/display/Badge.vue";
import FormInput from "../../../../src/components/form/FormInput.vue";
import FormTextarea from "../../../../src/components/form/FormTextarea.vue";
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
const drawerOpen = ref(false);

const direction = computed(() => (controls.value.direction as any) || "right");
const handle = computed(() => Boolean(controls.value.handle));

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
                侧边抽屉面板 (Drawer)
            </h3>

            <div class="flex items-center gap-3">
                <Drawer
                    id="nb-lab-target"
                    v-model:open="drawerOpen"
                    :direction="direction"
                    :handle="handle"
                    title="世界观与人物设定详情"
                    description="长篇写作设定集快速侧边栏"
                    @update:open="emit('lab-event', 'update:open', $event)"
                >
                    <template #trigger>
                        <Button variant="primary" icon-class="i-lucide-panel-right">
                            打开设定集抽屉 ({{ direction }})
                        </Button>
                    </template>

                    <div class="space-y-4 py-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-[var(--text-main)]">主要出场人物</span>
                            <Badge size="sm" tone="accent">核心主角</Badge>
                        </div>

                        <div>
                            <span class="block text-xs font-medium text-[var(--text-secondary)] mb-1">人物姓名</span>
                            <FormInput model-value="林澈 (Lin Che)" />
                        </div>

                        <div>
                            <span class="block text-xs font-medium text-[var(--text-secondary)] mb-1">义体与背景设定</span>
                            <FormTextarea
                                model-value="前荒坂第七生化实验室首席深潜者，三年前在特异奇点事故中脱离组织，目前在新东京下层街区以自由义体调试师身份隐居。"
                                :rows="4"
                            />
                        </div>
                    </div>

                    <template #footer>
                        <Button size="sm" variant="secondary" @click="drawerOpen = false">取消</Button>
                        <Button size="sm" variant="primary" @click="drawerOpen = false">保存设定</Button>
                    </template>
                </Drawer>
            </div>
        </div>
    </FixtureShell>
</template>
