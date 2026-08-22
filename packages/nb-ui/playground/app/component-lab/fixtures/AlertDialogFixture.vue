<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import AlertDialog, {type AlertDialogTone} from "../../../../src/components/feedback/AlertDialog.vue";
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
const alertOpen = ref(false);
const tone = computed<AlertDialogTone>(() => (controls.value.tone as AlertDialogTone) || "danger");

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
                破坏性警示弹窗 (AlertDialog)
            </h3>

            <div class="flex items-center gap-3">
                <AlertDialog
                    id="nb-lab-target"
                    v-model:open="alertOpen"
                    title="确定要彻底删除《第03章：幽灵协议》吗？"
                    description="此操作将永久抹除本地 SQLite 数据库及历史快照中的该章节数据，该操作不可逆。"
                    confirm-text="确认彻底删除"
                    cancel-text="暂不删除"
                    :tone="tone"
                    @confirm="emit('lab-event', 'confirm'); alertOpen = false"
                    @cancel="emit('lab-event', 'cancel'); alertOpen = false"
                >
                    <template #trigger>
                        <Button :variant="tone === 'danger' ? 'danger' : 'primary'" icon-class="i-lucide-trash-2">
                            触发二次确认弹窗 ({{ tone }})
                        </Button>
                    </template>
                </AlertDialog>
            </div>
        </div>
    </FixtureShell>
</template>
