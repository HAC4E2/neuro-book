<script setup lang="ts">
import {computed, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import IconButton from "nbook/app/components/common/IconButton.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useTextToImageStore} from "nbook/app/stores/text-to-image";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {TextToImageAssetListItemDto} from "nbook/shared/dto/text-to-image.dto";

const props = defineProps<{
    modelValue: boolean;
    projectPath: string;
    asset: TextToImageAssetListItemDto | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "changed"): void;
}>();

const notification = useNotification();
const novelIdeStore = useNovelIdeStore();
const textToImageStore = useTextToImageStore();
const busyAction = ref<"retry" | "delete" | "source" | "">("");
const deleteConfirmationOpen = ref(false);
const providerReady = computed(() => textToImageStore.novelAiProviderInspection.state === "configured"
    && textToImageStore.novelAiProviderInspection.provider?.hasCredential === true);

const imageUrl = computed(() => {
    if (!props.asset) {
        return "";
    }
    return `/api/text-to-image/assets/${encodeURIComponent(props.asset.id)}/content?projectPath=${encodeURIComponent(props.projectPath)}`;
});

watch(() => props.modelValue, (visible) => {
    if (!visible) {
        deleteConfirmationOpen.value = false;
    }
});

function updateVisible(value: boolean): void {
    emit("update:modelValue", value);
}

function formatTime(value: string): string {
    return new Date(value).toLocaleString("zh-CN", {hour12: false});
}

/** 将历史图片的已编译提示词回填到手动生成草稿。 */
function applyToManualGeneration(): void {
    if (!props.asset) {
        return;
    }
    textToImageStore.updateGenerationDraft({
        prompt: props.asset.prompt,
        negativePrompt: props.asset.negativePrompt,
    });
    notification.success("已套用到手动生成提示词");
}

async function copyPrompt(): Promise<void> {
    if (!props.asset) {
        return;
    }
    try {
        await navigator.clipboard.writeText(props.asset.prompt);
        notification.success("提示词已复制");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "复制提示词失败"));
    }
}

async function retry(): Promise<void> {
    if (!props.asset || busyAction.value || !providerReady.value) {
        return;
    }
    busyAction.value = "retry";
    try {
        await $fetch(`/api/text-to-image/jobs/${encodeURIComponent(props.asset.jobId)}/retry`, {
            method: "POST",
            body: {projectPath: props.projectPath},
        });
        notification.success("已创建重新生成任务");
        emit("changed");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "重新生成失败"));
    } finally {
        busyAction.value = "";
    }
}

async function openSource(): Promise<void> {
    if (!props.asset?.sourcePath || busyAction.value) {
        return;
    }
    busyAction.value = "source";
    try {
        const opened = await novelIdeStore.selectWorkspacePath(props.asset.sourcePath, "permanent");
        if (!opened) {
            notification.warning("来源章节已不可用");
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "打开来源章节失败"));
    } finally {
        busyAction.value = "";
    }
}

async function deleteAsset(): Promise<void> {
    if (!props.asset || busyAction.value) {
        return;
    }
    busyAction.value = "delete";
    try {
        await $fetch(`/api/text-to-image/assets/${encodeURIComponent(props.asset.id)}`, {
            method: "DELETE",
            body: {projectPath: props.projectPath},
        });
        deleteConfirmationOpen.value = false;
        updateVisible(false);
        notification.success("历史图片已删除");
        emit("changed");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "删除图片失败"));
    } finally {
        busyAction.value = "";
    }
}
</script>

<template>
    <Dialog :model-value="props.modelValue" title="图片详情" size="xl" body-class="min-h-0 overflow-y-auto" @update:model-value="updateVisible">
        <div v-if="props.asset" class="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
            <!-- 图片预览 -->
            <div class="flex min-h-72 items-center justify-center bg-[var(--bg-input)] p-3">
                <img :src="imageUrl" :alt="props.asset.fileName" class="max-h-[62vh] max-w-full object-contain">
            </div>

            <!-- 元数据与操作 -->
            <div class="min-w-0 space-y-3 text-[12px] text-[var(--text-secondary)]">
                <div class="grid grid-cols-2 gap-x-3 gap-y-2">
                    <span class="truncate">模型</span><span class="truncate text-[var(--text-main)]">{{ props.asset.model }}</span>
                    <span>Seed</span><span class="text-[var(--text-main)]">{{ props.asset.seed }}</span>
                    <span>尺寸</span><span class="text-[var(--text-main)]">{{ props.asset.width }} x {{ props.asset.height }}</span>
                    <span>大小</span><span class="text-[var(--text-main)]">{{ Math.ceil(props.asset.byteLength / 1024) }} KB</span>
                    <span>来源</span><span class="truncate text-[var(--text-main)]">{{ props.asset.sourcePath || props.asset.sourceKind }}</span>
                    <span>创建时间</span><span class="text-[var(--text-main)]">{{ formatTime(props.asset.createdAt) }}</span>
                    <span>正文插入</span><span class="text-[var(--text-main)]">{{ props.asset.sourceInsertStatus }}</span>
                </div>

                <label class="block">
                    <span class="mb-1 block text-[11px] text-[var(--text-muted)]">正面提示词</span>
                    <textarea :value="props.asset.prompt" readonly rows="6" class="w-full resize-none border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[11px] leading-5 text-[var(--text-main)] outline-none"></textarea>
                </label>
                <label class="block">
                    <span class="mb-1 block text-[11px] text-[var(--text-muted)]">负面提示词</span>
                    <textarea :value="props.asset.negativePrompt" readonly rows="3" class="w-full resize-none border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[11px] leading-5 text-[var(--text-main)] outline-none"></textarea>
                </label>

                <div class="flex flex-wrap gap-2">
                    <IconButton title="复制提示词" size="sm" @click="void copyPrompt"><span class="i-lucide-copy h-4 w-4"></span></IconButton>
                    <IconButton title="套用到手动生成" size="sm" @click="applyToManualGeneration"><span class="i-lucide-wand-sparkles h-4 w-4"></span></IconButton>
                    <IconButton :title="providerReady ? '重新生成' : '请先收敛并配置唯一 NovelAI Provider'" size="sm" :disabled="busyAction !== '' || !providerReady" @click="void retry"><span class="i-lucide-rotate-ccw h-4 w-4"></span></IconButton>
                    <IconButton title="打开来源章节" size="sm" :disabled="!props.asset.sourcePath || busyAction !== ''" @click="void openSource"><span class="i-lucide-file-text h-4 w-4"></span></IconButton>
                    <IconButton title="删除图片" size="sm" :disabled="busyAction !== ''" @click="deleteConfirmationOpen = true"><span class="i-lucide-trash-2 h-4 w-4 text-[var(--danger-text)]"></span></IconButton>
                </div>
            </div>
        </div>
    </Dialog>

    <Dialog :model-value="deleteConfirmationOpen" title="删除历史图片" size="sm" :busy="busyAction === 'delete'" @update:model-value="deleteConfirmationOpen = $event">
        <p class="text-[13px] leading-6 text-[var(--text-secondary)]">删除后无法恢复。正文仍引用此图片时，系统会阻止删除。</p>
        <template #footer>
            <div class="flex justify-end gap-2">
                <button type="button" class="h-8 border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)]" @click="deleteConfirmationOpen = false">取消</button>
                <button type="button" class="h-8 border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 text-[12px] text-[var(--danger-text)]" :disabled="busyAction !== ''" @click="void deleteAsset">删除</button>
            </div>
        </template>
    </Dialog>
</template>
